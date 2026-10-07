import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Quote } from '../../../shared/types.ts'
import { api, config, type Config } from '../lib/api.ts'

declare global { interface Window { paypal?: any } }

function loadSdk(clientId: string) {
  return new Promise<void>((res, rej) => {
    if (window.paypal) return res()
    const s = document.createElement('script')
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&intent=authorize&currency=USD&components=buttons`
    s.onload = () => res()
    s.onerror = () => rej(new Error('PayPal SDK failed to load'))
    document.head.appendChild(s)
  })
}

/**
 * PayPal checkout with intent AUTHORIZE. Sandbox mode renders the real PayPal JS SDK
 * buttons. Mock mode renders a stand in button with the same createOrder / onApprove
 * contract and opens the mock approval page in a popup frame.
 */
export function Checkout({ quote, onOrder, disabled }: { quote: Quote; onOrder: (o: any) => void; disabled?: boolean }) {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [popup, setPopup] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const orderRef = useRef<string | null>(null)

  useEffect(() => { config().then(setCfg) }, [])

  const createOrder = async () => {
    const r = await api('/api/orders', { quote_id: quote.id }, 'buyer')
    orderRef.current = r.order.id
    onOrder(r.order)
    return r as { order: any; paypal_order_id: string; approve_url: string | null }
  }
  const onApprove = async (data: { orderID: string }) => {
    const o = await api(`/api/orders/${orderRef.current}/approved`, { orderID: data.orderID }, 'buyer')
    onOrder(o)
  }

  // real PayPal buttons in sandbox mode
  useEffect(() => {
    if (!cfg || cfg.paypal.mode !== 'sandbox' || !box.current) return
    let closed = false
    loadSdk(cfg.paypal.clientId).then(() => {
      if (closed || !box.current) return
      box.current.innerHTML = ''
      window.paypal.Buttons({
        style: { layout: 'vertical', shape: 'pill', label: 'pay', height: 48 },
        createOrder: async () => (await createOrder()).paypal_order_id,
        onApprove,
        onError: (e: Error) => setErr(e.message),
      }).render(box.current)
    }).catch(e => setErr(e.message))
    return () => { closed = true }
  }, [cfg, quote.id])

  // mock popup messages
  useEffect(() => {
    const h = async (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== 'mock-paypal') return
      setPopup(null)
      if (e.data.event === 'approve') {
        try { await onApprove({ orderID: e.data.orderID }) } catch (x) { setErr((x as Error).message) }
      }
      setBusy(false)
    }
    window.addEventListener('message', h)
    return () => window.removeEventListener('message', h)
  }, [])

  if (!cfg) return null
  if (cfg.paypal.mode === 'sandbox') return <div><div ref={box} />{err && <div className="err">{err}</div>}</div>

  return (
    <div>
      <button className="btn paypal" data-film="paypal" disabled={disabled || busy} onClick={async () => {
        setErr(null); setBusy(true)
        try {
          const r = await createOrder()
          const u = new URL(r.approve_url!)
          setPopup(u.pathname + u.search)
        } catch (x) { setErr((x as Error).message); setBusy(false) }
      }}>
        Checkout with PayPal <span className="badge mock" style={{ padding: '3px 7px', fontSize: 10 }}>MOCK</span>
      </button>
      {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
      {popup && createPortal(
        <div className="modal-bg" role="dialog" aria-modal="true" aria-label="PayPal approval (mock)" onKeyDown={e => { if (e.key === 'Escape') { setPopup(null); setBusy(false) } }}>
          <div className="modal">
            <div className="bar"><span className="lock">●</span> mock PayPal approval, {popup.split('?')[0]}</div>
            <iframe src={popup} title="Mock PayPal approval" data-film="paypal-frame" />
          </div>
        </div>, document.body)}
    </div>
  )
}
