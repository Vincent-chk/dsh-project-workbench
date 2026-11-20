import assert from 'node:assert/strict'
import test from 'node:test'
import fs, { mkdtemp, rm, mkdir, writeFile, readFile, readdir, chmod } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submitProposals, saveSplitProposals, listProposals, purgeExpired, markApproved, markDismissed, readBaseline, writeBaseline, adoptProposal } from '../core/proposals.js'
import { dispatch } from '../core/rpc.js'
import * as store from '../core/store.js'
import { seedAIReview, seedReviewPrd } from './util.js'

async function root(t) {
  const r = await mkdtemp(join(tmpdir(), 'pw-prop-'))
  t.after(() => rm(r, { recursive: true, force: true }))
  await mkdir(join(r, '.project'), { recursive: true })
  return r
}
const good = { kind: 'advance', target: { reqId: 'req-20261113-aaaaaa' }, evidence: ['repo://src/x.js#L1-L9'], suggested_patch: { to: 'pending' }, reason: 'tests pass' }

test('proposals require evidence; persist to tmp; list newest first', async t => {
  const r = await root(t)
  await assert.rejects(submitProposals(r, [{ ...good, evidence: [] }]), e => e.code === 'EVIDENCE_REQUIRED')
  await assert.rejects(submitProposals(r, [{ ...good, kind: 'bogus' }]), e => e.code === 'INVALID_PROPOSAL')
  const res = await submitProposals(r, [good])
  assert.equal(res.data.saved.length, 1)
  const list = await listProposals(r)
  assert.equal(list.length, 1)
  assert.equal(list[0].status, 'pending')
  assert.equal(list[0].target.reqId, good.target.reqId)
  // stored under .local/tmp/sync, NOT in kanban
  const files = await readdir(join(r, '.project', '.local', 'tmp', 'sync'))
  assert.equal(files.length, 1)
})

test('24h dedup: same target+kind+patch not re-proposed within TTL', async t => {
  const r = await root(t)
  await submitProposals(r, [good])
  const again = await submitProposals(r, [good])
  assert.equal(again.data.saved.length, 0)
  assert.equal(again.data.skipped, 1)
  assert.equal((await listProposals(r)).length, 1)
})

test('draft dedup distinguishes tasks under one requirement and skips repeats within a batch', async t => {
  const r = await root(t)
  const first = { ...good, kind: 'field_draft', target: { ...good.target, issueId: 'iss-20261113-aaaaaa' }, suggested_patch: { acceptance: '验证通过' } }
  const second = { ...first, target: { ...first.target, issueId: 'iss-20261113-bbbbbb' } }
  await submitProposals(r, [first])
  const { data } = await submitProposals(r, [first, second, second])
  assert.equal(data.saved.length, 1)
  assert.equal(data.skipped, 2)
  assert.deepEqual((await listProposals(r)).map(p => p.target.issueId).sort(), [first.target.issueId, second.target.issueId])
})

test('CT-18 TTL: expired proposals hard-deleted; baseline and kanban untouched', async t => {
  const r = await root(t)
  await submitProposals(r, [good])
  await writeBaseline(r, { lastCommit: 'abc', accepted: 1 })
  const kanban = join(r, '.project', 'project.md')
  await writeFile(kanban, '---\nname: "x"\n---\n')
  const before = await readFile(kanban, 'utf8')
  // age the proposal beyond 24h
  const dir = join(r, '.project', '.local', 'tmp', 'sync')
  const f = join(dir, (await readdir(dir))[0])
  const doc = JSON.parse(await readFile(f, 'utf8'))
  doc.createdAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString()
  await writeFile(f, JSON.stringify(doc))
  const removed = await purgeExpired(r)
  assert.equal(removed, 1)
  assert.equal((await listProposals(r)).length, 0)
  // baseline survives TTL; kanban byte-identical
  assert.equal((await readBaseline(r)).lastCommit, 'abc')
  assert.equal(await readFile(kanban, 'utf8'), before)
})

