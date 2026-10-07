import { useEffect, useState } from 'react'
import { AgentView } from './agent/AgentView.tsx'
import { BuyerView } from './buyer/BuyerView.tsx'
import { Director } from './film/Director.tsx'
import { FILM } from './film/clock.ts'
import { film } from './film/hooks.ts'
import { config, getSession, login, setActive, signOut, type Config, type Role } from './lib/api.ts'
import { ShopView } from './shop/ShopView.tsx'

type View = 'buyer' | 'shop' | 'agent'
const ROLE: Record<View, Role> = { buyer: 'buyer', agent: 'buyer', shop: 'shop' }
const readHash = (): View => { const h = location.hash.replace(/^#\/?/, '').split('/')[0]; return h === 'shop' || h === 'agent' ? h : 'buyer' }

export const Logo = () => (
  <svg viewBox="0 0 32 32" aria-hidden><path d="M16 5 26 10.5v11L16 27 6 21.5v-11z" fill="none" stroke="#7cf2c4" strokeWidth="2.2" strokeLinejoin="round" /><path d="M16 15v12M6 10.5 16 16l10-5.5" fill="none" stroke="#7cf2c4" strokeWidth="2.2" strokeLinejoin="round" /></svg>
)

export function App() {
  const [view, setView] = useState<View>(readHash)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [, force] = useState(0)
  useEffect(() => { config().then(setCfg) }, [])
  useEffect(() => { const h = () => setView(readHash()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h) }, [])
  const go = (v: View) => { location.hash = `/${v}`; setView(v); if (getSession(ROLE[v])) setActive(ROLE[v]) }
  useEffect(() => film.register('app', { go, refresh: () => force(x => x + 1) }))

  const session = getSession(ROLE[view])
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Logo />PartDrop</div>
        <nav className="nav" aria-label="Views">
          <button aria-current={view === 'buyer' ? 'page' : undefined} onClick={() => go('buyer')}>Buyer</button>
          <button aria-current={view === 'shop' ? 'page' : undefined} onClick={() => go('shop')}>Shop</button>
          <button aria-current={view === 'agent' ? 'page' : undefined} onClick={() => go('agent')}>Buyer agent</button>
        </nav>
        <div className="spacer" />
        {cfg && <span className={`badge ${cfg.paypal.mode}`} title={cfg.paypal.mode === 'mock' ? 'Local fake of the PayPal REST API, no money moves' : 'PayPal sandbox'}><span className="dot" />PayPal {cfg.paypal.mode.toUpperCase()}</span>}
        {cfg && <span className="badge" title={cfg.ai.model}><span className="dot" style={{ color: 'var(--mint)' }} />Claude on Bedrock</span>}
        {session && <span className="who">Signed in as <b>{session.user.email}</b></span>}
        {session && !FILM && <button className="linkbtn" onClick={() => { signOut(); force(x => x + 1) }}>Sign out</button>}
      </header>
      <main className="main">
        {!session ? <Login role={ROLE[view]} onDone={() => force(x => x + 1)} />
          : view === 'buyer' ? <BuyerView />
          : view === 'shop' ? <ShopView />
          : <AgentView />}
      </main>
      {FILM && <Director />}
    </div>
  )
}

function Login({ role, onDone }: { role: Role; onDone: () => void }) {
  const [email, setEmail] = useState(`${role}@demo`)
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setEmail(`${role}@demo`) }, [role])
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    try { await login(email, password); onDone() } catch (x) { setErr((x as Error).message) }
  }
  return (
    <div className="login">
      <div className="panel card">
        <div className="brand" style={{ fontSize: 22 }}><Logo />PartDrop</div>
        <h1>Sign in as the {role}</h1>
        <div className="muted">Demo accounts: buyer@demo and shop@demo, password <span className="mono">partdrop</span>.</div>
        <form onSubmit={submit}>
          <div className="field"><label htmlFor="em">Email</label><input id="em" className="input" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></div>
          {err && <div className="err">{err}</div>}
          <button className="btn" type="submit">Sign in</button>
        </form>
      </div>
    </div>
  )
}
