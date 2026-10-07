// ?film=1 director: drives the real app through the demo story on a virtual clock.
// The Playwright recorder (output/record.mjs) calls __film.step(1/30) once per frame.
// Every click goes through the same handlers a person would use; the cursor is drawn.
import { useEffect, useState } from 'react'
import { api, login, signOut } from '../lib/api.ts'
import { MoneyChips } from '../ui/MoneyChips.tsx'
import { Logo } from '../App.tsx'
import { FILM, clock } from './clock.ts'
import { film } from './hooks.ts'

interface Overlay { caption: string | null; cursor: { x: number; y: number; down: number } | null; file: { x: number; y: number; name: string } | null; inbox: boolean; closer: boolean }
let ov: Overlay = { caption: null, cursor: null, file: null, inbox: false, closer: false }
const subs = new Set<(o: Overlay) => void>()
const set = (p: Partial<Overlay>) => { ov = { ...ov, ...p }; subs.forEach(f => f(ov)) }

// ---- network tracking: a frame does not advance while a request is in flight ----
let inflight = 0
if (FILM) {
  const realFetch = window.fetch.bind(window)
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const track = !url.includes('/api/events')
    if (track) inflight++
    try { return await realFetch(input as any, init) } finally { if (track) inflight-- }
  }) as typeof fetch
}
const realWait = (ms: number) => new Promise(r => (window as any).__realSetTimeout(r, ms))

const wait = (s: number) => new Promise<void>(r => setTimeout(r, s * 1000))
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
async function tween(s: number, f: (k: number) => void) {
  const t0 = performance.now()
  for (;;) {
    const k = Math.min(1, (performance.now() - t0) / (s * 1000))
    f(ease(k))
    if (k >= 1) return
    await new Promise(r => requestAnimationFrame(r))
  }
}
async function until(cond: () => boolean, max = 60) {
  const t0 = performance.now()
  while (!cond()) {
    if (performance.now() - t0 > max * 1000) { console.warn('film: timed out waiting'); return }
    await wait(0.1)
  }
}
const $ = (sel: string, root: Document = document) => root.querySelector(sel) as HTMLElement | null
function center(el: HTMLElement) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }

async function moveTo(sel: string | { x: number; y: number }, s = 0.9) {
  const target = typeof sel === 'string' ? center($(sel)!) : sel
  const from = ov.cursor ?? { x: 960, y: 1000, down: 0 }
  await tween(s, k => set({ cursor: { x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k, down: 0 } }))
}
async function click(sel: string, s = 0.9) {
  await until(() => !!$(sel) && !($(sel) as HTMLButtonElement).disabled, 30)
  await moveTo(sel, s)
  await tween(0.25, k => set({ cursor: { ...ov.cursor!, down: k } }))
  $(sel)!.click()
  await tween(0.35, k => set({ cursor: { ...ov.cursor!, down: 1 - k } }))
}
const caption = (t: string | null) => set({ caption: t })
const h = (name: string) => film.get(name)!

