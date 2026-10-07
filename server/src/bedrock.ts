// Amazon Bedrock Converse API client (bearer token auth) with a record / replay cassette.
//   AI_MODE=live    call Bedrock every time (default)
//   AI_MODE=record  call Bedrock and save every response to cassettes/
//   AI_MODE=replay  serve saved responses, fall back to live when a request was never recorded
// Replay exists so the demo film is deterministic. Cassettes hold real model output.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type Block =
  | { text: string }
  | { image: { format: 'png' | 'jpeg'; source: { bytes: string } } }
  | { toolUse: { toolUseId: string; name: string; input: unknown } }
  | { toolResult: { toolUseId: string; content: ({ json: unknown } | { text: string })[]; status?: 'success' | 'error' } }

export interface Msg { role: 'user' | 'assistant'; content: Block[] }
export interface ToolSpec { name: string; description: string; schema: Record<string, unknown> }

export interface ConverseResult {
  message: Msg
  stopReason: string
  usage?: { inputTokens: number; outputTokens: number }
  latency_ms: number
  mode: 'live' | 'replay'
}

const CASSETTES = resolve(import.meta.dirname, '../cassettes')

export const MODEL = () => process.env.BEDROCK_CLAUDE_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
export const aiMode = () => (process.env.AI_MODE || 'live') as 'live' | 'record' | 'replay'

/** Images are keyed by a coarse fingerprint so a re-rendered snapshot still hits the cassette. */
function keyOf(body: unknown) {
  const s = JSON.stringify(body, (_k, v) => (v && typeof v === 'object' && 'bytes' in v && typeof v.bytes === 'string' ? { bytes: 'IMG' } : v))
  // dates and times change from day to day, they must not break a recorded run
  const norm = s.replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?/g, 'DATE').replace(/"(ms|latency_ms|quoted_in_ms)":\d+/g, '"$1":0')
  return createHash('sha256').update(norm).digest('hex').slice(0, 24)
}

export async function converse(opts: {
  tag: string
  system: string
  messages: Msg[]
  tools?: ToolSpec[]
  toolChoice?: { tool: { name: string } } | { any: Record<string, never> } | { auto: Record<string, never> }
  maxTokens?: number
}): Promise<ConverseResult> {
  const body: Record<string, unknown> = {
    system: [{ text: opts.system }],
    messages: opts.messages,
    inferenceConfig: { maxTokens: opts.maxTokens ?? 1500, temperature: 0 },
  }
  if (opts.tools?.length) {
    body.toolConfig = {
      tools: opts.tools.map(t => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.schema } } })),
      ...(opts.toolChoice ? { toolChoice: opts.toolChoice } : {}),
    }
  }
  const mode = aiMode()
  const key = `${opts.tag}-${keyOf(body)}`
  const file = resolve(CASSETTES, `${key}.json`)
  if (mode === 'replay' && existsSync(file)) {
    const rec = JSON.parse(readFileSync(file, 'utf8'))
    return { ...rec, mode: 'replay' }
  }
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK
  if (!token) throw new Error('AWS_BEARER_TOKEN_BEDROCK is not set')
  const region = process.env.AWS_REGION || 'us-east-1'
  const t0 = Date.now()
  let res: Response | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(MODEL())}/converse`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status !== 429 && res.status < 500) break
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
  }
  if (!res!.ok) throw new Error(`Bedrock ${res!.status}: ${(await res!.text()).slice(0, 400)}`)
  const json = await res!.json() as { output: { message: Msg }; stopReason: string; usage?: { inputTokens: number; outputTokens: number } }
  const out = { message: json.output.message, stopReason: json.stopReason, usage: json.usage, latency_ms: Date.now() - t0 }
  if (mode === 'record' || mode === 'replay') {
    mkdirSync(CASSETTES, { recursive: true })
    writeFileSync(file, JSON.stringify(out, null, 1))
  }
  return { ...out, mode: 'live' }
}

export function textOf(m: Msg) {
  return m.content.map(b => ('text' in b ? b.text : '')).join('').trim()
}

export function toolUses(m: Msg) {
  return m.content.flatMap(b => ('toolUse' in b ? [b.toolUse] : []))
}

/** Generic tool loop: runs tools until the model calls `finalTool` or stops. */
export async function runToolLoop(opts: {
  tag: string
  system: string
  first: Block[]
  tools: ToolSpec[]
  handlers: Record<string, (input: any) => Promise<unknown> | unknown>
  finalTool: string
  maxTurns?: number
  /** 'any' forces a tool call every turn (agents that end with a final tool), 'auto' lets the model finish in text. */
  choice?: 'any' | 'auto'
  onCall?: (c: { tool: string; input: unknown; output: unknown; ms: number }) => void
}) {
  const messages: Msg[] = [{ role: 'user', content: opts.first }]
  let latency = 0
  let mode: 'live' | 'replay' = 'replay'
  const calls: { tool: string; input: unknown; output: unknown; ms: number }[] = []
  const texts: string[] = []
  for (let turn = 0; turn < (opts.maxTurns ?? 10); turn++) {
    const r = await converse({ tag: opts.tag, system: opts.system, messages, tools: opts.tools, toolChoice: opts.choice === 'auto' ? { auto: {} } : turn === (opts.maxTurns ?? 10) - 1 ? { tool: { name: opts.finalTool } } : { any: {} } })
    latency += r.latency_ms
    if (r.mode === 'live') mode = 'live'
    messages.push(r.message)
    const t = textOf(r.message)
    if (t) texts.push(t)
    const uses = toolUses(r.message)
    if (!uses.length) break
    const results: Block[] = []
    let final: { input: unknown; output: unknown } | null = null
    for (const u of uses) {
      const t0 = Date.now()
      let output: unknown
      let status: 'success' | 'error' = 'success'
      try {
        const h = opts.handlers[u.name]
        if (!h) throw new Error(`unknown tool ${u.name}`)
        output = await h(u.input)
      } catch (e) {
        status = 'error'
        output = { error: (e as Error).message }
      }
      const call = { tool: u.name, input: u.input, output, ms: Date.now() - t0 }
      calls.push(call)
      opts.onCall?.(call)
      results.push({ toolResult: { toolUseId: u.toolUseId, content: [{ json: output }], status } })
      if (u.name === opts.finalTool && status === 'success') final = { input: u.input, output }
    }
    messages.push({ role: 'user', content: results })
    if (final) return { final, calls, latency, mode, texts }
  }
  return { final: null, calls, latency, mode, texts }
}
