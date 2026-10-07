// Films the demo frame by frame through window.__film (see web/src/film/Director.tsx).
//   node output/record.mjs              -> output/partdrop-screen.mp4 + output/stills/*.jpg
//   node output/record.mjs --dry        -> runs the story without capturing (records AI cassettes)
//   node output/record.mjs --stills     -> only the stills
// Needs the web app on :5306 and the API on :8306 started with DETERMINISTIC_IDS=1 and
// AI_MODE=record (rehearsal) or AI_MODE=replay (final film). See README "Film".
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { launch } from './browser.mjs'

const DRY = process.argv.includes('--dry'), STILLS_ONLY = process.argv.includes('--stills')
const FPS = 30
const dir = new URL('.', import.meta.url).pathname
mkdirSync(dir + 'stills', { recursive: true })
// seconds into the film for poster stills
const STILLS = { '01-inbox': 4, '02-part': 20, '03-quote': 40, '04-authorized': 62, '05-gantt': 74, '06-floor': 93, '07-inspection': 128, '08-agent': 170, '09-close': 186 }

for (let k = 0; k < 60; k++) { try { if ((await fetch('http://localhost:8306/api/health')).ok) break } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 1000)) }
const b = await launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
p.on('pageerror', e => console.log('PAGEERR', e.message))
p.on('console', m => { if (m.type() === 'error' || m.text().startsWith('film')) console.log('console:', m.text().slice(0, 300)) })
await p.goto('http://localhost:5306/?film=1#/buyer')
await p.waitForFunction(() => !!window.__film, null, { timeout: 60000 })
// pre roll: let the story log in, reset the server and load the first view
for (let i = 0; i < 900; i++) {
  if (await p.evaluate(() => window.__film.ready)) break
  await p.evaluate(() => window.__film.step(1 / 30))
}
for (let i = 0; i < 20; i++) await p.evaluate(() => window.__film.step(1 / 30))
if (!(await p.evaluate(() => window.__film.ready))) { console.error('film never became ready'); await b.close(); process.exit(1) }
await p.evaluate(() => window.__film.start())

let ff = null
if (!DRY && !STILLS_ONLY) {
  ff = spawn('/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-vcodec', 'mjpeg', '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dir + 'partdrop-screen.mp4'])
}
const stillAt = new Map(Object.entries(STILLS).map(([k, s]) => [Math.round(s * FPS), k]))
const MAX = 200 * FPS
let i = 0, tail = -1, lastCap = null
const t0 = Date.now()
for (; i < MAX; i++) {
  if (i) await p.evaluate(() => window.__film.step(1 / 30))
  if (ff) {
    const jpg = await p.screenshot({ type: 'jpeg', quality: 92 })
    if (!ff.stdin.write(jpg)) await new Promise(r => ff.stdin.once('drain', r))
  }
  if (!DRY && stillAt.has(i)) {
    await p.screenshot({ path: `${dir}stills/${stillAt.get(i)}.jpg`, type: 'jpeg', quality: 85 })
    console.log('still', stillAt.get(i))
  }
  const st = await p.evaluate(() => [window.__film.done, document.querySelector('.caption')?.textContent ?? ''])
  if (st[1] !== lastCap) { console.log(`${(i / FPS).toFixed(1).padStart(6)} s  ${st[1] || '(no caption)'}`); lastCap = st[1] }
  if (tail < 0 && st[0]) tail = i
  if (tail >= 0) break
  if (i % 150 === 0) console.log('frame', i, `${((Date.now() - t0) / 1000).toFixed(0)} s`)
}
console.log('frames', i, 'duration', (i / FPS).toFixed(1), 's')
if (ff) { ff.stdin.end(); await new Promise(r => ff.on('close', r)); console.log('wrote', dir + 'partdrop-screen.mp4') }
writeFileSync(dir + 'tmp/last-run.json', JSON.stringify({ frames: i, seconds: i / FPS, dry: DRY }))
await b.close()
