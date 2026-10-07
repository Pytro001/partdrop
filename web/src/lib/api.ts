// API client. Tokens for both demo roles are kept so the demo can switch between buyer and shop.
import type { Machine, Material } from '../../../shared/types.ts'

export type Role = 'buyer' | 'shop'
export interface Session { token: string; user: { email: string; role: Role; name: string } }

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
const KEY = 'partdrop.sessions'

function readSessions(): Partial<Record<Role, Session>> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
let sessions: Partial<Record<Role, Session>> = readSessions()
let active: Role | null = (() => { try { return (localStorage.getItem(KEY + '.active') as Role) || null } catch { return null } })()

export function getSession(role?: Role) { return sessions[role ?? active ?? 'buyer'] ?? null }
export function activeRole() { return active && sessions[active] ? active : null }
export function setActive(r: Role) { active = r; try { localStorage.setItem(KEY + '.active', r) } catch { /* private mode */ } }
export function signOut() { sessions = {}; active = null; try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '.active') } catch { /* ignore */ } }

export async function login(email: string, password: string) {
  const r = await fetch(`${API}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || 'login failed')
  sessions[j.user.role as Role] = j
  try { localStorage.setItem(KEY, JSON.stringify(sessions)) } catch { /* private mode */ }
  setActive(j.user.role)
  return j as Session
}

export class ApiError extends Error { constructor(public status: number, message: string, public body?: any) { super(message) } }

export async function api<T = any>(path: string, body?: unknown, role?: Role): Promise<T> {
  const s = getSession(role)
  const r = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(s ? { authorization: `Bearer ${s.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError(r.status, j.error || r.statusText, j)
  return j as T
}

export interface Config {
  paypal: { mode: 'sandbox' | 'mock'; clientId: string; intent: string; currency: string }
  ai: { model: string; mode: string }
  shop: { name: string; city: string; margin_pct: number; platform_fee_pct: number; payout_email: string }
  machines: Machine[]
  materials: Material[]
  mandate_usd: number
}

let cfg: Promise<Config> | null = null
export function config() { return (cfg ??= fetch(`${API}/api/config`).then(r => r.json())) }

/** Server sent events for live order, trace and webhook updates. */
export function events(on: (type: string, data: any) => void, role?: Role) {
  const s = getSession(role)
  if (!s) return () => {}
  // fetch based SSE so the token travels in a header, not the URL
  const ctl = new AbortController()
  let stopped = false
  const connect = async () => {
    while (!stopped) {
      try {
        const r = await fetch(`${API}/api/events`, { headers: { authorization: `Bearer ${s.token}`, accept: 'text/event-stream' }, signal: ctl.signal })
        const reader = r.body!.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
            const type = /^event: (.*)$/m.exec(chunk)?.[1]
            const data = /^data: (.*)$/m.exec(chunk)?.[1]
            if (type && data) { try { on(type, JSON.parse(data)) } catch { /* ignore bad frame */ } }
          }
        }
      } catch { /* aborted or dropped */ }
      if (!stopped) await new Promise(r => setTimeout(r, 1500))
    }
  }
  connect()
  return () => { stopped = true; ctl.abort() }
}

export const money = (x: number) => '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
