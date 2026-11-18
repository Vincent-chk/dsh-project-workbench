import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { apply } from '../index.js'
import { makeRoot, stubSpawnHost, waitFor } from './util.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Model Cordis's same-effect reverse, awaited disposal; no DSH or model starts.
async function host(t, existingRoot) {
  const root = existingRoot ?? await makeRoot(t)
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  if (!existingRoot) {
    execFileSync('git', ['init', '--quiet', root], { env })
    await writeFile(join(root, '.gitignore'), 'openwiki/\n.project/.local/\n')
    await writeFile(join(root, 'source.js'), 'export const value = 1\n')
    execFileSync('git', ['-C', root, 'add', '.gitignore', 'source.js'], { env })
    execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { env })
    await mkdir(join(root, '.project'))
  }
  const { ctx, agents } = stubSpawnHost(root)
  const routes = new Map()
  let guard, guardRemoved = false, disposeGuardEffect
  ctx.skills = { register: () => {} }
  ctx.mcpManager = { register: () => {} }
  ctx.connection = { fetch: { register: route => routes.set(route.path, route.fetch) } }
  ctx.tools.guard = fn => { guard = fn; return () => { guardRemoved = true } }
  ctx.effect = (effect, label) => {
    const result = effect()
    if (typeof result?.next === 'function') {
      const disposers = [...result].filter(value => typeof value === 'function')
      if (label === 'project-workbench: wiki child write scope') {
        disposeGuardEffect = async () => { for (const dispose of disposers.reverse()) await dispose() }
      }
    } else if (typeof result === 'function' && label !== 'project-workbench: wiki child write scope') t.after(result)
  }
  const { sessionId } = await ctx.sessionController.create({ cwd: root })
  await apply(ctx)
  const call = async route => (await routes.get(`/api/project-workbench/${route}`)(new Request('http://local', {
    method: 'POST', body: JSON.stringify({ root, sessionId }),
  }))).json()
  const denied = childId => guard?.({ agent: { session: { id: childId } }, name: 'bash', arguments: { command: 'echo test' } })
  const callRaw = async (route, request) => (await routes.get(`/api/project-workbench/${route}`)(request)).json()
  return { root, ctx, agents, call, callRaw, denied, dispose: () => disposeGuardEffect(), removed: () => guardRemoved }
}

test('plugin unload holds the Wiki guard until an active child is disposed', async t => {
  const h = await host(t), release = deferred(), entered = deferred(), result = deferred()
  let childId, signal
  h.ctx.subagents.startActivation = async options => {
    childId = options.childId; signal = options.signal
    h.agents.set(childId, { session: { id: childId }, status: 'running' })
    return { result: result.promise, dispose: async () => { entered.resolve(); await release.promise; h.agents.delete(childId); result.resolve({ stopReason: 'stopped', output: [] }) } }
  }
  assert.equal((await h.call('wiki-generate')).ok, true)
  assert.ok(h.denied(childId))
  const closing = h.dispose()
  await entered.promise
  assert.equal(signal.aborted, true)
  assert.equal(h.removed(), false)
  assert.ok(h.denied(childId))
  release.resolve()
  await closing
  assert.equal(h.removed(), true)
})

test('plugin unload joins a late startup receipt even if the provider ignores abort', async t => {
  const h = await host(t), acceptance = deferred(), release = deferred(), entered = deferred(), result = deferred()
  let options, childId
  h.ctx.subagents.startActivation = input => { options = input; childId = input.childId; return acceptance.promise }
  const request = h.call('wiki-generate')
  await waitFor(() => !!options)
  const closing = h.dispose()
  assert.equal(options.signal.aborted, true)
  assert.equal(h.removed(), false)
  assert.ok(h.denied(childId))
  h.agents.set(childId, { session: { id: childId }, status: 'running' })
  acceptance.resolve({ result: result.promise, dispose: async () => { entered.resolve(); await release.promise; h.agents.delete(childId); result.resolve({ stopReason: 'stopped', output: [] }) } })
  assert.equal((await request).code, 'WIKI_CLOSING')
  await entered.promise
  assert.equal(h.removed(), false)
  assert.ok(h.denied(childId))
  release.resolve()
  await closing
  assert.equal(h.removed(), true)
})

