// Quote agent: Claude on Bedrock picks the process and machine, the deterministic
// estimator (shop.ts) produces every number.
import type { Drawing, Estimate, PartFeatures, Quote, ToolCallTrace } from '../../shared/types.ts'
import { MODEL, runToolLoop, type Block } from './bedrock.ts'
import { MACHINES, MATERIALS, SHOP, estimate, machine, priceFromEstimate } from './shop.ts'
import { leadTimeDays, save, state, uid } from './store.ts'

const SYSTEM = `You are the quoting engineer at ${SHOP.name}, a small job shop in ${SHOP.city}.
A buyer uploaded a part. You get the geometry features measured from the CAD mesh, the drawing notes when there is one, and a rendered picture of the part.

Your job:
1. Read the shop machines in the request. Decide which processes are plausible: cnc3 (3 axis mill), cnc5 (5 axis mill), lpbf (metal powder bed printing), sheet (laser cut and bend).
2. In ONE turn, call estimate_job in parallel for the 2 or 3 most plausible machine and material combinations, so the choice is compared, not assumed. Use the drawing material when given.
3. Call submit_quote with the estimate_id you recommend.

Rules:
- Every price, hour and day comes from estimate_job. Never invent or adjust numbers.
- Never choose an estimate with feasible=false.
- Prefer the cheapest feasible option unless a measured feature makes another clearly better, then say which. When two options cost the same, take the shorter lead time.
- hidden_area_3axis_pct above 2 means faces a 3 axis tool cannot reach; above 2 for 5 axis too means internal channels, which need printing.
- constant_thickness_mm not null means the part is a sheet candidate.
- Reasons: 2 to 4 items, each under 18 words, each citing a measured value. Risks: 0 to 2 items.
- Summary: one sentence under 25 words.`

const TOOLS = [
  {
    name: 'estimate_job',
    description: 'Run the deterministic machine time model for this part on one machine in one material. Returns cycle time, setups, cost lines, feasibility issues, price and lead time.',
    schema: { type: 'object', properties: { machine_id: { type: 'string' }, material_id: { type: 'string' }, quantity: { type: 'integer' } }, required: ['machine_id', 'material_id', 'quantity'] },
  },
  {
    name: 'submit_quote',
    description: 'Submit the final quote to the buyer using one estimate.',
    schema: {
      type: 'object',
      properties: {
        estimate_id: { type: 'string' },
        reasons: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
      required: ['estimate_id', 'reasons', 'summary'],
    },
  },
]

export interface QuoteRequest {
  part_name: string
  part_ref: string
  features: PartFeatures
  drawing: Drawing | null
  quantity: number
  material_id?: string | null
  image_png_base64?: string | null
  need_by_days?: number | null
}

export async function runQuote(req: QuoteRequest, onCall?: (c: ToolCallTrace) => void): Promise<Quote> {
  const t0 = Date.now()
  const estimates = new Map<string, Estimate>()
  const leads = new Map<string, ReturnType<typeof leadTimeDays>>()
  const f = req.features
  const handlers = {
    estimate_job: (i: { machine_id: string; material_id: string; quantity: number }) => {
      const e = estimate(f, i.machine_id, i.material_id, i.quantity || req.quantity)
      estimates.set(e.id, e)
      const p = priceFromEstimate(e)
      const lt = leadTimeDays(e.machine_id, e.machine_h_total, e.setup_h)
      leads.set(e.id, lt)
      return {
        estimate_id: e.id, machine: e.machine_name, process: e.process, material: i.material_id, quantity: e.quantity,
        feasible: e.feasible, issues: e.issues, setups: e.setups, cycle_min_per_part: e.cycle_min_per_part,
        machine_h_total: e.machine_h_total, total_price_usd: p.total, unit_price_usd: p.unit_price, lead_time_days: lt.days, notes: e.notes,
      }
    },
    submit_quote: (i: { estimate_id: string }) => {
      const e = estimates.get(i.estimate_id)
      if (!e) throw new Error(`unknown estimate_id ${i.estimate_id}`)
      if (!e.feasible) throw new Error(`estimate ${i.estimate_id} is not feasible: ${e.issues.join('; ')}`)
      return { ok: true }
    },
  }
  const brief = {
    part: req.part_name,
    quantity: req.quantity,
    material_requested: req.material_id ?? (req.drawing ? req.drawing.material : 'buyer did not specify, choose a sensible one'),
    need_by_days: req.need_by_days ?? null,
    features: f,
    shop_machines: MACHINES.map(m => ({ id: m.id, name: m.name, process: m.process, rate_per_h: m.rate_per_h, envelope_mm: m.envelope_mm, materials: m.materials })),
    materials: MATERIALS.map(m => ({ id: m.id, name: m.name, form: m.form })),
    drawing: req.drawing ? { title: req.drawing.title, material: req.drawing.material, finish: req.drawing.finish, tolerances: req.drawing.features } : null,
  }
  const first: Block[] = [{ text: `Quote this part.\n${JSON.stringify(brief, null, 1)}` }]
  if (req.image_png_base64) first.push({ image: { format: 'png', source: { bytes: req.image_png_base64 } } })
  let step = 0
  const trace: ToolCallTrace[] = []
  const r = await runToolLoop({
    tag: 'quote', system: SYSTEM, first, tools: TOOLS, handlers, finalTool: 'submit_quote', maxTurns: 5,
    onCall: c => { const t = { agent: 'quote' as const, step: ++step, ...c }; trace.push(t); onCall?.(t) },
  })
  if (!r.final) throw new Error('The quote agent did not submit a quote')
  const fin = r.final.input as { estimate_id: string; reasons: string[]; risks?: string[]; summary: string }
  const e = estimates.get(fin.estimate_id)!
  const p = priceFromEstimate(e)
  const lt = leads.get(e.id)!
  const q: Quote = {
    id: uid('qt'),
    created_at: new Date().toISOString(),
    part_name: req.part_name,
    part_ref: req.part_ref,
    features: f,
    drawing: req.drawing,
    quantity: e.quantity,
    material_id: e.material_id,
    process: e.process,
    machine_id: e.machine_id,
    machine_name: machine(e.machine_id)!.name,
    reasons: fin.reasons,
    risks: fin.risks ?? [],
    estimate: e,
    alternatives: [...estimates.values()].filter(x => x.id !== e.id).map(x => ({ machine_id: x.machine_id, process: x.process, feasible: x.feasible, total: priceFromEstimate(x).total, issues: x.issues })),
    lines: p.lines,
    subtotal: p.subtotal,
    margin_pct: p.margin_pct,
    margin: p.margin,
    total: p.total,
    unit_price: p.unit_price,
    currency: 'USD',
    lead_time_days: lt.days,
    ship_by: new Date(Date.now() + lt.days * 86400_000).toISOString().slice(0, 10),
    ai: { model: MODEL(), mode: r.mode, latency_ms: r.latency, trace, summary: fin.summary },
    quoted_in_ms: r.mode === 'replay' ? r.latency + (Date.now() - t0) : Date.now() - t0,
  }
  state.quotes.push(q)
  save()
  return q
}
