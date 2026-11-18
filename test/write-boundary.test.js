// CT-19 write boundary (C-07): the reconciliation/architecture AI must have NO
// kanban write path, and that is enforced by the Host's read-only sandbox, not by a
// prompt-level "do not write": every read-only background spawner registers its
// child for the sandbox hook. Production read-only jobs also mask inherited tools.
// The wiki generator uses its own guard for openwiki/ writes.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { apply } from '../index.js'
import { makeRoot, stubSpawnHost, waitFor } from './util.js'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..')

test('CT-19: every read-only spawner registers its child for the sandbox hook', async () => {
  const spawn = await readFile(join(src, 'core', 'spawn.js'), 'utf8')
  // runChild (probe), startSyncRun, startReadOnlyChild (architecture, delivery,
  // organize/split) must each add the childId to readOnlyChildren so the Host
  // applies sandbox read-only.
  const bodies = {
    runChild: spawn.split('async function runChild')[1].split('export async function spawnProbe')[0],
    startSyncRun: spawn.split('export async function startSyncRun')[1].split('export function parseSyncOutput')[0],
    startReadOnlyChild: spawn.split('export async function startReadOnlyChild')[1].split('export async function startArchitectureRun')[0],
  }
  for (const [name, body] of Object.entries(bodies)) {
    assert.ok(body.includes('readOnlyChildren.add(childId)'), `${name} must register child as read-only`)
    // This checks the configured delivery mode only. A DSH real-device run
    // showed that caller delivery can resume the parent; it does not prove CT-16.
    assert.ok(body.includes("delivery: 'caller'"), `${name} uses the current caller delivery mode`)
  }
  // The wiki generator is intentionally NOT read-only (it writes openwiki/).
  const wikiBody = spawn.split('export async function startWikiGeneration')[1].split('export async function startSyncRun')[0]
  assert.ok(!wikiBody.includes('readOnlyChildren.add'), 'wiki child writes openwiki/, must not be sandboxed read-only')
})

test('CT-19: Host guards the wiki child to openwiki/ writes', async () => {
  const index = await readFile(join(src, 'index.js'), 'utf8')
  assert.match(index, /ctx\.tools\.guard\(/)
  assert.match(index, /wikiGuardDenial/)
  assert.match(index, /wikiChildren\.set\(childId, \{ root: staged\.root, mode: 'init', resumeRunId: null, initStarted: false \}\)/)
  assert.match(index, /wikiChildren\.delete\(job\.childId\)/)
  assert.doesNotMatch(index, /sweepAppleDouble/)
})

test('CT-19: wiki generation is serialized and a reloaded job can be stopped', async () => {
  const index = await readFile(join(src, 'index.js'), 'utf8')
  assert.match(index, /another project is generating its wiki/)
  assert.match(index, /ctx\.subagents\.interrupt\(/)
  assert.match(index, /stopped by user/)
})

test('starting wiki generation and reading its status preserve unrelated metadata', async t => {
  const root = await makeRoot(t)
  execFileSync('git', ['init', '-q', root])
  await writeFile(join(root, '.gitignore'), '.project/.local/\n')
  await writeFile(join(root, 'source.js'), 'export const value = 1\n')
  execFileSync('git', ['-C', root, 'add', '.'])
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'baseline'])
  await mkdir(join(root, '.project', '.local'), { recursive: true })
  await mkdir(join(root, 'openwiki', '.claims'), { recursive: true })
  await writeFile(join(root, 'openwiki', 'quickstart.md'), '# Quickstart\n')
  const companions = [
    join(root, '._AGENTS.md'),
    // These remain in the original project while the child runs elsewhere.
    join(root, 'openwiki', '._.run.json'),
    join(root, 'openwiki', '.claims', '._notes.txt'),
  ]
  const metadata = Buffer.from([0, 5, 0x16, 7])
  for (const file of companions) await writeFile(file, metadata)
  const { ctx, children } = stubSpawnHost(root)
  const guards = []
  ctx.tools.guard = fn => { guards.push(fn); return () => {} }
  let childOptions
  const startActivation = ctx.subagents.startActivation
  ctx.subagents.startActivation = async options => { childOptions = options; return startActivation(options) }
  const routes = new Map()
  ctx.skills = { register: () => {} }
  ctx.mcpManager = { register: () => {} }
  ctx.connection = { fetch: { register: route => routes.set(route.path, route.fetch) } }
  ctx.effect = effect => {
    const result = effect()
    if (typeof result?.next === 'function') { for (const _ of result) { /* register routes */ } }
    if (typeof result === 'function') t.after(result)
  }
  await apply(ctx)
  const { sessionId } = await ctx.sessionController.create({ cwd: root })
  const request = (path, body) => routes.get(path)(new Request('http://local', {
    method: 'POST', body: JSON.stringify(body),
  }))
  const status = async () => (await (await request('/api/project-workbench/wiki-generate-status', { root })).json()).data.status
  const assertPreserved = async () => {
    for (const file of companions) assert.deepEqual(await readFile(file), metadata)
  }
  assert.equal(await status(), 'idle')
  await assertPreserved()
  const start = await (await request('/api/project-workbench/wiki-generate', { root, sessionId })).json()
  assert.equal(start.ok, true, JSON.stringify(start))
  assert.equal(start.data.started, true)
  assert.equal(children.length, 1)
  assert.notEqual(await realpath(childOptions.cwd), await realpath(root))
  const denial = file_path => guards.map(guard => guard({ name: 'write', arguments: { file_path }, agent: { session: { id: start.data.childId } } })).find(Boolean)
  assert.ok(denial(join(root, 'openwiki', 'quickstart.md')), 'child cannot write the original Wiki')
  assert.equal(denial(join(childOptions.cwd, 'openwiki', 'quickstart.md')), undefined, 'child can write its temporary Wiki')
  await assertPreserved()
  assert.equal(await status(), 'running')
  await assertPreserved()
  children[0].resolve({ stopReason: 'error', output: [], diagnostic: 'test completion' })
  await waitFor(async () => {
    try { return JSON.parse(await readFile(join(root, '.project', '.local', 'wiki-job.json'), 'utf8')).status === 'failed' } catch { return false }
  })
  assert.equal(await status(), 'failed')
  await assertPreserved()
})

