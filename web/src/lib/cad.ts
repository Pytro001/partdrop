import type { PartFeatures } from '../../../shared/types.ts'
import CadWorker from './cad.worker.ts?worker'

export interface LoadedPart {
  name: string
  positions: Float32Array
  index: Uint32Array | null
  features: PartFeatures
  ms: { parse: number; measure: number }
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { res: (p: LoadedPart) => void; rej: (e: Error) => void; name: string }>()

function w() {
  if (worker) return worker
  worker = new CadWorker()
  worker.onmessage = (e: MessageEvent) => {
    const d = e.data
    const p = pending.get(d.id)
    if (!p) return
    pending.delete(d.id)
    if (d.ok) p.res({ name: p.name, positions: d.positions, index: d.index, features: d.features, ms: d.ms })
    else p.rej(new Error(d.error))
  }
  return worker
}

export function loadPart(name: string, buf: ArrayBuffer): Promise<LoadedPart> {
  const id = ++seq
  return new Promise((res, rej) => {
    pending.set(id, { res, rej, name })
    w().postMessage({ id, name, buf }, [buf])
  })
}

export async function loadSample(ref: string) {
  const r = await fetch(`/samples/cad/${ref}.step`)
  if (!r.ok) throw new Error(`sample ${ref} missing`)
  return loadPart(`${ref}.step`, await r.arrayBuffer())
}
