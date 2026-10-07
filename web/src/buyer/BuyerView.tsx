import { useCallback, useEffect, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { Drawing, Quote, ToolCallTrace } from '../../../shared/types.ts'
import { api, config, events, money, type Config } from '../lib/api.ts'
import { loadPart, loadSample, type LoadedPart } from '../lib/cad.ts'
import { gridTheme, usd } from '../ui/grid.ts'
import { MoneyChips } from '../ui/MoneyChips.tsx'
import { Trace } from '../ui/Trace.tsx'
import { Checkout } from './Checkout.tsx'
import { PartViewer, type ViewerHandle } from './PartViewer.tsx'
import { film } from '../film/hooks.ts'

const PROCESS: Record<string, string> = { cnc3: 'CNC 3 axis', cnc5: 'CNC 5 axis', lpbf: 'Metal LPBF print', sheet: 'Sheet metal' }

export function BuyerView() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [samples, setSamples] = useState<{ ref: string; drawing: Drawing }[]>([])
  const [part, setPart] = useState<LoadedPart | null>(null)
  const [drawingRef, setDrawingRef] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [hot, setHot] = useState(false)
  const [qty, setQty] = useState(10)
  const [material, setMaterial] = useState('')
  const [quoting, setQuoting] = useState(false)
  const [calls, setCalls] = useState<ToolCallTrace[]>([])
  const [shown, setShown] = useState(0)
  const [showTrace, setShowTrace] = useState(false)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [order, setOrder] = useState<any | null>(null)
  const viewer = useRef<ViewerHandle>(null)
  const stream = useRef('')
  const fileInput = useRef<HTMLInputElement>(null)
  const orderId = useRef<string | null>(null)
  const rawFile = useRef<{ name: string; b64: string } | null>(null)
  useEffect(() => { orderId.current = order?.id ?? null }, [order?.id])

  useEffect(() => { config().then(setCfg); api('/api/samples').then(setSamples).catch(() => {}) }, [])

  // live tool calls and order updates
  useEffect(() => events((type, d) => {
    if (type === 'trace' && d.stream_id === stream.current) setCalls(c => [...c, d.call])
    if (type === 'change' && d.kind === 'order' && d.id === orderId.current) api(`/api/orders/${d.id}`, undefined, 'buyer').then(setOrder).catch(() => {})
  }, 'buyer'), [])

  // reveal tool calls at a readable pace
  useEffect(() => {
    if (shown >= calls.length) return
    const t = setTimeout(() => setShown(s => s + 1), 750)
    return () => clearTimeout(t)
  }, [shown, calls.length])

  const reset = () => { setQuote(null); setOrder(null); setCalls([]); setShown(0); setErr(null) }

  const open = useCallback(async (name: string, get: () => Promise<LoadedPart>, ref: string | null) => {
    reset()
    rawFile.current = null
    setLoading(/\.stl$/i.test(name) ? 'Reading STL' : 'Reading STEP with OpenCascade')
    try {
      const p = await get()
      setPart(p)
      setDrawingRef(ref)
      const d = samples.find(s => s.ref === ref)?.drawing
      if (d) setQty(d.qty_hint)
      setMaterial('')
    } catch (e) { setErr((e as Error).message) }
    setLoading(null)
  }, [samples])

  const openFile = (f: File) => {
    if (!/\.(step|stp|stl)$/i.test(f.name)) { setErr('Drop a .step, .stp or .stl file'); return }
    const ref = samples.find(s => `${s.ref}.step` === f.name)?.ref ?? null
    open(f.name, async () => {
      const buf = await f.arrayBuffer()
      if (!ref && buf.byteLength < 12e6) {
        const u8 = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000))
        rawFile.current = { name: f.name, b64: btoa(bin) }
      }
      return loadPart(f.name, buf.slice(0))
    }, ref)
  }

  const getQuote = async () => {
    if (!part) return
    setQuoting(true); setQuote(null); setOrder(null); setCalls([]); setShown(0); setErr(null)
    stream.current = Math.random().toString(36).slice(2)
    try {
      const q: Quote = await api('/api/quotes', {
        part_name: samples.find(s => s.ref === drawingRef)?.drawing.title ?? part.name.replace(/\.(step|stp|stl)$/i, ''),
        part_ref: drawingRef ?? part.name, features: part.features, drawing_ref: drawingRef, quantity: qty,
        material_id: material || null, image_png_base64: viewer.current?.snapshot() ?? null, stream_id: stream.current,
        file_name: drawingRef ? null : rawFile.current?.name ?? null, file_base64: drawingRef ? null : rawFile.current?.b64 ?? null,
      }, 'buyer')
      stream.current = '' // late SSE frames for this run must not duplicate the trace
      setCalls(q.ai.trace)
      setQuote(q)
    } catch (e) { setErr((e as Error).message) }
    setQuoting(false)
  }

  // film hooks
  useEffect(() => film.register('buyer', {
    dropSample: (ref: string) => open(`${ref}.step`, () => loadSample(ref), ref),
    setQty: (n: number) => setQty(n),
    getQuote,
    state: () => ({ part: !!part, quote, order, shown, calls: calls.length }),
  }))

  const f = part?.features
  const drawing = samples.find(s => s.ref === drawingRef)?.drawing ?? null
  const revealed = calls.slice(0, shown)
  const ready = quote && shown >= calls.length

  return (
    <div className="buyer">
      <div className="left">
        <div className="panel viewer"
          onDragOver={e => { e.preventDefault(); setHot(true) }} onDragLeave={() => setHot(false)}
          onDrop={e => { e.preventDefault(); setHot(false); const fl = e.dataTransfer.files[0]; if (fl) openFile(fl) }}>
          <PartViewer ref={viewer} part={part} spin={!loading} />
          {part && (
            <div className="hud">
              <div className="kicker">Part</div>
              <div className="name">{drawing?.title ?? part.name}</div>
              <div className="file">{part.name} · {f!.triangles.toLocaleString()} triangles · read {part.ms.parse} ms · measured {part.ms.measure} ms</div>
            </div>
          )}
          {part && <div className="tools"><button className="linkbtn" onClick={() => { setPart(null); reset() }}>New part</button></div>}
          {!part && (
            <div className={`drop${hot ? ' hot' : ''}`} data-film="drop">
              <div>
                <svg width="54" height="54" viewBox="0 0 32 32" aria-hidden><path d="M16 5 26 10.5v11L16 27 6 21.5v-11z" fill="none" stroke="#7cf2c4" strokeWidth="1.6" strokeLinejoin="round" /><path d="M16 15v12M6 10.5 16 16l10-5.5" fill="none" stroke="#7cf2c4" strokeWidth="1.6" strokeLinejoin="round" /></svg>
                <h2>Drop a STEP or STL file</h2>
                <div className="muted">Geometry is measured in your browser. Nothing is quoted until you ask.</div>
                <div style={{ marginTop: 18 }}><button className="btn ghost" onClick={() => fileInput.current?.click()}>Choose file</button></div>
                <input ref={fileInput} type="file" accept=".step,.stp,.stl" hidden onChange={e => { const fl = e.target.files?.[0]; if (fl) openFile(fl) }} />
                <div className="samples">
                  <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>or try</span>
                  {samples.map(s => <button key={s.ref} className="chip" onClick={() => open(`${s.ref}.step`, () => loadSample(s.ref), s.ref)}>{s.drawing.title}</button>)}
                </div>
              </div>
            </div>
          )}
          {loading && <div className="loading"><div><div className="spin" />{loading}</div></div>}
        </div>
        <div className="features" aria-label="Measured geometry">
          <Feat k="Volume" v={f ? (f.volume_mm3 / 1000).toFixed(1) : '·'} u="cm³" />
          <Feat k="Bounding box" v={f ? f.bbox_mm.map(x => x.toFixed(0)).join('×') : '·'} u="mm" />
          <Feat k="Surface area" v={f ? (f.surface_area_mm2 / 100).toFixed(0) : '·'} u="cm²" />
          <Feat k="Holes" v={f ? String(f.hole_estimate) : '·'} u={f?.smallest_hole_mm ? `min Ø${f.smallest_hole_mm}` : ''} />
          <Feat k={f?.constant_thickness_mm ? 'Sheet' : 'Min wall'} v={f ? (f.constant_thickness_mm ?? f.min_wall_mm).toFixed(1) : '·'} u={f?.constant_thickness_mm ? `mm · ${f.bend_estimate} bends` : f?.thin_wall ? 'mm thin' : 'mm'} flag={!!f?.thin_wall} />
          <Feat k="Tool can't reach" v={f ? f.hidden_area_3axis_pct.toFixed(1) : '·'} u="% of surface" flag={!!f && f.hidden_area_3axis_pct > 2} />
        </div>
      </div>

      <div className="right">
        <div className="panel">
          <div className="panel-h">Quote <span className="sub">Claude picks the process, the shop's machine model sets the price</span></div>
          <div className="panel-b" style={{ display: 'grid', gap: 14 }}>
            <div className="qform">
              <div className="field"><label htmlFor="qty">Quantity</label><input id="qty" className="input" type="number" min={1} max={10000} value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))} /></div>
              <div className="field"><label htmlFor="mat">Material</label>
                <select id="mat" className="input" value={material} onChange={e => setMaterial(e.target.value)}>
                  <option value="">{drawing ? `From drawing: ${drawing.material}` : 'Let the agent choose'}</option>
                  {cfg?.materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <button className="btn" data-film="get-quote" disabled={!part || quoting} onClick={getQuote}>{quoting ? 'Quoting…' : 'Get quote'}</button>
            </div>
            {err && <div className="err">{err}</div>}
            {(quoting || calls.length > 0) && !ready && <Trace calls={revealed} />}
            {ready && <button className="linkbtn" style={{ justifySelf: 'start' }} onClick={() => setShowTrace(v => !v)} aria-expanded={showTrace}>{showTrace ? 'Hide' : 'Show'} the agent's {calls.length} tool calls: {calls.map(c => c.tool).join(', ')}</button>}
            {ready && showTrace && <Trace calls={calls} />}
            {quoting && shown >= calls.length && <div className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}><div className="spin" style={{ width: 18, height: 18, margin: 0, borderWidth: 2 }} />Claude is comparing machines…</div>}
          </div>
        </div>

        {ready && quote && (
          <div className="panel" style={{ animation: 'slidein .4s ease both' }} data-film="quote">
            <div className="panel-b" style={{ display: 'grid', gap: 12 }}>
              <div className="quote-head">
                <div>
                  <div className="kicker">{quote.quantity} pcs · {money(quote.unit_price)} each</div>
                  <div className="price" style={{ marginTop: 8 }}>{money(quote.total)}<small>ships in {quote.lead_time_days} days</small></div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="process-pill">{PROCESS[quote.process]}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{quote.machine_name}</div>
                </div>
              </div>
              <ul className="reasons">
                {quote.reasons.map((r, i) => <li key={i}>{r}</li>)}
                {quote.risks.map((r, i) => <li key={'r' + i} className="risk">{r}</li>)}
              </ul>
              <div className="grid-box">
                <AgGridReact theme={gridTheme} rowData={quote.lines} domLayout="normal"
                  columnDefs={[{ field: 'item', width: 130 }, { field: 'detail', flex: 1, tooltipField: 'detail' }, { field: 'amount', width: 120, valueFormatter: usd, type: 'rightAligned' }]}
                  pinnedBottomRowData={[{ item: 'Margin', detail: `${quote.margin_pct}% shop margin`, amount: quote.margin }]} />
              </div>
              <div className="meta-row">
                <span>Quoted in <b>{(quote.quoted_in_ms / 1000).toFixed(1)} s</b></span>
                <span>Compared <b>{quote.alternatives.length + 1}</b> options</span>
                {quote.alternatives.map(a => <span key={a.machine_id}>{a.machine_id}: <b>{a.feasible ? money(a.total) : 'not feasible'}</b></span>)}
                <span className="dim">{cfg?.ai.model.split('.').slice(-1)[0].replace(/-v\d.*$/, '')}{quote.ai.mode === 'replay' ? ' · recorded run' : ''}</span>
              </div>
            </div>
          </div>
        )}

        {ready && quote && (
          <div className="panel" style={{ animation: 'slidein .4s ease both' }}>
            <div className="panel-h">Pay with PayPal <span className="sub">Funds are authorized now and captured only when the part passes inspection</span></div>
            <div className="panel-b" style={{ display: 'grid', gap: 14 }}>
              <MoneyChips state={order?.state ?? 'QUOTED'} only={['QUOTED', 'CREATED', 'APPROVED', 'AUTHORIZED']} xl />
              {!order || order.state === 'CREATED' ? <Checkout quote={quote} onOrder={setOrder} /> : null}
              {order && order.paypal.authorization_id && (
                <div className="money-note">
                  <b>{money(order.total)}</b> held by PayPal · authorization <span className="mono">{order.paypal.authorization_id}</span> ({order.paypal.authorization_status}) · expires {order.paypal.authorization_expires?.slice(0, 10)}
                  {order.job && <> · job booked on <b>{order.job.machine_id.toUpperCase()}</b> {new Date(order.job.start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' })}</>}
                </div>
              )}
              {order?.webhooks?.length > 0 && (
                <div className="whlist">{order.webhooks.map((w: any) => <div key={w.event_id} className="wh"><span className="v">✓ signature verified</span>{w.event_type}</div>)}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Feat({ k, v, u, flag }: { k: string; v: string; u?: string; flag?: boolean }) {
  return <div className={`feat${flag ? ' flag' : ''}`}><div className="k">{k}</div><div className="v">{v}<small>{u}</small></div></div>
}