test('unload during asynchronous preflight cannot start a Wiki child later', async t => {
  const h = await host(t), release = deferred(), entered = deferred()
  const original = fs.promises.realpath
  let intercepted = false, started = false
  fs.promises.realpath = async (path, ...args) => {
    if (!intercepted && String(path) === h.root) { intercepted = true; entered.resolve(); await release.promise }
    return original.call(fs.promises, path, ...args)
  }
  syncBuiltinESMExports()
  h.ctx.subagents.startActivation = async () => { started = true; throw new Error('unexpected activation') }
  try {
    const request = h.call('wiki-generate')
    await entered.promise
    const closing = h.dispose()
    assert.equal(h.removed(), false)
    release.resolve()
    assert.equal((await request).code, 'WIKI_CLOSING')
    await closing
    assert.equal(started, false)
    assert.equal(h.removed(), true)
  } finally {
    release.resolve()
    fs.promises.realpath = original
    syncBuiltinESMExports()
  }
})

test('a disposal failure leaves the Wiki guard installed', async t => {
  const h = await host(t), result = deferred()
  let childId
  h.ctx.subagents.startActivation = async options => {
    childId = options.childId
    h.agents.set(childId, { session: { id: childId }, status: 'running' })
    return { result: result.promise, dispose: async () => { result.resolve({ stopReason: 'stopped', output: [] }); throw new Error('disposal failed') } }
  }
  assert.equal((await h.call('wiki-generate')).ok, true)
  await assert.rejects(h.dispose(), /Wiki child teardown did not complete safely/)
  assert.equal(h.removed(), false)
  assert.ok(h.denied(childId))
})

test('a rejected disposal keeps the guard even if the registry entry disappeared', async t => {
  const h = await host(t), result = deferred()
  let childId
  h.ctx.subagents.startActivation = async options => {
    childId = options.childId
    return { result: result.promise, dispose: async () => { result.resolve({ stopReason: 'stopped', output: [] }); throw new Error('disposal failed after unregister') } }
  }
  assert.equal((await h.call('wiki-generate')).ok, true)
  await assert.rejects(h.dispose(), /Wiki child teardown did not complete safely/)
  assert.equal(h.removed(), false)
  assert.ok(h.denied(childId))
})

test('a rejected disposal still joins the later result and terminal write', async t => {
  const h = await host(t), result = deferred(), attempted = deferred()
  let finished = false
  h.ctx.subagents.startActivation = async () => ({
    result: result.promise,
    dispose: async () => { attempted.resolve(); throw new Error('disposal failed') },
  })
  assert.equal((await h.call('wiki-generate')).ok, true)
  const closing = h.dispose().then(() => { finished = true }, error => { finished = true; throw error })
  void closing.catch(() => {})
  await attempted.promise
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(finished, false)
  assert.equal(h.removed(), false)
  result.resolve({ stopReason: 'stopped', output: [] })
  await assert.rejects(closing, /Wiki child teardown did not complete safely/)
  assert.equal((await h.call('wiki-generate-status')).data.status, 'failed')
  assert.equal(h.removed(), false)
})

test('a delivered result still joins the exact activation disposal', async t => {
  const h = await host(t), result = deferred(), release = deferred(), entered = deferred()
  let childId
  h.ctx.subagents.startActivation = async options => {
    childId = options.childId
    return { result: result.promise, dispose: async () => { entered.resolve(); await release.promise } }
  }
  assert.equal((await h.call('wiki-generate')).ok, true)
  result.resolve({ stopReason: 'completed', output: [] })
  await entered.promise
  assert.ok(h.denied(childId))
  release.reject(new Error('late teardown failure'))
  await waitFor(async () => (await h.call('wiki-generate-status')).data.status === 'failed')
  assert.match((await h.call('wiki-generate-status')).data.error, /teardown did not complete safely/)
  assert.ok(h.denied(childId))
  await assert.rejects(h.dispose(), /Wiki child teardown did not complete safely/)
  assert.equal(h.removed(), false)
})

