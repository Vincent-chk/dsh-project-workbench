import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { apply } from '../index.js'
import { makeRoot, stubSpawnHost, waitFor } from './util.js'

async function makeGitRoot(t) {
  const root = await makeRoot(t)
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  execFileSync('git', ['init', '--quiet', root], { env })
  await writeFile(join(root, '.gitignore'), 'openwiki/\n.project/.local/\n')
  await writeFile(join(root, 'source.js'), 'export const value = 1\n')
  execFileSync('git', ['-C', root, 'add', '.gitignore', 'source.js'], { env })
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { env })
  await mkdir(join(root, '.project'))
  return root
}

function spawnHost(root) {
  const host = stubSpawnHost(root), start = host.ctx.subagents.startActivation
  host.ctx.subagents.startActivation = async options => {
    const result = await start(options)
    host.children.at(-1).cwd = options.cwd
    return result
  }
  return host
}

test('Wiki job succeeds only with this run’s durable complete metadata', async t => {
  for (const scenario of ['finish failed', 'old success', 'stale timestamp', 'future timestamp', 'interrupted', 'active run', 'stopped', 'child failed', 'finished', 'noop']) {
    await t.test(scenario, async t => {
      const root = await makeGitRoot(t)
      const wiki = join(root, 'openwiki')
      await mkdir(wiki)
      await writeFile(join(wiki, 'quickstart.md'), '# Existing')
      const previous = JSON.stringify({ status: 'complete', updatedAt: new Date(Date.now() - 60000).toISOString() })
      await writeFile(join(wiki, '.last-update.json'), previous)
      const { ctx, children } = spawnHost(root)
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
      await apply(ctx)
      const call = async (route, body) => (await routes.get(`/api/project-workbench/${route}`)(new Request('http://local', {
        method: 'POST', body: JSON.stringify(body),
      }))).json()
      assert.equal((await call('wiki-generate', { root, sessionId })).ok, true)
      const candidate = join(children[0].cwd, 'openwiki')
      assert.notEqual(children[0].cwd, root)
      await mkdir(candidate)
      await writeFile(join(candidate, 'quickstart.md'), '# New candidate')
      if (scenario === 'finish failed' || scenario === 'active run') {
        await writeFile(join(candidate, '.run.json'), JSON.stringify({ phase: 'generating' }))
      }
      if (!['finish failed', 'old success'].includes(scenario)) {
        const time = Date.now() + (scenario === 'stale timestamp' ? -60000 : scenario === 'future timestamp' ? 60000 : 0)
        await writeFile(join(candidate, '.last-update.json'), JSON.stringify({ status: scenario === 'interrupted' ? 'interrupted' : 'complete', updatedAt: new Date(time).toISOString() }))
      }
      if (scenario === 'stopped') await call('wiki-generate-stop', { root })
      const summary = scenario === 'noop' ? 'WIKI_NOOP' : 'WIKI_DONE pages=1'
      children[0].resolve({ stopReason: scenario === 'child failed' ? 'error' : 'completed', output: [{ type: 'text', text: summary }] })
      const expected = ['finished', 'noop'].includes(scenario) ? 'done' : 'failed'
      await waitFor(async () => (await call('wiki-generate-status', { root })).data.status === expected)
      const jobFile = join(root, '.project', '.local', 'wiki-job.json')
      await waitFor(async () => {
        try { return JSON.parse(await readFile(jobFile, 'utf8')).status === expected } catch { return false }
      })
      const job = JSON.parse(await readFile(jobFile, 'utf8'))
      assert.equal(job.status, expected)
      if (scenario === 'stopped') assert.equal(job.error, 'stopped by user')
      assert.equal(await readFile(join(wiki, 'quickstart.md'), 'utf8'), expected === 'done' ? '# New candidate' : '# Existing')
      if (expected === 'failed') assert.equal(await readFile(join(wiki, '.last-update.json'), 'utf8'), previous)
    })
  }
})

