// Order and money flow. Every PayPal call that moves or holds money writes a ledger entry
// with the evidence that triggered it.
import { EventEmitter } from 'node:events'
import type { InspectionResult, Job, LedgerEntry, MoneyState, Order, Quote } from '../../shared/types.ts'
import { paypal, paypalMode } from './paypal/index.ts'
import { PayPalError, type PayPalOrder } from './paypal/client.ts'
import { SHOP } from './shop.ts'
import { calendarHours, nextSlot, save, state, uid } from './store.ts'

export const bus = new EventEmitter()
bus.setMaxListeners(100)
export function changed(kind: string, id?: string) { bus.emit('change', { kind, id, at: Date.now() }) }

const r2 = (x: number) => Math.round(x * 100) / 100
const now = () => new Date().toISOString()

export function getOrder(id: string) {
  const o = state.orders.find(x => x.id === id || x.paypal.order_id === id)
  if (!o) throw Object.assign(new Error(`order ${id} not found`), { status: 404 })
  return o
}
export function getQuote(id: string) {
  const q = state.quotes.find(x => x.id === id)
  if (!q) throw Object.assign(new Error(`quote ${id} not found`), { status: 404 })
  return q
}

function setState(o: Order, s: MoneyState, note: string) {
  o.state = s
  o.history.push({ at: now(), state: s, note })
}

function ledger(e: Omit<LedgerEntry, 'id' | 'at' | 'currency'>) {
  const entry: LedgerEntry = { id: uid('led'), at: now(), currency: 'USD', ...e }
  state.ledger.push(entry)
  return entry
}

/** Step 1: PayPal order with intent AUTHORIZE. The buyer approves it in the PayPal popup. */
export async function createCheckout(quoteId: string, buyer: string, via: 'web' | 'agent', vaultId?: string) {
  const q = getQuote(quoteId)
  const o: Order = {
    id: uid('ord'), created_at: now(), buyer, via, quote_id: q.id, part_name: q.part_name, quantity: q.quantity, total: q.total, currency: 'USD',
    state: 'QUOTED',
    paypal: { order_id: null, order_status: null, authorization_id: null, authorization_status: null, authorization_expires: null, capture_id: null, capture_status: null, payout_batch_id: null, payout_status: null, void_status: null },
    job_id: null, inspection_id: null, hold_reason: null, history: [], webhooks: [],
  }
  state.orders.push(o)
  const sku = q.drawing?.part_no ?? q.part_ref
  const pp = await paypal().createOrder({
    reference_id: o.id,
    description: `${q.part_name} x${q.quantity}, ${q.machine_name.split(',')[0]}, ships in ${q.lead_time_days} days`,
    custom_id: q.id,
    invoice_id: `PD-${o.id}`,
    total: q.total,
    item: { name: `${q.part_name} (lot of ${q.quantity})`, sku, description: `${q.process.toUpperCase()} job at ${SHOP.name}` },
    vault_id: vaultId,
  }, `create-${o.id}`)
  o.paypal.order_id = pp.id
  o.paypal.order_status = pp.status
  setState(o, 'CREATED', `PayPal order ${pp.id} created, intent AUTHORIZE`)
  if (pp.status === 'COMPLETED') recordAuthorization(o, pp, via === 'agent' ? 'Buyer agent paid with the vaulted wallet under its spending mandate' : 'Order authorized on create')
  save(); changed('order', o.id)
  return { order: o, paypal: pp }
}

export function markApproved(o: Order, note: string) {
  if (o.state === 'CREATED') { o.paypal.order_status = 'APPROVED'; setState(o, 'APPROVED', note); save(); changed('order', o.id) }
}

function recordAuthorization(o: Order, pp: PayPalOrder, trigger: string) {
  const a = pp.purchase_units[0].payments?.authorizations?.[0]
  if (!a) throw new Error('PayPal returned no authorization')
  o.paypal.order_status = pp.status
  o.paypal.authorization_id = a.id
  o.paypal.authorization_status = a.status
  o.paypal.authorization_expires = a.expiration_time ?? null
  if (o.state === 'CREATED') setState(o, 'APPROVED', 'Payer approved')
  setState(o, 'AUTHORIZED', `Authorization ${a.id} ${a.status}, $${a.amount.value} held`)
  ledger({
    order_id: o.id, kind: 'AUTHORIZE', amount: Number(a.amount.value), from: pp.payer?.email_address ?? o.buyer, to: 'held by PayPal',
    paypal_ref: a.id, paypal_status: a.status, trigger,
    evidence: { paypal_order_id: pp.id, order_status: pp.status, expiration_time: a.expiration_time, seller_protection: a.seller_protection?.status, quote_id: o.quote_id },
  })
  scheduleJob(o)
}

