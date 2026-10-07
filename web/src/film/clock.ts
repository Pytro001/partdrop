// Virtual clock for ?film=1. Replaces performance.now, Date.now, requestAnimationFrame and
// timers, and pins CSS animations to virtual time, so the Playwright recorder can step the
// page frame by frame and every frame is deterministic. Imported first by main.tsx.
export const FILM = typeof location !== 'undefined' && new URLSearchParams(location.search).has('film')

type Timer = { id: number; due: number; cb: (...a: any[]) => void; args: any[]; every: number | null }

export const clock = {
  vt: 0,
  installed: false,
  advance: async (_dt: number) => {},
}

if (FILM) install()

function install() {
  clock.installed = true
  ;(window as any).__realSetTimeout = window.setTimeout.bind(window)
  const realDateNow = Date.now.bind(Date)
  const base = realDateNow()
  let seq = 1
  const timers = new Map<number, Timer>()
  let rafQ: { id: number; cb: FrameRequestCallback }[] = []

  performance.now = () => clock.vt
  Date.now = () => base + Math.round(clock.vt)
  ;(window as any).requestAnimationFrame = (cb: FrameRequestCallback) => { const id = seq++; rafQ.push({ id, cb }); return id }
  ;(window as any).cancelAnimationFrame = (id: number) => { rafQ = rafQ.filter(r => r.id !== id) }
  ;(window as any).setTimeout = (cb: any, ms = 0, ...args: any[]) => { const id = seq++; timers.set(id, { id, due: clock.vt + Math.max(0, +ms || 0), cb, args, every: null }); return id }
  ;(window as any).setInterval = (cb: any, ms = 0, ...args: any[]) => { const id = seq++; const every = Math.max(1, +ms || 1); timers.set(id, { id, due: clock.vt + every, cb, args, every }); return id }
  ;(window as any).clearTimeout = (id: number) => { timers.delete(id) }
  ;(window as any).clearInterval = (id: number) => { timers.delete(id) }

  // CSS transitions and animations: freeze on creation, then drive currentTime from vt
  const starts = new WeakMap<Animation, number>()
  const grab = () => {
    for (const a of document.getAnimations()) {
      if (!starts.has(a)) { starts.set(a, clock.vt); a.pause(); a.currentTime = 0 }
    }
  }
  for (const ev of ['transitionrun', 'animationstart']) document.addEventListener(ev, grab, true)

  const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve() }

  clock.advance = async (dt: number) => {
    const target = clock.vt + dt
    for (;;) {
      let next: Timer | null = null
      for (const t of timers.values()) if (t.due <= target && (!next || t.due < next.due)) next = t
      if (!next) break
      clock.vt = Math.max(clock.vt, next.due)
      if (next.every) next.due += next.every
      else timers.delete(next.id)
      try { next.cb(...next.args) } catch (e) { console.error(e) }
      await flush()
    }
    clock.vt = target
    const q = rafQ
    rafQ = []
    for (const r of q) { try { r.cb(clock.vt) } catch (e) { console.error(e) } }
    await flush()
    grab()
    for (const a of document.getAnimations()) {
      const s = starts.get(a)
      if (s === undefined) continue
      const end = Number(a.effect?.getComputedTiming().endTime ?? Infinity)
      if (Number.isFinite(end) && clock.vt - s >= end) { a.finish(); continue }
      a.pause()
      a.currentTime = clock.vt - s
    }
  }
}
