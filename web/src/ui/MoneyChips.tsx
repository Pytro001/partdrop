import type { MoneyState } from '../../../shared/types.ts'

const FLOW: MoneyState[] = ['QUOTED', 'CREATED', 'APPROVED', 'AUTHORIZED', 'CAPTURED', 'PAID_OUT']
const LABEL: Record<MoneyState, string> = { QUOTED: 'QUOTED', CREATED: 'CREATED', APPROVED: 'APPROVED', AUTHORIZED: 'AUTHORIZED', CAPTURED: 'CAPTURED', PAID_OUT: 'PAID OUT', VOIDED: 'VOIDED', HOLD: 'ON HOLD' }

/** The payment lifecycle as large status chips. The lit chip is the current PayPal state. */
export function MoneyChips({ state, xl, lg, only }: { state: MoneyState | null; xl?: boolean; lg?: boolean; only?: MoneyState[] }) {
  const flow = only ?? (state === 'VOIDED' || state === 'HOLD' ? [...FLOW.slice(0, 4), state] : FLOW)
  const at = state ? flow.indexOf(state) : -1
  return (
    <div className={`chips${xl ? ' xl' : ''}${lg ? ' lg' : ''}`} role="status" aria-live="polite" aria-label={`Payment status ${state ?? 'none'}`} data-film="chips">
      {flow.map((s, i) => (
        <span key={s} style={{ display: 'contents' }}>
          {i > 0 && <span className="arrow" aria-hidden>›</span>}
          <span className={`mchip s-${s}${i < at ? ' done' : ''}${i === at ? ' now' : ''}`}>{i <= at && <span className="ck" />}{LABEL[s]}</span>
        </span>
      ))}
    </div>
  )
}