/** Step 2: after approval, authorize the order. Funds are held, nothing is captured. */
export async function authorize(orderId: string) {
  const o = getOrder(orderId)
  if (o.state === 'AUTHORIZED' || o.paypal.authorization_id) return o
  try {
    const pp = await paypal().authorizeOrder(o.paypal.order_id!, `authorize-${o.id}`)
    recordAuthorization(o, pp, 'Buyer approved the PayPal checkout')
  } catch (e) {
    if (e instanceof PayPalError && e.body?.details?.[0]?.issue === 'ORDER_ALREADY_AUTHORIZED') {
      const pp = await paypal().getOrder(o.paypal.order_id!)
      recordAuthorization(o, pp, 'Buyer approved the PayPal checkout')
    } else throw e
  }
  save(); changed('order', o.id)
  return o
}

function scheduleJob(o: Order) {
  if (o.job_id) return
  const q = getQuote(o.quote_id)
  const hours = Math.max(1, Math.round(calendarHours(q.estimate.machine_h_total + q.estimate.setup_h) * 10) / 10)
  const slot = nextSlot(q.machine_id, hours)
  const job: Job = {
    id: uid('job'), order_id: o.id, machine_id: q.machine_id, name: `${q.part_name} x${q.quantity}`,
    start: slot.start.toISOString(), end: slot.end.toISOString(), hours, state: 'scheduled',
  }
  state.jobs.push(job)
  o.job_id = job.id
}

export function setJobState(jobId: string, s: Job['state']) {
  const j = state.jobs.find(x => x.id === jobId)
  if (!j) throw Object.assign(new Error('job not found'), { status: 404 })
  j.state = s
  save(); changed('job', j.id)
  return j
}

/** Step 3: inspection decided. PASS captures and pays the shop, otherwise hold or void. */
export async function settle(o: Order, insp: InspectionResult) {
  o.inspection_id = insp.id
  const evidence = {
    inspection_id: insp.id,
    photo_sha256: insp.photo_sha256,
    deterministic_verdict: insp.deterministic.verdict,
    worst_feature: worst(insp),
    ai_verdict: insp.ai.verdict,
    ai_confidence: insp.ai.confidence,
    ai_reasons: insp.ai.reasons,
    ai_model: insp.ai.model,
  }
  if (insp.decision === 'CAPTURE') {
    if (!o.paypal.authorization_id) throw new Error('order has no authorization')
    const cap = await paypal().captureAuthorization(o.paypal.authorization_id, { amount: o.total, invoice_id: `PD-${o.id}`, note_to_payer: `Part passed inspection ${insp.id}` }, `capture-${o.id}`)
    o.paypal.capture_id = cap.id
    o.paypal.capture_status = cap.status
    o.paypal.authorization_status = 'CAPTURED'
    setState(o, 'CAPTURED', `Capture ${cap.id} ${cap.status}`)
    ledger({ order_id: o.id, kind: 'CAPTURE', amount: Number(cap.amount.value), from: 'held by PayPal', to: 'PartDrop platform', paypal_ref: cap.id, paypal_status: cap.status, trigger: 'Inspection passed (tolerance check and AI vision agree)', evidence: { ...evidence, paypal_fee: cap.seller_receivable_breakdown?.paypal_fee?.value ?? null, net: cap.seller_receivable_breakdown?.net_amount?.value ?? null } })
    const fee = r2(o.total * SHOP.platform_fee_pct / 100)
    const payoutAmt = r2(o.total - fee)
    const batch = await paypal().createPayout({ sender_batch_id: `payout-${o.id}`, receiver: SHOP.payout_email, amount: payoutAmt, note: `${o.part_name} x${o.quantity}, order ${o.id}, inspection ${insp.id}`, sender_item_id: o.id })
    o.paypal.payout_batch_id = batch.batch_header.payout_batch_id
    o.paypal.payout_status = batch.batch_header.batch_status
    ledger({ order_id: o.id, kind: 'PAYOUT', amount: payoutAmt, from: 'PartDrop platform', to: SHOP.payout_email, paypal_ref: batch.batch_header.payout_batch_id, paypal_status: batch.batch_header.batch_status, trigger: `Capture ${cap.id} completed`, evidence: { capture_id: cap.id, gross: o.total, platform_fee_pct: SHOP.platform_fee_pct, platform_fee: fee, inspection_id: insp.id } })
  } else if (insp.decision === 'VOID') {
    await voidOrder(o, insp.decision_reason, evidence)
  } else {
    o.hold_reason = insp.decision_reason
    setState(o, 'HOLD', insp.decision_reason)
    ledger({ order_id: o.id, kind: 'HOLD', amount: o.total, from: 'held by PayPal', to: 'held by PayPal', paypal_ref: o.paypal.authorization_id ?? '', paypal_status: o.paypal.authorization_status ?? '', trigger: insp.decision_reason, evidence })
  }
  save(); changed('order', o.id)
  return o
}

