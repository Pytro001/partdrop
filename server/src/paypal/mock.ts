// A faithful local fake of the PayPal REST endpoints PartDrop uses, mounted at /mock-paypal.
// Same paths, request bodies, response shapes, status values and error names as the
// sandbox, plus signed webhooks (SHA256withRSA with a TEST ONLY key). No money moves.
// Used when PAYPAL_MODE=mock, which is the mode the demo film was recorded in.
import express, { type Request, type Response } from 'express'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sign as rsaSign, verify as rsaVerify } from 'node:crypto'
import { signedMessage, type Authorization, type Capture, type PayPalOrder, type PayoutBatch } from './client.ts'

const CERT_DIR = resolve(import.meta.dirname, '../../mock-cert')
const KEY = readFileSync(resolve(CERT_DIR, 'mock-signing-key.pem'), 'utf8')
const CERT = readFileSync(resolve(CERT_DIR, 'mock-signing-cert.pem'), 'utf8')

export const MOCK_CLIENT_ID = 'mock-client-id'
export const MOCK_CLIENT_SECRET = 'mock-client-secret'
export const MOCK_WEBHOOK_ID = 'WH-MOCK-PARTDROP-0001'

// PayPal style ids (17 upper case alphanumerics), seeded so a film run is repeatable.
const SEED0 = () => (process.env.DETERMINISTIC_IDS === '1' ? 0x5eed : (Math.random() * 2 ** 31) | 0)
let seed = SEED0()
const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const AL = 'ABCDEFGHJKLMNPRSTUVWXY0123456789'
function ppid(n = 17) { let s = ''; for (let i = 0; i < n; i++) s += AL[Math.floor(rand() * AL.length)]; return s }

const orders = new Map<string, PayPalOrder>()
const auths = new Map<string, Authorization & { order_id: string }>()
const captures = new Map<string, Capture>()
const payouts = new Map<string, PayoutBatch>()
const requestIds = new Map<string, unknown>()
const vaults = new Set<string>()

export function resetMock() {
  seed = SEED0()
  orders.clear(); auths.clear(); captures.clear(); payouts.clear(); requestIds.clear()
}

/** A vaulted PayPal wallet the demo buyer saved for their purchasing agent. */
export function mockVaultId() { const id = 'MOCKVAULT8BRKT50'; vaults.add(id); return id }

const now = () => new Date().toISOString()
const plusDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString()

function err(res: Response, status: number, name: string, issue: string, description: string) {
  res.status(status).json({ name, message: description, debug_id: ppid(13).toLowerCase(), details: [{ issue, description }], links: [{ href: `https://developer.paypal.com/docs/api/orders/v2/#error-${issue}`, rel: 'information_link', method: 'GET' }] })
}

