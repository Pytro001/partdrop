import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { LoadedPart } from '../lib/cad.ts'

export interface ViewerHandle { snapshot: () => string | null }

/** Builds a Three.js mesh from the worker output. CAD is Z up, Three is Y up. */
export function partMesh(part: LoadedPart, mat?: THREE.Material) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(part.positions.slice(), 3))
  if (part.index) g.setIndex(new THREE.BufferAttribute(part.index, 1))
  g.computeVertexNormals()
  g.computeBoundingBox()
  const c = g.boundingBox!.getCenter(new THREE.Vector3())
  g.translate(-c.x, -c.y, -g.boundingBox!.min.z)
  g.rotateX(-Math.PI / 2)
  g.computeBoundingBox()
  const m = new THREE.Mesh(g, mat ?? new THREE.MeshPhysicalMaterial({ color: 0xc8ced6, metalness: 1, roughness: 0.3, clearcoat: 0.2, clearcoatRoughness: 0.4 }))
  m.castShadow = true
  m.receiveShadow = true
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), new THREE.LineBasicMaterial({ color: 0x0a0f16, transparent: true, opacity: 0.35 }))
  m.add(edges)
  return m
}

export const PartViewer = forwardRef<ViewerHandle, { part: LoadedPart | null; spin?: boolean; showDims?: boolean }>(function PartViewer({ part, spin = true, showDims = true }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const st = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; holder: THREE.Group; spin: boolean; t0: number } | null>(null)
  const [labels, setLabels] = useState<{ x: number; y: number; text: string }[]>([])
  const dimPts = useRef<{ p: THREE.Vector3; text: string }[]>([])

  useImperativeHandle(ref, () => ({
    snapshot: () => {
      const s = st.current
      if (!s) return null
      s.renderer.render(s.scene, s.camera)
      return s.renderer.domElement.toDataURL('image/png').split(',')[1]
    },
  }))

  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.9
    renderer.shadowMap.enabled = true
        el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 5000)
    camera.position.set(160, 120, 200)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = false
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(120, 260, 140)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
        Object.assign(key.shadow.camera, { left: -200, right: 200, top: 200, bottom: -200, near: 1, far: 800 })
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x7cf2c4, 0.6)
    rim.position.set(-200, 80, -160)
    scene.add(rim)
    const ground = new THREE.Mesh(new THREE.CircleGeometry(600, 64), new THREE.ShadowMaterial({ opacity: 0.35 }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)
    const grid = new THREE.PolarGridHelper(260, 12, 6, 96, 0x18222d, 0x111820)
    grid.position.y = 0.05
    scene.add(grid)
    grid.visible = false
    const holder = new THREE.Group()
    scene.add(holder)
    st.current = { renderer, scene, camera, controls, holder, spin, t0: performance.now(), grid } as any
    let raf = 0
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()
    let last = performance.now()
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const s = st.current!
      if (s.spin && s.holder.children.length) s.holder.rotation.y += dt * 0.45
      controls.update()
      renderer.render(scene, camera)
      // project the dimension anchors for the HTML labels
      if (dimPts.current.length) {
        const w = el.clientWidth, h = el.clientHeight
        const out = dimPts.current.map(d => {
          const v = d.p.clone().applyMatrix4(holder.matrixWorld).project(camera)
          return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, text: d.text }
        })
        setLabels(prev => (prev.length === out.length && prev.every((p, i) => Math.abs(p.x - out[i].x) < 0.5 && Math.abs(p.y - out[i].y) < 0.5) ? prev : out))
      }
    }
    tick()
    return () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); pmrem.dispose(); el.removeChild(renderer.domElement) }
  }, [])

  useEffect(() => { if (st.current) st.current.spin = spin }, [spin])

  useEffect(() => {
    const s = st.current
    if (!s) return
    s.holder.clear()
    s.holder.rotation.set(0, -0.6, 0)
    dimPts.current = []
    setLabels([])
    ;(s as any).grid.visible = !!part
    if (!part) return
    const m = partMesh(part)
    s.holder.add(m)
    const bb = m.geometry.boundingBox!
    const size = bb.getSize(new THREE.Vector3())
    const r = size.length() / 2
    s.camera.position.set(r * 1.9, r * 1.35 + size.y * 0.3, r * 2.4)
    s.controls.target.set(0, size.y * 0.42, 0)
    s.controls.minDistance = r * 1.2
    s.controls.maxDistance = r * 8
    s.controls.update()
    if (showDims) {
      // bounding box frame with three dimension anchors (CAD X, Y, Z)
      const [X, Y, Z] = part.features.bbox_mm
      const box = new THREE.Box3Helper(bb, new THREE.Color(0x7cf2c4))
      ;(box.material as THREE.LineBasicMaterial).transparent = true
      ;(box.material as THREE.LineBasicMaterial).opacity = 0.35
      s.holder.add(box)
      dimPts.current = [
        { p: new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.min.y, bb.max.z), text: `${X.toFixed(1)} mm` },
        { p: new THREE.Vector3(bb.max.x, bb.min.y, (bb.min.z + bb.max.z) / 2), text: `${Y.toFixed(1)} mm` },
        { p: new THREE.Vector3(bb.max.x, (bb.min.y + bb.max.y) / 2, bb.max.z), text: `${Z.toFixed(1)} mm` },
      ]
    }
  }, [part, showDims])

  return (
    <div ref={host} style={{ position: 'absolute', inset: 0 }}>
      {labels.map((l, i) => <div key={i} className="dimlabel" style={{ left: l.x, top: l.y }}>{l.text}</div>)}
    </div>
  )
})
