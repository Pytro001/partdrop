// End to end smoke test against a running API (PAYPAL_MODE=mock):
// quote -> PayPal order -> approve -> authorize -> inspection -> capture -> payout -> webhooks.
//   npx tsx scripts/smoke.ts [baseUrl]
import { readFileSync } from 'node:fs'
const BASE = process.argv[2] || 'http://localhost:8306'
const feats = JSON.parse(readFileSync(new URL('../samples/features.json', import.meta.url), 'utf8'))
const drawings = JSON.parse(readFileSync(new URL('../samples/drawings.json', import.meta.url), 'utf8'))
async function call(path: string, body?: unknown, token?: string) {
  const r = await fetch(BASE + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j)}`)
  return j as any
}
const ok = (c: boolean, m: string) => { if (!c) { console.error('FAIL', m); process.exit(1) } console.log('ok  ', m) }
const part = process.env.PART || 'flange'
const buyer = (await call('/api/login', { email: 'buyer@demo', password: 'partdrop' })).token
const shop = (await call('/api/login', { email: 'shop@demo', password: 'partdrop' })).token
let t = Date.now()
const q = await call('/api/quotes', { part_name: drawings[part].title, part_ref: part, features: feats[part], drawing_ref: part, quantity: Number(process.env.QTY || 10) }, buyer)
console.log(`quote ${q.id}: ${q.process} on ${q.machine_name}, $${q.total} (${q.unit_price}/pc), ${q.lead_time_days} d, ${Date.now() - t} ms`)
for (const s of q.ai.trace) console.log('   tool', s.tool, JSON.stringify(s.input))
for (const r of q.reasons) console.log('   why ', r)
ok(q.total > 0, 'quote has a total')
const co = await call('/api/orders', { quote_id: q.id }, buyer)
ok(co.order.state === 'CREATED' && !!co.paypal_order_id, `PayPal order ${co.paypal_order_id} CREATED`)
const ap = await fetch(`${BASE}/mock-paypal/checkoutnow/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: co.paypal_order_id }) }).then(r => r.json())
ok(ap.orderID === co.paypal_order_id, 'buyer approved in mock checkout')
const au = await call(`/api/orders/${co.order.id}/approved`, { orderID: co.paypal_order_id }, buyer)
ok(au.state === 'AUTHORIZED' && au.paypal.authorization_status === 'CREATED', `AUTHORIZED, authorization ${au.paypal.authorization_id} status ${au.paypal.authorization_status}`)
ok(!!au.job, `job scheduled on ${au.job?.machine_id} ${au.job?.start}`)
const meas = drawings[part].features.map((f: any, i: number) => ({ id: f.id, measured: Math.round((f.nominal + (i % 2 ? 1 : -1) * f.tol * 0.4) * 1000) / 1000 }))
t = Date.now()
const ins = await call(`/api/orders/${co.order.id}/inspect`, { measurements: meas, photo_base64: process.env.PHOTO ? readFileSync(process.env.PHOTO).toString('base64') : null, photo_type: 'jpeg', photo_name: process.env.PHOTO ?? null }, shop)
console.log(`inspection ${ins.inspection.id}: det ${ins.inspection.deterministic.verdict}, ai ${ins.inspection.ai.verdict} (${ins.inspection.ai.confidence}), decision ${ins.inspection.decision}, ${Date.now() - t} ms`)
for (const r of ins.inspection.ai.reasons) console.log('   ai  ', r)
await new Promise(r => setTimeout(r, 2500))
const fin = await call(`/api/orders/${co.order.id}`, undefined, buyer)
console.log('final state', fin.state, JSON.stringify(fin.paypal))
console.log('webhooks', fin.webhooks.map((w: any) => w.event_type).join(', '))
const led = await call('/api/ledger', undefined, shop)
for (const l of led.filter((x: any) => x.order_id === fin.id).reverse()) console.log(`ledger ${l.kind.padEnd(9)} $${l.amount} ${l.from} -> ${l.to} ${l.paypal_ref} ${l.paypal_status} | ${l.trigger}`)
