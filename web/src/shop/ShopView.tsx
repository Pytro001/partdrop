import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { Job, LedgerEntry, Machine } from '../../../shared/types.ts'
import { api, config, events, money, type Config } from '../lib/api.ts'
import { loadPart, loadSample, type LoadedPart } from '../lib/cad.ts'
import { gridTheme, usd } from '../ui/grid.ts'
import { MoneyChips } from '../ui/MoneyChips.tsx'
import { FactoryScene } from './FactoryScene.tsx'
import { Schedule } from './Schedule.tsx'
import { film } from '../film/hooks.ts'
import { FILM } from '../film/clock.ts'

type Tab = 'schedule' | 'floor' | 'inspection' | 'ledger'
const PROCESS: Record<string, string> = { cnc3: 'CNC 3 axis', cnc5: 'CNC 5 axis', lpbf: 'Metal LPBF', sheet: 'Sheet metal' }

export function ShopView() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [tab, setTab] = useState<Tab>('schedule')
  const [orders, setOrders] = useState<any[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [jobs, setJobs] = useState<{ machines: Machine[]; jobs: Job[] }>({ machines: [], jobs: [] })
  const [ledger, setLedger] = useState<LedgerEntry[]>([])

  const refresh = useCallback(async () => {
    const [o, j, l] = await Promise.all([api('/api/orders', undefined, 'shop'), api('/api/jobs', undefined, 'shop'), api('/api/ledger', undefined, 'shop')])
    setOrders(o); setJobs(j); setLedger(l)
    setSel(s => s ?? o[0]?.id ?? null)
  }, [])
  useEffect(() => { config().then(setCfg); refresh() }, [refresh])
  useEffect(() => events(type => { if (type === 'change' || type === 'webhook') refresh() }, 'shop'), [refresh])

  const order = orders.find(o => o.id === sel) ?? null
  useEffect(() => film.register('shop', { setTab, select: (id: string) => setSel(id), first: () => orders[0]?.id, refresh }))

  return (
    <div className="shop">
      <aside className="side" aria-label="Orders">
        <div className="kicker" style={{ marginBottom: 4 }}>{cfg?.shop.name ?? 'Shop'} · orders</div>
        {orders.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No orders yet. Place one as buyer@demo.</div>}
        {orders.map(o => (
          <button key={o.id} className="ocard" aria-pressed={o.id === sel} onClick={() => setSel(o.id)}>
            <div className="n">{o.part_name} ×{o.quantity}</div>
            <div className="m"><span>{money(o.total)} · {o.via === 'agent' ? 'buyer agent' : 'web'}</span><span className={`ostate s-${o.state}`}>{o.state.replace('_', ' ')}</span></div>
          </button>
        ))}
      </aside>
      <section className="content">
        <div className="tabs" role="tablist">
          {(['schedule', 'floor', 'inspection', 'ledger'] as Tab[]).map(t => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{{ schedule: 'Schedule', floor: 'Factory floor', inspection: 'Inspection', ledger: 'Money ledger' }[t]}</button>
          ))}
        </div>
        <div className="tabpane" role="tabpanel">
          {tab === 'schedule' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div><div className="kicker">Bryntum Gantt</div><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', marginTop: 4 }}>Machine schedule</div></div>
                <div className="spacer" />
                {order?.job && <div className="muted" style={{ fontSize: 14 }}>New job <b style={{ color: 'var(--mint)' }}>{order.job.name}</b> on {order.job.machine_id.toUpperCase()}, {order.job.hours} h, booked when PayPal authorized {money(order.total)}</div>}
              </div>
              <Schedule machines={jobs.machines} jobs={jobs.jobs} highlight={order?.job?.id ?? null} />
            </>
          )}
          {tab === 'floor' && <Floor order={order} onChange={refresh} />}
          {tab === 'inspection' && <Inspection order={order} ledger={ledger.filter(l => l.order_id === order?.id)} onChange={refresh} />}
          {tab === 'ledger' && <Ledger rows={ledger} />}
        </div>
      </section>
    </div>
  )
}

async function partFor(order: any): Promise<LoadedPart | null> {
  const ref = order?.quote?.part_ref
  if (!ref) return null
  if (order.quote.drawing) return loadSample(ref)
  const r = await fetch(`/api/quotes/${order.quote.id}/file`, { headers: { authorization: `Bearer ${JSON.parse(localStorage.getItem('partdrop.sessions') || '{}').shop?.token}` } })
  if (!r.ok) return null
  return loadPart(ref, await r.arrayBuffer())
}