test('a new Wiki run waits until the preceding final status is persisted', async t => {
  const root = await makeGitRoot(t)
  const wiki = join(root, 'openwiki')
  await mkdir(wiki)
  await writeFile(join(wiki, 'quickstart.md'), '# Existing')
  const { ctx, children } = spawnHost(root)
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
  await apply(ctx)
  const call = async (route, body) => (await routes.get(`/api/project-workbench/${route}`)(new Request('http://local', {
    method: 'POST', body: JSON.stringify(body),
  }))).json()

  const originalRename = fs.promises.rename
  let release, entered
  const blocked = new Promise(resolve => { release = resolve })
  const enteredWrite = new Promise(resolve => { entered = resolve })
  let intercepted = false
  fs.promises.rename = async (from, to, ...args) => {
    if (!intercepted && String(to).endsWith('/wiki-job.json') && JSON.parse(await readFile(from, 'utf8')).status === 'done') {
      intercepted = true
      entered()
      await blocked
    }
    return originalRename.call(fs.promises, from, to, ...args)
  }
  syncBuiltinESMExports()
  t.after(() => { release(); fs.promises.rename = originalRename; syncBuiltinESMExports() })

  const first = await call('wiki-generate', { root, sessionId })
  assert.equal(first.ok, true)
  const candidate = join(children[0].cwd, 'openwiki')
  await mkdir(candidate)
  await writeFile(join(candidate, 'quickstart.md'), '# New candidate')
  await writeFile(join(candidate, '.last-update.json'), JSON.stringify({ status: 'complete', updatedAt: new Date().toISOString() }))
  children[0].resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'WIKI_DONE pages=1' }] })
  await enteredWrite
  const blockedStart = await call('wiki-generate', { root, sessionId })
  assert.equal(blockedStart.code, 'WIKI_BUSY')
  assert.equal(children.length, 1)
  release()
  let second
  await waitFor(async () => {
    second = await call('wiki-generate', { root, sessionId })
    return second.ok
  })
  assert.equal(children.length, 2)
  children[1].resolve({ stopReason: 'error', output: [] })
  const jobFile = join(root, '.project', '.local', 'wiki-job.json')
  await waitFor(async () => {
    try {
      const job = JSON.parse(await readFile(jobFile, 'utf8'))
      return job.childId === second.data.childId && job.status === 'failed'
    } catch { return false }
  })
})

test('Wiki guard protects the first child call and is removed on startup failure and completion', async t => {
  const root = await makeGitRoot(t)
  const { ctx, children } = spawnHost(root)
  const routes = new Map()
  let guard
  ctx.tools.guard = fn => { guard = fn; return () => {} }
  ctx.skills = { register: () => {} }
  ctx.mcpManager = { register: () => {} }
  ctx.connection = { fetch: { register: route => routes.set(route.path, route.fetch) } }
  ctx.effect = effect => {
    const result = effect()
    if (typeof result?.next === 'function') { for (const _ of result) { /* register routes */ } }
    if (typeof result === 'function') t.after(result)
  }
  const { sessionId } = await ctx.sessionController.create({ cwd: root })
  await apply(ctx)
  const call = async route => (await routes.get(`/api/project-workbench/${route}`)(new Request('http://local', {
    method: 'POST', body: JSON.stringify({ root, sessionId }),
  }))).json()
  const start = ctx.subagents.startActivation
  let firstId
  let firstCalls
  ctx.subagents.startActivation = async options => {
    firstId = options.childId
    const exec = { agent: { session: { id: firstId } }, name: 'bash', arguments: { command: 'find openwiki -name "._*" -delete' } }
    // A rejected call must never reach its handler, including a run_code
    // program that could otherwise use Node APIs or make nested tool calls.
    const delivered = []
    const dispatch = (name, args) => {
      const denial = guard({ agent: { session: { id: firstId } }, name, arguments: args })
      if (!denial) delivered.push(name)
      return denial
    }
    firstCalls = {
      shell: guard(exec),
      direct: dispatch('send_message', { recipient: 'lead', message: 'blocked' }),
      program: dispatch('run_code', { code: 'await import("node:fs"); await tools.send_message(...)' }),
      unknown: dispatch('unknown_communication_tool', {}),
      delivered,
    }
    throw new Error('startup failed')
  }
  assert.equal((await call('wiki-generate')).code, 'SPAWN_FAILED')
  assert.ok(firstCalls.shell, 'shell denied before startActivation returns')
  assert.ok(firstCalls.direct, 'direct parent message denied')
  assert.match(firstCalls.program, /不支持 PTC/, 'PTC is rejected before its program executes')
  assert.ok(firstCalls.unknown, 'unrecognized tools fail closed')
  assert.deepEqual(firstCalls.delivered, [])
  assert.equal(guard({ agent: { session: { id: firstId } }, name: 'bash', arguments: {} }), undefined)

  ctx.subagents.startActivation = async options => {
    assert.ok(guard({ agent: { session: { id: options.childId } }, name: 'bash', arguments: {} }))
    return start(options)
  }
  const started = await call('wiki-generate')
  assert.equal(started.ok, true)
  children[0].resolve({ stopReason: 'error', output: [] })
  await waitFor(async () => (await call('wiki-generate-status')).data.status === 'failed')
  await waitFor(async () => {
    try { return JSON.parse(await readFile(join(root, '.project', '.local', 'wiki-job.json'), 'utf8')).status === 'failed' } catch { return false }
  })
  assert.equal(guard({ agent: { session: { id: started.data.childId } }, name: 'bash', arguments: {} }), undefined)
})

