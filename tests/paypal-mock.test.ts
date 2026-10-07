// Runs the real PayPal client against the local mock: Orders v2 authorize, capture, void,
// Payouts, idempotency, error names, and offline webhook signature verification.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { PayPalClient, PayPalError, verifyWebhookOffline, webhookHeaders } from '../server/src/paypal/client.ts'
import { MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_WEBHOOK_ID, mockRouter, mockVaultId } from '../server/src/paypal/mock.ts'

let base = ''
let server: ReturnType<express.Express['listen']>
const hooks: { raw: Buffer; headers: Record<string, string> }[] = []
let pp: PayPalClient

beforeAll(async () => {
  const app = express()
  app.post('/hook', express.raw({ type: '*/*' }), (q, s) => { hooks.push({ raw: q.body, headers: q.headers as Record<string, string> }); s.json({ ok: true }) })
  app.use('/mock-paypal', mockRouter({ publicBase: () => base, webhookTarget: () => `${base}/hook` }))
  await new Promise<void>(r => { server = app.listen(0, () => r()) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  pp = new PayPalClient('mock', `${base}/mock-paypal`, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET)
})
afterAll(() => server.close())

const order = (total: number, vault_id?: string) => pp.createOrder({ reference_id: 'r', description: 'd', custom_id: 'c', invoice_id: `inv-${Math.random()}`, total, item: { name: 'n', sku: 's', description: 'x' }, vault_id }, `req-${Math.random()}`)
const approve = (id: string) => fetch(`${base}/mock-paypal/checkoutnow/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: id }) })
const settle = () => new Promise(r => setTimeout(r, 250))

describe('mock PayPal REST API', () => {
  it('rejects bad client credentials', async () => {
    const bad = new PayPalClient('mock', `${base}/mock-paypal`, 'x', 'y')
    await expect(bad.getOrder('NOPE')).rejects.toBeInstanceOf(PayPalError)
  })
  it('CREATED, then 422 ORDER_NOT_APPROVED, then APPROVED and authorized', async () => {
    const o = await order(123.45)
    expect(o.status).toBe('CREATED')
    expect(o.links.find(l => l.rel === 'approve')).toBeTruthy()
    await expect(pp.authorizeOrder(o.id, 'a1')).rejects.toMatchObject({ status: 422, body: { details: [{ issue: 'ORDER_NOT_APPROVED' }] } })
    await approve(o.id)
    expect((await pp.getOrder(o.id)).status).toBe('APPROVED')
    const done = await pp.authorizeOrder(o.id, 'a2')
    expect(done.status).toBe('COMPLETED')
    const auth = done.purchase_units[0].payments!.authorizations![0]
    expect(auth.status).toBe('CREATED')
    expect(auth.amount.value).toBe('123.45')
  })
  it('captures an authorization once, with fee breakdown, and refuses a second capture or a void', async () => {
    const o = await order(500); await approve(o.id)
    const a = (await pp.authorizeOrder(o.id, `a-${o.id}`)).purchase_units[0].payments!.authorizations![0]
    const c = await pp.captureAuthorization(a.id, { amount: 500, invoice_id: 'i', note_to_payer: 'n' }, `c-${o.id}`)
    expect(c.status).toBe('COMPLETED')
    expect(Number(c.seller_receivable_breakdown!.paypal_fee.value)).toBeGreaterThan(0)
    expect((await pp.getAuthorization(a.id)).status).toBe('CAPTURED')
    await expect(pp.captureAuthorization(a.id, { amount: 500, invoice_id: 'i', note_to_payer: 'n' }, 'c-other')).rejects.toMatchObject({ body: { details: [{ issue: 'AUTHORIZATION_ALREADY_CAPTURED' }] } })
    await expect(pp.voidAuthorization(a.id, 'v')).rejects.toMatchObject({ body: { details: [{ issue: 'PREVIOUSLY_CAPTURED' }] } })
  })
  it('same PayPal-Request-Id returns the same capture (idempotent)', async () => {
    const o = await order(80); await approve(o.id)
    const a = (await pp.authorizeOrder(o.id, `a-${o.id}`)).purchase_units[0].payments!.authorizations![0]
    const c1 = await pp.captureAuthorization(a.id, { amount: 80, invoice_id: 'i', note_to_payer: 'n' }, 'same-key')
    const c2 = await pp.captureAuthorization(a.id, { amount: 80, invoice_id: 'i', note_to_payer: 'n' }, 'same-key')
    expect(c2.id).toBe(c1.id)
  })
  it('voids an authorization and then refuses to capture it', async () => {
    const o = await order(42); await approve(o.id)
    const a = (await pp.authorizeOrder(o.id, `a-${o.id}`)).purchase_units[0].payments!.authorizations![0]
    await pp.voidAuthorization(a.id, `v-${o.id}`)
    expect((await pp.getAuthorization(a.id)).status).toBe('VOIDED')
    await expect(pp.captureAuthorization(a.id, { amount: 42, invoice_id: 'i', note_to_payer: 'n' }, 'c')).rejects.toMatchObject({ body: { details: [{ issue: 'AUTHORIZATION_VOIDED' }] } })
  })
  it('vaulted wallet orders authorize on create (agent path)', async () => {
    const o = await order(2069.9, mockVaultId())
    expect(o.status).toBe('COMPLETED')
    expect(o.purchase_units[0].payments!.authorizations![0].status).toBe('CREATED')
  })
  it('payout goes PENDING then SUCCESS, duplicate batch ids are refused', async () => {
    const b = await pp.createPayout({ sender_batch_id: 'batch-1', receiver: 'shop@example.com', amount: 100, note: 'n', sender_item_id: 'o1' })
    expect(b.batch_header.batch_status).toBe('PENDING')
    await new Promise(r => setTimeout(r, 1500))
    const g = await pp.getPayout(b.batch_header.payout_batch_id)
    expect(g.batch_header.batch_status).toBe('SUCCESS')
    expect(g.items![0].transaction_status).toBe('SUCCESS')
    await expect(pp.createPayout({ sender_batch_id: 'batch-1', receiver: 'x@y.z', amount: 1, note: 'n', sender_item_id: 'o2' })).rejects.toBeInstanceOf(PayPalError)
  })
  it('webhooks verify offline with the cert, and a tampered body fails', async () => {
    await settle()
    expect(hooks.length).toBeGreaterThan(3)
    const h = hooks.at(-1)!
    const hh = webhookHeaders(k => h.headers[k])!
    const origin = new URL(base).origin
    expect((await verifyWebhookOffline(hh, MOCK_WEBHOOK_ID, h.raw, [origin])).ok).toBe(true)
    const tampered = Buffer.from(h.raw.toString().replace('SUCCESS', 'FAILURE').replace('COMPLETED', 'DENIED'))
    expect((await verifyWebhookOffline(hh, MOCK_WEBHOOK_ID, tampered, [origin])).ok).toBe(false)
    expect((await verifyWebhookOffline(hh, 'WH-OTHER', h.raw, [origin])).ok).toBe(false)
    expect((await verifyWebhookOffline(hh, MOCK_WEBHOOK_ID, h.raw, ['https://api.paypal.com'])).ok).toBe(false)
  })
})
