// The demo shop: its machines, materials and the deterministic machine time estimator.
// Every number on a quote comes from here. The quote agent chooses WHICH machine and
// material to estimate and explains why, it never writes prices itself.
import type { Estimate, Machine, Material, PartFeatures } from '../../shared/types.ts'
import { uid } from './ids.ts'

export const SHOP = {
  name: 'Kestrel Machine Works',
  city: 'Hayward, CA',
  payout_email: 'payouts@kestrel-machine.example',
  margin_pct: 22,
  platform_fee_pct: 5,
  hours_per_day: 16, // two shifts
  inspection_days: 1,
  shipping_days: 2,
}

export const MACHINES: Machine[] = [
  { id: 'vmc-1', name: 'VMC 1, 3 axis vertical mill', process: 'cnc3', rate_per_h: 85, envelope_mm: [760, 400, 500], materials: ['al6061', 'al7075', 'ss304', 'steel1018'], notes: '12k rpm, 24 tool carousel, 4th axis not fitted' },
  { id: 'vmc-2', name: 'VMC 2, 3 axis vertical mill', process: 'cnc3', rate_per_h: 85, envelope_mm: [760, 400, 500], materials: ['al6061', 'al7075', 'ss304', 'steel1018'], notes: 'Same model as VMC 1, probe fitted' },
  { id: '5ax-1', name: '5AX 1, 5 axis trunnion mill', process: 'cnc5', rate_per_h: 140, envelope_mm: [500, 400, 350], materials: ['al6061', 'al7075', 'ss304', 'steel1018', 'ti64', 'in718'], notes: 'Trunnion A/C, 15k rpm, through spindle coolant' },
  { id: 'lpbf-1', name: 'LPBF 1, metal powder bed printer', process: 'lpbf', rate_per_h: 95, envelope_mm: [250, 250, 300], materials: ['in718', 'ti64', 'alsi10mg', 'ss316l'], notes: 'Single 500 W fibre laser, 40 micron layers' },
  { id: 'sheet-1', name: 'Sheet cell, fibre laser plus press brake', process: 'sheet', rate_per_h: 110, envelope_mm: [3000, 1500, 200], materials: ['al5052', 'ss304', 'steel1018'], notes: '3 kW fibre laser, 100 t brake, up to 6 mm' },
]

export const MATERIALS: Material[] = [
  { id: 'al6061', name: 'Aluminium 6061-T6', density_g_cm3: 2.70, price_per_kg: 9, mrr_cm3_min: 45, finish_mm2_min: 2600, form: 'bar' },
  { id: 'al7075', name: 'Aluminium 7075-T6', density_g_cm3: 2.81, price_per_kg: 16, mrr_cm3_min: 40, finish_mm2_min: 2400, form: 'bar' },
  { id: 'al5052', name: 'Aluminium 5052-H32 sheet', density_g_cm3: 2.68, price_per_kg: 8, mrr_cm3_min: 40, finish_mm2_min: 2400, form: 'sheet' },
  { id: 'ss304', name: 'Stainless 304', density_g_cm3: 8.0, price_per_kg: 7, mrr_cm3_min: 10, finish_mm2_min: 800, form: 'bar' },
  { id: 'steel1018', name: 'Steel 1018', density_g_cm3: 7.87, price_per_kg: 3, mrr_cm3_min: 16, finish_mm2_min: 1100, form: 'bar' },
  { id: 'ti64', name: 'Titanium Ti-6Al-4V', density_g_cm3: 4.43, price_per_kg: 60, mrr_cm3_min: 6, finish_mm2_min: 500, form: 'bar' },
  { id: 'in718', name: 'Inconel 718', density_g_cm3: 8.19, price_per_kg: 85, mrr_cm3_min: 3, finish_mm2_min: 300, form: 'bar' },
  { id: 'alsi10mg', name: 'AlSi10Mg powder', density_g_cm3: 2.67, price_per_kg: 70, mrr_cm3_min: 0, finish_mm2_min: 0, form: 'powder' },
  { id: 'ss316l', name: '316L powder', density_g_cm3: 7.99, price_per_kg: 45, mrr_cm3_min: 0, finish_mm2_min: 0, form: 'powder' },
]

// Powder prices for metals that also come as bar stock.
const POWDER_PRICE: Record<string, number> = { in718: 110, ti64: 300, alsi10mg: 70, ss316l: 45 }

const r2 = (x: number) => Math.round(x * 100) / 100
const r1 = (x: number) => Math.round(x * 10) / 10


export function machine(id: string) { return MACHINES.find(m => m.id === id) }
export function material(id: string) { return MATERIALS.find(m => m.id === id) }

/** Fits the part in the envelope in any axis-aligned orientation. */
function fits(b: [number, number, number], env: [number, number, number]) {
  const s = [...b].sort((a, c) => a - c), e = [...env].sort((a, c) => a - c)
  return s[0] <= e[0] && s[1] <= e[1] && s[2] <= e[2]
}

