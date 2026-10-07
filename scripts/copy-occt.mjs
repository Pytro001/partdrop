// Copies the OpenCascade WASM STEP reader into web/public/occt so the CAD worker can load it.
import { cpSync, mkdirSync } from 'node:fs'
const src = new URL('../node_modules/occt-import-js/dist/', import.meta.url)
const dst = new URL('../web/public/occt/', import.meta.url)
mkdirSync(dst, { recursive: true })
for (const f of ['occt-import-js.js', 'occt-import-js.wasm', 'license.occt-import-js.txt', 'license.occt.txt']) cpSync(new URL(f, src), new URL(f, dst))
console.log('occt-import-js copied to web/public/occt')
