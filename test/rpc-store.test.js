import assert from 'node:assert/strict'
import test from 'node:test'
import { access, chmod, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot } from './util.js'
import { dispatch } from '../core/rpc.js'
import { createRequirement, deliveryFingerprint } from '../core/store.js'

const sig = new AbortController().signal
const call = (method, input) => dispatch(method, input, sig)

// Legal pool → review → ready → development flow through the RPC surface.
async function devReq(root, title = 'x') {
  const { data } = await call('requirement/create', { root, title, fields: { q_pain: '需求概述' } })
  await call('requirement/update', { root, id: data.id, patch: { goal: 'g', scope: 's', acceptance: 'a' } })
  await call('requirement/review', { root, id: data.id, action: 'submit' })
  await call('requirement/review', { root, id: data.id, action: 'approve' })
  await call('requirement/startDev', { root, id: data.id })
  return data.id
}
async function issHash(root, reqId, id) {
  const got = await call('requirement/get', { root, id: reqId })
  return got.data.issues.find(i => i.id === id).hash
}

test('requirement creation saves title and overview together and needs no other field for review', async t => {
  const root = await makeRoot(t)
  assert.equal((await call('project/init', { root })).ok, true)
  assert.equal((await call('requirement/create', { root, title: '想法' })).code, 'REVIEW_INFO_REQUIRED')
  assert.equal((await call('requirement/create', { root, title: '想法', fields: { q_pain: '  ', goal: '可选目标' } })).code, 'REVIEW_INFO_REQUIRED')
  assert.equal((await call('requirement/create', { root, title: ' ', fields: { q_pain: '需求概述' } })).code, 'TITLE_REQUIRED')
  assert.deepEqual((await call('requirement/list', { root })).data.requirements, [])
  const created = await call('requirement/create', { root, title: '想法 "一"', fields: { q_pain: '  用户需要明确的提示。  ' } })
  assert.equal(created.ok, true)
  const id = created.data.id
  const list = await call('requirement/list', { root })
  assert.equal(list.ok, true)
  assert.equal(list.data.requirements.length, 1)
  const [req] = list.data.requirements
  assert.equal(req.title, '想法 "一"')
  assert.equal(req.q_pain, '用户需要明确的提示。')
  assert.equal(req.derived.needsClarification, false)
  assert.equal(list.data.todaySuggestion, null)
  assert.ok(id.startsWith('req-'))
  assert.equal((await call('requirement/update', { root, id, patch: { q_pain: ' ' } })).code, 'REVIEW_INFO_REQUIRED')
  assert.equal((await call('requirement/move', { root, id, to: 'reviewing', fileHash: req.hash })).ok, true)
})

test('listing another uninitialized workspace does not create or mix project data', async t => {
  const a = await makeRoot(t)
  const b = await makeRoot(t)
  assert.equal((await call('project/init', { root: a })).ok, true)
  assert.equal((await call('requirement/create', { root: a, title: 'A only', fields: { q_pain: 'A' } })).ok, true)
  const empty = await call('requirement/list', { root: b })
  assert.equal(empty.ok, true)
  assert.equal(empty.data.project, null)
  assert.deepEqual(empty.data.requirements, [])
  await assert.rejects(access(join(b, '.project')), { code: 'ENOENT' })
  const back = await call('requirement/list', { root: a })
  assert.equal(back.ok, true)
  assert.deepEqual(back.data.requirements.map(r => r.title), ['A only'])
})

test('missing workspace directory is reported as WORKSPACE_MISSING, an empty one as NOT_INITIALIZED', async t => {
  const root = await makeRoot(t)
  const empty = await call('requirement/list', { root })
  assert.equal(empty.ok, true)
  assert.deepEqual(empty.data.diagnostics.map(d => d.code), ['NOT_INITIALIZED'])
  const missing = await call('requirement/list', { root: join(root, 'gone') })
  assert.equal(missing.ok, true)
  assert.equal(missing.data.project, null)
  assert.deepEqual(missing.data.diagnostics.map(d => d.code), ['WORKSPACE_MISSING'])
  assert.equal((await call('project/init', { root: join(root, 'gone') })).ok, false)
  await assert.rejects(access(join(root, 'gone')), { code: 'ENOENT' })
})

