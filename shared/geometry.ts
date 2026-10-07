// Geometry features measured from a triangle mesh. Runs in the browser (on upload) and in
// Node (scripts/sample-features.ts). Pure functions over arrays plus a BVH for ray casts.
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { PartFeatures } from './types.ts'

export interface MeshInput {
  positions: Float32Array | number[]
  index?: Uint32Array | Uint16Array | number[] | null
  /** STEP only: triangle ranges per B-rep face (from occt-import-js brep_faces). */
  brepFaces?: { first: number; last: number }[] | null
}

/** Seeded PRNG so the sampled features are identical on every run. */
function mulberry(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** Merge meshes (occt-import-js returns one per solid) into one indexed list. */
export function mergeMeshes(parts: MeshInput[]): MeshInput {
  let nv = 0, ni = 0
  for (const p of parts) { nv += p.positions.length; ni += p.index ? p.index.length : p.positions.length / 3 }
  const positions = new Float32Array(nv), index = new Uint32Array(ni)
  const brep: { first: number; last: number }[] = []
  let vo = 0, io = 0, hasBrep = false
  for (const p of parts) {
    positions.set(p.positions as ArrayLike<number>, vo)
    const base = vo / 3, triBase = io / 3
    const idx = p.index ?? Array.from({ length: p.positions.length / 3 }, (_, i) => i)
    for (let i = 0; i < idx.length; i++) index[io + i] = idx[i] + base
    if (p.brepFaces) { hasBrep = true; for (const f of p.brepFaces) brep.push({ first: f.first + triBase, last: f.last + triBase }) }
    vo += p.positions.length; io += idx.length
  }
  return { positions, index, brepFaces: hasBrep ? brep : null }
}

/** Weld coincident vertices (STEP tessellation duplicates them on every face boundary). */
function weld(pos: ArrayLike<number>, idx: ArrayLike<number>, tol = 1e-3) {
  const map = new Map<string, number>()
  const remap = new Uint32Array(pos.length / 3)
  let n = 0
  const inv = 1 / tol
  for (let i = 0; i < pos.length / 3; i++) {
    const k = `${Math.round(pos[i * 3] * inv)},${Math.round(pos[i * 3 + 1] * inv)},${Math.round(pos[i * 3 + 2] * inv)}`
    let v = map.get(k)
    if (v === undefined) { v = n++; map.set(k, v) }
    remap[i] = v
  }
  const tri = new Uint32Array(idx.length)
  for (let i = 0; i < idx.length; i++) tri[i] = remap[idx[i]]
  return { tri, nv: n }
}

function find(p: Int32Array, x: number): number { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x] } return x }

/** Smallest eigenvector of a symmetric 3x3 (Jacobi), used for cylinder axes. */
function eigen3(m: number[][]) {
  const a = m.map(r => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 30; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-12) continue
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q])
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1))
      const c = 1 / Math.sqrt(t * t + 1), s = t * c
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq }
    }
  }
  const vals = [a[0][0], a[1][1], a[2][2]]
  const order = [0, 1, 2].sort((i, j) => vals[i] - vals[j])
  return { vals: order.map(i => vals[i]), vecs: order.map(i => [v[0][i], v[1][i], v[2][i]]) }
}

interface Hole { axis: THREE.Vector3; center: THREE.Vector3; r: number }

