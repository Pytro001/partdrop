// Buyer purchasing agent (agentic commerce). Claude on Bedrock with tools that wrap the same
// order endpoints the web app uses. Payment tools follow the PayPal Agent Toolkit naming
// (create_order, get_order) so the agent can be pointed at @paypal/agent-toolkit later.
// A spending mandate set by the human is enforced on the server, not by the prompt.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Drawing, PartFeatures, ToolCallTrace } from '../../shared/types.ts'
import { runToolLoop } from './bedrock.ts'
import { createCheckout, getOrder, publicOrder } from './orders.ts'
import { paypalMode } from './paypal/index.ts'
import { mockVaultId } from './paypal/mock.ts'
import { runQuote } from './quote.ts'
import { save, state, uid } from './store.ts'

const SAMPLES = resolve(import.meta.dirname, '../../samples')
interface LibPart { ref: string; name: string; drawing: Drawing; features: PartFeatures }
function library(): LibPart[] {
  const drawings = JSON.parse(readFileSync(resolve(SAMPLES, 'drawings.json'), 'utf8')) as Record<string, Drawing>
  const feats = JSON.parse(readFileSync(resolve(SAMPLES, 'features.json'), 'utf8')) as Record<string, PartFeatures>
  return Object.keys(drawings).map(k => ({ ref: k, name: drawings[k].title, drawing: drawings[k], features: feats[k] }))
}

export const MANDATE_USD = () => Number(process.env.AGENT_MANDATE_USD || 5000)

const SYSTEM = `You are a purchasing agent for a hardware team. You buy custom parts from PartDrop on the user's behalf.
Tools: find_part searches the team's saved CAD parts. get_quote asks PartDrop's quoting engine for a price and lead time. create_order creates a PayPal order with intent AUTHORIZE and pays it with the team's vaulted PayPal wallet; funds are only held, and are captured when the part passes inspection. get_order reads the order back.
Rules:
- Follow the user's quantity, budget and deadline exactly. If the quote breaks the budget or deadline, do not order; explain.
- Never create more than one order.
- After create_order, call get_order once to confirm the authorization, then finish with a 2 sentence summary: what you bought, price, lead time, payment status. Plain text, no markdown, no exclamation marks.`

const TOOLS = [
  { name: 'find_part', description: 'Search the team CAD library by name or part number.', schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'get_quote', description: 'Get a PartDrop quote for a library part: process, machine, price breakdown, lead time.', schema: { type: 'object', properties: { part_ref: { type: 'string' }, quantity: { type: 'integer' }, need_by_days: { type: 'integer' } }, required: ['part_ref', 'quantity'] } },
  { name: 'create_order', description: 'PayPal: create an order with intent AUTHORIZE for a quote and pay it from the vaulted wallet. Funds are held, not captured.', schema: { type: 'object', properties: { quote_id: { type: 'string' }, max_total_usd: { type: 'number', description: 'The budget the user stated' } }, required: ['quote_id', 'max_total_usd'] } },
  { name: 'get_order', description: 'PayPal: show order details and payment status.', schema: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] } },
]

export async function runBuyerAgent(prompt: string, buyer: string, onCall?: (c: ToolCallTrace) => void) {
  const runId = uid('run')
  const lib = library()
  const created: string[] = []
  const trace: ToolCallTrace[] = []
  let step = 0
  const handlers = {
    find_part: ({ query }: { query: string }) => {
      const qq = query.toLowerCase()
      const hits = lib.filter(p => [p.ref, p.name, p.drawing.part_no, p.drawing.material].join(' ').toLowerCase().split(/\s+/).some(w => qq.includes(w) || w.includes(qq)))
      return { results: (hits.length ? hits : lib).map(p => ({ part_ref: p.ref, name: p.name, part_no: p.drawing.part_no, material: p.drawing.material, bbox_mm: p.features.bbox_mm })) }
    },
    get_quote: async ({ part_ref, quantity, need_by_days }: { part_ref: string; quantity: number; need_by_days?: number }) => {
      const p = lib.find(x => x.ref === part_ref || x.drawing.part_no === part_ref)
      if (!p) throw new Error(`no part ${part_ref}`)
      const q = await runQuote({ part_name: p.name, part_ref: p.ref, features: p.features, drawing: p.drawing, quantity, need_by_days: need_by_days ?? null }, c => { const t = { ...c, agent: 'quote' as const }; trace.push(t); onCall?.(t) })
      return { quote_id: q.id, process: q.process, machine: q.machine_name, material: q.material_id, quantity: q.quantity, total_usd: q.total, unit_price_usd: q.unit_price, lead_time_days: q.lead_time_days, ship_by: q.ship_by, reasons: q.reasons }
    },
    create_order: async ({ quote_id, max_total_usd }: { quote_id: string; max_total_usd: number }) => {
      const q = state.quotes.find(x => x.id === quote_id)
      if (!q) throw new Error(`no quote ${quote_id}`)
      if (created.length) throw new Error('mandate: one order per run')
      const cap = Math.min(MANDATE_USD(), max_total_usd || Infinity)
      if (q.total > cap) throw new Error(`mandate: total $${q.total} is over the $${cap} limit, not ordering`)
      const vault = paypalMode() === 'mock' ? mockVaultId() : process.env.PAYPAL_VAULT_ID
      const { order, paypal } = await createCheckout(q.id, buyer, 'agent', vault || undefined)
      created.push(order.id)
      const approve = paypal.links.find(l => l.rel === 'approve' || l.rel === 'payer-action')
      return { order_id: order.id, paypal_order_id: paypal.id, paypal_status: paypal.status, authorization_id: order.paypal.authorization_id, authorization_status: order.paypal.authorization_status, total_usd: order.total, needs_buyer_approval: approve ? approve.href : null, mandate_limit_usd: cap }
    },
    get_order: ({ order_id }: { order_id: string }) => {
      const o = getOrder(order_id)
      return { order_id: o.id, state: o.state, paypal: o.paypal, job: state.jobs.find(j => j.id === o.job_id) ?? null }
    },
  }
  const r = await runToolLoop({
    tag: 'buyer', system: SYSTEM, first: [{ text: prompt }], tools: TOOLS, handlers, finalTool: '__none__', maxTurns: 9, choice: 'auto',
    onCall: c => { const t = { agent: 'buyer' as const, step: ++step, ...c }; trace.push(t); onCall?.(t) },
  })
  const run = { id: runId, at: new Date().toISOString(), prompt, buyer, trace, summary: r.texts.at(-1) ?? '', orders: created.map(id => publicOrder(getOrder(id))), latency_ms: r.latency, mode: r.mode, mandate_usd: MANDATE_USD() }
  state.agentRuns.push(run)
  save()
  return run
}