test('requirement update rejects a stale content fingerprint and accepts the refreshed one', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  const { data: req } = await call('requirement/create', { root, title: '指纹', fields: { q_pain: '核对内容' } })
  const listed = await call('requirement/list', { root })
  const hash = listed.data.requirements[0].hash
  assert.ok(typeof hash === 'string' && hash.length > 0)
  // External edit between read and save.
  await writeFile(join(root, '.project', 'requirements', req.id, 'requirement.md'), '---\nschema: 2\nid: ' + req.id + '\ntitle: "外部改动"\nstatus: backlog\n---\n', { flag: 'w' })
  const stale = await call('requirement/update', { root, id: req.id, patch: { title: '界面保存' }, fileHash: hash })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'CONFLICT')
  assert.match(await readFile(join(root, '.project', 'requirements', req.id, 'requirement.md'), 'utf8'), /外部改动/)
  const fresh = (await call('requirement/list', { root })).data.requirements[0].hash
  const saved = await call('requirement/update', { root, id: req.id, patch: { title: '界面保存' }, fileHash: fresh })
  assert.equal(saved.ok, true)
})

test('issue update rejects a stale content fingerprint', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  const reqId = await devReq(root, '指纹任务')
  const { data: iss } = await call('issue/create', { root, reqId, title: '任务', fields: { problemOverview: '要处理的内容' } })
  const issue = (await call('requirement/list', { root })).data.requirements[0].issues[0]
  assert.ok(typeof issue.hash === 'string' && issue.hash.length > 0)
  await writeFile(join(root, '.project', 'requirements', reqId, 'issues', `${iss.id}.md`), '---\nschema: 2\nid: ' + iss.id + '\ntitle: "外部任务改动"\nstatus: todo\n---\n')
  const stale = await call('issue/update', { root, reqId, id: iss.id, patch: { title: '界面任务保存' }, fileHash: issue.hash })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'CONFLICT')
})

test('task content is required at creation and editing, and ordinary edits never refresh old results', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  const reqId = await devReq(root)
  const title = '显示「名字」提示'
  const missing = await call('issue/create', { root, reqId, title, fields: { problemOverview: '  ' } })
  assert.equal(missing.code, 'MISSING_TASK_FIELDS')
  assert.equal((await call('requirement/get', { root, id: reqId })).data.issues.length, 0)
  const created = await call('issue/create', { root, reqId, title, fields: { problemOverview: '空名字要显示提示。' } })
  assert.equal(created.ok, true)
  const id = created.data.id
  const read = async () => (await call('requirement/get', { root, id: reqId })).data.issues.find(task => task.id === id)
  const first = await read()
  assert.equal(first.title, title)
  assert.equal(first.problemOverview, '空名字要显示提示。')
  assert.equal(first.acceptance, '')
  assert.equal((await call('issue/update', { root, reqId, id, patch: { title: ' ' }, fileHash: first.hash })).code, 'TITLE_REQUIRED')
  assert.equal((await call('issue/update', { root, reqId, id, patch: { problemOverview: '' }, fileHash: first.hash })).code, 'MISSING_TASK_FIELDS')
  const result = { resultSummary: '已检查空名字', evidence: '空字符串显示了提示' }
  assert.equal((await call('issue/update', { root, reqId, id, recordResult: true, patch: { resultSummary: '只填结果' }, fileHash: first.hash })).code, 'RESULT_EVIDENCE_REQUIRED')
  assert.equal((await call('issue/update', { root, reqId, id, recordResult: true, patch: result, fileHash: first.hash })).ok, true)
  assert.equal((await call('issue/confirm', { root, reqId, id, fileHash: (await read()).hash })).ok, true)
  assert.equal((await call('issue/move', { root, reqId, id, to: 'todo', reason: '重新核对' })).ok, true)
  const reopened = await read()
  assert.equal(reopened.resultFresh, false)
  assert.equal((await call('issue/update', { root, reqId, id, patch: { title: '改名', ...result }, fileHash: reopened.hash })).ok, true)
  const edited = await read()
  assert.equal(edited.resultSummary, result.resultSummary)
  assert.equal(edited.resultFresh, false)
  assert.equal((await call('issue/confirm', { root, reqId, id, fileHash: edited.hash })).code, 'RESULT_STALE')
  const note = '已核对空名字\n\n- 空字符串已验证。\n- 全空格待核对。'
  assert.equal((await call('issue/addUpdate', { root, reqId, id, text: note })).ok, true)
  assert.ok((await read()).activity[0].endsWith(note))
})

test('enable failure returns a structured error and the same enable succeeds on retry', async t => {
  const root = await makeRoot(t)
  await chmod(root, 0o500) // directory not writable: project/init cannot create .project/
  try {
    const failed = await call('project/init', { root })
    assert.equal(failed.ok, false)
    assert.equal(failed.code, 'ACCESS_DENIED')
    await assert.rejects(access(join(root, '.project')), { code: 'ENOENT' })
  } finally {
    await chmod(root, 0o700)
  }
  const retried = await call('project/init', { root })
  assert.equal(retried.ok, true)
  const list = await call('requirement/list', { root })
  assert.ok(list.data.project, 'retry must initialize the project')
})