async function story() {
  // fresh server state and both demo sessions
  signOut()
  await login('shop@demo', 'partdrop')
  await api('/api/demo/reset', {}, 'shop')
  await login('buyer@demo', 'partdrop')
  h('app').go('buyer')
  h('app').refresh()
  await until(() => !!film.get('buyer'))
  set({ inbox: true })
  await wait(0.2)
  ;(window as any).__film.ready = true
  await new Promise<void>(r => { (window as any).__film.go = r })

  // 1. the slow way
  caption('Today: a custom part quote takes a week')
  await wait(7.5)
  set({ inbox: false })
  caption(null)
  await wait(1)

  // 2. drop a STEP file
  caption('Drop a STEP file')
  const drop = center($('[data-film=drop]')!)
  set({ cursor: { x: 1500, y: 980, down: 0 }, file: { x: 1500, y: 980, name: 'flange.step' } })
  await tween(2.2, k => {
    const x = 1500 + (drop.x - 1500) * k, y = 980 + (drop.y + 40 - 980) * k - Math.sin(k * Math.PI) * 120
    set({ cursor: { x, y, down: 0 }, file: { x: x + 16, y: y + 14, name: 'flange.step' } })
  })
  set({ file: null })
  await h('buyer').dropSample('flange')
  await wait(1.2)
  caption('Volume, holes, walls and tool reach, measured in the browser')
  await moveTo({ x: 1500, y: 700 }, 1.4)
  await wait(4.6)

  // 3. quote
  caption('Claude picks the process, the shop\'s machine model sets the price')
  await click('[data-film=get-quote]')
  await until(() => !!$('[data-film=quote]'), 90)
  await moveTo({ x: 1700, y: 760 }, 1.2)
  await wait(11)
  caption(`Quoted in ${($('.meta-row b')?.textContent ?? '').trim()}, not a week`)
  await wait(4)
  const right = $('.buyer .right')!
  const top0 = right.scrollTop
  await tween(1, k => { right.scrollTop = top0 + (right.scrollHeight - right.clientHeight - top0) * k })

  // 4. PayPal checkout, intent AUTHORIZE
  caption('Pay with PayPal: authorized, not captured')
  await click('[data-film=paypal]')
  await until(() => !!($('[data-film=paypal-frame]') as HTMLIFrameElement | null)?.contentDocument?.querySelector('[data-film=mock-approve]'), 30)
  await wait(1.2)
  const frame = $('[data-film=paypal-frame]') as HTMLIFrameElement
  const fr = frame.getBoundingClientRect()
  const btn = frame.contentDocument!.querySelector('[data-film=mock-approve]') as HTMLElement
  const br = btn.getBoundingClientRect()
  await moveTo({ x: fr.left + br.left + br.width / 2, y: fr.top + br.top + br.height / 2 }, 1)
  await wait(1.6)
  await tween(0.25, k => set({ cursor: { ...ov.cursor!, down: k } }))
  btn.click()
  await tween(0.35, k => set({ cursor: { ...ov.cursor!, down: 1 - k } }))
  await until(() => !!h('buyer').state().order?.paypal?.authorization_id, 30)
  await moveTo('[data-film=chips]', 1.2)
  caption('The money is held by PayPal until the part passes inspection')
  await wait(8)

  // 5. shop schedule
  caption('The job lands on the shop\'s machine schedule')
  await click('nav button:nth-child(2)')
  await until(() => !!film.get('shop'))
  await wait(1)
  await moveTo('[data-film=gantt]', 1.5)
  await wait(10)

  // 6. factory floor
  caption('Simulated on the machine it was quoted for')
  h('shop').setTab('floor')
  await until(() => !!$('[data-film=start-job]'))
  await wait(1)
  await click('[data-film=start-job]')
  set({ cursor: null })
  await wait(20)

  // 7. inspection gates the money
  caption('Inspection: photo and measured sizes against the drawing')
  h('shop').setTab('inspection')
  await until(() => !!film.get('inspection'))
  await wait(0.8)
  await h('inspection').photo()
  await wait(1.5)
  const rows = h('inspection').rows() as { id: string; nominal: number; tol: number }[]
  const dev = [0.3, -0.2, 0.45, -0.35, 0.1, -0.5]
  for (let i = 0; i < rows.length; i++) {
    h('inspection').setMeasured(i, Math.round((rows[i].nominal + dev[i % 6] * rows[i].tol) * 1000) / 1000)
    await wait(0.45)
  }
  await wait(1)
  await click('[data-film=run-inspection]')
  caption('Claude vision and a tolerance check must both pass')
  await until(() => !!$('[data-film=verdict]'), 90)
  await wait(5)
  caption('Pass: PayPal captures, the shop is paid out')
  await moveTo('.insp .chips', 1.2)
  await until(() => document.querySelector('.insp .mchip.now')?.textContent?.includes('PAID') ?? false, 30)
  await wait(5)
  caption('Every money movement is logged with the evidence behind it')
  h('shop').setTab('ledger')
  await wait(1)
  const firstRow = $('.ag-center-cols-container .ag-row')
  if (firstRow) await click('.ag-center-cols-container .ag-row[row-index="1"]', 1)
  await wait(7)

  // 8. buyer agent
  caption('Or send your purchasing agent')
  await click('nav button:nth-child(3)')
  await until(() => !!film.get('agent'))
  const text = 'Order 50 of our angle brackets in 6061. Budget $2,500, we need them within two weeks.'
  h('agent').setPrompt('')
  await moveTo('[data-film=agent-input]', 1)
  for (let i = 1; i <= text.length; i++) { h('agent').setPrompt(text.slice(0, i)); await wait(0.035) }
  await wait(0.6)
  await click('[data-film=agent-run]')
  caption('It quotes, checks its budget and pays through PayPal')
  await until(() => h('agent').state().done && h('agent').state().shown >= h('agent').state().calls, 120)
  await until(() => !!$('[data-film=agent-order]'), 30)
  await moveTo('[data-film=agent-order]', 1.2)
  caption('50 brackets ordered, funds held, job booked')
  await wait(9)

  // 9. close
  caption(null)
  set({ cursor: null, closer: true })
  await wait(12)
  ;(window as any).__film.done = true
}

