import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { apply } from '../index.js'
import { markWikiViewReady, prepareWikiView, wikiPage, wikiStatus, wikiUpdateRecordState } from '../core/wiki.js'
import { makeRoot, stubSpawnHost, waitFor } from './util.js'

async function setup(t, { updatedAt = '2020-01-01T00:00:00.000Z', missingRecord = false, stopped = false } = {}) {
  const root = await makeRoot(t)
  const templates = join(root, 'empty-git-templates')
  await mkdir(templates)
  execFileSync('git', ['init', '--quiet', root], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TEMPLATE_DIR: templates },
  })
  const wiki = join(root, 'openwiki')
  await mkdir(wiki)
  const page = join(wiki, 'quickstart.md'), update = join(wiki, '.last-update.json')
  await writeFile(page, '# 原内容\n')
  const original = JSON.stringify({ status: 'complete', updatedAt })
  if (!missingRecord) await writeFile(update, original)
  await writeFile(join(root, '.gitignore'), '.project/.local/\n')
  execFileSync('git', ['-C', root, 'add', '.'])
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'baseline'])
  // Recreate an existing legacy saved view directly. New jobs generate in a
  // private copy and no longer create or resume these legacy snapshots.
  const saved = await prepareWikiView(root)
  await markWikiViewReady(root, saved.epoch)
  await writeFile(page, '# 失败后的部分内容\n')
  const observed = await wikiUpdateRecordState(root)
  const jobPath = join(root, '.project', '.local', 'wiki-job.json')
  const failed = { status: 'failed', childId: 'legacy-child', startedAt: Date.now() - 1000,
    endedAt: Date.now(), error: stopped ? 'stopped by user' : 'legacy failure',
    viewEpoch: saved.epoch, viewSnapshotId: saved.snapshotId,
    failureUpdateHash: observed.hash, failureUpdateAt: observed.at }
  await writeFile(jobPath, JSON.stringify(failed))
  const { ctx, children } = stubSpawnHost(root), routes = new Map()
  ctx.skills = { register: () => {} }
  ctx.mcpManager = { register: () => {} }
  ctx.connection = { fetch: { register: route => routes.set(route.path, route.fetch) } }
  ctx.effect = effect => {
    const result = effect()
    if (typeof result?.next === 'function') for (const _ of result) { /* register routes */ }
    if (typeof result === 'function') t.after(result)
  }
  const { sessionId } = await ctx.sessionController.create({ cwd: root })
  await apply(ctx)
  const callRoute = async (route, overrides = {}) => (await routes.get(`/api/project-workbench/${route}`)(new Request('http://local', {
    method: 'POST', body: JSON.stringify({ root, sessionId, ...overrides }),
  }))).json()
  const call = overrides => callRoute('wiki-generate', overrides)
  const job = async () => JSON.parse(await readFile(jobPath, 'utf8'))
  const waitJob = async (status, childId) => {
    await waitFor(async () => { try { const v = await job(); return v.status === status && v.childId === childId } catch { return false } })
    return job()
  }
  return { root, wiki, page, update, original, call, job, jobPath, waitJob, failed, children }
}

test('failed job only adopts a newer completion proved by its recorded terminal baseline', async t => {
  const f = await setup(t)
  assert.match(f.failed.failureUpdateHash, /^[0-9a-f]{64}$/)
  let status = await wikiStatus(f.root)
  assert.equal(status.viewIsSnapshot, true)
  assert.equal(status.viewExternalChanged, undefined, 'the original completion marker does not hide a stopped/failed message')
  assert.equal((await wikiPage(f.root, 'quickstart.md', status.viewVersion)).content, '# 原内容\n')

  for (const at of [f.failed.endedAt, f.failed.endedAt - 1000, Date.now() + 60000]) {
    await writeFile(f.update, JSON.stringify({ status: 'complete', updatedAt: new Date(at).toISOString() }))
    status = await wikiStatus(f.root)
    assert.equal(status.viewIsSnapshot, true, 'same-time, old and future records are unverified')
    assert.equal(status.viewExternalChanged, true, 'a different unverified completion is reported')
    assert.equal((await wikiPage(f.root, 'quickstart.md', status.viewVersion)).content, '# 原内容\n')
  }

  await waitFor(() => Date.now() > f.failed.endedAt)
  await writeFile(f.page, '# 外部更新成功\n')
  await writeFile(f.update, JSON.stringify({ status: 'complete', updatedAt: new Date().toISOString() }))
  const checkpoint = join(f.wiki, '.run.json')
  await writeFile(checkpoint, JSON.stringify({ schemaVersion: 1, runId: 'external', mode: 'update', phase: 'generating', initialPages: [] }))
  status = await wikiStatus(f.root)
  assert.equal(status.viewIsSnapshot, true, 'an active external run cannot be treated as complete')
  await unlink(checkpoint)
  status = await wikiStatus(f.root)
  assert.equal(status.viewIsSnapshot, false)
  assert.equal((await wikiPage(f.root, 'quickstart.md', status.viewVersion)).content, '# 外部更新成功\n')

  const next = await f.call()
  assert.equal(next.ok, true)
  await f.waitJob('running', next.data.childId)
  f.children[0].resolve({ stopReason: 'error', output: [] })
  await f.waitJob('failed', next.data.childId)
  status = await wikiStatus(f.root)
  assert.equal(status.viewIsSnapshot, false, 'the verified current Wiki remains the baseline for staged retries')
  assert.equal((await wikiPage(f.root, 'quickstart.md', status.viewVersion)).content, '# 外部更新成功\n')
})