/**
 * Deterministic machine time model. Inputs are only the measured geometry, the machine
 * and the material. Rates and formulas are documented inline and in README.
 */
export function estimate(f: PartFeatures, machineId: string, materialId: string, quantity: number): Estimate {
  const m = machine(machineId)
  const mat = material(materialId)
  if (!m) throw new Error(`unknown machine ${machineId}`)
  if (!mat) throw new Error(`unknown material ${materialId}`)
  const q = Math.max(1, Math.round(quantity))
  const issues: string[] = []
  const notes: string[] = []
  const [bx, by, bz] = f.bbox_mm
  const Vcm3 = f.volume_mm3 / 1000
  const partKg = (Vcm3 * mat.density_g_cm3) / 1000

  if (!m.materials.includes(mat.id)) issues.push(`${m.name} does not run ${mat.name}`)
  if (!fits(f.bbox_mm, m.envelope_mm)) issues.push(`Part ${bx.toFixed(0)} x ${by.toFixed(0)} x ${bz.toFixed(0)} mm does not fit the ${m.envelope_mm.join(' x ')} mm envelope`)

  let setups = 1, cycleMin = 0, setupH = 0, materialCost = 0, postCost = 0
  const breakdown: Record<string, number> = {}

  if (m.process === 'cnc3' || m.process === 'cnc5') {
    const five = m.process === 'cnc5'
    const hidden = five ? f.hidden_area_5axis_pct : f.hidden_area_3axis_pct
    if (hidden > 2) issues.push(`${hidden.toFixed(1)}% of the surface cannot be reached by a straight tool (${five ? '26' : '6'} directions), likely internal channels`)
    if (f.thin_wall && f.min_wall_mm < 0.8) issues.push(`Walls down to ${f.min_wall_mm.toFixed(2)} mm will chatter or tear when milled`)
    if (f.smallest_hole_mm !== null && f.smallest_hole_mm < 1.0) issues.push(`Holes of ${f.smallest_hole_mm.toFixed(2)} mm need micro drilling`)
    // stock: bounding box plus 3 mm per side, sawn from bar
    const stock = (bx + 6) * (by + 6) * (bz + 6) / 1000 // cm3
    const removed = Math.max(0, stock - Vcm3)
    const mrr = mat.mrr_cm3_min * (five ? 1.15 : 1) // 5 axis keeps shorter tools in the cut
    const roughMin = removed / Math.max(mrr, 0.5)
    const finishMin = f.surface_area_mm2 / Math.max(mat.finish_mm2_min * (five ? 1.1 : 1), 50)
    const holeMin = f.hole_estimate * (mat.mrr_cm3_min > 20 ? 0.35 : 0.9)
    // setups: 3 axis needs a flip for every face with features (top and bottom at least),
    // more when the hidden 3 axis area suggests side features. 5 axis does it in one plus a flip.
    setups = five ? (f.hidden_area_3axis_pct > 1 ? 2 : 1) : Math.min(4, 2 + (f.hidden_area_3axis_pct > 1 ? 1 : 0) + (f.hole_features && f.hole_features > 0 && f.bbox_mm[2] > 30 ? 1 : 0))
    const handleMin = setups * (five ? 2.5 : 2)
    const toolChangeMin = 0.25 * (3 + Math.min(6, f.hole_estimate))
    cycleMin = roughMin + finishMin + holeMin + handleMin + toolChangeMin
    setupH = setups * (five ? 0.75 : 0.5) + 0.5 // fixtures per setup plus first article
    materialCost = q * stock * mat.density_g_cm3 / 1000 * mat.price_per_kg * 1.1 + q * 1.5 // saw cut
    postCost = q * 1.2 // deburr
    Object.assign(breakdown, { stock_cm3: r1(stock), removed_cm3: r1(removed), rough_min: r2(roughMin), finish_min: r2(finishMin), drill_min: r2(holeMin), handling_min: r2(handleMin), tool_change_min: r2(toolChangeMin) })
    notes.push(`Stock ${(bx + 6).toFixed(0)} x ${(by + 6).toFixed(0)} x ${(bz + 6).toFixed(0)} mm, ${removed.toFixed(0)} cm3 removed per part at ${mrr.toFixed(0)} cm3/min`)
  } else if (m.process === 'lpbf') {
    if (f.min_wall_mm < 0.4) issues.push(`Walls of ${f.min_wall_mm.toFixed(2)} mm are under the 0.4 mm printable minimum`)
    const layerMm = 0.04
    const powderKg = POWDER_PRICE[mat.id] ?? mat.price_per_kg
    // nest parts on the 250 x 250 plate by footprint with 8 mm spacing
    const [fx, fy, fz] = [...f.bbox_mm].sort((a, c) => c - a) // print with the longest axis flat
    const perRow = Math.max(1, Math.floor(250 / (fx + 8))), perCol = Math.max(1, Math.floor(250 / (fy + 8)))
    const perPlate = Math.max(1, perRow * perCol)
    const plates = Math.ceil(q / perPlate)
    const layers = Math.ceil(fz / layerMm)
    const recoatH = layers * 9 / 3600 // 9 s per layer
    const buildRate = 18 // cm3/h melted, one laser
    const supportFactor = 1.15
    const plateParts = Math.min(q, perPlate)
    const meltH = (plateParts * Vcm3 * supportFactor) / buildRate
    const plateH = recoatH + meltH
    cycleMin = (plateH * 60 * plates) / q
    setupH = plates * 1.5 + plates * 2.5 // plate prep and inert gas, then depowder, stress relief and wire EDM off the plate
    materialCost = q * partKg * supportFactor * 1.25 * powderKg // 25% powder not recovered
    postCost = q * 18 // bead blast, lap the face, CT spot check on first part
    Object.assign(breakdown, { layers, recoat_h_per_plate: r2(recoatH), melt_h_per_plate: r2(meltH), parts_per_plate: perPlate, plates, build_rate_cm3_h: buildRate })
    notes.push(`${perPlate} per plate, ${plates} plate${plates > 1 ? 's' : ''}, ${layers} layers at 40 microns`)
  } else {
    // sheet: laser cut the flat pattern then bend
    const t = f.constant_thickness_mm
    if (t === null) issues.push('Part is not a constant thickness sheet, it cannot be cut flat and bent')
    else if (t > 6) issues.push(`Sheet ${t.toFixed(1)} mm is over the 6 mm cell limit`)
    const th = t ?? 3
    const flatArea = f.volume_mm3 / th
    const edgeArea = Math.max(0, f.surface_area_mm2 - 2 * flatArea)
    const cutLen = edgeArea / th
    const cutSpeed = mat.id === 'ss304' ? 3500 : mat.id === 'steel1018' ? 4500 : 7000 // mm/min at 1.5 mm
    const pierces = f.hole_estimate + 1
    const cutMin = cutLen / cutSpeed + pierces * 0.05
    const bendMin = f.bend_estimate * 0.5
    cycleMin = cutMin + bendMin + 0.8
    setups = 1 + (f.bend_estimate > 0 ? 1 : 0)
    setupH = 0.4 + f.bend_estimate * 0.15
    const sheetKg = (flatArea * 1.3 * th / 1000) * mat.density_g_cm3 / 1000
    materialCost = q * sheetKg * mat.price_per_kg
    postCost = q * 0.8
    Object.assign(breakdown, { thickness_mm: r2(th), flat_area_mm2: Math.round(flatArea), cut_length_mm: Math.round(cutLen), cut_min: r2(cutMin), bends: f.bend_estimate, bend_min: r2(bendMin) })
    notes.push(`${Math.round(cutLen)} mm of cut, ${f.bend_estimate} bend${f.bend_estimate === 1 ? '' : 's'}`)
  }

  const machineH = (cycleMin * q) / 60
  return {
    id: uid('est'),
    machine_id: m.id,
    machine_name: m.name,
    process: m.process,
    material_id: mat.id,
    quantity: q,
    feasible: issues.length === 0,
    issues,
    setups,
    cycle_min_per_part: r2(cycleMin),
    setup_h: r2(setupH),
    machine_h_total: r2(machineH),
    material_cost: r2(materialCost),
    machine_cost: r2(machineH * m.rate_per_h),
    setup_cost: r2(setupH * m.rate_per_h),
    post_cost: r2(postCost),
    notes,
    breakdown,
  }
}

