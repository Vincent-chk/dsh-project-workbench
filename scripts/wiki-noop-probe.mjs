import { spawn } from 'node:child_process'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const root = process.argv[2]
const pages = ['openwiki/architecture/calculation.md', 'openwiki/quickstart.md', 'openwiki/index.md']
const hash = () => pages.map(p => {
  try { return createHash('sha256').update(readFileSync(`${root}/${p}`)).digest('hex').slice(0, 12) } catch { return 'missing' }
}).join(' ')
const clean = () => { try { execSync(`find "${root}/openwiki" -name '._*' -delete`) } catch {} }

const child = spawn('npx', ['--yes', 'openwiki@0.9.0', 'mcp', '--host', 'dsh'], {
  env: { ...process.env, DO_NOT_TRACK: '1', OPENWIKI_TELEMETRY_DISABLED: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
})
let buf = ''; const pending = new Map(); let nextId = 1
child.stdout.on('data', d => {
  buf += d.toString(); let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue
    let m; try { m = JSON.parse(line) } catch { continue }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
})
const send = (method, params) => new Promise(res => { const id = nextId++; pending.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
const call = async (name, args) => {
  const r = await send('tools/call', { name, arguments: args })
  const sc = r.result?.structuredContent
  if (r.result?.isError) throw new Error(`${name}: ${r.result?.content?.[0]?.text ?? 'error'}`)
  return sc ?? JSON.parse(r.result?.content?.[0]?.text ?? '{}')
}
await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'noop-probe', version: '0' } })
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

const before = hash()
clean()
// First update: reconcile any pending window with an empty plan (no source evidence changed).
let b = await call('openwiki_begin', { root, mode: 'update', language: 'en' })
console.log('update#1 status:', b.status, 'phase:', b.phase ?? '-', 'changed:', b.changedPathCount ?? 0)
if (b.status === 'active') {
  await call('openwiki_submit_plan', { runId: b.runId, pages: [] })
  let n = await call('openwiki_next_page', { runId: b.runId })
  while (n.status === 'pending') { n = await call('openwiki_next_page', { runId: b.runId }) }
  const f = await call('openwiki_finish', { runId: b.runId })
  console.log('update#1 finish:', f.status)
}
const mid = hash()
clean()
// Second update: nothing changed since the recorded head -> must be a no-op.
b = await call('openwiki_begin', { root, mode: 'update', language: 'en' })
console.log('update#2 status:', b.status)
const after = hash()
console.log('hash before:', before)
console.log('hash mid:   ', mid)
console.log('hash after: ', after)
console.log('NOOP_VERDICT:', b.status === 'noop' && before === after ? 'PASS' : 'CHECK')
child.kill(); process.exit(0)
