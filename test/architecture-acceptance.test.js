import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderArchitecture, readArchitecture } from '../core/architecture.js'
import { makeRoot } from './util.js'

test('architecture retains validated local sources with the successful diagram, even when a later generation fails', async t => {
  const root = await makeRoot(t)
  await writeFile(join(root, 'demo.mjs'), 'export function greet(name) {\n  return name\n}\n')
  const candidate = JSON.parse(await readFile(new URL('../vendor/archify/archify/examples/web-app.architecture.json', import.meta.url), 'utf8'))
  candidate.components[0].sources = [{ path: 'demo.mjs', line: 1, end_line: 3 }]
  const path = join(root, 'candidate.json')
  await writeFile(path, JSON.stringify(candidate))
  await renderArchitecture(root, path)
  const saved = await readArchitecture(root)
  assert.equal(saved.exists, true)
  assert.match(saved.html, /<svg[\s\S]*<\/svg>/)
  assert.deepEqual(saved.sources, [{ label: 'Users', path: 'demo.mjs', from: 1, to: 3 }])
  candidate.components[0].sources = [{ path: '../outside.js' }]
  await writeFile(path, JSON.stringify(candidate))
  await assert.rejects(renderArchitecture(root, path), { code: 'ARCH_SOURCE_INVALID' })
  assert.deepEqual(await readArchitecture(root), saved)
  await mkdir(join(root, '.project', 'requirements'), { recursive: true })
  await writeFile(join(root, '.project', 'requirements', 'workbench-record.md'), '这只是验收记录')
  candidate.components[0].sources = [{ path: '.project/requirements/workbench-record.md' }]
  await writeFile(path, JSON.stringify(candidate))
  await assert.rejects(renderArchitecture(root, path), { code: 'ARCH_SOURCE_INVALID' })
  assert.deepEqual(await readArchitecture(root), saved)
  candidate.components[0].sources = [{ path: 'demo.mjs', line: 1, end_line: 4 }]
  await writeFile(path, JSON.stringify(candidate))
  await assert.rejects(renderArchitecture(root, path), { code: 'ARCH_SOURCE_INVALID' })
  assert.deepEqual(await readArchitecture(root), saved)
  delete candidate.components[0].sources
  await writeFile(path, JSON.stringify(candidate))
  await assert.rejects(renderArchitecture(root, path), { code: 'ARCH_SOURCE_REQUIRED' })
  assert.deepEqual(await readArchitecture(root), saved)
  const abort = new AbortController(); abort.abort()
  candidate.components[0].sources = [{ path: 'demo.mjs', line: 1 }]
  await writeFile(path, JSON.stringify(candidate))
  await assert.rejects(renderArchitecture(root, path, abort.signal))
  assert.deepEqual(await readArchitecture(root), saved)
})

test('architecture author and repair prompts use program source, not workbench records', async t => {
  const { stubSpawnHost } = await import('./util.js')
  const { startArchitectureRun, startArchitectureRepair } = await import('../core/spawn.js')
  const root = await makeRoot(t)
  const { ctx, children } = stubSpawnHost(root)
  const { sessionId } = await ctx.sessionController.create({ cwd: root })
  assert.equal((await startArchitectureRun(ctx, new Set(), sessionId, root)).ok, true)
  assert.match(children[0].prompt, /\.project\/ directory contains management data and runtime records/)
  assert.match(children[0].prompt, /actual program, its modules/)
  assert.match(children[0].prompt, /tiny single-file program/)
  assert.equal((await startArchitectureRepair(ctx, new Set(), sessionId, root, { components: [] }, 'missing source')).ok, true)
  assert.match(children[1].prompt, /Never cite the workbench-owned \.project\//)
})

test('architecture read errors are distinct from a missing diagram', async t => {
  const root = await makeRoot(t)
  assert.equal((await readArchitecture(root)).exists, false)
  await mkdir(join(root, '.project', '.local', 'archify', 'architecture.html'), { recursive: true })
  await assert.rejects(readArchitecture(root), { code: 'READ_FAILED' })
})

test('architecture start is single-flight and stop during activation settles before another start', async t => {
  const { apply } = await import('../index.js')
  const { childReply, stubSpawnHost, waitFor } = await import('./util.js')
  const root = await makeRoot(t)
  const { ctx } = stubSpawnHost(root)
  const routes = new Map()
  ctx.skills = { register: () => {} }
  ctx.mcpManager = { register: () => {} }
  ctx.connection = { fetch: { register: route => routes.set(route.path, route.fetch) } }
  ctx.effect = effect => {
    const result = effect()
    if (typeof result?.next === 'function') { for (const _ of result) { /* register routes */ } }
    if (typeof result === 'function') t.after(result)
  }
  const { sessionId } = await ctx.sessionController.create({ cwd: root })
  let count = 0, release, enter
  const entered = new Promise(resolve => { enter = resolve })
  const gate = new Promise(resolve => { release = resolve })
  ctx.subagents.startActivation = async ({ signal }) => {
    count++; enter(); await gate
    const result = new Promise(resolve => {
      if (signal.aborted) resolve({ stopReason: 'aborted', output: [] })
      else signal.addEventListener('abort', () => resolve({ stopReason: 'aborted', output: [] }), { once: true })
    })
    return { result, dispose: async () => {} }
  }
  await apply(ctx)
  const call = async (route, data) => (await routes.get('/api/project-workbench/' + route)(new Request('http://local/', { method: 'POST', body: JSON.stringify(data) }))).json()
  const first = call('arch-generate', { root, sessionId })
  await entered
  assert.equal((await call('arch-generate', { root, sessionId })).data.alreadyRunning, true)
  assert.equal(count, 1)
  assert.equal((await call('arch-stop', { root })).data.stopping, true)
  assert.equal((await call('arch-status', { root })).data.status, 'stopping')
  assert.equal((await call('arch-generate', { root, sessionId })).data.alreadyRunning, true)
  release()
  assert.equal((await first).ok, true)
  await waitFor(async () => (await call('arch-status', { root })).data.status === 'failed')
  assert.equal((await call('arch-status', { root })).data.error, 'stopped by user')
  assert.equal(count, 1)
  // A failed activation is reported and releases the reservation for retry.
  ctx.subagents.startActivation = async () => { count++; throw new Error('test activation failure') }
  assert.equal((await call('arch-generate', { root, sessionId })).ok, false)
  assert.equal((await call('arch-generate', { root, sessionId })).ok, false)
  assert.equal(count, 3)
  for (const output of [{ arch_error: 'ARCH_SOURCE_REQUIRED' }, { components: [] }]) {
    ctx.subagents.startActivation = async () => ({ result: Promise.resolve(childReply(output)) })
    assert.equal((await call('arch-generate', { root, sessionId })).ok, true)
    await waitFor(async () => (await call('arch-status', { root })).data.status === 'failed')
    assert.equal((await call('arch-status', { root })).data.code, 'ARCH_SOURCE_REQUIRED')
  }
})