test('an unchanged completion after failure can be retried while keeping the prior view', async t => {
  const f = await setup(t)
  const retry = await f.call()
  assert.equal(retry.ok, true)
  await f.waitJob('running', retry.data.childId)
  assert.equal((await wikiPage(f.root, 'quickstart.md')).content, '# 原内容\n')
  f.children[0].resolve({ stopReason: 'error', output: [] })
  await f.waitJob('failed', retry.data.childId)
  assert.equal((await wikiPage(f.root, 'quickstart.md')).content, '# 原内容\n')
})

test('stopping with an unchanged completion preserves the stopped state and permits retry', async t => {
  const f = await setup(t, { stopped: true })
  assert.equal(f.failed.error, 'stopped by user')
  const status = await wikiStatus(f.root)
  assert.equal(status.viewIsSnapshot, true)
  assert.equal(status.viewExternalChanged, undefined)
  assert.equal((await wikiPage(f.root, 'quickstart.md', status.viewVersion)).content, '# 原内容\n')
  const retry = await f.call()
  assert.equal(retry.ok, true)
  await f.waitJob('running', retry.data.childId)
  f.children[0].resolve({ stopReason: 'error', output: [] })
  await f.waitJob('failed', retry.data.childId)
})

test('an unavailable parent during retry never replaces the saved view with partial output', async t => {
  const f = await setup(t)
  const unavailable = await f.call({ sessionId: 'session-not-live' })
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.code, 'SESSION_NOT_LIVE')
  assert.equal((await wikiPage(f.root, 'quickstart.md')).content, '# 原内容\n')
  const retry = await f.call()
  assert.equal(retry.ok, true)
  await f.waitJob('running', retry.data.childId)
  assert.equal((await wikiPage(f.root, 'quickstart.md')).content, '# 原内容\n')
  f.children[0].resolve({ stopReason: 'error', output: [] })
  await f.waitJob('failed', retry.data.childId)
  assert.equal((await wikiPage(f.root, 'quickstart.md')).content, '# 原内容\n')
})

test('an old future-dated marker with unrelated edits is not a new completion', async t => {
  const updatedAt = new Date(Date.now() + 500).toISOString()
  const f = await setup(t, { updatedAt })
  assert.equal(f.failed.failureUpdateAt, Date.parse(updatedAt))
  await waitFor(() => Date.now() > Date.parse(updatedAt))
  await writeFile(f.update, JSON.stringify({ status: 'complete', updatedAt, unrelated: 'changed' }))
  assert.equal((await wikiPage(f.root, 'quickstart.md')).content, '# 原内容\n')
})

test('a completion created after a failed job with no prior record is recognized', async t => {
  const f = await setup(t, { missingRecord: true })
  assert.equal(f.failed.failureUpdateHash, null)
  assert.equal(f.failed.failureUpdateAt, null)
  await waitFor(() => Date.now() > f.failed.endedAt)
  await writeFile(f.page, '# 外部生成完成\n')
  await writeFile(f.update, JSON.stringify({ status: 'complete', updatedAt: new Date().toISOString() }))
  assert.equal((await wikiPage(f.root, 'quickstart.md')).content, '# 外部生成完成\n')
})

test('legacy failure with no captured terminal record does not infer an external completion', async t => {
  const f = await setup(t)
  const job = await f.job()
  delete job.failureUpdateHash
  await writeFile(f.jobPath, JSON.stringify(job))
  await waitFor(() => Date.now() > job.endedAt)
  await writeFile(f.update, JSON.stringify({ status: 'complete', updatedAt: new Date().toISOString() }))
  const status = await wikiStatus(f.root)
  assert.equal(status.viewIsSnapshot, true)
  assert.equal((await wikiPage(f.root, 'quickstart.md', status.viewVersion)).content, '# 原内容\n')
})

test('legacy failure can retry an unchanged completion from its verified saved view', async t => {
  const f = await setup(t)
  const job = await f.job()
  delete job.failureUpdateHash
  delete job.failureUpdateAt
  await writeFile(f.jobPath, JSON.stringify(job))
  const unavailable = await f.call({ sessionId: 'session-not-live' })
  assert.equal(unavailable.code, 'SESSION_NOT_LIVE')
  assert.equal((await wikiPage(f.root, 'quickstart.md')).content, '# 原内容\n')
  const retry = await f.call()
  assert.equal(retry.ok, true)
  await f.waitJob('running', retry.data.childId)
  assert.equal((await wikiPage(f.root, 'quickstart.md')).content, '# 原内容\n')
  f.children[0].resolve({ stopReason: 'error', output: [] })
  await f.waitJob('failed', retry.data.childId)
})