export function Director() {
  const [o, setO] = useState(ov)
  useEffect(() => { subs.add(setO); return () => { subs.delete(setO) } }, [])
  useEffect(() => {
    const f = ((window as any).__film = {
      ready: false,
      done: false,
      started: false,
      go: null as null | (() => void),
      start() { this.started = true; this.go?.() },
      async step(dt: number) {
        await clock.advance(dt * 1000)
        // hold the frame until requests started by this step have finished
        let n = 0
        while (inflight > 0 && n++ < 2400) await realWait(50)
        await clock.advance(0)
      },
    })
    story().catch(e => console.error('film story failed', e))
    return () => { if ((window as any).__film === f) delete (window as any).__film }
  }, [])
  return (
    <>
      {o.inbox && <Inbox />}
      {o.closer && (
        <div className="closer">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24 }}><span style={{ width: 110, height: 110, display: 'inline-flex' }} className="biglogo"><Logo /></span><h1>PartDrop</h1></div>
            <p>Quote in seconds. Paid on proof.</p>
            <div style={{ marginTop: 40, display: 'flex', justifyContent: 'center' }}><MoneyChips state="PAID_OUT" only={['AUTHORIZED', 'CAPTURED', 'PAID_OUT']} xl /></div>
            <p style={{ fontSize: 20, marginTop: 36 }} className="dim">PayPal Orders v2 · Payouts · Webhooks · Claude on Amazon Bedrock · Bryntum · AG Grid</p>
          </div>
        </div>
      )}
      {o.caption && <div className="caption">{o.caption}</div>}
      {o.file && <div className="filedrag" style={{ left: o.file.x, top: o.file.y }}><svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><path d="M16 5 26 10.5v11L16 27 6 21.5v-11z" fill="none" stroke="#7cf2c4" strokeWidth="2.2" strokeLinejoin="round" /></svg>{o.file.name}</div>}
      {o.cursor && (
        <div className="cursor" style={{ left: o.cursor.x, top: o.cursor.y }}>
          <div className="ring" style={{ opacity: o.cursor.down * 0.9, transform: `scale(${0.6 + o.cursor.down * 0.5})` }} />
          <svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.6-6.8L4 20z" fill="#fff" stroke="#0b0f15" strokeWidth="1.4" strokeLinejoin="round" /></svg>
        </div>
      )}
    </>
  )
}

function Inbox() {
  return (
    <div className="inbox">
      <div className="list">
        <div className="item sel"><div className="f">Precision Parts Co.</div><div className="s">RE: RFQ, pipe flange 120, qty 10</div></div>
        <div className="item"><div className="f">Valley CNC</div><div className="s">RE: RFQ, pipe flange 120</div></div>
        <div className="item"><div className="f">Metro Machining</div><div className="s">Auto reply: out of office</div></div>
      </div>
      <div className="read">
        <h1>RE: RFQ, pipe flange 120, qty 10</h1>
        <div className="from">Precision Parts Co. · sales desk</div>
        <p>Hi, thanks for the drawing and the STEP file.</p>
        <p>Our estimator is out this week. We will get back to you with a quote in <span className="hl">5 to 7 business days</span>.</p>
        <p>We require 50% payment upfront before we schedule the job.</p>
        <p className="dim" style={{ fontSize: 18 }}>Illustration of a typical reply, not a real company.</p>
      </div>
    </div>
  )
}
