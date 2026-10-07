// Stylised factory view: the actual part being machined (3 and 5 axis, sheet) or printed
// (LPBF). Material removal is shown with clipping planes driven by job progress.
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { LoadedPart } from '../lib/cad.ts'
import { partMesh } from '../buyer/PartViewer.tsx'

export interface FactoryProps {
  part: LoadedPart | null
  process: string
  /** 0..1 job progress, or null to animate on its own clock */
  progress: number | null
  onTick?: (p: number) => void
}

let rs = 7
const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647 }
const steel = (c: number, r = 0.45, m = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m })

function buildMill(scene: THREE.Scene) {
  const g = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: 0.6, metalness: 0.2 })
  const paint2 = new THREE.MeshStandardMaterial({ color: 0x9aa3ae, roughness: 0.55, metalness: 0.1 })
  const accent = new THREE.MeshStandardMaterial({ color: 0x7cf2c4, emissive: 0x7cf2c4, emissiveIntensity: 1.4 })
  const base = new THREE.Mesh(new RoundedBoxGeometry(900, 260, 620, 4, 18), paint)
  base.position.set(0, -130 - 60, 0)
  g.add(base)
  const table = new THREE.Mesh(new THREE.BoxGeometry(760, 50, 380), steel(0x3c434c, 0.5))
  table.position.set(0, -35, 0)
  g.add(table)
  for (let i = -2; i <= 2; i++) { // T slots
    const s = new THREE.Mesh(new THREE.BoxGeometry(760, 4, 14), steel(0x2a2f36, 0.6))
    s.position.set(0, -9.5, i * 70)
    g.add(s)
  }
  const column = new THREE.Mesh(new RoundedBoxGeometry(420, 900, 300, 4, 16), paint2)
  column.position.set(0, 330, -420)
  g.add(column)
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(424, 10, 304), accent)
  stripe.position.set(0, 600, -420)
  g.add(stripe)
  const enclosure = new THREE.Mesh(new THREE.BoxGeometry(1300, 1100, 1100), new THREE.MeshStandardMaterial({ color: 0x0b0f15, roughness: 0.9, side: THREE.BackSide }))
  enclosure.position.set(0, 300, -100)
  g.add(enclosure)
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fd8ff, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.05, metalness: 0 })
  const door = new THREE.Mesh(new THREE.PlaneGeometry(900, 700), glass)
  door.position.set(0, 250, 420)
  g.add(door)
  for (const x of [-650, 650]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(30, 1100, 30), paint)
    post.position.set(x, 300, 430)
    g.add(post)
  }
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(600, 8, 30), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf6ff, emissiveIntensity: 2 }))
  lamp.position.set(0, 830, 150)
  g.add(lamp)
  scene.add(g)
  // spindle head on the column
  const head = new THREE.Group()
  const hb = new THREE.Mesh(new RoundedBoxGeometry(220, 320, 260, 4, 14), paint2)
  hb.position.set(0, 160, -110)
  head.add(hb)
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(52, 60, 90, 48), steel(0x8a929c, 0.3))
  nose.position.set(0, 0, 0)
  head.add(nose)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(56, 3, 12, 64), accent)
  ring.rotation.x = Math.PI / 2
  ring.position.y = -42
  head.add(ring)
  const holder = new THREE.Mesh(new THREE.CylinderGeometry(22, 30, 60, 32), steel(0xb8c0ca, 0.25))
  holder.position.y = -75
  head.add(holder)
  const tool = new THREE.Group()
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 50, 20), steel(0xd8dde3, 0.2, 1))
  shank.position.y = -130
  tool.add(shank)
  const flute = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 30, 20), steel(0xc6a46a, 0.25, 1))
  flute.position.y = -170
  tool.add(flute)
  head.add(tool)
  scene.add(head)
  return { head, tool, tipOffset: 185 }
}

function buildPrinter(scene: THREE.Scene) {
  const g = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: 0.6, metalness: 0.2 })
  const room = new THREE.Mesh(new THREE.BoxGeometry(1300, 1100, 1100), new THREE.MeshStandardMaterial({ color: 0x0b0f15, roughness: 0.9, side: THREE.BackSide }))
  room.position.set(0, 300, -100)
  g.add(room)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(900, 40, 700), paint)
  deck.position.set(0, -20, 0)
  g.add(deck)
  const plate = new THREE.Mesh(new THREE.BoxGeometry(250, 10, 250), steel(0x9aa3ad, 0.35))
  plate.position.set(0, -5, 0)
  g.add(plate)
  const accent = new THREE.MeshStandardMaterial({ color: 0xffa34d, emissive: 0xff8a2a, emissiveIntensity: 1.6 })
  const rail = new THREE.Mesh(new THREE.BoxGeometry(820, 8, 8), accent)
  rail.position.set(0, 2, -300)
  g.add(rail)
  scene.add(g)
  const recoater = new THREE.Mesh(new THREE.BoxGeometry(20, 30, 300), steel(0xc8ced6, 0.3))
  scene.add(recoater)
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 600, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a8, transparent: true, opacity: 0.7 }))
  scene.add(beam)
  const glow = new THREE.PointLight(0xff9a3c, 0, 160, 1.6)
  scene.add(glow)
  const spark = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfff1d0 }))
  scene.add(spark)
  return { recoater, beam, glow, spark }
}