test('a corrupt project.md is a read failure, and fixing it makes the project readable again', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  await writeFile(join(root, '.project', 'project.md'), 'corrupt: no frontmatter\n')
  const broken = await call('requirement/list', { root })
  assert.equal(broken.ok, true)
  assert.equal(broken.data.project, null)
  assert.ok(broken.data.diagnostics.some(d => d.code === 'MISSING_FRONTMATTER'))
  await writeFile(join(root, '.project', 'project.md'), '---\nschema: 2\nname: "恢复的项目"\n---\n')
  const fixed = await call('requirement/list', { root })
  assert.equal(fixed.ok, true)
  assert.equal(fixed.data.project.name, '恢复的项目')
  assert.deepEqual(fixed.data.diagnostics, [])
})

test('RPC full move journey and illegal move returns structured error', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  const { data } = await createRequirement(root, 'x')
  const id = data.id
  assert.equal((await call('requirement/get', { root, id })).data.derived.needsClarification, true)
  // The old backlog → in_progress shortcut is no longer legal.
  assert.equal((await call('requirement/move', { root, id, to: 'in_progress' })).code, 'ILLEGAL_TRANSITION')
  assert.equal((await call('requirement/review', { root, id, action: 'submit' })).code, 'REVIEW_INFO_REQUIRED')
  await call('requirement/update', { root, id, patch: { q_pain: '补齐需求概述' } })
  assert.equal((await call('requirement/review', { root, id, action: 'submit' })).ok, true)
  assert.equal((await call('requirement/review', { root, id, action: 'approve' })).ok, true)
  assert.equal((await call('requirement/startDev', { root, id })).ok, true)
  const illegal = await call('requirement/move', { root, id, to: 'completed', expectFingerprint: 'invalid' })
  assert.equal(illegal.ok, false)
  assert.equal(illegal.code, 'ILLEGAL_TRANSITION')
  assert.ok(illegal.message.length > 0)
})

test('RPC issue lifecycle through dispatch: confirm → submit → accept', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  const reqId = await devReq(root)
  const { data: iss } = await call('issue/create', { root, reqId, title: 'task', fields: { problemOverview: '要处理的内容' } })
  await call('issue/update', { root, reqId, id: iss.id, patch: { problemOverview: 'p', triggerPath: 't', acceptance: 'a' } })
  // Human direct completion supplies result + evidence (no AI session needed).
  assert.equal((await call('issue/confirm', { root, reqId, id: iss.id, summary: '结果', evidence: '依据', fileHash: await issHash(root, reqId, iss.id) })).ok, true)
  let shown = (await call('requirement/get', { root, id: reqId })).data
  assert.equal((await call('requirement/submit', { root, id: reqId, summary: '交付摘要' })).code, 'FINGERPRINT_REQUIRED')
  assert.equal((await call('requirement/get', { root, id: reqId })).data.status, 'in_progress')
  assert.equal((await call('requirement/submit', { root, id: reqId, summary: '交付摘要', expectFingerprint: deliveryFingerprint(shown) })).ok, true)
  shown = (await call('requirement/get', { root, id: reqId })).data
  const proposal = await call('sync/submit', { root, proposals: [{
    kind: 'advance', target: { reqId }, evidence: ['repo://src/x.js#L1-L9'],
    suggested_patch: { to: 'completed' }, reason: '建议通过验收',
  }] })
  assert.equal((await call('sync/apply', { root, proposalId: proposal.data.saved[0] })).code, 'FINGERPRINT_REQUIRED')
  assert.equal((await call('requirement/get', { root, id: reqId })).data.status, 'pending')
  assert.equal((await call('requirement/move', { root, id: reqId, to: 'completed', opinion: '验收通过' })).code, 'FINGERPRINT_REQUIRED')
  assert.equal((await call('requirement/get', { root, id: reqId })).data.status, 'pending')
  assert.equal((await call('requirement/move', { root, id: reqId, to: 'completed', opinion: '验收通过', fileHash: shown.hash, expectFingerprint: deliveryFingerprint(shown) })).ok, true)
  const got = await call('requirement/get', { root, id: reqId })
  assert.equal(got.data.status, 'completed')
  assert.ok(got.data.reviews.some(r => r.kind === 'acceptance' && r.decision === 'approved'))
})

