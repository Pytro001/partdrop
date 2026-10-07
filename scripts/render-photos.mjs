// Renders the stand-in inspection photos (samples/photos/*.jpg) from the sample STEP files.
// Needs the dev server (npm run dev). These are 3D renders, labelled as such in the README.
import { launch } from '../output/browser.mjs'
const parts = process.argv.slice(2).length ? process.argv.slice(2) : ['flange', 'bracket', 'injector', 'cover', 'flange_defect']
import { mkdirSync } from 'node:fs'
mkdirSync('samples/reference', { recursive: true })
const b = await launch()
const p = await b.newPage({ viewport: { width: 1600, height: 1200 } })
p.on('pageerror', e => console.log('ERR', e.message))
for (const part of parts) {
  await p.goto(`http://localhost:5306/photo.html?part=${part}`)
  await p.waitForFunction(() => window.__done, null, { timeout: 60000 })
  await p.waitForTimeout(300)
  await p.locator('#c').screenshot({ path: `samples/photos/${part}.jpg`, type: 'jpeg', quality: 86 })
  console.log('photo', part)
  if (part.includes('defect')) continue
  // clean CAD reference view the inspector compares the photo against
  await p.goto(`http://localhost:5306/photo.html?part=${part}&ref=1`)
  await p.waitForFunction(() => window.__done, null, { timeout: 60000 })
  await p.waitForTimeout(300)
  await p.locator('#c').screenshot({ path: `samples/reference/${part}.jpg`, type: 'jpeg', quality: 86 })
}
await b.close()
