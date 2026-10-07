import type { ToolCallTrace } from '../../../shared/types.ts'
import { money } from '../lib/api.ts'

function describe(c: ToolCallTrace): { args: string; result: string; ok: boolean } {
  const i = c.input as any, o = c.output as any
  if (o?.error) return { args: JSON.stringify(i), result: o.error, ok: false }
  switch (c.tool) {
    case 'estimate_job': return { args: `${i.machine_id} · ${i.material_id} · qty ${i.quantity}`, result: o.feasible ? `${money(o.total_price_usd)} · ${o.machine_h_total} h · ${o.lead_time_days} days` : `not feasible: ${o.issues?.[0] ?? ''}`, ok: !!o.feasible }
    case 'submit_quote': return { args: i.estimate_id, result: i.summary, ok: true }
    case 'find_part': return { args: `"${i.query}"`, result: (o.results ?? []).map((r: any) => `${r.name} (${r.part_no})`).join(', '), ok: true }
    case 'get_quote': return { args: `${i.part_ref} · qty ${i.quantity}${i.need_by_days ? ` · need by ${i.need_by_days} d` : ''}`, result: `${money(o.total_usd)} · ${o.process} on ${String(o.machine).split(',')[0]} · ${o.lead_time_days} days`, ok: true }
    case 'create_order': return { args: `${i.quote_id} · limit ${money(i.max_total_usd)}`, result: `PayPal ${o.paypal_order_id} ${o.paypal_status} · authorization ${o.authorization_status ?? 'pending'}${o.needs_buyer_approval ? ' · needs buyer approval' : ''}`, ok: true }
    case 'get_order': return { args: i.order_id, result: `${o.state} · ${o.paypal?.authorization_id ?? ''} ${o.paypal?.authorization_status ?? ''} · job ${o.job ? o.job.machine_id : 'none'}`, ok: true }
    default: return { args: JSON.stringify(i), result: JSON.stringify(o).slice(0, 160), ok: true }
  }
}

export function Trace({ calls, nestedQuote }: { calls: ToolCallTrace[]; nestedQuote?: boolean }) {
  return (
    <div className="trace" aria-live="polite">
      {calls.map((c, k) => {
        const d = describe(c)
        const fin = c.tool === 'submit_quote'
        const pay = c.tool === 'create_order' || c.tool === 'get_order'
        return (
          <div key={k} className={`call${fin ? ' final' : ''}${pay ? ' pay' : ''}${nestedQuote && c.agent === 'quote' ? ' nested' : ''}`}>
            <span className="ix">{c.agent === 'quote' && nestedQuote ? 'Q' : k + 1 - (nestedQuote ? calls.slice(0, k).filter(x => x.agent === 'quote').length : 0)}</span>
            <div>
              <div className="t">{c.tool}<span className="dim" style={{ fontWeight: 400 }}>({d.args})</span></div>
              <div className="r">{d.result}</div>
            </div>
            <span className={d.ok ? 'ok' : 'bad'}>{d.ok ? 'OK' : 'NO'}</span>
          </div>
        )
      })}
    </div>
  )
}
