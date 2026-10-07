// Inspection agent. A deterministic tolerance check and Claude vision both look at the part;
// money only moves when they agree.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Drawing, InspectionResult, Order } from '../../shared/types.ts'
import { MODEL, converse, toolUses } from './bedrock.ts'
import { getQuote } from './orders.ts'
import { save, state, uid } from './store.ts'

export function toleranceCheck(rows: InspectionResult['measurements']): InspectionResult['deterministic'] {
  const out = rows.map(r => {
    const deviation = r.measured === null || Number.isNaN(r.measured) ? null : Math.round((r.measured - r.nominal) * 10000) / 10000
    return { ...r, deviation, pass: deviation !== null && Math.abs(deviation) <= r.tol + 1e-9 }
  })
  return { verdict: out.every(r => r.pass) ? 'PASS' : 'FAIL', rows: out }
}

/** Drawing for a part without one: overall sizes from the CAD bounding box at +-0.1 mm. */
export function drawingFor(orderPart: { drawing: Drawing | null; features: { bbox_mm: [number, number, number] } }) {
  if (orderPart.drawing) return orderPart.drawing.features
  const [x, y, z] = orderPart.features.bbox_mm
  return [
    { id: 'X', name: 'Overall X', nominal: Math.round(x * 100) / 100, tol: 0.1 },
    { id: 'Y', name: 'Overall Y', nominal: Math.round(y * 100) / 100, tol: 0.1 },
    { id: 'Z', name: 'Overall Z', nominal: Math.round(z * 100) / 100, tol: 0.1 },
  ]
}

const SYSTEM = `You are the final inspector for a job shop. Payment for the job is captured only if you pass the part.
You get the drawing (nominal sizes and tolerances), the measured values, the result of a deterministic tolerance check, a clean render of the CAD model (reference) and a photo of the finished part.
Check:
- Compare the photo with the CAD reference feature by feature. Count the through holes you can actually see in the photo yourself, do not copy the expected number. Look for missing holes, extra cuts, notches, gouges or changed edges.
- Visible defects: burrs, chatter marks, cracks, porosity, dents, wrong finish, missing features.
- The measurements are plausible: not copied nominal values everywhere, consistent with each other.
Verdict PASS only if the photo matches the reference, nothing visible is wrong and the tolerance check passed. FAIL if the part is clearly wrong or defective. REVIEW if the photo is unclear or something needs a human.
Reasons: 2 to 4 short items, each under 18 words. Visual: what you actually see, 1 to 3 short items.
Call report_inspection exactly once.`

const TOOL = {
  name: 'report_inspection',
  description: 'Report the inspection verdict.',
  schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['PASS', 'FAIL', 'REVIEW'] },
      confidence: { type: 'number', description: '0 to 1' },
      reasons: { type: 'array', items: { type: 'string' } },
      visual: { type: 'array', items: { type: 'string' } },
      hole_count_seen: { type: 'integer', description: 'Through holes you counted in the photo' },
      differences: { type: 'array', items: { type: 'string' }, description: 'Differences between photo and CAD reference, empty if none' },
    },
    required: ['verdict', 'confidence', 'reasons', 'visual', 'hole_count_seen', 'differences'],
  },
}

export async function runInspection(o: Order, input: { measurements: { id: string; measured: number | null }[]; photo_base64: string | null; photo_type: 'jpeg' | 'png'; photo_name: string | null }) {
  const q = getQuote(o.quote_id)
  const drawing = drawingFor(q)
  const rows = drawing.map(d => ({ ...d, measured: input.measurements.find(m => m.id === d.id)?.measured ?? null }))
  const det = toleranceCheck(rows)
  const photoSha = input.photo_base64 ? createHash('sha256').update(Buffer.from(input.photo_base64, 'base64')).digest('hex') : null
  const brief = {
    part: q.part_name, part_no: q.drawing?.part_no ?? q.part_ref, material: q.drawing?.material ?? q.material_id, finish: q.drawing?.finish ?? null,
    expected_hole_count: q.drawing?.hole_count ?? q.features.hole_estimate, quantity: q.quantity,
    tolerance_check: det,
  }
  const content: any[] = [{ text: `Inspect this part before payment capture.\n${JSON.stringify(brief, null, 1)}` }]
  const refFile = resolve(import.meta.dirname, '../../samples/reference', `${q.part_ref}.jpg`)
  if (existsSync(refFile)) content.push({ text: 'Image 1: CAD reference render.' }, { image: { format: 'jpeg', source: { bytes: readFileSync(refFile).toString('base64') } } })
  if (input.photo_base64) content.push({ text: 'Image 2: inspection photo of the finished part.' }, { image: { format: input.photo_type, source: { bytes: input.photo_base64 } } })
  else content.push({ text: 'No photo was supplied.' })
  const r = await converse({ tag: 'inspect', system: SYSTEM, messages: [{ role: 'user', content }], tools: [TOOL], toolChoice: { tool: { name: TOOL.name } }, maxTokens: 800 })
  const use = toolUses(r.message)[0]
  const ai = (use?.input ?? { verdict: 'REVIEW', confidence: 0, reasons: ['The model returned no verdict'], visual: [], hole_count_seen: null, differences: [] }) as InspectionResult['ai'] & { hole_count_seen: number | null; differences: string[] }
  // the model's own structured observation is checked in code too
  const expectedHoles = q.drawing?.hole_count ?? null
  if (ai.verdict === 'PASS' && expectedHoles !== null && ai.hole_count_seen !== null && ai.hole_count_seen !== expectedHoles) {
    ai.verdict = 'REVIEW'
    ai.reasons = [`Counted ${ai.hole_count_seen} holes in the photo, the drawing has ${expectedHoles}`, ...ai.reasons]
  }
  if (ai.verdict === 'PASS' && ai.differences?.length) {
    ai.verdict = 'REVIEW'
    ai.reasons = [`Differences from CAD: ${ai.differences.join('; ')}`, ...ai.reasons]
  }
  let decision: InspectionResult['decision']
  let reason: string
  if (det.verdict === 'PASS' && ai.verdict === 'PASS') { decision = 'CAPTURE'; reason = 'Tolerance check PASS and AI inspection PASS' }
  else if (det.verdict === 'FAIL' && ai.verdict === 'FAIL') { decision = 'VOID'; reason = `Part rejected: ${det.rows.filter(x => !x.pass).map(x => x.name).join(', ') || 'measurements'} out of tolerance and AI inspection FAIL` }
  else { decision = 'HOLD'; reason = `Held for human review: tolerance check ${det.verdict}, AI inspection ${ai.verdict}` }
  if (o.paypal.authorization_expires && Date.parse(o.paypal.authorization_expires) < Date.now()) { decision = 'HOLD'; reason = 'Authorization expired, reauthorize before capture' }
  const insp: InspectionResult = {
    id: uid('insp'), order_id: o.id, created_at: new Date().toISOString(), photo_sha256: photoSha, photo_name: input.photo_name,
    measurements: rows, deterministic: det,
    ai: { verdict: ai.verdict, confidence: ai.confidence, reasons: ai.reasons, visual: ai.visual, hole_count_seen: ai.hole_count_seen ?? null, differences: ai.differences ?? [], model: MODEL(), mode: r.mode, latency_ms: r.latency_ms },
    decision, decision_reason: reason,
  }
  state.inspections.push(insp)
  save()
  return insp
}
