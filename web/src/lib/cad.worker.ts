// Classic worker: reads STEP (OpenCascade WASM) or STL and measures the part off the UI thread.
import { computeFeatures, mergeMeshes, type MeshInput } from '../../../shared/geometry.ts'

let occt: Promise<any> | null = null
/** Loads the emscripten build as plain script text, so it works in classic and module workers. */
function getOcct() {
  if (!occt) {
    occt = fetch('/occt/occt-import-js.js').then(r => r.text()).then(code => {
      const factory = new Function(`${code}\nreturn occtimportjs`)() as (o?: { locateFile?: (f: string) => string }) => Promise<any>
      return factory({ locateFile: (f: string) => `/occt/${f}` })
    })
  }
  return occt
}

function parseStl(buf: ArrayBuffer): MeshInput {
  const dv = new DataView(buf)
  const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0
  if (84 + n * 50 === buf.byteLength) {
    const pos = new Float32Array(n * 9)
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true)
    return { positions: pos }
  }
  const txt = new TextDecoder().decode(buf)
  const v: number[] = []
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g
  let m
  while ((m = re.exec(txt))) v.push(+m[1], +m[2], +m[3])
  return { positions: new Float32Array(v) }
}

self.onmessage = async (e: MessageEvent<{ id: number; name: string; buf: ArrayBuffer }>) => {
  const { id, name, buf } = e.data
  try {
    const t0 = performance.now()
    const isStl = /\.stl$/i.test(name)
    let mesh: MeshInput
    if (isStl) mesh = parseStl(buf)
    else {
      const o = await getOcct()
      const r = o.ReadStepFile(new Uint8Array(buf), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0008, angularDeflection: 0.3 })
      if (!r.success || !r.meshes?.length) throw new Error('Could not read this STEP file')
      mesh = mergeMeshes(r.meshes.map((m: any) => ({ positions: new Float32Array(m.attributes.position.array), index: new Uint32Array(m.index.array), brepFaces: m.brep_faces })))
    }
    const t1 = performance.now()
    const features = computeFeatures(mesh, name, isStl ? 'stl' : 'step')
    const pos = mesh.positions as Float32Array
    const idx = (mesh.index ?? null) as Uint32Array | null
    ;(self as any).postMessage({ id, ok: true, positions: pos, index: idx, features, ms: { parse: Math.round(t1 - t0), measure: Math.round(performance.now() - t1) } }, [pos.buffer, ...(idx ? [idx.buffer] : [])])
  } catch (err) {
    ;(self as any).postMessage({ id, ok: false, error: (err as Error).message })
  }
}
