// Measures the sample parts with the same geometry code the browser uses and writes
// samples/features.json (used by the buyer agent, which has no browser).
//   npx tsx scripts/sample-features.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { computeFeatures, mergeMeshes } from '../shared/geometry.ts'

const require = createRequire(import.meta.url)
const occtimportjs = require('occt-import-js')
const ROOT = resolve(import.meta.dirname, '..')

export async function readStep(buf: Uint8Array) {
  const occt = await occtimportjs()
  const r = occt.ReadStepFile(buf, { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0008, angularDeflection: 0.3 })
  if (!r.success) throw new Error('STEP read failed')
  return mergeMeshes(r.meshes.map((m: any) => ({ positions: new Float32Array(m.attributes.position.array), index: new Uint32Array(m.index.array), brepFaces: m.brep_faces })))
}

if (process.argv[1]?.endsWith('sample-features.ts')) {
const drawings = JSON.parse(readFileSync(resolve(ROOT, 'samples/drawings.json'), 'utf8'))
const out: Record<string, unknown> = {}
for (const ref of Object.keys(drawings)) {
  const t0 = Date.now()
  const mesh = await readStep(new Uint8Array(readFileSync(resolve(ROOT, `samples/cad/${ref}.step`))))
  const f = computeFeatures(mesh, `${ref}.step`, 'step')
  out[ref] = f
  console.log(ref, Date.now() - t0, 'ms', JSON.stringify(f))
}
writeFileSync(resolve(ROOT, 'samples/features.json'), JSON.stringify(out, null, 1))
}
