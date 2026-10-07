// PartDrop API.
import './env.ts'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import type { Drawing, PartFeatures, ToolCallTrace } from '../../shared/types.ts'
import { auth, login } from './auth.ts'
import { runBuyerAgent, MANDATE_USD } from './agent.ts'
import { MODEL, aiMode } from './bedrock.ts'
import { runInspection } from './inspect.ts'
import { applyWebhook, authorize, bus, changed, createCheckout, getOrder, markApproved, publicOrder, setJobState, settle, voidOrder } from './orders.ts'
import { allowedCertOrigins, paypal, paypalMode, publicPayPalConfig, selfBase, webhookId } from './paypal/index.ts'
import { verifyWebhookOffline, webhookHeaders } from './paypal/client.ts'
import { mockRouter, resetMock } from './paypal/mock.ts'
import { runQuote } from './quote.ts'
import { MACHINES, MATERIALS, SHOP } from './shop.ts'
import { reset, state } from './store.ts'

const app = express()
const PORT = Number(process.env.PORT || 8306)
const ROOT = resolve(import.meta.dirname, '../..')
const UPLOADS = resolve(process.env.DATA_DIR || resolve(ROOT, 'data'), 'uploads')
app.disable('x-powered-by')

app.use((req, res, next) => {
  const origin = req.headers.origin
  const allowed = (process.env.CORS_ORIGINS || 'http://localhost:5306').split(',')
  if (origin && allowed.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('access-control-allow-headers', 'authorization, content-type')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.status(204).end()
  next()
})

// webhooks need the raw body for the CRC32 in the signed message
app.post('/api/paypal/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const raw = req.body as Buffer
  const h = webhookHeaders(k => req.header(k))
  if (!h) return res.status(400).json({ error: 'missing PayPal transmission headers' })
  let event: any
  try { event = JSON.parse(raw.toString('utf8')) } catch { return res.status(400).json({ error: 'bad json' }) }
  let ok = false, method = 'offline'
  if (process.env.PAYPAL_WEBHOOK_VERIFY === 'postback') {
    method = 'postback'
    ok = (await paypal().verifyWebhookPostback(h, webhookId(), event)).verification_status === 'SUCCESS'
  } else {
    const v = await verifyWebhookOffline(h, webhookId(), raw, allowedCertOrigins())
    ok = v.ok
    if (!ok) console.warn('[webhook] rejected:', v.reason)
  }
  if (!ok) return res.status(401).json({ error: 'signature verification failed' })
  const r = applyWebhook(event, method)
  bus.emit('webhook', { event_type: event.event_type, id: event.id, verified: method, matched: r.matched })
  res.json({ received: true, ...r })
})

app.use(express.json({ limit: '15mb' }))

if (paypalMode() === 'mock') app.use('/mock-paypal', mockRouter({ publicBase: selfBase, webhookTarget: () => `${selfBase()}/api/paypal/webhook` }))

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).then(v => { if (!res.headersSent) res.json(v) }).catch(next)
}

app.get('/api/health', (_q, s) => s.json({ ok: true }))

app.get('/api/config', (_q, s) => s.json({
  paypal: publicPayPalConfig(),
  ai: { model: MODEL(), mode: aiMode() },
  shop: SHOP, machines: MACHINES, materials: MATERIALS, mandate_usd: MANDATE_USD(),
}))

app.post('/api/login', (req, res) => {
  const r = login(req.body?.email, req.body?.password)
  if (!r) return res.status(401).json({ error: 'wrong email or password' })
  res.json(r)
})

app.get('/api/samples', (_q, s) => {
  const drawings = JSON.parse(readFileSync(resolve(ROOT, 'samples/drawings.json'), 'utf8')) as Record<string, Drawing>
  s.json(Object.entries(drawings).map(([ref, d]) => ({ ref, file: `/samples/cad/${ref}.step`, drawing: d })))
})
app.use('/samples/cad', express.static(resolve(ROOT, 'samples/cad'), { maxAge: '1h' }))
app.use('/samples/photos', express.static(resolve(ROOT, 'samples/photos'), { maxAge: '1h' }))

// ---- buyer ------------------------------------------------------------------
app.post('/api/quotes', auth('buyer'), wrap(async req => {
  const b = req.body as { part_name: string; part_ref: string; features: PartFeatures; drawing_ref?: string | null; quantity: number; material_id?: string | null; image_png_base64?: string | null; stream_id?: string; file_base64?: string | null; file_name?: string | null }
  let drawing: Drawing | null = null
  if (b.drawing_ref) drawing = (JSON.parse(readFileSync(resolve(ROOT, 'samples/drawings.json'), 'utf8')) as Record<string, Drawing>)[b.drawing_ref] ?? null
  const q = await runQuote({ part_name: b.part_name, part_ref: b.part_ref, features: b.features, drawing, quantity: Math.max(1, Math.min(10000, Number(b.quantity) || 1)), material_id: b.material_id || null, image_png_base64: b.image_png_base64 || null },
    (c: ToolCallTrace) => bus.emit('trace', { stream_id: b.stream_id, call: c }))
  // keep the uploaded CAD so the shop can open it (samples are already on disk)
  if (!drawing && b.file_base64 && b.file_name && /\.(step|stp|stl)$/i.test(b.file_name)) {
    mkdirSync(UPLOADS, { recursive: true })
    writeFileSync(resolve(UPLOADS, `${q.id}${extname(b.file_name).toLowerCase()}`), Buffer.from(b.file_base64, 'base64'))
  }
  return q
}))