test('Wiki generation checks the Git root and source before starting an agent', async t => {
  const root = await makeGitRoot(t)
  const subdir = join(root, 'subdir')
  await mkdir(subdir)
  const plain = await makeRoot(t)
  await writeFile(join(plain, 'app.js'), 'export const value = 1\n')
  const { ctx, children } = spawnHost(root)
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
  await apply(ctx)
  const call = async (route, projectRoot) => (await routes.get(`/api/project-workbench/${route}`)(new Request('http://local', {
    method: 'POST', body: JSON.stringify({ root: projectRoot, sessionId }),
  }))).json()
  const subdirResult = await call('wiki-generate', subdir)
  assert.equal(subdirResult.code, 'WIKI_ROOT_NOT_TOPLEVEL')
  assert.match(subdirResult.message, /顶层文件夹/)
  const plainResult = await call('wiki-generate', plain)
  assert.equal(plainResult.code, 'NOT_GIT')
  assert.match(plainResult.message, /初始化 Git.*无需提交/)
  const sourceLink = join(root, 'source-link.js')
  await symlink('source.js', sourceLink)
  const unsupported = await call('wiki-generate', root)
  assert.equal(unsupported.code, 'WIKI_SOURCE_UNSUPPORTED')
  await unlink(sourceLink)
  assert.equal(children.length, 0)
  const alias = join(plain, 'repository-alias')
  await symlink(root, alias)
  const started = await call('wiki-generate', alias)
  assert.equal(started.ok, true)
  assert.equal(children.length, 1)
  children[0].resolve({ stopReason: 'error', output: [] })
  await waitFor(async () => (await call('wiki-generate-status', alias)).data.status === 'failed')
  // The in-memory terminal status is visible before its queued file write ends.
  // Wait for this child's durable result before makeRoot removes the aliased root.
  await waitFor(async () => {
    try {
      const job = JSON.parse(await readFile(join(root, '.project', '.local', 'wiki-job.json'), 'utf8'))
      return job.childId === started.data.childId && job.status === 'failed'
    } catch { return false }
  })
})

test('a damaged prior run stays untouched while a fresh candidate starts in isolation', async t => {
  const root = await makeGitRoot(t)
  const wiki = join(root, 'openwiki')
  await mkdir(wiki)
  const attachment = join(wiki, 'attachment.txt')
  const checkpoint = join(wiki, '.run.json')
  await writeFile(attachment, 'valuable attachment')
  const { ctx, children } = spawnHost(root)
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
  await apply(ctx)
  for (const [i, damaged] of ['{broken', JSON.stringify({ phase: 'generating', mode: 'init' })].entries()) {
    await writeFile(checkpoint, damaged)
    const response = await routes.get('/api/project-workbench/wiki-generate')(new Request('http://local', {
      method: 'POST', body: JSON.stringify({ root, sessionId }),
    }))
    assert.equal((await response.json()).ok, true)
    assert.equal(children.length, i + 1)
    await assert.rejects(readFile(join(children[i].cwd, 'openwiki', '.run.json')), { code: 'ENOENT' })
    assert.equal(await readFile(attachment, 'utf8'), 'valuable attachment')
    assert.equal(await readFile(checkpoint, 'utf8'), damaged)
    children[i].resolve({ stopReason: 'error', output: [] })
    await waitFor(async () => {
      try { return JSON.parse(await readFile(join(root, '.project', '.local', 'wiki-job.json'), 'utf8')).status === 'failed' } catch { return false }
    })
    assert.equal(await readFile(attachment, 'utf8'), 'valuable attachment')
    assert.equal(await readFile(checkpoint, 'utf8'), damaged)
  }
})