test('RPC actor is server-set: a body claiming ai cannot bypass human-only acceptance', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  const reqId = await devReq(root)
  const { data: iss } = await call('issue/create', { root, reqId, title: 'task', fields: { problemOverview: '要处理的内容' } })
  // issue/move to done is human-only; the route forces human, but a direct AI
  // tool path would be rejected. Here verify the UI route completes as human.
  await call('issue/update', { root, reqId, id: iss.id, patch: { resultSummary: 'r', evidence: 'e' } })
  const res = await call('issue/move', { root, reqId, id: iss.id, to: 'done', actor: 'ai', fileHash: await issHash(root, reqId, iss.id) })
  assert.equal(res.ok, true) // actor:'ai' in body is ignored; entry is human
  assert.equal((await call('requirement/get', { root, id: reqId })).data.issues[0].status, 'done')
})

test('RPC reopen returns to development with selected tasks and is retryable', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  const reqId = await devReq(root)
  const { data: iss } = await call('issue/create', { root, reqId, title: 'task', fields: { problemOverview: '要处理的内容' } })
  await call('issue/update', { root, reqId, id: iss.id, patch: { resultSummary: 'r', evidence: 'e' } })
  await call('issue/confirm', { root, reqId, id: iss.id, fileHash: await issHash(root, reqId, iss.id) })
  const shown = (await call('requirement/get', { root, id: reqId })).data
  await call('requirement/submit', { root, id: reqId, summary: 's', expectFingerprint: deliveryFingerprint(shown) })
  const reopened = await call('requirement/reopen', { root, id: reqId, reason: '打回修改', reopen: [iss.id], create: [{ title: '新任务', fields: { problemOverview: '要补做的工作' } }] })
  assert.equal(reopened.ok, true)
  assert.equal(reopened.data.status, 'in_progress')
  const got = await call('requirement/get', { root, id: reqId })
  assert.equal(got.data.issues.length, 2)
  assert.equal(got.data.pendingReopen, null)
})

test('RPC task/stamp and home/summary (initialized vs uninitialized)', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  const reqId = await devReq(root)
  const { data: iss } = await call('issue/create', { root, reqId, title: 'task', fields: { problemOverview: '要处理的内容' } })
  const stamp = await call('task/stamp', { root, reqId, id: iss.id })
  assert.ok(stamp.ok && stamp.data.hash && typeof stamp.data.modified === 'number')
  const home = await call('home/summary', { root })
  assert.equal(home.data.initialized, true)
  assert.equal(home.data.counts.in_progress, 1)
  // Uninitialized workspace: recognizable empty state, no writes.
  const empty = await makeRoot(t)
  const homeEmpty = await call('home/summary', { root: empty })
  assert.equal(homeEmpty.data.initialized, false)
  assert.deepEqual(homeEmpty.data.reminders, [])
  assert.deepEqual(homeEmpty.data.diagnostics.map(d => d.code), ['NOT_INITIALIZED'])
})

test('home summary stamp tracks task updates, authorization and deletion without clock noise', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  const reqId = await devReq(root)
  const { data: issue } = await call('issue/create', { root, reqId, title: '任务', fields: { problemOverview: '要处理的内容' } })
  const readHome = async (running = []) => (await call('home/summary', { root, running })).data
  const before = await readHome()

  const blocked = await call('issue/move', { root, reqId, id: issue.id, to: 'blocked', blockedReason: '等待输入' })
  assert.equal(blocked.ok, true)
  const after = await readHome()
  assert.equal(after.counts.blocked, 1)
  assert.notEqual(after.stamp, before.stamp)
  const blockedSince = after.reminders[0].waitingSince
  const updated = await call('issue/addUpdate', { root, reqId, id: issue.id, text: '补充等待进展' })
  assert.equal(updated.ok, true)
  const afterUpdate = await readHome()
  assert.notEqual(afterUpdate.stamp, after.stamp)
  assert.equal(afterUpdate.reminders[0].waitingSince, blockedSince)

  const file = join(root, '.project', 'requirements', reqId, 'issues', `${issue.id}.md`)
  const raw = await readFile(file, 'utf8')
  await writeFile(file, raw.replace(/^updated: .*$/m, 'updated: unknown'))
  const withoutAuth = await readHome()
  const running = [{ issueId: issue.id, awaitingAuth: true }]
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const pendingAuth = await readHome(running)
  assert.notEqual(pendingAuth.stamp, withoutAuth.stamp)
  now += 10_000
  const polled = await readHome(running)
  assert.equal(polled.reminders[0].waitingSince, blockedSince)
  assert.equal(polled.stamp, pendingAuth.stamp)

  const { data: draft } = await call('requirement/create', { root, title: '待删除草稿', fields: { q_pain: '测试草稿恢复' } })
  const withDraft = await readHome()
  const deleted = await call('project/trash', { root, kind: 'requirement', id: draft.id })
  assert.equal(deleted.ok, true)
  assert.notEqual((await readHome()).stamp, withDraft.stamp)
})

