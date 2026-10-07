// Tiny JSON file store. Good enough for a demo, swap for Postgres in production.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { InspectionResult, Job, LedgerEntry, Order, Quote } from '../../shared/types.ts'
import { MACHINES, SHOP } from './shop.ts'
import { resetIds, uid } from './ids.ts'

export interface State {
  quotes: Quote[]
  orders: Order[]
  jobs: Job[]
  inspections: InspectionResult[]
  ledger: LedgerEntry[]
  agentRuns: unknown[]
}

const H = 3600_000
const FILE = resolve(process.env.DATA_DIR || resolve(import.meta.dirname, '../../data'), 'state.json')

function empty(): State { return { quotes: [], orders: [], jobs: seedJobs(), inspections: [], ledger: [], agentRuns: [] } }


function load(): State {
  try {
    if (existsSync(FILE)) return { ...empty(), ...JSON.parse(readFileSync(FILE, 'utf8')) }
  } catch { /* fall through to a fresh state */ }
  return empty()
}

let timer: NodeJS.Timeout | null = null
export function save() {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(state, null, 1))
  }, 150)
}

export function reset() { resetIds(); state.quotes = []; state.orders = []; state.inspections = []; state.ledger = []; state.agentRuns = []; state.jobs = seedJobs(); save() }
export { uid }

/** Hour aligned "now" so the Gantt starts on a clean grid line. */
export function shopNow() { const d = new Date(); d.setMinutes(0, 0, 0); return d }

/** Other customers' work already on the floor, so the schedule looks like a real shop. */
function seedJobs(): Job[] {
  const t0 = shopNow().getTime()
  const mk = (machine_id: string, name: string, startH: number, hours: number, state: Job['state'] = 'scheduled'): Job => ({
    id: uid('job'), order_id: 'existing', machine_id, name, start: new Date(t0 + startH * H).toISOString(),
    end: new Date(t0 + (startH + hours) * H).toISOString(), hours, state, seeded: true,
  })
  return [
    mk('vmc-1', 'Gearbox housing x4', -6, 14, 'running'),
    mk('vmc-1', 'Sensor mount x40', 10, 9),
    mk('vmc-2', 'Valve body x12', -3, 11, 'running'),
    mk('vmc-2', 'Heat sink x60', 9, 16),
    mk('5ax-1', 'Impeller x2', -8, 20, 'running'),
    mk('5ax-1', 'Hip implant trial x6', 14, 12),
    mk('lpbf-1', 'Bracket lattice plate', -10, 30, 'running'),
    mk('sheet-1', 'Enclosure panels x30', -2, 6, 'running'),
    mk('sheet-1', 'Chassis rails x80', 6, 10),
  ]
}

/** Calendar hours a job needs: machine hours stretched over two shifts a day. */
export function calendarHours(machineHours: number) { return machineHours * 24 / SHOP.hours_per_day }

/** First free slot on a machine at or after now. */
export function nextSlot(machineId: string, hours: number) {
  const now = shopNow().getTime()
  const jobs = state.jobs.filter(j => j.machine_id === machineId).sort((a, b) => +new Date(a.start) - +new Date(b.start))
  let t = now
  for (const j of jobs) {
    const s = +new Date(j.start), e = +new Date(j.end)
    if (t + hours * H <= s) break
    if (e > t) t = e
  }
  return { start: new Date(t), end: new Date(t + hours * H) }
}

export function leadTimeDays(machineId: string, machineHours: number, setupH: number) {
  const cal = calendarHours(machineHours + setupH)
  const slot = nextSlot(machineId, cal)
  const days = Math.ceil((+slot.end - shopNow().getTime()) / (24 * H)) + SHOP.inspection_days + SHOP.shipping_days
  return { days, slot, calendar_h: cal }
}

export function machineIds() { return MACHINES.map(m => m.id) }

export let state: State = load()