test('approve/dismiss keep trace; dismiss requires pending; invalid id rejected', async t => {
  const r = await root(t)
  const { data } = await submitProposals(r, [good])
  const id = data.saved[0]
  const ap = await markApproved(r, id)
  assert.equal(ap.data.status, 'approved')
  // An approved proposal cannot also be dismissed (consistent state).
  await assert.rejects(markDismissed(r, id, 'x'), e => e.code === 'INVALID_STATE')
  const { data: d2 } = await submitProposals(r, [{ ...good, suggested_patch: { to: 'ready' }, reason: '另一条' }])
  const dm = await markDismissed(r, d2.saved[0], 'not now')
  assert.equal(dm.data.status, 'dismissed')
  assert.equal(dm.data.dismissReason, 'not now')
  await assert.rejects(markApproved(r, '../evil'), e => e.code === 'INVALID_ID')
  await assert.rejects(markApproved(r, 'prop-nonexistent'), e => e.code === 'NOT_FOUND')
})

// ---- stage 2: field drafts and new-task suggestions adopt through store guards ----
async function devReq(r) {
  await store.initProject(r)
  const { data } = await store.createRequirement(r, '需求')
  await store.updateRequirement(r, data.id, { goal: 'g', scope: 's', acceptance: 'a' })
  await seedReviewPrd(r, data.id)
  await store.moveRequirement(r, data.id, 'reviewing')
  await seedAIReview(r, data.id)
  await store.moveRequirement(r, data.id, 'ready')
  await store.moveRequirement(r, data.id, 'in_progress')
  return data.id
}
const ev = ['session://s/1']

function splitDraft(requirement, id, title, sources = []) {
  return {
    kind: 'new_task', target: { reqId: requirement.id },
    evidence: [`draft://requirement/${requirement.id}`], reason: '需要独立处理这项缺口',
    suggested_patch: { title, problemOverview: '补齐现有工作尚未覆盖的结果' },
    split: {
      version: { requirement: requirement.hash, tasks: Object.fromEntries(requirement.issues.map(issue => [issue.id, issue.hash])) },
      requirements: [{ id, text: title }], sources,
    },
  }
}

test('split drafts must be adopted in their requirement and can be adopted one by one', async t => {
  const r = await root(t)
  const reqId = await devReq(r)
  const [requirement] = (await store.scanProject(r)).requirements
  const { data: { saved: [first, second, third] } } = await saveSplitProposals(r, reqId, [
    splitDraft(requirement, 'criterion-1', '符合空格输入标准'),
    splitDraft(requirement, 'criterion-2', '验证导出结果'),
    splitDraft(requirement, 'criterion-3', '处理目录为空'),
  ])
  const call = (method, input) => dispatch(method, { root: r, ...input }, new AbortController().signal)
  const bulk = await call('sync/apply', { proposalId: first, reqId })
  assert.equal(bulk.code, 'SPLIT_REVIEW_REQUIRED')
  await assert.rejects(adoptProposal(r, first), { code: 'SPLIT_REVIEW_REQUIRED' })
  await assert.rejects(adoptProposal(r, first, null, { reqId: 'another' }), { code: 'SPLIT_REVIEW_REQUIRED' })
  assert.equal((await store.scanProject(r)).requirements[0].issues.length, 0)
  const adopted = await call('proposal/adopt', { proposalId: first, reqId, patch: { title: '核对全空格输入' } })
  assert.equal(adopted.ok, true, JSON.stringify(adopted))
  assert.equal((await store.scanProject(r)).requirements[0].issues[0].title, '核对全空格输入')
  const sibling = await call('proposal/adopt', { proposalId: second, reqId })
  assert.equal(sibling.ok, true, JSON.stringify(sibling))
  const retry = await call('proposal/adopt', { proposalId: first, reqId })
  assert.equal(retry.data.id, adopted.data.id)
  await store.addIssueUpdate(r, reqId, adopted.data.id, '这个任务也已经覆盖空目录')
  await assert.rejects(adoptProposal(r, third, null, { reqId }), { code: 'DRAFT_STALE' })
  assert.deepEqual((await store.scanProject(r)).requirements[0].issues.map(issue => issue.status), ['todo', 'todo'])
})