/** Concave cylindrical B-rep faces grouped by axis line and radius. */
function holeFeatures(pos: ArrayLike<number>, idx: ArrayLike<number>, faces: { first: number; last: number }[]) {
  const holes: Hole[] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3()
  const P = (i: number, out: THREE.Vector3) => out.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
  for (const f of faces) {
    const count = f.last - f.first + 1
    if (count < 6) continue
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    const pts: THREE.Vector3[] = [], nrm: THREE.Vector3[] = []
    for (let t = f.first; t <= f.last; t++) {
      P(idx[t * 3], a); P(idx[t * 3 + 1], b); P(idx[t * 3 + 2], c)
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a))
      const ar = n.length()
      if (ar < 1e-12) continue
      n.divideScalar(ar)
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += n.getComponent(i) * n.getComponent(j)
      pts.push(new THREE.Vector3().addVectors(a, b).add(c).divideScalar(3))
      nrm.push(n.clone())
    }
    if (pts.length < 6) continue
    const { vals, vecs } = eigen3(M)
    const tot = vals[0] + vals[1] + vals[2]
    // cylinder: normals span a plane (one ~zero eigenvalue, the other two both present)
    if (vals[0] / tot > 0.01 || vals[1] / tot < 0.08) continue
    const axis = new THREE.Vector3(...vecs[0] as [number, number, number]).normalize()
    // circle fit in the plane perpendicular to the axis (Kasa)
    const u = new THREE.Vector3(...vecs[1] as [number, number, number]).normalize(), v = new THREE.Vector3().crossVectors(axis, u)
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0
    for (const p of pts) {
      const x = p.dot(u), y = p.dot(v), z = x * x + y * y
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z
    }
    const N = pts.length
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, N]], B = [sxz, syz, sz]
    const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    const D = det(A)
    if (Math.abs(D) < 1e-12) continue
    const sol = [0, 1, 2].map(k => det(A.map((row, i) => row.map((x, j) => (j === k ? B[i] : x)))) / D)
    const cx = sol[0] / 2, cy = sol[1] / 2, r = Math.sqrt(Math.max(0, sol[2] + cx * cx + cy * cy))
    if (!(r > 0.05 && r < 500)) continue
    const center = new THREE.Vector3().addScaledVector(u, cx).addScaledVector(v, cy)
    // concave when normals point toward the axis
    let inward = 0
    for (let i = 0; i < N; i++) {
      const p = pts[i]
      const radial = new THREE.Vector3(p.dot(u) - cx, p.dot(v) - cy, 0)
      const nr = nrm[i].dot(u) * radial.x + nrm[i].dot(v) * radial.y
      inward += nr < 0 ? 1 : -1
    }
    if (inward <= 0) continue
    // merge with an existing hole on the same axis line and radius
    const same = holes.find(h => Math.abs(Math.abs(h.axis.dot(axis)) - 1) < 1e-3 && Math.abs(h.r - r) < Math.max(0.05, r * 0.03) && (() => {
      const d = new THREE.Vector3().subVectors(center, h.center)
      d.addScaledVector(h.axis, -d.dot(h.axis))
      return d.length() < Math.max(0.1, r * 0.1)
    })())
    if (!same) holes.push({ axis, center: center.addScaledVector(axis, 0), r })
  }
  return holes
}

