import { spawn } from 'node:child_process'

const root = process.argv[2]
const mode = process.argv[3] ?? 'update'
const child = spawn('npx', ['--yes', 'openwiki@0.9.0', 'mcp', '--host', 'dsh'], {
  env: { ...process.env, DO_NOT_TRACK: '1', OPENWIKI_TELEMETRY_DISABLED: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let buf = ''
const pending = new Map()
let nextId = 1
child.stdout.on('data', d => {
  buf += d.toString()
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
    if (!line) continue
    let msg; try { msg = JSON.parse(line) } catch { continue }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
})
child.stderr.on('data', d => process.stderr.write('[openwiki stderr] ' + d.toString()))
function send(method, params) {
  const id = nextId++
  return new Promise(res => {
    pending.set(id, res)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}
const init = await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } })
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
const call = await send('tools/call', { name: 'openwiki_begin', arguments: { root, mode, language: 'en' } })
console.log(JSON.stringify(call, null, 2))
child.kill()
process.exit(0)