export function priceFromEstimate(e: Estimate) {
  const m = machine(e.machine_id)!
  const mat = material(e.material_id)!
  const lines = [
    { item: 'Material', detail: `${mat.name}, ${e.quantity} pcs`, amount: e.material_cost },
    { item: 'Machine time', detail: `${e.machine_h_total.toFixed(1)} h on ${m.name.split(',')[0]} at $${m.rate_per_h}/h (${e.cycle_min_per_part.toFixed(1)} min per part)`, amount: e.machine_cost },
    { item: 'Setup', detail: `${e.setups} setup${e.setups > 1 ? 's' : ''}, ${e.setup_h.toFixed(1)} h incl. first article`, amount: e.setup_cost },
    { item: 'Finishing', detail: m.process === 'lpbf' ? 'Depowder, blast, lap, CT check' : m.process === 'sheet' ? 'Deburr' : 'Deburr all edges', amount: e.post_cost },
  ]
  const subtotal = r2(lines.reduce((a, l) => a + l.amount, 0))
  const margin = r2(subtotal * SHOP.margin_pct / 100)
  const total = Math.ceil((subtotal + margin) * 100) / 100
  return { lines, subtotal, margin, margin_pct: SHOP.margin_pct, total, unit_price: r2(total / e.quantity) }
}