test('a fresh candidate leaves existing companion files untouched on failure', async t => {
  const root = await makeGitRoot(t)
  const wiki = join(root, 'openwiki')
  const pages = join(wiki, 'concepts')
  const claims = join(wiki, '.claims', 'concepts')
  await mkdir(pages, { recursive: true })
  await mkdir(claims, { recursive: true })
  const existingPage = join(pages, 'greet.md')
  await writeFile(existingPage, '# Existing page')
  await writeFile(join(wiki, '._.run.json'), 'unrelated companion')
  const { ctx, children } = spawnHost(root)
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
  await apply(ctx)
  const start = async () => (await routes.get('/api/project-workbench/wiki-generate')(new Request('http://local', {
    method: 'POST', body: JSON.stringify({ root, sessionId }),
  }))).json()
  const bytes = Buffer.from([0, 5, 22, 7, 0, 255, 42])
  for (const [i, file] of [join(pages, '._greet.md'), join(claims, '._greet.json')].entries()) {
    await writeFile(file, bytes)
    assert.equal((await start()).ok, true)
    assert.equal(children.length, i + 1)
    await assert.rejects(readFile(join(children[i].cwd, 'openwiki', 'concepts', '._greet.md')), { code: 'ENOENT' })
    assert.deepEqual(await readFile(file), bytes)
    assert.equal(await readFile(existingPage, 'utf8'), '# Existing page')
    children[i].resolve({ stopReason: 'error', output: [] })
    await waitFor(async () => {
      try { return JSON.parse(await readFile(join(root, '.project', '.local', 'wiki-job.json'), 'utf8')).status === 'failed' } catch { return false }
    })
    assert.deepEqual(await readFile(file), bytes)
    await unlink(file)
  }
  assert.equal((await start()).ok, true, 'unrelated ._.run.json does not block generation')
  assert.equal(children.length, 3)
  children[2].resolve({ stopReason: 'error', output: [] })
  await waitFor(async () => (await routes.get('/api/project-workbench/wiki-generate-status')(new Request('http://local', {
    method: 'POST', body: JSON.stringify({ root, sessionId }),
  }))).json().then(result => result.data.status === 'failed'))
  await waitFor(async () => {
    try { return JSON.parse(await readFile(join(root, '.project', '.local', 'wiki-job.json'), 'utf8')).status === 'failed' } catch { return false }
  })
})

test('a checkpoint with companion page paths is not reused by the fresh candidate', async t => {
  const root = await makeGitRoot(t)
  const wiki = join(root, 'openwiki')
  await mkdir(wiki)
  const checkpoint = join(wiki, '.run.json')
  const source = JSON.stringify({ schemaVersion: 1, runId: 'current-run', mode: 'update', phase: 'generating', initialPages: ['quickstart.md', 'docs/._old.md'] })
  await writeFile(checkpoint, source)
  const page = join(wiki, 'quickstart.md')
  await writeFile(page, '# Existing')
  const { ctx, children } = spawnHost(root)
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
  await apply(ctx)
  const response = await routes.get('/api/project-workbench/wiki-generate')(new Request('http://local', {
    method: 'POST', body: JSON.stringify({ root, sessionId }),
  }))
  assert.equal((await response.json()).ok, true)
  assert.equal(children.length, 1)
  await assert.rejects(readFile(join(children[0].cwd, 'openwiki', '.run.json')), { code: 'ENOENT' })
  assert.equal(await readFile(checkpoint, 'utf8'), source)
  assert.equal(await readFile(page, 'utf8'), '# Existing')
  children[0].resolve({ stopReason: 'error', output: [] })
  await waitFor(async () => {
    try { return JSON.parse(await readFile(join(root, '.project', '.local', 'wiki-job.json'), 'utf8')).status === 'failed' } catch { return false }
  })
  assert.equal(await readFile(checkpoint, 'utf8'), source)
  assert.equal(await readFile(page, 'utf8'), '# Existing')
})
