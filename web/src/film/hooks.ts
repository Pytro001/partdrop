// Registry the film director uses to drive views (the same handlers the buttons call).
type Handlers = Record<string, (...a: any[]) => any>
const reg = new Map<string, Handlers>()
export const film = {
  register(name: string, h: Handlers) { reg.set(name, h); return () => { if (reg.get(name) === h) reg.delete(name) } },
  get(name: string) { return reg.get(name) },
}
;(window as any).__pd = film