test('a split draft becomes stale after task progress or cited project text changes', async t => {
  const r = await root(t)
  const reqId = await devReq(r)
  const { data: { id } } = await store.createIssue(r, reqId, '已有任务')
  await writeFile(join(r, 'project-notes.md'), '一个已记录的行为\n')
  const save = async () => {
    const [requirement] = (await store.scanProject(r)).requirements
    const draft = splitDraft(requirement, 'criterion-1', '独立缺口', [{ path: 'project-notes.md', quote: '一个已记录的行为' }])
    return (await saveSplitProposals(r, reqId, [draft])).data.saved[0]
  }
  const beforeProgress = await save()
  await store.addIssueUpdate(r, reqId, id, '已有任务刚补齐这项能力')
  await assert.rejects(adoptProposal(r, beforeProgress, null, { reqId }), { code: 'DRAFT_STALE' })
  const beforeEvidence = await save()
  assert.notEqual(beforeProgress, beforeEvidence)
  await assert.rejects(adoptProposal(r, beforeProgress, null, { reqId }), { code: 'DRAFT_STALE' })
  await writeFile(join(r, 'project-notes.md'), '行为已改变\n')
  await assert.rejects(adoptProposal(r, beforeEvidence, null, { reqId }), { code: 'DRAFT_STALE' })
  assert.deepEqual((await store.scanProject(r)).requirements[0].issues.map(issue => issue.id), [id])
})

test('a successful empty review retires pending split drafts without affecting other suggestions', async t => {
  const r = await root(t)
  const reqId = await devReq(r)
  const [requirement] = (await store.scanProject(r)).requirements
  const draft = splitDraft(requirement, 'criterion-1', '旧草稿')
  const { data: { saved: [oldId] } } = await submitProposals(r, [draft])
  await assert.rejects(adoptProposal(r, oldId, null, { reqId }), { code: 'DRAFT_STALE' })
  const { data: { saved: [ordinaryId] } } = await submitProposals(r, [{ ...draft, evidence: ev }])
  await saveSplitProposals(r, reqId, [])
  const list = await listProposals(r)
  assert.equal(list.find(p => p.id === oldId).status, 'dismissed')
  assert.equal(list.find(p => p.id === ordinaryId).status, 'pending')
  const adopted = await adoptProposal(r, ordinaryId)
  assert.ok(adopted.data.id)
})

test('split replacement keeps the previous draft when publication fails', async t => {
  const r = await root(t)
  const reqId = await devReq(r)
  const [requirement] = (await store.scanProject(r)).requirements
  const draft = splitDraft(requirement, 'criterion-1', '任务草稿')
  const { data: { saved: [oldId] } } = await saveSplitProposals(r, reqId, [draft])
  const oldFile = join(r, '.project', '.local', 'tmp', 'sync', `${oldId}.json`)
  const rename = fs.rename
  const injected = t.mock.method(fs, 'rename', (from, to) => {
    if (to === oldFile) throw Object.assign(new Error('injected failure'), { code: 'EIO' })
    return rename(from, to)
  })
  syncBuiltinESMExports()
  t.after(() => { injected.mock.restore(); syncBuiltinESMExports() })
  await assert.rejects(saveSplitProposals(r, reqId, [draft]), { code: 'EIO' })
  const list = await listProposals(r)
  assert.deepEqual(list.map(p => [p.id, p.status]), [[oldId, 'pending']])
})

test('field_draft adoption writes the formal field; repeat adopt is idempotent', async t => {
  const r = await root(t)
  const reqId = await devReq(r)
  const { data: iss } = await store.createIssue(r, reqId, '任务')
  const { data } = await submitProposals(r, [{ kind: 'field_draft', target: { reqId, issueId: iss.id }, evidence: ev, suggested_patch: { problemOverview: 'AI 起草的概述' }, reason: '补充' }])
  const pid = data.saved[0]
  const first = await adoptProposal(r, pid)
  assert.equal(first.ok, true)
  assert.equal((await store.scanProject(r)).requirements[0].issues[0].problemOverview, 'AI 起草的概述')
  const second = await adoptProposal(r, pid)
  assert.equal(second.data.alreadyAdopted, true)
  assert.equal((await store.scanProject(r)).requirements[0].issues.length, 1)
})

test('new_task adoption creates one task; repeat adopt does not duplicate', async t => {
  const r = await root(t)
  const reqId = await devReq(r)
  const { data } = await submitProposals(r, [{ kind: 'new_task', target: { reqId }, evidence: ev, suggested_patch: { title: '拆分任务', problemOverview: '具体工作', acceptance: '标准' }, reason: '拆分' }])
  const pid = data.saved[0]
  const first = await adoptProposal(r, pid)
  assert.ok(first.data.id.startsWith('iss-'))
  const second = await adoptProposal(r, pid)
  assert.equal(second.data.alreadyAdopted, true)
  assert.equal(second.data.id, first.data.id)
  const issues = (await store.scanProject(r)).requirements[0].issues
  assert.equal(issues.length, 1)
  assert.equal(issues[0].acceptance, '标准')
})