export async function voidOrder(o: Order, reason: string, evidence: Record<string, unknown> = {}) {
  if (!o.paypal.authorization_id) throw new Error('order has no authorization')
  await paypal().voidAuthorization(o.paypal.authorization_id, `void-${o.id}`)
  o.paypal.authorization_status = 'VOIDED'
  o.paypal.void_status = 'VOIDED'
  o.hold_reason = reason
  setState(o, 'VOIDED', reason)
  ledger({ order_id: o.id, kind: 'VOID', amount: o.total, from: 'held by PayPal', to: o.buyer, paypal_ref: o.paypal.authorization_id, paypal_status: 'VOIDED', trigger: reason, evidence })
  save(); changed('order', o.id)
  return o
}

function worst(insp: InspectionResult) {
  const rows = insp.deterministic.rows.filter(r => r.deviation !== null)
  if (!rows.length) return null
  const w = rows.reduce((a, b) => (Math.abs(b.deviation!) / b.tol > Math.abs(a.deviation!) / a.tol ? b : a))
  return { id: w.id, name: w.name, deviation: w.deviation, tol: w.tol, used_pct: Math.round(Math.abs(w.deviation!) / w.tol * 100) }
}

/** Verified webhook events update the order and confirm ledger rows. */
export function applyWebhook(ev: any, method: string) {
  const res = ev.resource ?? {}
  const t = ev.event_type as string
  let o: Order | undefined
  if (t === 'CHECKOUT.ORDER.APPROVED') o = state.orders.find(x => x.paypal.order_id === res.id)
  else if (t.startsWith('PAYMENT.AUTHORIZATION')) o = state.orders.find(x => x.paypal.authorization_id === res.id || x.paypal.order_id === res.supplementary_data?.related_ids?.order_id)
  else if (t === 'PAYMENT.CAPTURE.COMPLETED') o = state.orders.find(x => x.paypal.capture_id === res.id || `PD-${x.id}` === res.invoice_id)
  else if (t.startsWith('PAYMENT.PAYOUTSBATCH')) o = state.orders.find(x => x.paypal.payout_batch_id === res.batch_header?.payout_batch_id)
  if (!o) return { matched: false }
  o.webhooks.push({ at: now(), event_type: t, event_id: ev.id, verified: true, method })
  if (t === 'CHECKOUT.ORDER.APPROVED') markApproved(o, 'Webhook CHECKOUT.ORDER.APPROVED')
  if (t === 'PAYMENT.PAYOUTSBATCH.SUCCESS') {
    o.paypal.payout_status = 'SUCCESS'
    if (o.state === 'CAPTURED') setState(o, 'PAID_OUT', `Payout ${res.batch_header.payout_batch_id} SUCCESS`)
  }
  // confirm the matching ledger row
  const ref = t.startsWith('PAYMENT.PAYOUTSBATCH') ? res.batch_header?.payout_batch_id : res.id
  const row = state.ledger.find(l => l.paypal_ref === ref)
  if (row) {
    if (t === 'PAYMENT.PAYOUTSBATCH.SUCCESS') row.paypal_status = 'SUCCESS'
    row.evidence = { ...row.evidence, webhook: { event_id: ev.id, event_type: t, verified: method } }
  }
  save(); changed('order', o.id)
  return { matched: true, order_id: o.id }
}

export function publicOrder(o: Order) {
  return { ...o, quote: state.quotes.find(q => q.id === o.quote_id) ?? null, job: state.jobs.find(j => j.id === o.job_id) ?? null, inspection: state.inspections.find(i => i.id === o.inspection_id) ?? null, paypal_mode: paypalMode() }
}

export type { Quote }