export function mockRouter(opts: { publicBase: () => string; webhookTarget: () => string }) {
  const r = express.Router()
  const api = () => opts.publicBase() + '/mock-paypal'

  // ---- webhooks -------------------------------------------------------------
  function emit(event_type: string, resource_type: string, resource: unknown, summary: string) {
    const event = { id: `WH-${ppid(17)}-${ppid(17)}`, event_version: '1.0', create_time: now(), resource_type, resource_version: '2.0', event_type, summary, resource, links: [] }
    const raw = Buffer.from(JSON.stringify(event))
    const h = { transmissionId: crypto.randomUUID(), transmissionTime: now() }
    const sig = rsaSign('sha256', Buffer.from(signedMessage(h, MOCK_WEBHOOK_ID, raw)), KEY).toString('base64')
    setTimeout(() => {
      fetch(opts.webhookTarget(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'paypal-transmission-id': h.transmissionId,
          'paypal-transmission-time': h.transmissionTime,
          'paypal-transmission-sig': sig,
          'paypal-cert-url': `${api()}/v1/notifications/certs/CERT-mock-partdrop`,
          'paypal-auth-algo': 'SHA256withRSA',
        },
        body: raw,
      }).catch(e => console.warn('[mock-paypal] webhook delivery failed', e.message))
    }, 60)
  }

  r.get('/v1/notifications/certs/:id', (_q, s) => { s.type('application/x-pem-file').send(CERT) })

  // ---- auth -------------------------------------------------------------------
  r.post('/v1/oauth2/token', express.urlencoded({ extended: false }), (q, s) => {
    const b = (q.headers.authorization || '').replace(/^Basic /, '')
    const [id, secret] = Buffer.from(b, 'base64').toString().split(':')
    if (id !== MOCK_CLIENT_ID || secret !== MOCK_CLIENT_SECRET) return s.status(401).json({ error: 'invalid_client', error_description: 'Client Authentication failed' })
    s.json({ scope: 'https://uri.paypal.com/services/payments/payment/authcapture https://uri.paypal.com/services/payments/payouts', access_token: `A21AA${ppid(40)}`, token_type: 'Bearer', app_id: 'APP-MOCK00PARTDROP', expires_in: 32400, nonce: `${now()}${ppid(20)}` })
  })

  r.use((q, s, n) => {
    if (q.path.startsWith('/checkoutnow') || q.path.startsWith('/v1/notifications/certs')) return n()
    if (!/^Bearer A21AA/.test(q.headers.authorization || '')) return s.status(401).json({ error: 'invalid_token', error_description: 'Token signature verification failed' })
    n()
  })
  r.use(express.json())

  // idempotency: same PayPal-Request-Id returns the stored response
  function idem(q: Request, s: Response, make: () => [number, unknown]) {
    const rid = q.headers['paypal-request-id'] as string | undefined
    if (rid && requestIds.has(rid)) return s.status(200).json(requestIds.get(rid))
    const [code, body] = make()
    if (rid && code < 300) requestIds.set(rid, body)
    if (body === undefined) return s.status(code).end()
    s.status(code).json(body)
  }

  // ---- Orders v2 --------------------------------------------------------------
  const orderLinks = (o: PayPalOrder): PayPalOrder['links'] => {
    const self = { href: `${api()}/v2/checkout/orders/${o.id}`, rel: 'self', method: 'GET' }
    if (o.status === 'CREATED') return [self, { href: `${api()}/checkoutnow?token=${o.id}`, rel: 'approve', method: 'GET' }, { href: self.href, rel: 'update', method: 'PATCH' }, { href: `${self.href}/authorize`, rel: 'authorize', method: 'POST' }]
    if (o.status === 'APPROVED') return [self, { href: self.href, rel: 'update', method: 'PATCH' }, { href: `${self.href}/authorize`, rel: 'authorize', method: 'POST' }]
    return [self]
  }

  function authorizeInto(o: PayPalOrder) {
    const pu = o.purchase_units[0]
    const id = ppid()
    const a: Authorization & { order_id: string } = {
      id, status: 'CREATED', amount: pu.amount, invoice_id: pu.invoice_id, custom_id: pu.custom_id,
      seller_protection: { status: 'ELIGIBLE', dispute_categories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] },
      expiration_time: plusDays(29), create_time: now(), update_time: now(), order_id: o.id,
      links: [
        { href: `${api()}/v2/payments/authorizations/${id}`, rel: 'self', method: 'GET' },
        { href: `${api()}/v2/payments/authorizations/${id}/capture`, rel: 'capture', method: 'POST' },
        { href: `${api()}/v2/payments/authorizations/${id}/void`, rel: 'void', method: 'POST' },
        { href: `${api()}/v2/payments/authorizations/${id}/reauthorize`, rel: 'reauthorize', method: 'POST' },
        { href: `${api()}/v2/checkout/orders/${o.id}`, rel: 'up', method: 'GET' },
      ],
    }
    auths.set(id, a)
    o.status = 'COMPLETED'
    o.update_time = now()
    const { order_id: _o, ...pub } = a
    pu.payments = { authorizations: [pub] }
    o.links = orderLinks(o)
    emit('PAYMENT.AUTHORIZATION.CREATED', 'authorization', pub, `Payment authorized for $ ${pu.amount.value} USD`)
  }

  r.post('/v2/checkout/orders', (q, s) => idem(q, s, () => {
    const b = q.body
    if (b?.intent !== 'AUTHORIZE' && b?.intent !== 'CAPTURE') return [400, { name: 'INVALID_REQUEST', message: 'intent is required', details: [{ field: '/intent', issue: 'MISSING_REQUIRED_PARAMETER' }] }]
    const pu = b.purchase_units?.[0]
    if (!pu?.amount?.value) return [400, { name: 'INVALID_REQUEST', message: 'amount is required', details: [{ field: '/purchase_units/@reference_id==\'default\'/amount', issue: 'MISSING_REQUIRED_PARAMETER' }] }]
    const o: PayPalOrder = { id: ppid(), status: 'CREATED', intent: b.intent, purchase_units: [{ ...pu, reference_id: pu.reference_id ?? 'default' }], create_time: now(), links: [] }
    const vault = b.payment_source?.paypal?.vault_id
    if (vault) {
      if (!vaults.has(vault)) return [422, { name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed', details: [{ issue: 'INVALID_VAULT_ID', description: 'The vault_id is invalid' }] }]
      // merchant initiated: no buyer redirect, the order authorizes on create
      o.payment_source = { paypal: { email_address: 'agent-wallet@buyer.example', account_id: 'MOCKPAYER7Q2', attributes: { vault: { id: vault, status: 'VAULTED' } } } }
      o.payer = { email_address: 'agent-wallet@buyer.example', payer_id: 'MOCKPAYER7Q2' }
      orders.set(o.id, o)
      authorizeInto(o)
      return [201, o]
    }
    o.links = orderLinks(o)
    orders.set(o.id, o)
    return [201, o]
  }))

  r.get('/v2/checkout/orders/:id', (q, s) => {
    const o = orders.get(String(q.params.id))
    if (!o) return err(s, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
    s.json(o)
  })

  r.post('/v2/checkout/orders/:id/authorize', (q, s) => {
    const o = orders.get(String(q.params.id))
    if (!o) return err(s, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
    if (o.intent !== 'AUTHORIZE') return err(s, 422, 'UNPROCESSABLE_ENTITY', 'ACTION_DOES_NOT_MATCH_INTENT', 'Order was created with an intent to CAPTURE.')
    if (o.status === 'COMPLETED') return err(s, 422, 'UNPROCESSABLE_ENTITY', 'ORDER_ALREADY_AUTHORIZED', 'Order already authorized.')
    if (o.status !== 'APPROVED') return err(s, 422, 'UNPROCESSABLE_ENTITY', 'ORDER_NOT_APPROVED', 'Payer has not yet approved the Order for payment.')
    idem(q, s, () => { authorizeInto(o); return [201, o] })
  })

  // ---- the approval page the "approve" link points to ---------------------------
  r.get('/checkoutnow', (q, s) => {
    const o = orders.get(String(q.query.token))
    if (!o) return s.status(404).send('Unknown order')
    const v = o.purchase_units[0].amount.value
    s.type('html').send(approvePage(o.id, v, o.purchase_units[0].description ?? ''))
  })
  r.post('/checkoutnow/approve', express.json(), (q, s) => {
    const o = orders.get(String(q.body?.token))
    if (!o) return s.status(404).json({ error: 'unknown order' })
    if (o.status !== 'CREATED') return s.status(409).json({ error: `order is ${o.status}` })
    o.status = 'APPROVED'
    o.payer = { email_address: 'sb-buyer@personal.example', payer_id: 'MOCKPAYER7Q2', name: { given_name: 'Sandbox', surname: 'Buyer' } }
    o.payment_source = { paypal: { email_address: o.payer.email_address, account_id: o.payer.payer_id, account_status: 'VERIFIED' } }
    o.update_time = now()
    o.links = orderLinks(o)
    emit('CHECKOUT.ORDER.APPROVED', 'checkout-order', o, 'An order has been approved by buyer')
    s.json({ orderID: o.id, payerID: o.payer.payer_id })
  })

  // ---- Payments v2 ------------------------------------------------------------
  r.get('/v2/payments/authorizations/:id', (q, s) => {
    const a = auths.get(String(q.params.id))
    if (!a) return err(s, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
    const { order_id: _o, ...pub } = a
    s.json(pub)
  })

  r.post('/v2/payments/authorizations/:id/capture', (q, s) => {
    const a = auths.get(String(q.params.id))
    if (!a) return err(s, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
    if (a.status === 'VOIDED') return err(s, 422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_VOIDED', 'A voided authorization cannot be captured.')
    if (a.status === 'CAPTURED') return err(s, 422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_ALREADY_CAPTURED', 'Authorization has been previously captured and hence cannot be voided or captured.')
    if (Date.parse(a.expiration_time!) < Date.now()) return err(s, 422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_EXPIRED', 'An expired authorization cannot be captured.')
    idem(q, s, () => {
      const value = q.body?.amount?.value ?? a.amount.value
      if (Number(value) > Number(a.amount.value) * 1.15 + 75) return [422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'MAX_CAPTURE_AMOUNT_EXCEEDED' }] }]
      const gross = Number(value)
      const fee = Math.round((gross * 0.0349 + 0.49) * 100) / 100 // mock fee table: 3.49% + 0.49
      const id = ppid()
      const c: Capture = {
        id, status: 'COMPLETED', amount: { currency_code: 'USD', value: gross.toFixed(2) }, final_capture: q.body?.final_capture ?? true,
        invoice_id: q.body?.invoice_id ?? a.invoice_id,
        seller_receivable_breakdown: { gross_amount: { currency_code: 'USD', value: gross.toFixed(2) }, paypal_fee: { currency_code: 'USD', value: fee.toFixed(2) }, net_amount: { currency_code: 'USD', value: (gross - fee).toFixed(2) } },
        create_time: now(), update_time: now(),
        links: [
          { href: `${api()}/v2/payments/captures/${id}`, rel: 'self', method: 'GET' },
          { href: `${api()}/v2/payments/captures/${id}/refund`, rel: 'refund', method: 'POST' },
          { href: `${api()}/v2/payments/authorizations/${a.id}`, rel: 'up', method: 'GET' },
        ],
      }
      captures.set(id, c)
      a.status = 'CAPTURED'; a.update_time = now()
      emit('PAYMENT.CAPTURE.COMPLETED', 'capture', c, `Payment completed for $ ${c.amount.value} USD`)
      return [201, c]
    })
  })

  r.get('/v2/payments/captures/:id', (q, s) => {
    const c = captures.get(String(q.params.id))
    if (!c) return err(s, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
    s.json(c)
  })

  r.post('/v2/payments/authorizations/:id/void', (q, s) => {
    const a = auths.get(String(q.params.id))
    if (!a) return err(s, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
    if (a.status === 'CAPTURED') return err(s, 422, 'UNPROCESSABLE_ENTITY', 'PREVIOUSLY_CAPTURED', 'Authorization has been previously captured and hence cannot be voided.')
    if (a.status === 'VOIDED') return err(s, 422, 'UNPROCESSABLE_ENTITY', 'PREVIOUSLY_VOIDED', 'Authorization has been previously voided and hence cannot be voided again.')
    idem(q, s, () => {
      a.status = 'VOIDED'; a.update_time = now()
      const { order_id: _o, ...pub } = a
      emit('PAYMENT.AUTHORIZATION.VOIDED', 'authorization', pub, `A payment authorization was voided`)
      return String(q.headers.prefer).includes('representation') ? [200, pub] : [204, undefined]
    })
  })

  // ---- Payouts v1 ---------------------------------------------------------------
  r.post('/v1/payments/payouts', (q, s) => {
    const b = q.body
    const sb = b?.sender_batch_header?.sender_batch_id
    if (!sb || !b.items?.length) return s.status(400).json({ name: 'VALIDATION_ERROR', message: 'Invalid request - see details', details: [{ field: 'sender_batch_header.sender_batch_id', location: 'body', issue: 'Required field missing' }] })
    if ([...payouts.values()].some(p => p.batch_header.sender_batch_header.sender_batch_id === sb)) return s.status(400).json({ name: 'USER_BUSINESS_ERROR', message: 'User business error.', details: [{ field: 'SENDER_BATCH_ID', location: 'body', issue: 'Batch with given sender_batch_id already exists' }] })
    const id = ppid(13)
    const total = b.items.reduce((a: number, i: any) => a + Number(i.amount.value), 0)
    const batch: PayoutBatch = {
      batch_header: { payout_batch_id: id, batch_status: 'PENDING', sender_batch_header: b.sender_batch_header, time_created: now(), amount: { currency: 'USD', value: total.toFixed(2) }, fees: { currency: 'USD', value: '0.25' } },
      items: b.items.map((i: any) => ({ payout_item_id: ppid(13), transaction_status: 'PENDING', payout_batch_id: id, payout_item: { recipient_type: i.recipient_type, amount: i.amount, receiver: i.receiver, note: i.note, sender_item_id: i.sender_item_id } })),
      links: [{ href: `${api()}/v1/payments/payouts/${id}`, rel: 'self', method: 'GET' }],
    }
    payouts.set(id, batch)
    setTimeout(() => {
      batch.batch_header.batch_status = 'SUCCESS'
      batch.batch_header.time_completed = now()
      for (const it of batch.items!) { it.transaction_status = 'SUCCESS'; it.transaction_id = ppid(17); it.time_processed = now() }
      emit('PAYMENT.PAYOUTSBATCH.SUCCESS', 'payouts', { batch_header: batch.batch_header, links: batch.links }, 'Payouts batch completed successfully.')
    }, 1200)
    s.status(201).json({ batch_header: { sender_batch_header: b.sender_batch_header, payout_batch_id: id, batch_status: 'PENDING' }, links: batch.links })
  })

  r.get('/v1/payments/payouts/:id', (q, s) => {
    const p = payouts.get(String(q.params.id))
    if (!p) return s.status(404).json({ name: 'INVALID_RESOURCE_ID', message: 'The requested resource ID was not found' })
    s.json(p)
  })

  // ---- webhook postback verification -----------------------------------------------
  r.post('/v1/notifications/verify-webhook-signature', (q, s) => {
    const b = q.body
    try {
      const raw = Buffer.from(JSON.stringify(b.webhook_event))
      const ok = rsaVerify('sha256', Buffer.from(signedMessage({ transmissionId: b.transmission_id, transmissionTime: b.transmission_time }, b.webhook_id, raw)), CERT, Buffer.from(b.transmission_sig, 'base64'))
      s.json({ verification_status: ok && b.webhook_id === MOCK_WEBHOOK_ID ? 'SUCCESS' : 'FAILURE' })
    } catch {
      s.json({ verification_status: 'FAILURE' })
    }
  })

  return r
}

function approvePage(id: string, value: string, desc: string) {
  const esc = (x: string) => x.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock checkout</title>
<style>
body{margin:0;font:15px/1.4 Inter,system-ui,sans-serif;background:#f4f6f9;color:#1b2333}
.w{max-width:420px;margin:0 auto;padding:28px 26px}
.tag{display:inline-block;font:600 11px/1 ui-monospace,monospace;letter-spacing:.08em;background:#ffd84d;color:#3b2f00;padding:6px 8px;border-radius:4px}
h1{font-size:22px;margin:16px 0 4px}.m{color:#5b6577;font-size:13px}
.card{background:#fff;border:1px solid #dde3ec;border-radius:12px;padding:18px;margin:18px 0}
.row{display:flex;justify-content:space-between;margin:6px 0}.big{font-size:30px;font-weight:700}
button{width:100%;padding:14px;border:0;border-radius:24px;font:600 16px Inter,system-ui;cursor:pointer;margin-top:10px}
.ok{background:#1b2333;color:#fff}.no{background:#e7ebf1;color:#1b2333}button:focus-visible{outline:3px solid #2b6cff;outline-offset:2px}
</style></head><body><div class="w">
<span class="tag">MOCK PAYPAL, LOCAL FAKE, NO MONEY MOVES</span>
<h1>Approve payment</h1><div class="m">Signed in as sandbox buyer (mock): sb-buyer@personal.example</div>
<div class="card"><div class="m">${esc(desc)}</div><div class="big">$${esc(value)} USD</div>
<div class="row m"><span>Pay with</span><span>Mock wallet balance</span></div>
<div class="row m"><span>Order</span><span>${esc(id)}</span></div>
<div class="row m"><span>Intent</span><span>AUTHORIZE, funds held until the part passes inspection</span></div></div>
<button class="ok" id="ok" data-film="mock-approve">Approve and hold funds</button><button class="no" id="no">Cancel</button>
</div><script>
const send=m=>{(window.opener||window.parent).postMessage(m,location.origin)};
document.getElementById('ok').onclick=async()=>{const r=await fetch('checkoutnow/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:${JSON.stringify(id)}})});const j=await r.json();send({type:'mock-paypal',event:'approve',orderID:j.orderID,payerID:j.payerID})};
document.getElementById('no').onclick=()=>send({type:'mock-paypal',event:'cancel'});
</script></body></html>`
}
