// Simple local auth for the demo: two fixed test accounts, HMAC signed bearer tokens.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export type Role = 'buyer' | 'shop'
export interface User { email: string; role: Role; name: string }

export const USERS: Record<string, User & { password: string }> = {
  'buyer@demo': { email: 'buyer@demo', role: 'buyer', name: 'Northwind Robotics (buyer)', password: process.env.DEMO_PASSWORD || 'partdrop' },
  'shop@demo': { email: 'shop@demo', role: 'shop', name: 'Kestrel Machine Works (shop)', password: process.env.DEMO_PASSWORD || 'partdrop' },
}

const secret = () => process.env.AUTH_SECRET || 'dev-only-secret-change-me'
const b64 = (s: string) => Buffer.from(s).toString('base64url')

export function issue(u: User) {
  const body = b64(JSON.stringify({ e: u.email, r: u.role, x: Date.now() + 7 * 86400_000 }))
  return `${body}.${createHmac('sha256', secret()).update(body).digest('base64url')}`
}

export function readToken(t: string | undefined): User | null {
  if (!t) return null
  const [body, sig] = t.split('.')
  if (!body || !sig) return null
  const want = createHmac('sha256', secret()).update(body).digest()
  const got = Buffer.from(sig, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  const p = JSON.parse(Buffer.from(body, 'base64url').toString())
  if (p.x < Date.now()) return null
  const u = USERS[p.e]
  return u ? { email: u.email, role: u.role, name: u.name } : null
}

export function login(email: string, password: string) {
  const u = USERS[String(email).trim().toLowerCase()]
  if (!u) return null
  const a = Buffer.from(String(password)), b = Buffer.from(u.password)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return { token: issue(u), user: { email: u.email, role: u.role, name: u.name } }
}

declare module 'express-serve-static-core' { interface Request { user?: User } }

export function auth(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const u = readToken((req.headers.authorization || '').replace(/^Bearer /, ''))
    if (!u) return res.status(401).json({ error: 'sign in first' })
    if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: `needs role ${roles.join(' or ')}` })
    req.user = u
    next()
  }
}
