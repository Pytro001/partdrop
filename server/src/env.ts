// Loads ../../.env before any other module reads process.env.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
const file = resolve(import.meta.dirname, '../../.env')
if (existsSync(file)) process.loadEnvFile(file)
