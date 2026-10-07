let counter = 0
export function resetIds() { counter = 0 }

/** Ids. With DETERMINISTIC_IDS=1 they are counters, so a recorded film run replays identically. */
export function uid(prefix: string) {
  if (process.env.DETERMINISTIC_IDS === '1') return `${prefix}_${String(++counter).padStart(4, '0')}`
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
