// npm run dev: API on 8306 (tsx watch) and the web app on 5306 (vite), one terminal.
import { spawn } from 'node:child_process'
const run = (name, args) => {
  const p = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  const tag = s => s.toString().split('\n').filter(Boolean).map(l => `[${name}] ${l}`).join('\n') + '\n'
  p.stdout.on('data', d => process.stdout.write(tag(d)))
  p.stderr.on('data', d => process.stderr.write(tag(d)))
  p.on('exit', c => { console.log(`[${name}] exited ${c}`); process.exit(c ?? 0) })
  return p
}
const procs = [run('api', ['tsx', 'watch', 'server/src/index.ts']), run('web', ['vite', '--config', 'web/vite.config.ts'])]
process.on('SIGINT', () => { for (const p of procs) p.kill('SIGINT'); process.exit(0) })