test('adoption never bypasses guards: new_task into a non-developing requirement fails', async t => {
  const r = await root(t)
  await store.initProject(r)
  const { data } = await store.createRequirement(r, '草稿')
  const { data: prop } = await submitProposals(r, [{ kind: 'new_task', target: { reqId: data.id }, evidence: ev, suggested_patch: { title: 'x' }, reason: '拆分' }])
  await assert.rejects(adoptProposal(r, prop.saved[0]), e => e.code === 'REQ_NOT_ACTIVE')
  // Still pending after a failed adopt — retryable once the requirement develops.
  assert.equal((await listProposals(r))[0].status, 'pending')
})

test('field_draft validation requires issueId and a patch; new_task requires a title', async t => {
  const r = await root(t)
  await assert.rejects(submitProposals(r, [{ kind: 'field_draft', target: { reqId: 'req-20261113-aaaaaa' }, evidence: ev, suggested_patch: { x: 1 }, reason: 'r' }]), e => e.code === 'INVALID_PROPOSAL')
  await assert.rejects(submitProposals(r, [{ kind: 'new_task', target: { reqId: 'req-20261113-aaaaaa' }, evidence: ev, suggested_patch: {}, reason: 'r' }]), e => e.code === 'INVALID_PROPOSAL')
})

// ---- 返工 4：采用并发与失败重试 ----

test('concurrent adopt of one new_task through workspace aliases creates exactly one task', async t => {
  const r = await root(t)
  const reqId = await devReq(r)
  const { data } = await submitProposals(r, [{ kind: 'new_task', target: { reqId }, evidence: ev, suggested_patch: { title: '并发任务', problemOverview: '具体工作' }, reason: '拆分' }])
  const pid = data.saved[0]
  const [r1, r2] = await Promise.all([adoptProposal(r, pid), adoptProposal(`${r}/.`, pid)])
  assert.equal(r1.data.id, r2.data.id) // same formal task
  assert.ok(r1.data.alreadyAdopted || r2.data.alreadyAdopted)
  assert.equal((await store.scanProject(r)).requirements[0].issues.length, 1)
})

test('adopting a split task reuses a manual creation already queued on the requirement lock', { timeout: 3000 }, async t => {
  const r = await root(t)
  const reqId = await devReq(r)
  const title = '补充说明'
  const { data: { saved: [proposalId] } } = await submitProposals(r, [{
    kind: 'new_task', target: { reqId }, evidence: ev,
    suggested_patch: { title, problemOverview: '补充使用场景', acceptance: '建议标准' }, reason: '拆分',
  }])
  const manualRoot = `${r}/.`
  const adoptionRoot = `${r}//.`
  const manualKey = Promise.withResolvers()
  const adoptionKey = Promise.withResolvers()
  let adoptionPaths = 0
  const realpath = fs.realpath
  const observed = t.mock.method(fs, 'realpath', async path => {
    const canonical = await realpath(path)
    if (path === manualRoot) manualKey.resolve()
    // The first call locks the proposal; the second reaches the shared requirement lock.
    if (path === adoptionRoot && ++adoptionPaths === 2) adoptionKey.resolve()
    return canonical
  })
  syncBuiltinESMExports()
  t.after(() => { observed.mock.restore(); syncBuiltinESMExports() })
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  const held = store.withRequirementLock(r, reqId, async () => {
    entered.resolve()
    await release.promise
  })
  t.after(release.resolve)
  await entered.promise
  const manual = store.createIssue(manualRoot, reqId, title)
  await manualKey.promise
  const adopted = adoptProposal(adoptionRoot, proposalId)
  await Promise.race([adoptionKey.promise, adopted])
  release.resolve()
  await held

  const [{ data: created }, { data: reused }] = await Promise.all([manual, adopted])
  assert.equal(reused.id, created.id)
  assert.equal(reused.reused, true)
  const issues = (await store.scanProject(r)).requirements[0].issues
  assert.equal(issues.length, 1)
  assert.equal(issues[0].acceptance, '') // Adoption preserves the manual task's fields.

  const second = await store.createIssue(r, reqId, title)
  assert.notEqual(second.data.id, created.id) // A separate manual request may still use the same title.
})

