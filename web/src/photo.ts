// Dev only: renders a stand-in "floor camera" inspection photo of a sample part on a
// granite surface plate. Used by scripts/render-photos.mjs. These are renders, not photos.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { loadPart } from './lib/cad.ts'
import { partMesh } from './buyer/PartViewer.tsx'

const q = new URLSearchParams(location.search)
const ref = q.get('part') || 'flange'
const REF = q.has('ref') // clean top view of the CAD, used as the inspection reference image
const W = 1600, H = 1200

let s = 99
const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }

function granite() {
  const c = document.createElement('canvas'); c.width = c.height = 1024
  const x = c.getContext('2d')!
  x.fillStyle = '#26282b'; x.fillRect(0, 0, 1024, 1024)
  for (let i = 0; i < 70000; i++) {
    const v = rnd()
    x.fillStyle = v < 0.5 ? `rgba(10,10,12,${0.5 * rnd()})` : v < 0.97 ? `rgba(90,92,96,${0.35 * rnd()})` : `rgba(170,170,175,${0.3 * rnd()})`
    const r = rnd() * 2.2
    x.fillRect(rnd() * 1024, rnd() * 1024, r, r)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(3, 3)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function ruler(len: number) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 128
  const x = c.getContext('2d')!
  x.fillStyle = '#c9cdd2'; x.fillRect(0, 0, 2048, 128)
  x.fillStyle = '#16181b'
  const px = 2048 / len
  for (let mm = 0; mm <= len; mm++) {
    const h = mm % 10 === 0 ? 52 : mm % 5 === 0 ? 36 : 22
    x.fillRect(mm * px, 0, 2, h)
    if (mm % 10 === 0 && mm > 0 && mm < len) { x.font = 'bold 30px Arial'; x.fillText(String(mm / 10), mm * px - 8, 92) }
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

async function main() {
  const r = await fetch(`/samples/cad/${ref}.step`)
  const part = await loadPart(`${ref}.step`, await r.arrayBuffer())
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(W, H)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.85
  renderer.shadowMap.enabled = true
  document.getElementById('c')!.prepend(renderer.domElement)
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.02).texture
  scene.environmentIntensity = 0.55
  scene.background = new THREE.Color(0x111214)
  const m = partMesh(part, new THREE.MeshPhysicalMaterial({ color: 0xa9b0b8, metalness: 1, roughness: 0.4, clearcoat: 0.05 }))
  ;(m.children[0] as THREE.Object3D).visible = false
  const bb = m.geometry.boundingBox!
  const size = bb.getSize(new THREE.Vector3())
  m.rotation.y = 0.35
  scene.add(m)
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1200, 40, 900), new THREE.MeshStandardMaterial({ map: granite(), roughness: 0.55, metalness: 0.05 }))
  plate.position.y = -20
  plate.receiveShadow = true
  scene.add(plate)
  const L = 150
  const rl = new THREE.Mesh(new THREE.BoxGeometry(L, 0.8, 16), [steelSide(), steelSide(), new THREE.MeshStandardMaterial({ map: ruler(L), metalness: 0.6, roughness: 0.45 }), steelSide(), steelSide(), steelSide()])
  rl.position.set(0, 0.4, size.z / 2 + 22)
  rl.rotation.y = 0.04
  rl.receiveShadow = true
  scene.add(rl)
  const key = new THREE.DirectionalLight(0xfff4e8, 1.7)
  key.position.set(-160, 320, 200)
  key.castShadow = true
  key.shadow.mapSize.set(4096, 4096)
  Object.assign(key.shadow.camera, { left: -200, right: 200, top: 200, bottom: -200, near: 1, far: 1000 })
  key.shadow.radius = 4
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xdfe9ff, 0.5)
  fill.position.set(220, 140, -120)
  scene.add(fill)
  const cam = new THREE.PerspectiveCamera(30, W / H, 1, 5000)
  const r0 = Math.max(size.x, size.z) * 1.05 + 60
  cam.position.set(r0 * 0.2, r0 * 2.1, r0 * 0.95)
  cam.lookAt(0, size.y * 0.2, 12)
  if (REF) {
    plate.visible = false; rl.visible = false
    scene.background = new THREE.Color(0xeef1f4)
    ;(m.children[0] as THREE.Object3D).visible = true
    m.rotation.y = 0
    const r1 = Math.max(size.x, size.z) * 1.9
    cam.position.set(0, r1 * 1.7, r1 * 0.55)
    cam.lookAt(0, 0, 0)
  }
  renderer.render(scene, cam)
  // film grain overlay
  if (REF) { (document.getElementById('g') as HTMLCanvasElement).style.display = 'none'; (document.getElementById('v') as HTMLElement).style.display = 'none'; (window as any).__done = true; return }
  const g = (document.getElementById('g') as HTMLCanvasElement).getContext('2d')!
  const img = g.createImageData(W, H)
  for (let i = 0; i < img.data.length; i += 4) { const v = rnd() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255 }
  g.putImageData(img, 0, 0)
  ;(window as any).__done = true
}
const steelSide = () => new THREE.MeshStandardMaterial({ color: 0xaab0b8, metalness: 0.9, roughness: 0.4 })
main()