export function computeFeatures(input: MeshInput, fileName: string, format: 'step' | 'stl'): PartFeatures {
  const pos = input.positions
  const rawIdx = input.index ?? Array.from({ length: pos.length / 3 }, (_, i) => i)
  const { tri, nv } = weld(pos, rawIdx)
  const T = tri.length / 3

  // volume, area, bbox
  let vol = 0, area = 0
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]) }
  const idx = rawIdx
  const triArea = new Float64Array(T)
  for (let t = 0; t < T; t++) {
    const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3
    const ax = pos[i0], ay = pos[i0 + 1], az = pos[i0 + 2]
    const bx = pos[i1], by = pos[i1 + 1], bz = pos[i1 + 2]
    const cx = pos[i2], cy = pos[i2 + 1], cz = pos[i2 + 2]
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    triArea[t] = Math.sqrt(nx * nx + ny * ny + nz * nz) / 2
    area += triArea[t]
  }
  const flip = vol < 0 ? -1 : 1 // inward facing meshes
  vol = Math.abs(vol)

  // shells and Euler characteristic on the welded mesh
  const parent = new Int32Array(nv).map((_, i) => i)
  const edges = new Set<number>()
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 3; k++) {
      const a = tri[t * 3 + k], b = tri[t * 3 + ((k + 1) % 3)]
      const lo = Math.min(a, b), hi = Math.max(a, b)
      edges.add(lo * nv + hi)
      const ra = find(parent, a), rb = find(parent, b)
      if (ra !== rb) parent[ra] = rb
    }
  }
  const used = new Uint8Array(nv)
  for (let i = 0; i < tri.length; i++) used[tri[i]] = 1
  let V = 0
  const roots = new Set<number>()
  for (let i = 0; i < nv; i++) if (used[i]) { V++; roots.add(find(parent, i)) }
  const shells = roots.size
  const chi = V - edges.size + T
  const genus = Math.max(0, Math.round((2 * shells - chi) / 2))

  // hole features from B-rep faces (STEP)
  const holes = input.brepFaces ? holeFeatures(pos, idx, input.brepFaces) : null

  // BVH for ray casts
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos as ArrayLike<number>), 3))
  // MeshBVH reorders the index in place, so give it a copy
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx as ArrayLike<number>), 1))
  const bvh = new MeshBVH(g)

  // area weighted surface samples
  const rng = mulberry(1234)
  const cdf = new Float64Array(T)
  let acc = 0
  for (let t = 0; t < T; t++) { acc += triArea[t]; cdf[t] = acc }
  const NS = 1600
  const ray = new THREE.Ray()
  const p = new THREE.Vector3(), n = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3()
  const dirs6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(d => new THREE.Vector3(...d as [number, number, number]))
  const dirs26: THREE.Vector3[] = []
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) dirs26.push(new THREE.Vector3(x, y, z).normalize())
  const thick: number[] = []
  const samples: { p: THREE.Vector3; n: THREE.Vector3; t: number }[] = []
  let hidden3 = 0, hidden5 = 0
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  const eps = Math.max(1e-3, diag * 2e-5)
  const visible = (o: THREE.Vector3, d: THREE.Vector3) => {
    if (n.dot(d) < -0.02) return false
    ray.origin.copy(o).addScaledVector(n, eps * 20).addScaledVector(d, eps * 5)
    ray.direction.copy(d)
    return !bvh.raycastFirst(ray, THREE.DoubleSide)
  }
  for (let s = 0; s < NS; s++) {
    const r = rng() * acc
    let lo = 0, hi = T - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid }
    const t = lo
    A.fromArray(pos as ArrayLike<number> as number[], idx[t * 3] * 3); B.fromArray(pos as number[], idx[t * 3 + 1] * 3); C.fromArray(pos as number[], idx[t * 3 + 2] * 3)
    let u = rng(), v = rng()
    if (u + v > 1) { u = 1 - u; v = 1 - v }
    p.copy(A).addScaledVector(B.clone().sub(A), u).addScaledVector(C.clone().sub(A), v)
    n.crossVectors(B.clone().sub(A), C.clone().sub(A)).normalize().multiplyScalar(flip)
    // wall thickness: cast inward
    ray.origin.copy(p).addScaledVector(n, -eps)
    ray.direction.copy(n).negate()
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide)
    const th = hit ? hit.distance + eps : diag
    thick.push(th)
    samples.push({ p: p.clone(), n: n.clone(), t: th })
    if (!dirs6.some(d => visible(p, d))) hidden3++
    if (!dirs26.some(d => visible(p, d))) hidden5++
  }
  const sorted = [...thick].sort((a, b) => a - b)
  const minWall = sorted[Math.floor(sorted.length * 0.02)]

  // constant thickness (sheet candidate): most samples within 8% of the modal thickness
  const bins = new Map<number, number>()
  for (const t of thick) { const k = Math.round(t * 10); bins.set(k, (bins.get(k) ?? 0) + 1) }
  const mode = [...bins.entries()].sort((a, b) => b[1] - a[1])[0][0] / 10
  const near = thick.filter(t => Math.abs(t - mode) <= Math.max(0.08, mode * 0.08)).length / thick.length
  const constT = mode <= 6 && near >= 0.8 ? Math.round(mode * 100) / 100 : null

  // bends: distinct panel planes among constant thickness samples, two planes per panel
  let bends = 0
  if (constT !== null) {
    const planes = new Set<string>()
    for (const s of samples) {
      if (Math.abs(s.t - constT) > constT * 0.1) continue
      const k = [s.n.x, s.n.y, s.n.z].map(x => Math.round(x * 5)).join(',') + '|' + Math.round(s.n.dot(s.p) / Math.max(0.5, constT / 2))
      planes.add(k)
    }
    bends = Math.max(0, Math.round(planes.size / 2) - 1)
  }

  const holeCount = holes ? holes.length : genus
  const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100
  return {
    fileName, format, triangles: T,
    volume_mm3: r1(vol), surface_area_mm2: r1(area),
    bbox_mm: [r2(max[0] - min[0]), r2(max[1] - min[1]), r2(max[2] - min[2])],
    through_holes: genus,
    hole_features: holes ? holes.length : null,
    hole_estimate: holeCount,
    smallest_hole_mm: holes && holes.length ? r2(Math.min(...holes.map(h => h.r * 2))) : null,
    min_wall_mm: r2(minWall),
    thin_wall: minWall < 1.0,
    hidden_area_3axis_pct: r1(hidden3 / NS * 100),
    hidden_area_5axis_pct: r1(hidden5 / NS * 100),
    constant_thickness_mm: constT,
    bend_estimate: bends,
    shells,
  }
}