test('invalid fields leave no task; a fixed retry creates exactly one', async t => {
  const r = await root(t)
  const reqId = await devReq(r)
  const { data } = await submitProposals(r, [{ kind: 'new_task', target: { reqId }, evidence: ev, suggested_patch: { title: '合法标题', problemOverview: '具体工作', refs: ['/abs/path'] }, reason: '拆分' }])
  const pid = data.saved[0]
  await assert.rejects(adoptProposal(r, pid), e => e.code === 'ABSOLUTE_REF')
  assert.equal((await store.scanProject(r)).requirements[0].issues.length, 0) // no half-product
  assert.equal((await listProposals(r))[0].status, 'pending') // retryable
  // Fix the proposal's refs, then retry.
  const file = join(r, '.project', '.local', 'tmp', 'sync', `${pid}.json`)
  const doc = JSON.parse(await readFile(file, 'utf8'))
  doc.suggested_patch.refs = ['src/x.js']
  await writeFile(file, JSON.stringify(doc, null, 2) + '\n')
  const ok = await adoptProposal(r, pid)
  assert.ok(ok.data.id.startsWith('iss-'))
  const issues = (await store.scanProject(r)).requirements[0].issues
  assert.equal(issues.length, 1)
  assert.deepEqual(issues[0].refs, ['src/x.js'])
})

test('a crash after create (adopting) finalizes without duplicating', async t => {
  const r = await root(t)
  const reqId = await devReq(r)
  const { data } = await submitProposals(r, [{ kind: 'new_task', target: { reqId }, evidence: ev, suggested_patch: { title: '崩溃恢复', problemOverview: '具体工作' }, reason: '拆分' }])
  const pid = data.saved[0]
  const first = await adoptProposal(r, pid)
  // Simulate a reload that left the proposal in "adopting" with a recorded result.
  const file = join(r, '.project', '.local', 'tmp', 'sync', `${pid}.json`)
  const doc = JSON.parse(await readFile(file, 'utf8'))
  doc.status = 'adopting'
  await writeFile(file, JSON.stringify(doc, null, 2) + '\n')
  await store.updateRequirement(r, reqId, { goal: '修改目标' }, { confirmReviewInvalid: true, reason: '重审' })
  const again = await adoptProposal(r, pid)
  assert.equal(again.data.id, first.data.id)
  assert.equal(again.data.alreadyAdopted, true)
  const req = (await store.scanProject(r)).requirements[0]
  assert.equal(req.status, 'backlog')
  assert.deepEqual(req.issues.map(issue => issue.id), [first.data.id])
})

test('a blocked claim write leaves no task; a retry creates exactly one', async t => {
  const r = await root(t)
  const reqId = await devReq(r)
  const { data } = await submitProposals(r, [{ kind: 'new_task', target: { reqId }, evidence: ev, suggested_patch: { title: '阻断恢复', problemOverview: '具体工作' }, reason: '拆分' }])
  const pid = data.saved[0]
  const dir = join(r, '.project', '.local', 'tmp', 'sync')
  await chmod(dir, 0o500) // the claim write (before create) cannot land
  try {
    await assert.rejects(adoptProposal(r, pid), e => e.code === 'EACCES')
  } finally { await chmod(dir, 0o700) }
  assert.equal((await store.scanProject(r)).requirements[0].issues.length, 0) // no task created
  assert.equal((await listProposals(r))[0].status, 'pending')
  const ok = await adoptProposal(r, pid)
  assert.ok(ok.data.id.startsWith('iss-'))
  assert.equal((await store.scanProject(r)).requirements[0].issues.length, 1)
})

test('concurrent adopt and dismiss: only one wins, state stays consistent', async t => {
  const r = await root(t)
  const reqId = await devReq(r)
  const { data } = await submitProposals(r, [{ kind: 'new_task', target: { reqId }, evidence: ev, suggested_patch: { title: '竞态', problemOverview: '具体工作' }, reason: '拆分' }])
  const pid = data.saved[0]
  const [a, d] = await Promise.allSettled([adoptProposal(r, pid), markDismissed(r, pid, '不要')])
  const won = [a, d].filter(x => x.status === 'fulfilled')
  assert.equal(won.length, 1) // exactly one succeeds
  const lost = [a, d].find(x => x.status === 'rejected')
  assert.equal(lost.reason.code, 'INVALID_STATE')
  const final = (await listProposals(r))[0]
  const tasks = (await store.scanProject(r)).requirements[0].issues.length
  if (final.status === 'adopted') assert.equal(tasks, 1)
  else assert.equal(tasks, 0) // dismissed → no task
})