function usePart(order: any) {
  const [part, setPart] = useState<LoadedPart | null>(null)
  const key = order?.quote?.id
  useEffect(() => { let a = true; setPart(null); partFor(order).then(p => { if (a) setPart(p) }).catch(() => {}); return () => { a = false } }, [key])
  return part
}

// ---------------- factory floor ----------------
function Floor({ order, onChange }: { order: any; onChange: () => void }) {
  const part = usePart(order)
  const [p, setP] = useState(0)
  const [running, setRunning] = useState(false)
  const startAt = useRef(0)
  const SIM_S = 18 // seconds of screen time for the whole job
  const q = order?.quote
  useEffect(() => { setRunning(order?.job?.state === 'running'); setP(order?.job?.state === 'inspection' || order?.job?.state === 'done' ? 1 : 0) }, [order?.id])
  useEffect(() => {
    if (!running) return
    startAt.current = performance.now() - p * SIM_S * 1000
    let raf = 0
    const tick = () => {
      const v = Math.min(1, (performance.now() - startAt.current) / (SIM_S * 1000))
      setP(v)
      if (v >= 1) {
        setRunning(false)
        if (order?.job) api(`/api/jobs/${order.job.id}/state`, { state: 'inspection' }, 'shop').then(onChange)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running])
  const start = async () => { if (order?.job) await api(`/api/jobs/${order.job.id}/state`, { state: 'running' }, 'shop'); setRunning(true); onChange() }
  useEffect(() => film.register('floor', { start, progress: () => p }))
  if (!order) return <div className="muted">Select an order.</div>
  const totalMin = q ? q.estimate.cycle_min_per_part * q.quantity + q.estimate.setup_h * 60 : 0
  const speed = totalMin * 60 / SIM_S
  const lpbf = q?.process === 'lpbf'
  return (
    <div className="floor" data-film="floor">
      <FactoryScene part={part} process={q?.process ?? 'cnc3'} progress={p} />
      <div className="hud">
        <div className="kicker">{q?.machine_name}</div>
        <div className="t">{order.part_name} ×{order.quantity}</div>
        <div className="muted" style={{ fontSize: 13 }}>{PROCESS[q?.process]} · part {Math.min(order.quantity, Math.floor(p * order.quantity) + 1)} of {order.quantity} · simulated at {Math.round(speed)}x</div>
        {!running && p === 0 && <div style={{ pointerEvents: 'auto', marginTop: 10 }}><button className="btn" data-film="start-job" onClick={start}>Start job</button></div>}
        {p >= 1 && <div style={{ marginTop: 10, color: 'var(--mint)', fontWeight: 700 }}>Job complete, ready for inspection</div>}
      </div>
      {q && (
        <div className="stats">
          <span>{lpbf ? 'Layers' : 'Cycle / part'}</span><b>{lpbf ? q.estimate.breakdown.layers : `${q.estimate.cycle_min_per_part.toFixed(1)} min`}</b>
          <span>Setups</span><b>{q.estimate.setups}</b>
          <span>{lpbf ? 'Laser' : 'Spindle'}</span><b>{lpbf ? '500 W' : `${p > 0 && p < 1 ? '12,000' : '0'} rpm`}</b>
          <span>Machine time</span><b>{(q.estimate.machine_h_total * p).toFixed(1)} / {q.estimate.machine_h_total.toFixed(1)} h</b>
          <span>Payment</span><b style={{ color: 'var(--amber)' }}>{order.state === 'AUTHORIZED' ? 'held, not captured' : order.state}</b>
        </div>
      )}
      <div className="progress" aria-label="Job progress"><i style={{ width: `${p * 100}%` }} /></div>
    </div>
  )
}

// ---------------- inspection ----------------
function Inspection({ order, ledger, onChange }: { order: any; ledger: LedgerEntry[]; onChange: () => void }) {
  const q = order?.quote
  const drawingRows = useMemo(() => {
    if (!q) return []
    if (q.drawing) return q.drawing.features
    const [x, y, z] = q.features.bbox_mm
    return [{ id: 'X', name: 'Overall X', nominal: x, tol: 0.1 }, { id: 'Y', name: 'Overall Y', nominal: y, tol: 0.1 }, { id: 'Z', name: 'Overall Z', nominal: z, tol: 0.1 }]
  }, [q?.id])
  const [rows, setRows] = useState<any[]>([])
  const [photo, setPhoto] = useState<{ url: string; b64: string; type: 'jpeg' | 'png'; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const result = order?.inspection ?? null
  useEffect(() => { setRows(drawingRows.map((d: any) => ({ ...d, measured: null }))); setPhoto(null); setErr(null) }, [q?.id])

  const loadPhoto = async (url: string, name: string) => {
    const r = await fetch(url)
    if (!r.ok) { setErr('No floor camera photo for this part, upload one'); return }
    const b = await r.blob()
    const b64 = await new Promise<string>(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(b) })
    setPhoto({ url: URL.createObjectURL(b), b64, type: b.type.includes('png') ? 'png' : 'jpeg', name })
  }
  const fillCmm = () => setRows(rs => rs.map((r, i) => ({ ...r, measured: Math.round((r.nominal + [0.3, -0.2, 0.45, -0.35, 0.1, -0.5][i % 6] * r.tol) * 1000) / 1000 })))
  const setMeasured = (i: number, v: number) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, measured: v } : r)))
  const run = async () => {
    setBusy(true); setErr(null)
    try {
      await Promise.all([
        api(`/api/orders/${order.id}/inspect`, { measurements: rows.map(r => ({ id: r.id, measured: r.measured })), photo_base64: photo?.b64 ?? null, photo_type: photo?.type ?? 'jpeg', photo_name: photo?.name ?? null }, 'shop'),
        FILM ? new Promise(r => setTimeout(r, 2600)) : null, // film only: keep the scan visible
      ])
      onChange()
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  useEffect(() => film.register('inspection', { photo: () => loadPhoto(`/samples/photos/${q?.part_ref}.jpg`, `${q?.part_ref}-floor-camera.jpg`), fillCmm, setMeasured, run, rows: () => rows }))
  if (!order) return <div className="muted">Select an order.</div>
  const liveRows = rows.map(r => ({ ...r, deviation: r.measured == null ? null : Math.round((r.measured - r.nominal) * 1000) / 1000, pass: r.measured != null && Math.abs(r.measured - r.nominal) <= r.tol + 1e-9 }))
  const shownPhoto = photo?.url ?? null
  return (
    <div className="insp">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <div className="photo" data-film="photo">
          {shownPhoto ? <img src={shownPhoto} alt="Inspection photo of the finished part" /> : <div className="muted" style={{ textAlign: 'center', padding: 20 }}>Inspection photo<br /><span style={{ fontSize: 12 }}>from the floor camera or an upload</span></div>}
          {busy && <div className="scan" />}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={() => loadPhoto(`/samples/photos/${q?.part_ref}.jpg`, `${q?.part_ref}-floor-camera.jpg`)}>Floor camera</button>
          <label className="btn ghost" style={{ flex: 1 }}>Upload photo<input type="file" accept="image/jpeg,image/png" hidden onChange={e => { const f = e.target.files?.[0]; if (f) loadPhoto(URL.createObjectURL(f), f.name) }} /></label>
        </div>
        <div className="panel" style={{ padding: 14 }}>
          <div className="kicker" style={{ marginBottom: 10 }}>Money for this order</div>
          <MoneyChips state={order.state} only={order.state === 'VOIDED' || order.state === 'HOLD' ? ['AUTHORIZED', order.state] : ['AUTHORIZED', 'CAPTURED', 'PAID_OUT']} lg />
          <div className="money-note">{money(order.total)} · authorization <span className="mono">{order.paypal.authorization_id}</span>{order.paypal.capture_id && <> · capture <span className="mono">{order.paypal.capture_id}</span></>}{order.paypal.payout_batch_id && <> · payout <span className="mono">{order.paypal.payout_batch_id}</span> {order.paypal.payout_status}</>}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div><div className="kicker">Drawing {q?.drawing?.part_no ?? ''}</div><div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>Measured vs tolerance</div></div>
          <div className="spacer" />
          <button className="btn ghost" onClick={fillCmm}>Import CMM values</button>
          <button className="btn" data-film="run-inspection" disabled={busy || !!result && result.decision === 'CAPTURE' || !(order.state === 'AUTHORIZED' || order.state === 'HOLD')} onClick={run}>{busy ? 'Inspecting…' : 'Run inspection'}</button>
        </div>
        <div style={{ height: 40 + 40 * Math.max(3, liveRows.length) + 4 }}>
          <AgGridReact theme={gridTheme} rowData={liveRows} getRowId={p => p.data.id} singleClickEdit stopEditingWhenCellsLoseFocus
            onCellValueChanged={e => setMeasured(rows.findIndex(r => r.id === e.data.id), Number(e.newValue))}
            columnDefs={[
              { field: 'name', headerName: 'Feature', flex: 1.4 },
              { field: 'nominal', width: 110, valueFormatter: p => p.value?.toFixed(3) },
              { field: 'tol', headerName: '± Tol', width: 90, valueFormatter: p => p.value?.toFixed(3) },
              { field: 'measured', width: 130, editable: true, cellEditor: 'agNumberCellEditor', valueFormatter: p => (p.value == null ? 'enter' : Number(p.value).toFixed(3)), cellStyle: { color: '#7cf2c4', fontFamily: 'JetBrains Mono, monospace' } },
              { field: 'deviation', width: 120, valueFormatter: p => (p.value == null ? '' : (p.value >= 0 ? '+' : '') + p.value.toFixed(3)) },
              { field: 'pass', headerName: 'Check', width: 100, cellDataType: 'text', valueFormatter: p => (p.data.measured == null ? '' : p.value ? 'PASS' : 'FAIL'), cellStyle: p => ({ color: p.value ? '#3ddc97' : '#ff6b6b', fontWeight: 700 }) },
            ]} />
        </div>
        {err && <div className="err">{err}</div>}
        {result && (
          <div style={{ display: 'grid', gap: 12, animation: 'slidein .4s ease both' }} data-film="verdict">
            <div className="verdict">
              <div className={`vcard ${result.ai.verdict.toLowerCase()}`}>
                <div className="h"><span>Claude vision vs CAD</span><span className="mono">{result.ai.hole_count_seen != null && q?.drawing ? `holes ${result.ai.hole_count_seen}/${q.drawing.hole_count} · ` : ''}{Math.round(result.ai.confidence * 100)}%</span></div>
                <div className="big">{result.ai.verdict}</div>
                <ul>{result.ai.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}{result.ai.visual.map((r: string, i: number) => <li key={'v' + i}>{r}</li>)}</ul>
              </div>
              <div className={`vcard ${result.deterministic.verdict.toLowerCase()}`}>
                <div className="h"><span>Tolerance check (code)</span><span className="mono">{result.deterministic.rows.filter((r: any) => r.pass).length}/{result.deterministic.rows.length}</span></div>
                <div className="big">{result.deterministic.verdict}</div>
                <ul>{result.deterministic.rows.map((r: any) => <li key={r.id}>{r.name}: {r.deviation == null ? 'missing' : `${r.deviation >= 0 ? '+' : ''}${r.deviation.toFixed(3)} of ±${r.tol}`}</li>).slice(0, 4)}</ul>
              </div>
            </div>
            <div className={`decision ${result.decision}`}>{result.decision === 'CAPTURE' ? 'Capture and pay out' : result.decision === 'VOID' ? 'Void the authorization' : 'Hold'} · {result.decision_reason}</div>
            {ledger.length > 0 && (
              <div className="whlist">{[...ledger].reverse().map(l => <div key={l.id} className="wh"><span className="v">{l.kind}</span>{money(l.amount)} · {l.from} → {l.to} · {l.paypal_ref} {l.paypal_status}</div>)}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------- ledger ----------------
function Ledger({ rows }: { rows: LedgerEntry[] }) {
  const [pick, setPick] = useState<LedgerEntry | null>(null)
  useEffect(() => film.register('ledger', { pick: (i: number) => setPick(rows[i] ?? null) }))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 380px', gap: 16, flex: 1, minHeight: 0 }}>
      <div style={{ minHeight: 0 }}>
        <AgGridReact theme={gridTheme} rowData={rows} onRowClicked={e => setPick(e.data ?? null)} rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
          columnDefs={[
            { field: 'at', headerName: 'Time', width: 110, valueFormatter: p => new Date(p.value).toLocaleTimeString('en-US', { hour12: false }) },
            { field: 'kind', width: 110, cellStyle: p => ({ fontWeight: 700, color: ({ AUTHORIZE: '#ffb547', CAPTURE: '#3ddc97', PAYOUT: '#3ddc97', VOID: '#ff6b6b', HOLD: '#ff6b6b' } as any)[p.value] }) },
            { field: 'amount', width: 120, valueFormatter: usd, type: 'rightAligned' },
            { field: 'from', width: 190 }, { field: 'to', width: 210 },
            { field: 'paypal_ref', headerName: 'PayPal id', width: 190, cellStyle: { fontFamily: 'JetBrains Mono, monospace' } },
            { field: 'paypal_status', headerName: 'Status', width: 110 },
            { field: 'trigger', flex: 1, minWidth: 260 },
          ]} />
      </div>
      <div className="panel" style={{ overflow: 'auto' }}>
        <div className="panel-h">Evidence <span className="sub">why this money moved</span></div>
        <pre className="mono" style={{ margin: 0, padding: 16, fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--muted)' }}>{pick ? JSON.stringify(pick.evidence, null, 2) : 'Select a ledger row.'}</pre>
      </div>
    </div>
  )
}