test('CT-19: Host applies read-only sandbox to registered children only', async () => {
  const index = await readFile(join(src, 'index.js'), 'utf8')
  assert.match(index, /ctx\.on\('agent\/created'/)
  assert.match(index, /readOnlyChildren\.delete\(agent\.session\.id\)/)
  assert.match(index, /append\('sandbox\/mode',\s*\{\s*mode:\s*'read-only'/)
})

test('background tool restrictions use the child scope and must take effect before dispatch', async t => {
  const cases = [
    { name: 'standard', inherited: ['read', 'glob', 'grep', 'edit'], expected: ['read', 'glob', 'grep'] },
    { name: 'minimal', inherited: ['read_image', 'bash'], expected: [] },
    { name: 'failed restriction', inherited: ['read', 'edit'], restrictionError: true },
    { name: 'unfiltered child tool', inherited: ['read'], own: ['other'] },
  ]
  for (const { name, inherited, expected, restrictionError, own = [] } of cases) {
    await t.test(name, async t => {
      const root = await makeRoot(t)
      const { ctx } = stubSpawnHost(root)
      const listeners = []
      const routes = new Map()
      ctx.skills = { register: () => {} }
      ctx.mcpManager = { register: () => {} }
      ctx.connection = { fetch: { register: route => routes.set(route.path, route.fetch) } }
      ctx.effect = effect => {
        const result = effect()
        if (typeof result?.next === 'function') { for (const _ of result) { /* register all routes */ } }
        if (typeof result === 'function') t.after(result)
      }
      ctx.on = (event, listener) => { if (event === 'agent/created') listeners.push(listener) }
      const { sessionId } = await ctx.sessionController.create({ cwd: root })
      let requestTools
      ctx.subagents.startActivation = async ({ childId }) => {
        let visible = inherited
        let sandbox
        const agent = {
          session: { id: childId, append: (_event, data) => { sandbox = data.mode } },
          ctx: {
            tools: {
              schemas: scope => {
                assert.equal(scope, agent, 'rc.3 schema queries require the agent argument')
                return [...visible, ...own].map(name => ({ name }))
              },
              restrict: ({ allow }) => {
                if (restrictionError) throw new Error('restriction failed')
                visible = inherited.filter(name => allow.includes(name))
              },
            },
          },
        }
        for (const listener of listeners) await listener({ agent })
        assert.equal(sandbox, 'read-only')
        requestTools = [...visible, ...own]
        return { result: Promise.resolve({ stopReason: 'error', output: [] }) }
      }

      await apply(ctx)
      const request = new Request('http://local/api/project-workbench/arch-generate', {
        method: 'POST', body: JSON.stringify({ root, sessionId }),
      })
      const response = await routes.get('/api/project-workbench/arch-generate')(request)
      const result = await response.json()
      assert.equal(result.ok, expected !== undefined)
      assert.deepEqual(requestTools, expected)
      if (expected === undefined) assert.equal(result.code, 'SPAWN_FAILED')
    })
  }
})
