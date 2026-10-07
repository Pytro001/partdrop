import { useEffect, useRef, useState } from 'react'
import type { ToolCallTrace } from '../../../shared/types.ts'
import { api, config, events, money, type Config } from '../lib/api.ts'
import { MoneyChips } from '../ui/MoneyChips.tsx'
import { Trace } from '../ui/Trace.tsx'
import { film } from '../film/hooks.ts'

const DEFAULT = 'Order 50 of our angle brackets in 6061. Budget $2,500, we need them within two weeks.'

export function AgentView() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [prompt, setPrompt] = useState(DEFAULT)
  const [busy, setBusy] = useState(false)
  const [calls, setCalls] = useState<ToolCallTrace[]>([])
  const [shown, setShown] = useState(0)
  const [run, setRun] = useState<any | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const stream = useRef('')
  useEffect(() => { config().then(setCfg) }, [])
  useEffect(() => events((type, d) => { if (type === 'trace' && d.stream_id === stream.current) setCalls(c => [...c, d.call]) }, 'buyer'), [])
  useEffect(() => {
    if (shown >= calls.length) return
    const t = setTimeout(() => setShown(s => s + 1), 800)
    return () => clearTimeout(t)
  }, [shown, calls.length])

  const go = async (text = prompt) => {
    setBusy(true); setErr(null); setRun(null); setCalls([]); setShown(0)
    stream.current = Math.random().toString(36).slice(2)
    try {
      const r = await api('/api/agent/run', { prompt: text, stream_id: stream.current }, 'buyer')
      stream.current = ''
      setCalls(r.trace)
      setRun(r)
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  useEffect(() => film.register('agent', { setPrompt, go, state: () => ({ busy, shown, calls: calls.length, done: !!run }) }))

  const done = run && shown >= calls.length
  const order = run?.orders?.[0]
  return (
    <div className="agent">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
        <div>
          <div className="kicker">Agentic commerce</div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.03em', marginTop: 6 }}>Your purchasing agent, one sentence</div>
        </div>
        <div className="ask">
          <textarea aria-label="Instruction for the buyer agent" value={prompt} onChange={e => setPrompt(e.target.value)} data-film="agent-input"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go() }} />
          <button className="btn big" data-film="agent-run" disabled={busy || !prompt.trim()} onClick={() => go()}>{busy ? 'Working…' : 'Send'}</button>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="log">
          <Trace calls={calls.slice(0, shown)} nestedQuote />
          {busy && shown >= calls.length && <div className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}><div className="spin" style={{ width: 18, height: 18, margin: 0, borderWidth: 2 }} />Agent is working…</div>}
          {done && run.summary && <div className="panel" style={{ padding: 18, animation: 'slidein .4s ease both' }}><div className="kicker" style={{ marginBottom: 8 }}>Agent</div><div className="summary">{run.summary}</div></div>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
        <div className="panel">
          <div className="panel-h">Spending mandate <span className="sub">enforced by the server, not the prompt</span></div>
          <div className="panel-b mandate">
            <div className="row"><span className="muted">Limit per order</span><b>{cfg ? money(cfg.mandate_usd) : ''}</b></div>
            <div className="row"><span className="muted">Pays with</span><b>Vaulted PayPal wallet{cfg?.paypal.mode === 'mock' ? ' (mock vault)' : ''}</b></div>
            <div className="row"><span className="muted">Payment intent</span><b>AUTHORIZE only</b></div>
            <div className="row"><span className="muted">Can capture funds</span><b style={{ color: 'var(--red)' }}>No, inspection does</b></div>
            <div className="row"><span className="muted">Orders per run</span><b>1</b></div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-h">Tools <span className="sub">PayPal Agent Toolkit names</span></div>
          <div className="panel-b" style={{ display: 'grid', gap: 8, fontSize: 13 }}>
            {[['find_part', 'PartDrop', 'search the team CAD library'], ['get_quote', 'PartDrop', 'runs the quote agent'], ['create_order', 'PayPal', 'Orders v2, intent AUTHORIZE'], ['get_order', 'PayPal', 'order and authorization status']].map(([t, s, d]) => (
              <div key={t} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span className="mono">{t}</span><span className="muted">{s} · {d}</span></div>
            ))}
          </div>
        </div>
        {done && order && (
          <div className="panel" style={{ animation: 'slidein .4s ease both' }} data-film="agent-order">
            <div className="panel-h">Order {order.id}</div>
            <div className="panel-b" style={{ display: 'grid', gap: 12 }}>
              <div className="price">{money(order.total)}<small>{order.part_name} ×{order.quantity}</small></div>
              <MoneyChips state={order.state} only={['CREATED', 'AUTHORIZED', 'CAPTURED']} lg />
              <div className="money-note">PayPal order <span className="mono">{order.paypal.order_id}</span> {order.paypal.order_status} · authorization <span className="mono">{order.paypal.authorization_id}</span> {order.paypal.authorization_status}{order.job && <> · booked on <b>{order.job.machine_id.toUpperCase()}</b></>}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
