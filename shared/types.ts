// Types shared by the web app and the API.

export type ProcessId = 'cnc3' | 'cnc5' | 'lpbf' | 'sheet'

/** Geometry features measured from the mesh in the browser (all lengths in mm). */
export interface PartFeatures {
  fileName: string
  format: 'step' | 'stl'
  triangles: number
  volume_mm3: number
  surface_area_mm2: number
  bbox_mm: [number, number, number]
  /** Through holes from the Euler characteristic of the welded mesh (genus). */
  through_holes: number
  /** Concave cylindrical faces grouped by axis (STEP only, includes blind holes). */
  hole_features: number | null
  hole_estimate: number
  smallest_hole_mm: number | null
  /** 5th percentile wall thickness from inward ray casts. */
  min_wall_mm: number
  thin_wall: boolean
  /** Share of surface area no straight tool can see from the 6 axis directions (3 axis, with flips). */
  hidden_area_3axis_pct: number
  /** Same, from 26 directions (5 axis). */
  hidden_area_5axis_pct: number
  /** True when most of the surface sits at one constant thickness (sheet candidate). */
  constant_thickness_mm: number | null
  bend_estimate: number
  shells: number
}

export interface Drawing {
  title: string
  part_no: string
  material: string
  finish: string
  qty_hint: number
  features: { id: string; name: string; nominal: number; tol: number }[]
  hole_count: number
  volume_mm3: number
  bbox_mm: [number, number, number]
}

export interface Machine {
  id: string
  name: string
  process: ProcessId
  rate_per_h: number
  envelope_mm: [number, number, number]
  materials: string[]
  notes: string
}

export interface Material {
  id: string
  name: string
  density_g_cm3: number
  price_per_kg: number
  /** cm3/min of roughing removal on a 3 axis mill */
  mrr_cm3_min: number
  /** mm2/min of finishing on a 3 axis mill */
  finish_mm2_min: number
  form: 'bar' | 'powder' | 'sheet'
}

export interface EstimateLine { label: string; hours?: number; rate?: number; amount: number }

export interface Estimate {
  id: string
  machine_id: string
  machine_name: string
  process: ProcessId
  material_id: string
  quantity: number
  feasible: boolean
  issues: string[]
  setups: number
  cycle_min_per_part: number
  setup_h: number
  machine_h_total: number
  material_cost: number
  machine_cost: number
  setup_cost: number
  post_cost: number
  notes: string[]
  breakdown: Record<string, number>
}

export interface ToolCallTrace {
  agent: 'quote' | 'inspection' | 'buyer'
  step: number
  tool: string
  input: unknown
  output: unknown
  ms: number
}

export interface Quote {
  id: string
  created_at: string
  part_name: string
  part_ref: string
  features: PartFeatures
  drawing: Drawing | null
  quantity: number
  material_id: string
  process: ProcessId
  machine_id: string
  machine_name: string
  reasons: string[]
  risks: string[]
  estimate: Estimate
  alternatives: { machine_id: string; process: ProcessId; feasible: boolean; total: number; issues: string[] }[]
  lines: { item: string; detail: string; amount: number }[]
  subtotal: number
  margin_pct: number
  margin: number
  total: number
  unit_price: number
  currency: 'USD'
  lead_time_days: number
  ship_by: string
  ai: { model: string; mode: 'live' | 'replay'; latency_ms: number; trace: ToolCallTrace[]; summary: string }
  quoted_in_ms: number
}

export type MoneyState =
  | 'QUOTED' | 'CREATED' | 'APPROVED' | 'AUTHORIZED' | 'CAPTURED' | 'PAID_OUT' | 'VOIDED' | 'HOLD'

export interface Job {
  id: string
  order_id: string
  machine_id: string
  name: string
  start: string
  end: string
  hours: number
  state: 'scheduled' | 'running' | 'inspection' | 'done'
  seeded?: boolean
}

export interface Order {
  id: string
  created_at: string
  buyer: string
  via: 'web' | 'agent'
  quote_id: string
  part_name: string
  quantity: number
  total: number
  currency: 'USD'
  state: MoneyState
  paypal: {
    order_id: string | null
    order_status: string | null
    authorization_id: string | null
    authorization_status: string | null
    authorization_expires: string | null
    capture_id: string | null
    capture_status: string | null
    payout_batch_id: string | null
    payout_status: string | null
    void_status: string | null
  }
  job_id: string | null
  inspection_id: string | null
  hold_reason: string | null
  history: { at: string; state: MoneyState; note: string }[]
  webhooks: { at: string; event_type: string; event_id: string; verified: boolean; method: string }[]
}

export interface InspectionResult {
  id: string
  order_id: string
  created_at: string
  photo_sha256: string | null
  photo_name: string | null
  measurements: { id: string; name: string; nominal: number; tol: number; measured: number | null }[]
  deterministic: { verdict: 'PASS' | 'FAIL'; rows: { id: string; name: string; nominal: number; tol: number; measured: number | null; deviation: number | null; pass: boolean }[] }
  ai: { verdict: 'PASS' | 'FAIL' | 'REVIEW'; confidence: number; reasons: string[]; visual: string[]; hole_count_seen?: number | null; differences?: string[]; model: string; mode: 'live' | 'replay'; latency_ms: number }
  decision: 'CAPTURE' | 'HOLD' | 'VOID'
  decision_reason: string
}

export interface LedgerEntry {
  id: string
  at: string
  order_id: string
  kind: 'AUTHORIZE' | 'CAPTURE' | 'PAYOUT' | 'VOID' | 'HOLD' | 'WEBHOOK'
  amount: number
  currency: 'USD'
  from: string
  to: string
  paypal_ref: string
  paypal_status: string
  trigger: string
  evidence: Record<string, unknown>
}