test('a later registry entry does not turn a successfully disposed activation into teardown failure', async t => {
  const h = await host(t), result = deferred()
  let childId, disposed = false
  h.ctx.subagents.startActivation = async options => {
    childId = options.childId
    return { result: result.promise, dispose: async () => { disposed = true } }
  }
  assert.equal((await h.call('wiki-generate')).ok, true)
  h.agents.set(childId, { session: { id: childId }, status: 'idle' })
  result.resolve({ stopReason: 'stopped', output: [] })
  await waitFor(async () => (await h.call('wiki-generate-status')).data.status === 'failed')
  assert.equal(disposed, true)
  assert.doesNotMatch((await h.call('wiki-generate-status')).data.error, /teardown/)
  assert.equal(h.denied(childId), undefined)
  await h.dispose()
  assert.equal(h.removed(), true)
})

test('unload joins delayed terminal persistence before a new instance writes its job', async t => {
  const old = await host(t), oldResult = deferred(), entered = deferred(), release = deferred()
  let oldId
  old.ctx.subagents.startActivation = async options => {
    oldId = options.childId
    return { result: oldResult.promise, dispose: async () => { oldResult.resolve({ stopReason: 'stopped', output: [] }) } }
  }
  assert.equal((await old.call('wiki-generate')).ok, true)
  const original = fs.promises.rename
  const jobPath = join(old.root, '.project', '.local', 'wiki-job.json')
  let blocked = false, closed = false
  fs.promises.rename = async (source, target, ...args) => {
    if (!blocked && String(target) === jobPath) {
      const record = JSON.parse(await readFile(source, 'utf8'))
      if (record.childId === oldId && record.status === 'failed') {
        blocked = true; entered.resolve(); await release.promise
      }
    }
    return original.call(fs.promises, source, target, ...args)
  }
  syncBuiltinESMExports()
  try {
    const closing = old.dispose().then(() => { closed = true })
    await entered.promise
    assert.equal(closed, false)
    assert.equal(old.removed(), false)
    assert.ok(old.denied(oldId))
    release.resolve()
    await closing
    const next = await host(t, old.root), nextResult = deferred()
    let nextId
    next.ctx.subagents.startActivation = async options => {
      nextId = options.childId
      return { result: nextResult.promise, dispose: async () => { nextResult.resolve({ stopReason: 'stopped', output: [] }) } }
    }
    assert.equal((await next.call('wiki-generate')).ok, true)
    assert.notEqual(nextId, oldId)
    await new Promise(resolve => setImmediate(resolve))
    const saved = JSON.parse(await readFile(jobPath, 'utf8'))
    assert.equal(saved.childId, nextId)
    assert.equal(saved.status, 'running')
    await next.dispose()
  } finally {
    release.resolve()
    fs.promises.rename = original
    syncBuiltinESMExports()
  }
})

test('unload fails closed when the terminal job cannot be persisted', async t => {
  const h = await host(t), result = deferred()
  let childId
  h.ctx.subagents.startActivation = async options => {
    childId = options.childId
    return { result: result.promise, dispose: async () => { result.resolve({ stopReason: 'stopped', output: [] }) } }
  }
  assert.equal((await h.call('wiki-generate')).ok, true)
  const original = fs.promises.rename
  fs.promises.rename = async (source, target, ...args) => {
    if (String(target) === join(h.root, '.project', '.local', 'wiki-job.json')) throw new Error('terminal write failed')
    return original.call(fs.promises, source, target, ...args)
  }
  syncBuiltinESMExports()
  try {
    await assert.rejects(h.dispose(), /Wiki child teardown did not complete safely/)
    assert.equal(h.removed(), false)
    assert.ok(h.denied(childId))
    assert.equal((await h.call('wiki-generate-status')).data.status, 'failed')
  } finally {
    fs.promises.rename = original
    syncBuiltinESMExports()
  }
})