export function FactoryScene({ part, process, progress, onTick }: FactoryProps) {
  const host = useRef<HTMLDivElement>(null)
  const prog = useRef<number | null>(progress)
  prog.current = progress
  const tickCb = useRef(onTick)
  tickCb.current = onTick

  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.localClippingEnabled = true
    renderer.shadowMap.enabled = true
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x05070a)
    scene.fog = new THREE.Fog(0x05070a, 1800, 3400)
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.55
    const camera = new THREE.PerspectiveCamera(26, 1, 5, 8000)
    const key = new THREE.SpotLight(0xffffff, 2.2e5, 0, 0.5, 0.7, 2)
    key.position.set(150, 760, 380)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    scene.add(key, key.target)
    const rim = new THREE.DirectionalLight(0x7cf2c4, 0.45)
    rim.position.set(-500, 200, -300)
    scene.add(rim)
    scene.add(new THREE.AmbientLight(0x8899aa, 0.25))

    rs = 7
    const lpbf = process === 'lpbf'
    const mill = lpbf ? null : buildMill(scene)
    const printer = lpbf ? buildPrinter(scene) : null

    // the part and its stock / powder
    const holder = new THREE.Group()
    scene.add(holder)
    let H = 40, W = 60, D = 60, baseY = 0
    const keepAbove = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const keepBelow = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
    let cap: THREE.Mesh | null = null, stock: THREE.Mesh | null = null, powder: THREE.Mesh | null = null
    if (part) {
      const m = partMesh(part, new THREE.MeshPhysicalMaterial({ color: 0xd5dbe2, metalness: 1, roughness: 0.26, clippingPlanes: [lpbf ? keepBelow : keepAbove], clipShadows: true, side: THREE.DoubleSide }))
      ;(m.children[0] as THREE.LineSegments).material = new THREE.LineBasicMaterial({ color: 0x0a0f16, transparent: true, opacity: 0.35, clippingPlanes: [lpbf ? keepBelow : keepAbove] })
      const bb = m.geometry.boundingBox!
      const s = bb.getSize(new THREE.Vector3())
      H = s.y; W = s.x; D = s.z
      holder.add(m)
    }
    if (!lpbf) {
      // vise jaws and stock block, part sits on parallels 30 mm above the table
      baseY = 30
      holder.position.y = baseY
      const jaw = steel(0x59616c, 0.4)
      for (const sz of [-1, 1]) {
        const j = new THREE.Mesh(new THREE.BoxGeometry(Math.max(160, W + 80), 60, 40), jaw)
        j.position.set(0, 0, sz * (D / 2 + 3 + 20))
        scene.add(j)
      }
      const vbase = new THREE.Mesh(new THREE.BoxGeometry(Math.max(180, W + 100), 30, D + 120), steel(0x2b3138, 0.55))
      vbase.position.set(0, -10 + 15 - 30, 0)
      scene.add(vbase)
      const sw = W + 6, sd = D + 6, sh = H + 3
      stock = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), new THREE.MeshStandardMaterial({ color: 0xa9b1ba, roughness: 0.55, metalness: 0.9, clippingPlanes: [keepBelow], clipShadows: true }))
      stock.position.y = baseY + sh / 2
      stock.castShadow = true
      scene.add(stock)
      cap = new THREE.Mesh(new THREE.PlaneGeometry(sw, sd), new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.18, metalness: 1 }))
      cap.rotation.x = -Math.PI / 2
      scene.add(cap)
    } else {
      powder = new THREE.Mesh(new THREE.PlaneGeometry(250, 250), new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 1, metalness: 0.2, transparent: true, opacity: 0.55 }))
      powder.rotation.x = -Math.PI / 2
      scene.add(powder)
      const walls = new THREE.Mesh(new THREE.BoxGeometry(260, 400, 260), new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.8, side: THREE.BackSide, transparent: true, opacity: 0.0 }))
      walls.position.y = -200
      scene.add(walls)
    }

    // chips
    const NCH = 160
    const chipGeo = new THREE.BufferGeometry()
    const cp = new Float32Array(NCH * 3), cv = new Float32Array(NCH * 3), cl = new Float32Array(NCH)
    chipGeo.setAttribute('position', new THREE.BufferAttribute(cp, 3))
    const chips = new THREE.Points(chipGeo, new THREE.PointsMaterial({ color: lpbf ? 0xffc27a : 0xdfe6ee, size: lpbf ? 2.2 : 2.6, sizeAttenuation: true }))
    chips.frustumCulled = false
    scene.add(chips)
    let ci = 0

    const size = Math.max(W, D, H)
    const target = new THREE.Vector3(0, baseY + H * 0.5 + 70, -40)
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix() }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    let raf = 0, last = performance.now(), auto = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const t = now / 1000
      auto = (auto + dt / 40) % 1
      const p = Math.min(1, Math.max(0, prog.current ?? auto))
      tickCb.current?.(p)
      // slow orbit camera
      const a = 0.65 + Math.sin(t * 0.08) * 0.35
      const dist = Math.max(1050, size * 8.5)
      camera.position.set(Math.sin(a) * dist, baseY + H + dist * 0.38, Math.cos(a) * dist)
      camera.lookAt(target)
      if (mill) {
        // top down material removal: everything above h is finished part
        const top = baseY + H + 3, h = top - p * (H + 3)
        keepAbove.constant = -h
        keepBelow.constant = h
        if (cap) { cap.position.y = h + 0.05; cap.visible = p < 0.995 }
        // raster toolpath at the cut height
        const sweep = (t * 0.9) % 2, xs = sweep < 1 ? sweep : 2 - sweep
        const x = (xs - 0.5) * (W + 10)
        const z = Math.sin(t * 0.37) * (D / 2 + 4)
        const tipY = p >= 0.995 ? top + 60 : h
        mill.head.position.set(x, tipY + mill.tipOffset, z)
        mill.tool.rotation.y += dt * 60
        if (p < 0.995) for (let k = 0; k < 3; k++) {
          const i = ci++ % NCH
          cp[i * 3] = x; cp[i * 3 + 1] = h + 2; cp[i * 3 + 2] = z
          const ang = rnd() * Math.PI * 2
          cv[i * 3] = Math.cos(ang) * 260; cv[i * 3 + 1] = 120 + rnd() * 160; cv[i * 3 + 2] = Math.sin(ang) * 260
          cl[i] = 0.9
        }
      } else if (printer) {
        const h = p * H
        keepBelow.constant = h
        if (powder) powder.position.y = h + 0.2
        const lay = (t * 0.5) % 1
        printer.recoater.position.set(-300 + lay * 600, h + 15, 0)
        const x = Math.sin(t * 7.1) * W * 0.4, z = Math.cos(t * 4.3) * D * 0.4
        printer.beam.position.set(x, h + 300, z)
        printer.spark.position.set(x, h + 1, z)
        printer.glow.position.set(x, h + 8, z)
        printer.glow.intensity = p < 0.995 ? 8e4 : 0
        printer.beam.visible = printer.spark.visible = p < 0.995
        for (let k = 0; k < 2 && p < 0.995; k++) {
          const i = ci++ % NCH
          cp[i * 3] = x; cp[i * 3 + 1] = h + 1; cp[i * 3 + 2] = z
          const ang = rnd() * Math.PI * 2
          cv[i * 3] = Math.cos(ang) * 120; cv[i * 3 + 1] = 80 + rnd() * 120; cv[i * 3 + 2] = Math.sin(ang) * 120
          cl[i] = 0.5
        }
      }
      for (let i = 0; i < NCH; i++) {
        if (cl[i] <= 0) { cp[i * 3 + 1] = -9999; continue }
        cl[i] -= dt
        cv[i * 3 + 1] -= 900 * dt
        cp[i * 3] += cv[i * 3] * dt; cp[i * 3 + 1] += cv[i * 3 + 1] * dt; cp[i * 3 + 2] += cv[i * 3 + 2] * dt
        if (cp[i * 3 + 1] < -10) { cp[i * 3 + 1] = -10; cv[i * 3 + 1] *= -0.2; cv[i * 3] *= 0.5; cv[i * 3 + 2] *= 0.5 }
      }
      chipGeo.attributes.position.needsUpdate = true
      renderer.render(scene, camera)
    }
    tick()
    return () => { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); pmrem.dispose(); el.removeChild(renderer.domElement) }
  }, [part, process])

  return <div ref={host} style={{ position: 'absolute', inset: 0 }} />
}