test('RPC proposal/list and proposal/adopt write formal objects idempotently', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  const reqId = await devReq(root)
  const submitted = await call('sync/submit', { root, proposals: [{ kind: 'new_task', target: { reqId }, evidence: ['session://s/1'], suggested_patch: { title: '建议任务' }, reason: '拆分' }] })
  const pid = submitted.data.saved[0]
  assert.equal((await call('proposal/list', { root })).data.proposals.length, 1)
  const missing = await call('proposal/adopt', { root, proposalId: pid })
  assert.equal(missing.code, 'MISSING_TASK_FIELDS')
  const first = await call('proposal/adopt', { root, proposalId: pid, patch: { problemOverview: '补充明确的操作说明' } })
  assert.ok(first.data.id.startsWith('iss-'))
  const second = await call('proposal/adopt', { root, proposalId: pid })
  assert.equal(second.data.alreadyAdopted, true)
  assert.equal((await call('requirement/get', { root, id: reqId })).data.issues.length, 1)
})

test('RPC sync/apply and proposal/adopt share one adoption (no duplicate task)', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  const reqId = await devReq(root)
  const submitted = await call('sync/submit', { root, proposals: [{ kind: 'new_task', target: { reqId }, evidence: ['session://s/1'], suggested_patch: { title: '共享采用' }, reason: '拆分' }] })
  const pid = submitted.data.saved[0]
  const viaSync = await call('sync/apply', { root, proposalId: pid, patch: { problemOverview: '补充明确的操作说明' } })
  assert.ok(viaSync.data.id.startsWith('iss-'))
  const viaAdopt = await call('proposal/adopt', { root, proposalId: pid })
  assert.equal(viaAdopt.data.alreadyAdopted, true)
  assert.equal(viaAdopt.data.id, viaSync.data.id)
  assert.equal((await call('requirement/get', { root, id: reqId })).data.issues.length, 1)
})

test('RPC rejects relative/invalid root and unknown method', async t => {
  const root = await makeRoot(t)
  assert.equal((await call('project/init', { root: 'relative/path' })).code, 'INVALID_ROOT')
  assert.equal((await call('no/such', { root })).code, 'NOT_FOUND')
})

test('RPC project/trash soft-deletes and validate reports problems', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  const { data } = await call('requirement/create', { root, title: 'x', fields: { q_pain: '测试软删除' } })
  assert.equal((await call('project/trash', { root, kind: 'requirement', id: data.id })).ok, true)
  const list = await call('requirement/list', { root })
  assert.equal(list.data.requirements.length, 0)
  const valid = await call('project/validate', { root })
  assert.equal(valid.ok, true)
})

test('CT-17: sync/apply approval reuses the exact move guards (illegal transition still rejected)', async t => {
  const root = await makeRoot(t)
  await call('project/init', { root })
  const { data: req } = await call('requirement/create', { root, title: '对账目标', fields: { q_pain: '核对状态' } })
  // AI proposes an ILLEGAL jump backlog -> completed; approval must NOT bypass guards.
  const submitted = await call('sync/submit', { root, proposals: [{
    kind: 'advance', target: { reqId: req.id }, evidence: ['repo://src/x.js#L1-L9'],
    suggested_patch: { to: 'completed' }, reason: '非法推进',
  }] })
  assert.equal(submitted.ok, true)
  const proposalId = submitted.data.saved[0]
  const applied = await call('sync/apply', { root, proposalId })
  assert.equal(applied.ok, false)
  assert.equal(applied.code, 'ILLEGAL_TRANSITION')
  assert.equal((await call('requirement/get', { root, id: req.id })).data.status, 'backlog')
  // A LEGAL proposal (reviewing -> ready) applies through the same path.
  await call('requirement/update', { root, id: req.id, patch: { goal: 'g', scope: 's', acceptance: 'a' } })
  await call('requirement/review', { root, id: req.id, action: 'submit' })
  const ok = await call('sync/submit', { root, proposals: [{
    kind: 'advance', target: { reqId: req.id }, evidence: ['repo://src/x.js#L1-L9'],
    suggested_patch: { to: 'ready' }, reason: '合法推进',
  }] })
  const appliedOk = await call('sync/apply', { root, proposalId: ok.data.saved[0] })
  assert.equal(appliedOk.ok, true)
  assert.equal((await call('requirement/get', { root, id: req.id })).data.status, 'ready')
})