test('unload joins a stop request waiting for its body before a new instance starts', async t => {
  const old = await host(t), body = deferred()
  let interrupts = 0, finished = false
  old.ctx.subagents.interrupt = () => { interrupts++ }
  const stopping = old.callRaw('wiki-generate-stop', { json: () => body.promise })
  const closing = old.dispose().then(() => { finished = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(finished, false)
  assert.equal(old.removed(), false)
  assert.equal((await old.callRaw('wiki-generate-stop', { json: () => { throw new Error('must not read') } })).code, 'WIKI_CLOSING')
  body.resolve({ root: old.root })
  assert.equal((await stopping).code, 'WIKI_CLOSING')
  await closing
  assert.equal(interrupts, 0)
  const next = await host(t, old.root), result = deferred()
  let childId
  next.ctx.subagents.startActivation = async options => {
    childId = options.childId
    return { result: result.promise, dispose: async () => { result.resolve({ stopReason: 'stopped', output: [] }) } }
  }
  assert.equal((await next.call('wiki-generate')).ok, true)
  const record = JSON.parse(await readFile(join(old.root, '.project', '.local', 'wiki-job.json'), 'utf8'))
  assert.equal(record.childId, childId)
  assert.equal(record.status, 'running')
  await next.dispose()
})

test('unload joins an orphan stop read and prevents it from stopping a new instance', async t => {
  const old = await host(t), entered = deferred(), release = deferred()
  const jobPath = join(old.root, '.project', '.local', 'wiki-job.json')
  await mkdir(join(old.root, '.project', '.local'), { recursive: true })
  await writeFile(jobPath, JSON.stringify({ childId: 'old-child', status: 'running' }))
  const original = fs.promises.readFile
  let blocked = false, interrupts = 0, finished = false
  old.ctx.subagents.interrupt = () => { interrupts++ }
  fs.promises.readFile = async (path, ...args) => {
    if (!blocked && String(path) === jobPath) { blocked = true; entered.resolve(); await release.promise }
    return original.call(fs.promises, path, ...args)
  }
  syncBuiltinESMExports()
  try {
    const stopping = old.call('wiki-generate-stop')
    await entered.promise
    const closing = old.dispose().then(() => { finished = true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(finished, false)
    assert.equal(old.removed(), false)
    release.resolve()
    assert.equal((await stopping).code, 'WIKI_CLOSING')
    await closing
    assert.equal(interrupts, 0)
    const next = await host(t, old.root), result = deferred()
    let childId
    next.ctx.subagents.startActivation = async options => {
      childId = options.childId
      return { result: result.promise, dispose: async () => { result.resolve({ stopReason: 'stopped', output: [] }) } }
    }
    assert.equal((await next.call('wiki-generate')).ok, true)
    const record = JSON.parse(await readFile(jobPath, 'utf8'))
    assert.equal(record.childId, childId)
    assert.equal(record.status, 'running')
    await next.dispose()
  } finally {
    release.resolve()
    fs.promises.readFile = original
    syncBuiltinESMExports()
  }
})

test('startup failure with a still-live child does not remove its guard', async t => {
  const h = await host(t)
  let childId
  h.ctx.subagents.startActivation = async options => {
    childId = options.childId
    h.agents.set(childId, { session: { id: childId }, status: 'running' })
    throw new Error('startup failed after child creation')
  }
  assert.equal((await h.call('wiki-generate')).code, 'SPAWN_FAILED')
  assert.ok(h.denied(childId))
  assert.equal((await h.call('wiki-generate')).code, 'WIKI_BUSY')
  await assert.rejects(h.dispose(), /Wiki child teardown did not complete safely/)
  assert.equal(h.removed(), false)
  assert.ok(h.denied(childId))
})