app.get('/api/quotes/:id/file', auth(), (req, res) => {
  const id = String(req.params.id).replace(/[^\w]/g, '')
  for (const ext of ['.step', '.stp', '.stl']) { const f = resolve(UPLOADS, id + ext); if (existsSync(f)) return res.download(f, `part${ext}`) }
  res.status(404).json({ error: 'no file for this quote' })
})

app.post('/api/orders', auth('buyer'), wrap(async req => {
  const { order, paypal: pp } = await createCheckout(String(req.body?.quote_id), req.user!.email, 'web')
  return { order: publicOrder(order), paypal_order_id: pp.id, approve_url: pp.links.find(l => l.rel === 'approve')?.href ?? null }
}))

/** Called from the PayPal JS SDK onApprove: mark approved, then authorize (hold funds). */
app.post('/api/orders/:id/approved', auth('buyer'), wrap(async req => {
  const o = getOrder(String(req.params.id))
  if (o.buyer !== req.user!.email) throw Object.assign(new Error('not your order'), { status: 403 })
  if (req.body?.orderID && req.body.orderID !== o.paypal.order_id) throw Object.assign(new Error('PayPal order mismatch'), { status: 400 })
  markApproved(o, 'PayPal onApprove callback')
  await authorize(o.id)
  return publicOrder(o)
}))

app.get('/api/orders', auth(), (req, res) => {
  const list = state.orders.filter(o => req.user!.role === 'shop' || o.buyer === req.user!.email)
  res.json(list.map(publicOrder).reverse())
})
app.get('/api/orders/:id', auth(), wrap(req => publicOrder(getOrder(String(req.params.id)))))
app.post('/api/orders/:id/void', auth(), wrap(async req => publicOrder(await voidOrder(getOrder(String(req.params.id)), String(req.body?.reason || `Voided by ${req.user!.email}`), { by: req.user!.email }))))

app.post('/api/agent/run', auth('buyer'), wrap(async req => {
  const prompt = String(req.body?.prompt || '').slice(0, 600)
  if (!prompt) throw Object.assign(new Error('prompt required'), { status: 400 })
  return runBuyerAgent(prompt, req.user!.email, c => bus.emit('trace', { stream_id: req.body?.stream_id, call: c }))
}))

// ---- shop -------------------------------------------------------------------
app.get('/api/jobs', auth(), (_q, s) => s.json({ machines: MACHINES, jobs: state.jobs }))
app.post('/api/jobs/:id/state', auth('shop'), wrap(req => setJobState(String(req.params.id), req.body?.state)))

app.post('/api/orders/:id/inspect', auth('shop'), wrap(async req => {
  const o = getOrder(String(req.params.id))
  if (o.state !== 'AUTHORIZED' && o.state !== 'HOLD') throw Object.assign(new Error(`order is ${o.state}, nothing to settle`), { status: 409 })
  const b = req.body
  const insp = await runInspection(o, { measurements: b.measurements ?? [], photo_base64: b.photo_base64 ?? null, photo_type: b.photo_type === 'png' ? 'png' : 'jpeg', photo_name: b.photo_name ?? null })
  await settle(o, insp)
  if (o.job_id) setJobState(o.job_id, insp.decision === 'CAPTURE' ? 'done' : 'inspection')
  return { inspection: insp, order: publicOrder(o) }
}))

app.get('/api/ledger', auth('shop'), (_q, s) => s.json([...state.ledger].reverse()))
app.get('/api/inspections', auth('shop'), (_q, s) => s.json(state.inspections))

// ---- live updates (server sent events) ------------------------------------------
app.get('/api/events', auth(), (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  res.write(': ok\n\n')
  const send = (type: string) => (data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
  const handlers = { change: send('change'), trace: send('trace'), webhook: send('webhook') }
  for (const [k, h] of Object.entries(handlers)) bus.on(k, h)
  const ping = setInterval(() => res.write(': ping\n\n'), 20000)
  req.on('close', () => { clearInterval(ping); for (const [k, h] of Object.entries(handlers)) bus.off(k, h) })
})

app.post('/api/demo/reset', auth(), (_q, s) => { reset(); resetMock(); changed('reset'); s.json({ ok: true }) })

// ---- production: serve the built web app -----------------------------------------
const DIST = resolve(ROOT, 'web/dist')
if (existsSync(DIST)) {
  app.use(express.static(DIST, { maxAge: '1h', index: false }))
  app.get(/^\/(?!api|mock-paypal|samples).*/, (_q, s) => s.sendFile(resolve(DIST, 'index.html')))
}

app.use((err: any, _q: Request, res: Response, _n: NextFunction) => {
  const status = err.status ?? (err.name === 'PayPalError' ? 502 : 500)
  console.error('[api]', status, err.message)
  res.status(status).json({ error: err.message, paypal: err.body ?? undefined })
})

app.listen(PORT, () => console.log(`PartDrop API on :${PORT}  PayPal ${paypalMode()}  AI ${aiMode()} ${MODEL()}`))
