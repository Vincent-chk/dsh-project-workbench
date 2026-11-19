import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, writeFile, mkdir, readdir, rm, symlink, chmod } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { makeRoot, issueFileHash, saveReviewPrd } from './util.js'
import { homeSummary } from '../core/derive.js'
import {
  initProject, scanProject, validateProject, createRequirement, updateRequirement, moveRequirement,
  createIssue, updateIssue, moveIssue, recordRunStart, confirmIssue, continueIssue, submitIssueResult, submitRequirement, reopenRequirement,
  trash, restore, addRequirementUpdate, addIssueUpdate, taskStamp, SUPPORTED_SCHEMA,
} from '../core/store.js'

const reqFile = (root, id) => join(root, '.project', 'requirements', id, 'requirement.md')
const issFile = (root, reqId, id) => join(root, '.project', 'requirements', reqId, 'issues', `${id}.md`)

async function draft(root, title = '需求') {
  await initProject(root)
  return (await createRequirement(root, title)).data.id
}
// Full legal flow: pool → review → ready → development.
async function started(root, title = '需求') {
  const id = await draft(root, title)
  await updateRequirement(root, id, { goal: '目标', scope: '范围', acceptance: '完成标准' })
  await saveReviewPrd(root, id)
  await moveRequirement(root, id, 'reviewing')
  await moveRequirement(root, id, 'ready')
  await moveRequirement(root, id, 'in_progress')
  return id
}
async function link(root, reqId, issueId, sid = 'session-test') {
  const dir = join(root, '.project', '.local', 'links')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${sid}.json`), JSON.stringify({ sessionId: sid, reqId, issueId, linkedAt: new Date().toISOString(), startSeq: 0 }))
}
// Manual direct completion (human, result + evidence) — no session needed.
async function doneIssue(root, reqId, title = '任务') {
  const { data } = await createIssue(root, reqId, title)
  await updateIssue(root, reqId, data.id, { problemOverview: 'p', triggerPath: 't', acceptance: 'a', resultSummary: '结果', evidence: '依据' })
  await moveIssue(root, reqId, data.id, 'done', { fileHash: await issueFileHash(root, reqId, data.id) })
  return data.id
}
// Move to done with the current content fingerprint (required for confirmation).
async function moveDone(root, reqId, id, opts = {}) {
  await moveIssue(root, reqId, id, 'done', { ...opts, fileHash: await issueFileHash(root, reqId, id) })
}

test('adding progress to an older blocked task does not reset its home waiting time', async t => {
  const root = await makeRoot(t)
  const reqId = await started(root)
  const older = (await createIssue(root, reqId, '较早阻塞')).data.id
  const newer = (await createIssue(root, reqId, '较晚阻塞')).data.id
  await moveIssue(root, reqId, older, 'blocked', { blockedReason: '等待依赖' })
  await moveIssue(root, reqId, newer, 'blocked', { blockedReason: '等待确认' })

  const now = Date.now()
  for (const [id, age] of [[older, 7200000], [newer, 3600000]]) {
    const file = issFile(root, reqId, id)
    const content = await readFile(file, 'utf8')
    await writeFile(file, content.replace(/^blockedAt: \d+$/m, `blockedAt: ${now - age}`)
      .replace(/^updated: .*$/m, `updated: ${new Date(now - age).toISOString()}`))
  }
  await addIssueUpdate(root, reqId, older, '补充等待进展')
  const req = (await scanProject(root)).requirements.find(r => r.id === reqId)
  const reminders = homeSummary([req], { [reqId]: req.issues }, { now }).reminders
  assert.deepEqual(reminders.map(item => item.issueId), [older, newer])
  assert.deepEqual(reminders.map(item => item.waitingSince), [now - 7200000, now - 3600000])
})

test('starting a blocked task clears its waiting time before a new block', async t => {
  const root = await makeRoot(t)
  const reqId = await started(root)
  const issueId = (await createIssue(root, reqId, '阻塞后继续')).data.id
  const issue = async () => (await scanProject(root)).requirements.find(r => r.id === reqId).issues.find(i => i.id === issueId)
  await moveIssue(root, reqId, issueId, 'blocked', { blockedReason: '等待依赖' })
  assert.ok((await issue()).blockedAt > 0)

  await recordRunStart(root, reqId, issueId)
  const resumed = await issue()
  assert.equal(resumed.status, 'doing')
  assert.equal(resumed.blocked_reason, '')
  assert.equal(resumed.blockedAt, 0)

  const beforeSecondBlock = Date.now()
  await moveIssue(root, reqId, issueId, 'blocked', { blockedReason: '等待确认' })
  const blockedAgain = await issue()
  assert.equal(blockedAgain.blocked_reason, '等待确认')
  assert.ok(blockedAgain.blockedAt >= beforeSecondBlock && blockedAgain.blockedAt <= Date.now())
})

test('confirmation wait tracks entry time through progress and clears on exit', async t => {
  const root = await makeRoot(t)
  const reqId = await started(root)
  const issueId = (await createIssue(root, reqId, '等待确认')).data.id
  await link(root, reqId, issueId)
  await moveIssue(root, reqId, issueId, 'doing')
  await updateIssue(root, reqId, issueId, { acceptance: '标准', resultSummary: '结果', evidence: '依据' })
  const issue = async () => (await scanProject(root)).requirements.find(r => r.id === reqId).issues.find(i => i.id === issueId)
  const firstBefore = Date.now()
  await moveIssue(root, reqId, issueId, 'in_review', { actor: 'ai' })
  const entered = (await issue()).inReviewAt
  assert.ok(entered >= firstBefore && entered <= Date.now())
  await addIssueUpdate(root, reqId, issueId, '补充等待期间的进展')
  const afterProgress = await issue()
  assert.equal(afterProgress.inReviewAt, entered)
  assert.equal(homeSummary([{ id: reqId, status: 'in_progress' }], { [reqId]: [afterProgress] }).reminders[0].waitingSince, entered)
  await continueIssue(root, reqId, issueId, { text: '补充验证' })
  assert.equal((await issue()).inReviewAt, 0)

  await updateIssue(root, reqId, issueId, { evidence: '新依据' })
  const secondBefore = Date.now()
  await submitIssueResult(root, reqId, issueId, { summary: '重新验证的结果' })
  const resubmitted = (await issue()).inReviewAt
  assert.ok(resubmitted >= secondBefore && resubmitted <= Date.now())
  await addIssueUpdate(root, reqId, issueId, '补充结果背景')
  assert.equal((await issue()).inReviewAt, resubmitted)
  await moveIssue(root, reqId, issueId, 'todo', { reason: '需要再次处理' })
  assert.equal((await issue()).inReviewAt, 0)
})

test('init is idempotent, does not overwrite, writes .gitignore=.local/', async t => {
  const root = await makeRoot(t)
  await initProject(root, { name: 'first' })
  const before = await readFile(join(root, '.project', 'project.md'), 'utf8')
  await initProject(root, { name: 'second' })
  assert.equal(await readFile(join(root, '.project', 'project.md'), 'utf8'), before)
  assert.equal(await readFile(join(root, '.project', '.gitignore'), 'utf8'), '.local/\n._*\n.DS_Store\n')
})

test('init names the project after its workspace folder', async t => {
  const root = await makeRoot(t)
  await initProject(root)
  const idx = await scanProject(root)
  assert.equal(idx.project.name, basename(root))
})

test('full journey: create → review → ready → dev → task done → submit → accept', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  await doneIssue(root, id)
  const sub = await submitRequirement(root, id, { summary: '交付摘要' })
  assert.equal(sub.data.to, 'pending')
  const res = await moveRequirement(root, id, 'completed', { opinion: '验收通过' })
  assert.equal(res.data.to, 'completed')
  const idx = await scanProject(root)
  const req = idx.requirements.find(r => r.id === id)
  assert.equal(req.status, 'completed')
  assert.ok(req.reviews.some(r => r.kind === 'review' && r.decision === 'approved'))
  assert.ok(req.reviews.some(r => r.kind === 'acceptance' && r.decision === 'approved' && r.summary === '交付摘要'))
})

test('review flow: submit needs an overview; return needs reason; records kept', async t => {
  const root = await makeRoot(t)
  const id = await draft(root)
  await assert.rejects(moveRequirement(root, id, 'reviewing'), e => e.code === 'REVIEW_INFO_REQUIRED')
  await updateRequirement(root, id, { q_pain: '需求概述' })
  await saveReviewPrd(root, id)
  await moveRequirement(root, id, 'reviewing')
  assert.ok((await scanProject(root)).requirements[0].submittedAt)
  await assert.rejects(moveRequirement(root, id, 'backlog'), e => e.code === 'REASON_REQUIRED')
  await moveRequirement(root, id, 'backlog', { reason: '补充背景' })
  let req = (await scanProject(root)).requirements[0]
  assert.equal(req.status, 'backlog')
  assert.ok(req.reviews.some(r => r.decision === 'returned' && r.opinion.includes('补充背景')))
  // Resubmit and approve.
  await moveRequirement(root, id, 'reviewing')
  await moveRequirement(root, id, 'ready')
  req = (await scanProject(root)).requirements[0]
  assert.equal(req.status, 'ready')
  assert.ok(req.reviewedAt)
})

test('a new review decision does not overwrite an unreadable old record', async t => {
  const root = await makeRoot(t)
  const id = await draft(root)
  await updateRequirement(root, id, { goal: '目标', scope: '范围', acceptance: '标准' })
  await saveReviewPrd(root, id)
  await moveRequirement(root, id, 'reviewing')
  const reviews = join(root, '.project', 'requirements', id, 'reviews')
  await mkdir(reviews)
  await writeFile(join(reviews, '1.md'), '旧记录缺少元数据')

  await moveRequirement(root, id, 'ready')

  assert.equal(await readFile(join(reviews, '1.md'), 'utf8'), '旧记录缺少元数据')
  assert.match(await readFile(join(reviews, '2.md'), 'utf8'), /decision: approved/)
})

test('substantive edit of reviewed fields invalidates review only with confirmation', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: { id: issueId } } = await createIssue(root, id, '保留的原任务')
  const { goal } = (await scanProject(root)).requirements[0]
  await updateRequirement(root, id, { q_pain: goal })
  await assert.rejects(updateRequirement(root, id, { q_pain: '实质修改概述' }), e => e.code === 'REVIEW_INVALIDATION_REQUIRED')
  await assert.rejects(updateRequirement(root, id, { goal: '新目标' }), e => e.code === 'REVIEW_INVALIDATION_REQUIRED')
  // Ordinary supplement does not trigger re-review.
  await updateRequirement(root, id, { next: '补充说明' })
  assert.equal((await scanProject(root)).requirements[0].status, 'in_progress')
  const res = await updateRequirement(root, id, { goal: '新目标' }, { confirmReviewInvalid: true, reason: '目标变化' })
  assert.equal(res.data.invalidated, true)
  const { requirements: [req], diagnostics } = await scanProject(root)
  assert.equal(req.status, 'backlog')
  assert.equal(req.goal, '新目标')
  assert.ok(req.reviews.some(r => r.decision === 'returned'))
  assert.deepEqual(req.issues.map(issue => issue.id), [issueId])
  assert.deepEqual(diagnostics, [])
})

test('in_progress → backlog requires no running tasks', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: iss } = await createIssue(root, id, 't')
  const runs = join(root, '.project', '.local', 'runs')
  await mkdir(runs, { recursive: true })
  await writeFile(join(runs, `${iss.id}.json`), JSON.stringify({ runId: 'r', sessionId: 's', state: 'running', since: Date.now() }))
  await assert.rejects(updateRequirement(root, id, { scope: '新范围' }, { confirmReviewInvalid: true, reason: 'x' }), e => e.code === 'RUNNING_ISSUES')
  await rm(join(runs, `${iss.id}.json`))
  await updateRequirement(root, id, { scope: '新范围' }, { confirmReviewInvalid: true, reason: 'x' })
  assert.equal((await scanProject(root)).requirements[0].status, 'backlog')
})

test('issue creation rejected unless in_progress', async t => {
  const root = await makeRoot(t)
  const id = await draft(root)
  await assert.rejects(createIssue(root, id, 't'), e => e.code === 'REQ_NOT_ACTIVE')
})

test('requirement submission waits until every task passes acceptance', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  await doneIssue(root, id)
  const { data: iss } = await createIssue(root, id, 't')
  await updateIssue(root, id, iss.id, { acceptance: '核对结果', resultSummary: 'r', evidence: 'e' })
  const submit = () => submitRequirement(root, id, { summary: 's', cancelImpact: '旧说明' })
  await assert.rejects(submit(), { code: 'TASKS_NOT_ACCEPTED' })
  await moveIssue(root, id, iss.id, 'cancelled', { reason: '放弃' })
  await assert.rejects(submit(), { code: 'TASKS_NOT_ACCEPTED' })
  await moveIssue(root, id, iss.id, 'todo', { reason: '恢复' })
  await updateIssue(root, id, iss.id, { resultSummary: '新结果', evidence: '新依据' })
  await moveIssue(root, id, iss.id, 'in_review', { fileHash: await issueFileHash(root, id, iss.id) })
  await assert.rejects(submit(), { code: 'TASKS_NOT_ACCEPTED' })
  await moveDone(root, id, iss.id)
  assert.equal((await submit()).data.to, 'pending')
})

test('submit needs a delivery summary (clean requirement)', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  await doneIssue(root, id)
  await assert.rejects(submitRequirement(root, id, {}), e => e.code === 'SUMMARY_REQUIRED')
  assert.equal((await submitRequirement(root, id, { summary: 's' })).data.to, 'pending')
})

test('auto (ai/system) and manual submit share the same acceptance conditions', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  await doneIssue(root, id)
  // Automatic submission is allowed when conditions hold...
  assert.equal((await submitRequirement(root, id, { summary: 's', actor: 'ai' })).data.to, 'pending')
  // ...and rejected for the same reasons as manual (here: an open task after reopen).
  await reopenRequirement(root, id, { reason: '打回', create: [{ title: '新', fields: { problemOverview: '要补做的工作' } }] })
  await assert.rejects(submitRequirement(root, id, { summary: 's', actor: 'system' }), e => e.code === 'TASKS_NOT_ACCEPTED')
  await assert.rejects(submitRequirement(root, id, { summary: 's', actor: 'human' }), e => e.code === 'TASKS_NOT_ACCEPTED')
})

test('no-task requirement cannot submit; summary preserved on a rejected submit', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  await assert.rejects(submitRequirement(root, id, { summary: '保留的摘要' }), e => e.code === 'NO_ISSUES')
  assert.equal((await scanProject(root)).requirements[0].deliverySummary, '保留的摘要')
})

test('issue moves blocked once requirement leaves in_progress', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const iss = await doneIssue(root, id)
  await submitRequirement(root, id, { summary: 's' })
  await assert.rejects(moveIssue(root, id, iss, 'todo', { reason: 'x' }), e => e.code === 'REQ_NOT_ACTIVE')
})

test('editing an in-review task cannot change its status after its requirement returns to the pool', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: { id: iss } } = await createIssue(root, id, '任务')
  await link(root, id, iss)
  await updateIssue(root, id, iss, { acceptance: '标准', triggerPath: '原路径', resultSummary: '结果', evidence: '依据' })
  await moveIssue(root, id, iss, 'doing')
  await moveIssue(root, id, iss, 'in_review')
  await updateRequirement(root, id, { goal: '新目标' }, { confirmReviewInvalid: true, reason: '新目标需要评审' })

  await assert.rejects(updateIssue(root, id, iss, { triggerPath: '新路径' }), e => e.code === 'REQ_NOT_ACTIVE')

  const [task] = (await scanProject(root)).requirements[0].issues
  assert.equal(task.status, 'in_review')
  assert.equal(task.triggerPath, '原路径')
})

test('blocked issue requires reason; clearing on unblock; AI may block but not confirm', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: iss } = await createIssue(root, id, 't')
  await link(root, id, iss.id)
  await moveIssue(root, id, iss.id, 'doing')
  await assert.rejects(moveIssue(root, id, iss.id, 'blocked', {}), e => e.code === 'BLOCKED_REASON_REQUIRED')
  await moveIssue(root, id, iss.id, 'blocked', { blockedReason: '等待依赖', actor: 'ai' })
  let idx = await scanProject(root)
  assert.equal(idx.requirements[0].issues[0].blocked_reason, '等待依赖')
  await moveIssue(root, id, iss.id, 'doing', { actor: 'system' })
  idx = await scanProject(root)
  assert.equal(idx.requirements[0].issues[0].blocked_reason, '')
  await assert.rejects(moveDone(root, id, iss.id, { actor: 'ai' }), e => e.code === 'HUMAN_ONLY')
  await assert.rejects(moveIssue(root, id, iss.id, 'cancelled', { actor: 'ai', reason: 'x' }), e => e.code === 'HUMAN_ONLY')
})

test('six-info sections round-trip and preserve 说明 plus unrelated body', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: iss } = await createIssue(root, id, 't')
  await updateIssue(root, id, iss.id, { description: '旧说明保留' })
  const file = issFile(root, id, iss.id)
  const oldSections = '## 问题概述的历史注释\n\n无关正文\n\n## 处理结果的草稿\n\n旧草稿\n\n'
  const oldResultSubheading = '### 摘要的写作提示\n\n保留提示正文\n'
  const oldBody = (await readFile(file, 'utf8')).replace('## 说明', oldSections + '## 说明')
  await writeFile(file, oldBody + '\n## 处理结果\n\n' + oldResultSubheading)
  const before = (await scanProject(root)).requirements[0].issues[0]
  assert.equal(before.problemOverview, '')
  assert.equal(before.resultSummary, '')
  await updateIssue(root, id, iss.id, {
    problemOverview: '概述', triggerPath: '路径', rootCause: '待分析', acceptance: '标准',
    resultSummary: '结果摘要', knownLimits: '已知限制',
  })
  const out = await readFile(file, 'utf8')
  assert.match(out, /旧说明保留/)
  assert.ok(out.includes(oldSections))
  assert.ok(out.includes(oldResultSubheading))
  const issue = (await scanProject(root)).requirements[0].issues[0]
  assert.equal(issue.problemOverview, '概述')
  assert.equal(issue.triggerPath, '路径')
  assert.equal(issue.rootCause, '待分析')
  assert.equal(issue.resultSummary, '结果摘要')
  assert.equal(issue.knownLimits, '已知限制')
  assert.equal(issue.description, '旧说明保留')
})

test('deliveryStartedAt: set on create, reset on reopen/continue, kept on normal moves', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: iss } = await createIssue(root, id, 't')
  const created = (await scanProject(root)).requirements[0].issues[0].deliveryStartedAt
  assert.ok(created > 0)
  await link(root, id, iss.id)
  await moveIssue(root, id, iss.id, 'doing')
  assert.equal((await scanProject(root)).requirements[0].issues[0].deliveryStartedAt, created) // not reset
  await updateIssue(root, id, iss.id, { acceptance: 'a', resultSummary: 'r', evidence: 'e' })
  await moveIssue(root, id, iss.id, 'in_review', { actor: 'ai' })
  await continueIssue(root, id, iss.id, { text: '继续修改' })
  const continued = (await scanProject(root)).requirements[0].issues[0].deliveryStartedAt
  assert.ok(continued >= created)
  await updateIssue(root, id, iss.id, { resultSummary: 'r2', evidence: 'e2' }) // new result AND evidence for this delivery
  await moveDone(root, id, iss.id)
  await moveIssue(root, id, iss.id, 'todo', { reason: '重开' })
  const reopened = (await scanProject(root)).requirements[0].issues[0].deliveryStartedAt
  assert.ok(reopened >= continued)
})

test('continue-modify preserves the result while an execution request is still active', async t => {
  const root = await makeRoot(t)
  const reqId = await started(root)
  const { data: { id } } = await createIssue(root, reqId, '任务')
  await link(root, reqId, id)
  await moveIssue(root, reqId, id, 'doing')
  await updateIssue(root, reqId, id, { acceptance: '标准', resultSummary: '结果', evidence: '依据' })
  await moveIssue(root, reqId, id, 'in_review', { actor: 'ai' })
  const file = issFile(root, reqId, id)
  const before = await readFile(file, 'utf8')
  const runs = join(root, '.project', '.local', 'runs')
  await mkdir(runs, { recursive: true })
  await writeFile(join(runs, `${id}.json`), JSON.stringify({ sessionId: 'session-test', state: 'running' }))

  await assert.rejects(continueIssue(root, reqId, id, { text: '请重新验证' }), { code: 'RUNNING' })
  assert.equal(await readFile(file, 'utf8'), before)

  await rm(join(runs, `${id}.json`))
  await continueIssue(root, reqId, id, { text: '请重新验证' })
  const issue = (await scanProject(root)).requirements[0].issues[0]
  assert.equal(issue.status, 'doing')
  assert.match(issue.activity.join('\n'), /请重新验证/)
})

test('terminal content is read-only until reopened', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const iss = await doneIssue(root, id)
  await assert.rejects(updateIssue(root, id, iss, { title: '改' }), e => e.code === 'TERMINAL_READ_ONLY')
  await moveIssue(root, id, iss, 'todo', { reason: '重开' })
  await updateIssue(root, id, iss, { title: '改', resultSummary: '新结果', evidence: '新依据' })
  await moveDone(root, id, iss)
  await submitRequirement(root, id, { summary: 's' })
  await assert.rejects(updateRequirement(root, id, { next: 'x' }), e => e.code === 'TERMINAL_READ_ONLY')
})

test('confirm: fingerprint required, conflict, direct completion needs result+evidence', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: { id: iss } } = await createIssue(root, id, 't')
  const hash = (await scanProject(root)).requirements[0].issues[0].hash
  await writeFile(issFile(root, id, iss), (await readFile(issFile(root, id, iss), 'utf8')).replace('title: "t"', 'title: "外部"'))
  await assert.rejects(confirmIssue(root, id, iss, { summary: 'r', evidence: 'e', fileHash: hash }), e => e.code === 'CONFLICT')
  await assert.rejects(confirmIssue(root, id, iss, {}), e => e.code === 'FINGERPRINT_REQUIRED')
  const fresh = await issueFileHash(root, id, iss)
  await assert.rejects(confirmIssue(root, id, iss, { fileHash: fresh }), e => e.code === 'RESULT_EVIDENCE_REQUIRED')
  const ok = await confirmIssue(root, id, iss, { summary: '结果', evidence: '依据', fileHash: fresh })
  assert.equal(ok.data.to, 'done')
})

test('updateRequirement edits only whitelisted fields and preserves unknown bytes', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const file = reqFile(root, id)
  const original = await readFile(file, 'utf8')
  const withUnknown = original.replace('status: in_progress', 'status: in_progress\ncustom_field: "preserve"')
  await writeFile(file, withUnknown)
  await updateRequirement(root, id, { next: '下一步', q_who: '我' })
  const out = await readFile(file, 'utf8')
  assert.match(out, /custom_field: "preserve"/)
  assert.match(out, /next: "下一步"/)
  await assert.rejects(updateRequirement(root, id, { status: 'completed' }), e => e.code === 'FIELD_NOT_EDITABLE')
})

test('issue refs are editable: round-trip, relative-only, byte-preserving', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: iss } = await createIssue(root, id, 't')
  await updateIssue(root, id, iss.id, { refs: ['src/core/store.js', 'openwiki/data/store.md'] })
  let idx = await scanProject(root)
  assert.deepEqual(idx.requirements[0].issues[0].refs, ['src/core/store.js', 'openwiki/data/store.md'])
  await assert.rejects(updateIssue(root, id, iss.id, { refs: ['/etc/passwd'] }), e => e.code === 'ABSOLUTE_REF')
  await updateIssue(root, id, iss.id, { refs: [] })
  idx = await scanProject(root)
  assert.deepEqual(idx.requirements[0].issues[0].refs, [])
})

test('update log appends to requirement and issue activity; issue move records actor', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: iss } = await createIssue(root, id, 't')
  await addRequirementUpdate(root, id, '需求进展一')
  await addIssueUpdate(root, id, iss.id, 'issue 进展')
  await link(root, id, iss.id)
  await moveIssue(root, id, iss.id, 'doing')
  const idx = await scanProject(root)
  const req = idx.requirements[0]
  assert.ok(req.activity.some(a => a.includes('需求进展一')))
  assert.ok(req.issues[0].activity.some(a => a.includes('issue 进展')))
  assert.ok(req.issues[0].activity.some(a => a.includes('todo → doing') && a.includes('人工')))
  await assert.rejects(addRequirementUpdate(root, id, '   '), e => e.code === 'EMPTY_UPDATE')
})

test('activity excludes similarly named sections and objective evidence', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: issue } = await createIssue(root, id, '任务')
  const file = issFile(root, id, issue.id)
  const raw = await readFile(file, 'utf8')
  const body = [
    '## 活动计划',
    '- 排期说明',
    '## 活动',
    '- 用户补充验收场景',
    '## 处理结果',
    '### 客观记录（系统生成，请勿手改）',
    '- 执行命令：npm test（结果 ok，会话 s 第 1 条，2026-01-01T00:00:00.000Z）',
  ].join('\n')
  await writeFile(file, raw + body + '\n')
  await addIssueUpdate(root, id, issue.id, '新增进展')

  const saved = (await scanProject(root)).requirements[0].issues[0]
  assert.equal(saved.activity.length, 2)
  assert.match(saved.activity[0], /新增进展$/)
  assert.equal(saved.activity[1], '用户补充验收场景')
  assert.equal(saved.hasObjective, true)
})

test('concurrent issue edits, status and progress preserve each other after a rejected write', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: issue } = await createIssue(root, id, 't')
  await link(root, id, issue.id)
  const results = await Promise.allSettled([
    updateIssue(root, id, issue.id, { status: 'done' }), // not editable → rejected, must not block queue
    updateIssue(root, id, issue.id, { description: '并发修改说明' }),
    moveIssue(root, id, issue.id, 'doing'),
    addIssueUpdate(root, id, issue.id, '并发进展'),
  ])
  assert.equal(results[0].status, 'rejected')
  assert.ok(results.slice(1).every(r => r.status === 'fulfilled'))
  const saved = (await scanProject(root)).requirements[0].issues[0]
  assert.equal(saved.description, '并发修改说明')
  assert.equal(saved.status, 'doing')
  assert.ok(saved.activity.some(a => a.includes('并发进展')))
})

test('workspace symlink aliases share the requirement write queue', async t => {
  const root = await makeRoot(t)
  const alias = `${root}-alias`
  await symlink(root, alias, 'dir')
  t.after(() => rm(alias, { force: true }))
  const reqId = await started(root)
  const { data: issue } = await createIssue(root, reqId, '任务')
  await Promise.all(Array.from({ length: 40 }, (_, n) =>
    addIssueUpdate(n % 2 ? alias : root, reqId, issue.id, `别名并发记录 ${n}`)))
  const doc = await readFile(issFile(root, reqId, issue.id), 'utf8')
  for (let n = 0; n < 40; n++) assert.ok(doc.includes(`别名并发记录 ${n}\n`))
  await assert.rejects(addIssueUpdate(join(root, 'missing'), reqId, issue.id, 'x'), e => e.code === 'NOT_FOUND')
  const fileRoot = join(root, 'not-a-directory')
  await writeFile(fileRoot, 'file')
  await assert.rejects(addIssueUpdate(fileRoot, reqId, issue.id, 'x'), e => e.code === 'NOT_FOUND')
})

test('draft trash coordinates with a concurrent edit (either order is legal)', async t => {
  const root = await makeRoot(t)
  const id = await draft(root)
  const [note, trashed] = await Promise.allSettled([
    updateRequirement(root, id, { next: '删除前的补充' }),
    trash(root, 'requirement', id),
  ])
  assert.equal(trashed.status, 'fulfilled')
  if (note.status === 'fulfilled') {
    const moved = join(root, '.project', trashed.value.data.location, 'requirement.md')
    assert.match(await readFile(moved, 'utf8'), /删除前的补充/)
  } else assert.equal(note.reason.code, 'NOT_FOUND')
  await restore(root, { location: trashed.value.data.location })
  assert.equal((await scanProject(root)).requirements[0].id, id)
})

test('only untouched drafts can be deleted; developed requirements cannot', async t => {
  const root = await makeRoot(t)
  const withTask = await started(root, '有任务')
  await createIssue(root, withTask, 't')
  await assert.rejects(trash(root, 'requirement', withTask), e => e.code === 'NOT_A_DRAFT')
  const developed = await started(root, '开发过')
  await assert.rejects(trash(root, 'requirement', developed), e => e.code === 'NOT_A_DRAFT')
  // A returned draft has review history → not deletable.
  const returned = await draft(root, '退回过')
  await updateRequirement(root, returned, { goal: 'g', scope: 's', acceptance: 'a' })
  await saveReviewPrd(root, returned)
  await moveRequirement(root, returned, 'reviewing')
  await moveRequirement(root, returned, 'backlog', { reason: '退回' })
  await assert.rejects(trash(root, 'requirement', returned), e => e.code === 'NOT_A_DRAFT')
  // Tasks are cancelled, not deleted.
  await assert.rejects(trash(root, 'issue', 'iss-20261112-aaaaaa', { reqId: withTask }), e => e.code === 'INVALID_KIND')
})

test('draft soft delete and restore keeps content, never auto-reviews', async t => {
  const root = await makeRoot(t)
  const id = await draft(root, '草稿')
  await updateRequirement(root, id, { goal: 'g', scope: 's', acceptance: 'a' })
  const res = await trash(root, 'requirement', id)
  assert.match(res.data.location, /\.local\/trash/)
  assert.equal((await scanProject(root)).requirements.length, 0)
  await restore(root, { location: res.data.location })
  const req = (await scanProject(root)).requirements[0]
  assert.equal(req.id, id)
  assert.equal(req.status, 'backlog')
  assert.equal(req.goal, 'g')
})

test('restore rejects traversal, issue labels and a missing location', async t => {
  const root = await makeRoot(t)
  await initProject(root)
  await assert.rejects(restore(root, { location: '../../evil' }), e => e.code === 'INVALID_PATH')
  await assert.rejects(restore(root, { location: '.local/trash/x/req-20261112-aaaaaa__iss-20261112-bbbbbb' }), e => e.code === 'INVALID_PATH')
  await assert.rejects(restore(root, { location: '.local/trash/nope/req-20261112-aaaaaa' }), e => e.code === 'NOT_FOUND')
})

test('reopen: allocates IDs first, reopens + creates, same titles do not impersonate', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const a = await doneIssue(root, id, '任务甲')
  const b = await doneIssue(root, id, '任务乙')
  await submitRequirement(root, id, { summary: 's' })
  const res = await reopenRequirement(root, id, { reason: '打回修改', reopen: [a, b], create: [{ title: '同名新任务', fields: { problemOverview: '要补做的工作' } }, { title: '同名新任务', fields: { problemOverview: '第二份不同的工作' } }] })
  assert.equal(res.data.status, 'in_progress')
  assert.equal(res.data.items.length, 4)
  const idx = await scanProject(root)
  const req = idx.requirements[0]
  assert.equal(req.pendingReopen, null)
  assert.equal(req.issues.length, 4)
  const newOnes = req.issues.filter(i => i.title === '同名新任务')
  assert.equal(newOnes.length, 2)
  assert.notEqual(newOnes[0].id, newOnes[1].id)
  const atMs = res.data.reopenedAtMs
  for (const i of req.issues) {
    assert.equal(i.status, 'todo')
    assert.equal(i.deliveryStartedAt, atMs) // one shared reopen time
  }
  assert.ok(req.reviews.some(r => r.kind === 'acceptance' && r.decision === 'returned'))
})

test('reopen resumes after a mid-flow failure: IDs, count and delivery start stay stable', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const a = await doneIssue(root, id, '已完成')
  await submitRequirement(root, id, { summary: 's' })
  // Build a partially-completed plan: item 1 reopened, item 2 (create) pending.
  const plan = { at: new Date().toISOString(), atMs: Date.now(), reason: '打回', items: [
    { id: a, action: 'reopen', done: false },
    { id: 'iss-20261112-abcdef', action: 'create', title: '新任务', done: false },
  ] }
  const file = reqFile(root, id)
  await writeFile(file, (await readFile(file, 'utf8')).replace('status: pending', `status: in_progress\npendingReopen: "${JSON.stringify(plan).replace(/"/g, '\\"')}"`))
  const issuesDir = join(root, '.project', 'requirements', id, 'issues')
  await chmod(issuesDir, 0o500) // item 2 create cannot write
  try {
    await assert.rejects(reopenRequirement(root, id, {}), e => e.code === 'REOPEN_ITEM_FAILED' && /未完成/.test(e.message) && /iss-20261112-abcdef/.test(e.message))
  } finally { await chmod(issuesDir, 0o700) }
  let req = (await scanProject(root)).requirements[0]
  assert.equal(req.pendingReopen.items[1].done, false)
  assert.equal(req.issues.length, 1) // not created yet
  // Retry continues the SAME plan: no duplicate, same delivery start.
  const res = await reopenRequirement(root, id, {})
  assert.equal(res.data.reopenedAt, plan.at)
  req = (await scanProject(root)).requirements[0]
  assert.equal(req.pendingReopen, null)
  assert.equal(req.issues.length, 2)
  const created = req.issues.find(i => i.id === 'iss-20261112-abcdef')
  assert.equal(created.deliveryStartedAt, plan.atMs)
  assert.equal(req.issues.find(i => i.id === a).deliveryStartedAt, plan.atMs)
})

test('pendingReopen blocks acceptance submission until cleared', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const a = await doneIssue(root, id)
  await submitRequirement(root, id, { summary: 's' })
  // A partially-completed reopen leaves the plan in place.
  const plan = { at: new Date().toISOString(), atMs: Date.now(), reason: '打回', items: [{ id: a, action: 'reopen', done: false }] }
  const file = reqFile(root, id)
  await writeFile(file, (await readFile(file, 'utf8')).replace('status: pending', `status: in_progress\npendingReopen: "${JSON.stringify(plan).replace(/"/g, '\\"')}"`))
  await assert.rejects(submitRequirement(root, id, { summary: 's2' }), e => e.code === 'REOPEN_PENDING')
  // Finishing the reopen clears the plan; submission is allowed again.
  await reopenRequirement(root, id, {})
  assert.equal((await scanProject(root)).requirements[0].pendingReopen, null)
  await updateIssue(root, id, a, { resultSummary: '新结果', evidence: '新依据' }) // fresh result for the reopened delivery
  await moveDone(root, id, a)
  await submitRequirement(root, id, { summary: 's3' })
  assert.equal((await scanProject(root)).requirements[0].status, 'pending')
})

test('schema newer than supported is read-only', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const file = reqFile(root, id)
  await writeFile(file, (await readFile(file, 'utf8')).replace(`schema: ${SUPPORTED_SCHEMA}`, 'schema: 99'))
  await assert.rejects(updateRequirement(root, id, { next: 'x' }), e => e.code === 'SCHEMA_TOO_NEW')
  const idx = await scanProject(root)
  assert.equal(idx.requirements[0].readOnly, true)
  assert.ok(idx.diagnostics.some(d => d.code === 'SCHEMA_TOO_NEW'))
})

test('corrupt file degrades to diagnostic; sibling still loads', async t => {
  const root = await makeRoot(t)
  const good = await started(root, 'good')
  const { data: bad } = await createRequirement(root, 'bad')
  await writeFile(reqFile(root, bad.id), 'this is not frontmatter at all')
  const idx = await scanProject(root)
  assert.ok(idx.diagnostics.some(d => d.code === 'MISSING_FRONTMATTER'))
  assert.ok(idx.requirements.some(r => r.id === good))
  await assert.rejects(addRequirementUpdate(root, bad.id, '补充进展'), e => e.code === 'MISSING_FRONTMATTER')
  assert.equal(await readFile(reqFile(root, bad.id), 'utf8'), 'this is not frontmatter at all')
})

test('unknown requirement and task states remain readable but cannot be edited', async t => {
  const root = await makeRoot(t)
  const reqId = await started(root)
  const { data: { id } } = await createIssue(root, reqId, '任务')
  const task = issFile(root, reqId, id)
  const req = reqFile(root, reqId)
  const taskBytes = (await readFile(task, 'utf8')).replace('status: todo', 'status: unknown')
  const reqBytes = (await readFile(req, 'utf8')).replace('status: in_progress', 'status: unknown')
  await writeFile(task, taskBytes)
  await writeFile(req, reqBytes)

  const index = await scanProject(root)
  assert.equal(index.requirements[0].readOnly, true)
  assert.equal(index.requirements[0].issues[0].readOnly, true)
  assert.equal(index.diagnostics.filter(d => d.code === 'INVALID_STATUS').length, 2)
  await assert.rejects(updateRequirement(root, reqId, { title: '改需求' }), e => e.code === 'INVALID_STATUS')
  await assert.rejects(updateIssue(root, reqId, id, { title: '改任务' }), e => e.code === 'INVALID_STATUS')
  assert.equal(await readFile(req, 'utf8'), reqBytes)
  assert.equal(await readFile(task, 'utf8'), taskBytes)
})

test('path-traversal ids are rejected', async t => {
  const root = await makeRoot(t)
  await initProject(root)
  await assert.rejects(updateRequirement(root, '../../evil', { next: 'x' }), e => e.code === 'INVALID_ID')
  await assert.rejects(createIssue(root, '../../evil', 't'), e => e.code === 'INVALID_ID')
})

test('old-format task without deliveryStartedAt gets it backfilled on first start', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: iss } = await createIssue(root, id, '旧任务')
  // Strip the new field to simulate a pre-stage-2 file.
  const file = issFile(root, id, iss.id)
  await writeFile(file, (await readFile(file, 'utf8')).replace(/^deliveryStartedAt: \d+\n/m, ''))
  assert.equal((await scanProject(root)).requirements[0].issues[0].deliveryStartedAt, 0)
  await link(root, id, iss.id)
  await moveIssue(root, id, iss.id, 'doing')
  assert.ok((await scanProject(root)).requirements[0].issues[0].deliveryStartedAt > 0)
})

test('task/stamp returns mtime and a content hash that changes on edit', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: iss } = await createIssue(root, id, 't')
  const s1 = await taskStamp(root, id, iss.id)
  assert.ok(typeof s1.modified === 'number' && s1.hash.length > 0)
  await updateIssue(root, id, iss.id, { description: '变化' })
  const s2 = await taskStamp(root, id, iss.id)
  assert.notEqual(s2.hash, s1.hash)
})

test('validator surfaces >=10 distinct problem classes', async t => {
  const root = await makeRoot(t)
  await initProject(root)
  const reqs = join(root, '.project', 'requirements')
  const w = async (slug, fm, issues = []) => {
    await mkdir(join(reqs, slug, 'issues'), { recursive: true })
    await writeFile(join(reqs, slug, 'requirement.md'), fm)
    for (const [name, content] of issues) await writeFile(join(reqs, slug, 'issues', name), content)
  }
  const base = (id, over = {}) => {
    const f = { schema: 1, id, title: '"t"', status: 'backlog', created: '2026-11-12T10:00:00+08:00', updated: '2026-11-12T10:00:00+08:00', ...over }
    return '---\n' + Object.entries(f).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n'
  }
  const issue = (id, status, extra = '') => `---\nschema: 1\nid: ${id}\ntitle: "i"\nstatus: ${status}\n${extra}---\n`
  await w('req-20261112-aaaaaa', base('req-20261112-aaaaaa', { status: 'weird', updated: 'not-a-date' }))
  await w('req-20261112-bbbbbb', base('req-20261112-bbbbbb'), [['iss-20261112-cccccc.md', issue('iss-20261112-cccccc', 'todo')]])
  await w('req-20261112-dddddd', base('req-20261112-dddddd', { status: 'completed' }), [['iss-20261112-eeeeee.md', issue('iss-20261112-eeeeee', 'doing')]])
  await w('req-20261112-ffffff', base('req-20261112-ffffff', { status: 'in_progress', refs: '["/abs/path"]' }), [['iss-20261112-111111.md', issue('iss-20261112-111111', 'blocked')]])
  await w('req-20261112-444444', base('req-20261112-444444', { schema: 99 }))
  await w('req-20261112-555555', base('req-20261112-555555', { title: '""' }))
  await w('req-20261112-777777', 'no frontmatter here')
  await w('req-20261112-888888', base('req-20261112-aaaaaa'))
  await w('req-20261112-999999', base('req-20261112-abcd12'))
  const { data } = await validateProject(root)
  const codes = new Set(data.map(d => d.code))
  assert.ok(codes.size >= 10, `only ${codes.size} classes: ${[...codes].join(',')}`)
})

test('check CLI exits 0 on valid and 1 on invalid', async t => {
  const root = await makeRoot(t)
  await initProject(root)
  const { execFileSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const bin = fileURLToPath(new URL('../bin/check.js', import.meta.url))
  const okOut = execFileSync(process.execPath, [bin, root], { encoding: 'utf8' })
  assert.match(okOut, /OK/)
  await writeFile(reqFile(root, (await createRequirement(root, 'x')).data.id), 'broken')
  assert.throws(() => execFileSync(process.execPath, [bin, root], { encoding: 'utf8' }), e => e.status === 1)
})

test('scanProject ignores macOS AppleDouble (._*.md) in issues dir', async t => {
  const root = await makeRoot(t)
  const reqId = await started(root, 'exfat 幽灵 issue')
  const { data: iss } = await createIssue(root, reqId, '真 issue')
  const issuesDir = join(root, '.project', 'requirements', reqId, 'issues')
  await writeFile(join(issuesDir, `._${iss.id}.md`), 'AppleDouble metadata')
  const idx = await scanProject(root)
  const r = idx.requirements.find(x => x.id === reqId)
  assert.equal(r.issues.length, 1, 'phantom ._* issue must not be listed')
  assert.equal(r.issues[0].id, iss.id)
})

// ---- 返工 2：提交/确认/验收条件 ----

test('generic move cannot return a reviewed requirement to the pool', async t => {
  const root = await makeRoot(t)
  const id = await started(root) // in_progress, reviewed
  await assert.rejects(moveRequirement(root, id, 'backlog', { reason: 'x', confirmReviewInvalid: true }), e => e.code === 'REVIEW_INVALIDATION_REQUIRED')
  assert.equal((await scanProject(root)).requirements[0].status, 'in_progress')
  // The legitimate path is a substantive edit via updateRequirement.
  await updateRequirement(root, id, { goal: '新目标' }, { confirmReviewInvalid: true, reason: '改目标' })
  assert.equal((await scanProject(root)).requirements[0].status, 'backlog')
})

test('progress writes respect task and requirement read-only states', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const iss = await doneIssue(root, id)
  await assert.rejects(addIssueUpdate(root, id, iss, '终态后写进展'), e => e.code === 'TERMINAL_READ_ONLY')
  await submitRequirement(root, id, { summary: '交付摘要' })
  await assert.rejects(addRequirementUpdate(root, id, '待验收时写进展'), e => e.code === 'TERMINAL_READ_ONLY')
  await moveRequirement(root, id, 'completed')
  await assert.rejects(addRequirementUpdate(root, id, '完成后写进展'), e => e.code === 'TERMINAL_READ_ONLY')
})

test('after reopen, old evidence cannot re-confirm or resubmit; a new result can', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const a = await doneIssue(root, id)
  await submitRequirement(root, id, { summary: '旧摘要' })
  await reopenRequirement(root, id, { reason: '打回', reopen: [a] })
  // Old result is now stale: direct confirmation is rejected.
  await assert.rejects(confirmIssue(root, id, a, { fileHash: await issueFileHash(root, id, a) }), e => e.code === 'RESULT_STALE')
  // A new result makes it confirmable and submittable again.
  await updateIssue(root, id, a, { resultSummary: '新结果', evidence: '新依据' })
  await confirmIssue(root, id, a, { fileHash: await issueFileHash(root, id, a) })
  assert.equal((await submitRequirement(root, id, { summary: '新摘要' })).data.to, 'pending')
})

// ---- 返工 3：写入失败可恢复，决定恰好一条 ----

test('review-approve decision write failure recovers with exactly one record', async t => {
  const root = await makeRoot(t)
  const id = await draft(root)
  await updateRequirement(root, id, { goal: 'g', scope: 's', acceptance: 'a' })
  await saveReviewPrd(root, id)
  await moveRequirement(root, id, 'reviewing')
  const reviewsDir = join(root, '.project', 'requirements', id, 'reviews')
  await mkdir(reviewsDir, { recursive: true })
  await chmod(reviewsDir, 0o500)
  try {
    await assert.rejects(moveRequirement(root, id, 'ready'), e => e.code === 'EACCES')
  } finally { await chmod(reviewsDir, 0o700) }
  assert.equal((await scanProject(root)).requirements[0].status, 'reviewing') // not advanced
  await moveRequirement(root, id, 'ready') // retry
  const req = (await scanProject(root)).requirements[0]
  assert.equal(req.status, 'ready')
  assert.equal(req.reviews.filter(r => r.kind === 'review' && r.decision === 'approved').length, 1)
})

test('acceptance-pass decision write failure recovers with exactly one record', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  await doneIssue(root, id)
  await submitRequirement(root, id, { summary: 's' })
  const reviewsDir = join(root, '.project', 'requirements', id, 'reviews')
  await chmod(reviewsDir, 0o500)
  try {
    await assert.rejects(moveRequirement(root, id, 'completed', { opinion: '通过' }), e => e.code === 'EACCES')
  } finally { await chmod(reviewsDir, 0o700) }
  assert.equal((await scanProject(root)).requirements[0].status, 'pending')
  await moveRequirement(root, id, 'completed', { opinion: '通过' })
  const req = (await scanProject(root)).requirements[0]
  assert.equal(req.status, 'completed')
  assert.equal(req.reviews.filter(r => r.kind === 'acceptance' && r.decision === 'approved').length, 1)
})

test('reopen retry with the original fingerprint resumes the same plan and decision', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const a = await doneIssue(root, id)
  await submitRequirement(root, id, { summary: 's' })
  const originalHash = (await scanProject(root)).requirements[0].hash
  const issuesDir = join(root, '.project', 'requirements', id, 'issues')
  await chmod(issuesDir, 0o500) // item processing fails after the plan is saved
  try {
    await assert.rejects(reopenRequirement(root, id, { reason: '打回', reopen: [a], create: [{ title: '新', fields: { problemOverview: '要补做的工作' } }], fileHash: originalHash }), e => e.code === 'REOPEN_ITEM_FAILED')
  } finally { await chmod(issuesDir, 0o700) }
  assert.ok((await scanProject(root)).requirements[0].pendingReopen) // plan persisted
  await assert.rejects(reopenRequirement(root, id, { reason: '打回', reopen: [a],
    create: [{ title: '新', fields: { problemOverview: '另一个任务内容' } }] }), { code: 'REOPEN_CONFLICT' })
  // Retry with the SAME original fingerprint must not conflict (continuation).
  const res = await reopenRequirement(root, id, { reason: '打回', reopen: [a], create: [{ title: '新', fields: { problemOverview: '要补做的工作' } }], fileHash: originalHash })
  assert.equal(res.data.status, 'in_progress')
  const req = (await scanProject(root)).requirements[0]
  assert.equal(req.pendingReopen, null)
  assert.equal(req.issues.length, 2) // no duplicate
  assert.equal(req.issues.find(issue => issue.title === '新').problemOverview, '要补做的工作')
  assert.equal(req.reviews.filter(r => r.kind === 'acceptance' && r.decision === 'returned').length, 1)
})

test('two separate reopens with the same reason each record one decision', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const a = await doneIssue(root, id)
  await submitRequirement(root, id, { summary: 's' })
  await reopenRequirement(root, id, { reason: '打回', reopen: [a] })
  // Complete and submit again, then reopen a second time with the SAME reason.
  await updateIssue(root, id, a, { resultSummary: '二轮结果', evidence: '二轮依据' })
  await confirmIssue(root, id, a, { fileHash: await issueFileHash(root, id, a) })
  await submitRequirement(root, id, { summary: 's2' })
  await reopenRequirement(root, id, { reason: '打回', reopen: [a] })
  const req = (await scanProject(root)).requirements[0]
  assert.equal(req.reviews.filter(r => r.kind === 'acceptance' && r.decision === 'returned').length, 2)
})

test('reopen fails at the second item, names it, and resumes the same plan on retry', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const a = await doneIssue(root, id, '甲')
  const b = await doneIssue(root, id, '乙')
  await submitRequirement(root, id, { summary: 's' })
  // A saved plan whose second item will fail mid-flow (corrupt target file).
  const plan = { at: new Date().toISOString(), atMs: Date.now(), reason: '打回', items: [
    { id: a, action: 'reopen', done: false },
    { id: b, action: 'reopen', done: false },
  ] }
  const file = reqFile(root, id)
  await writeFile(file, (await readFile(file, 'utf8')).replace('status: pending', `status: in_progress\npendingReopen: "${JSON.stringify(plan).replace(/"/g, '\\"')}"`))
  const bFile = issFile(root, id, b)
  const bOriginal = await readFile(bFile, 'utf8')
  await writeFile(bFile, 'corrupt: no frontmatter')
  await assert.rejects(reopenRequirement(root, id, {}), e => e.code === 'REOPEN_ITEM_FAILED' && e.message.includes(b))
  let req = (await scanProject(root)).requirements[0]
  assert.equal(req.issues.find(i => i.id === a).status, 'todo') // first item done
  assert.equal(req.pendingReopen.items[1].done, false) // second pending
  // Fix the target and retry: same IDs, same delivery start, no duplicate.
  await writeFile(bFile, bOriginal)
  const res = await reopenRequirement(root, id, {})
  assert.equal(res.data.reopenedAt, plan.at)
  req = (await scanProject(root)).requirements[0]
  assert.equal(req.pendingReopen, null)
  assert.equal(req.issues.length, 2)
  for (const iid of [a, b]) assert.equal(req.issues.find(i => i.id === iid).deliveryStartedAt, plan.atMs)
})

// ---- 第二轮返工 2：半更新交付、旧事件补查、整轮新交付 ----

test('updating only result or only evidence leaves the other stale', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const a = await doneIssue(root, id)
  await submitRequirement(root, id, { summary: 's' })
  await reopenRequirement(root, id, { reason: '打回', reopen: [a] })
  // Only a new result: evidence is still from the previous delivery → stale.
  await updateIssue(root, id, a, { resultSummary: '新结果' })
  await assert.rejects(confirmIssue(root, id, a, { fileHash: await issueFileHash(root, id, a) }), e => e.code === 'RESULT_STALE')
  // Evidence written after the summary also requires re-checking that summary.
  await updateIssue(root, id, a, { evidence: '新依据' })
  await assert.rejects(confirmIssue(root, id, a, { fileHash: await issueFileHash(root, id, a) }), e => e.code === 'RESULT_STALE')
  await updateIssue(root, id, a, { resultSummary: '新结果（已核对新依据）' })
  assert.equal((await confirmIssue(root, id, a, { fileHash: await issueFileHash(root, id, a) })).data.to, 'done')
  // Guard-level: a fresh result with stale evidence is rejected symmetrically.
  const { canMoveIssue } = await import('../core/state.js')
  assert.equal(canMoveIssue({ from: 'in_review', to: 'done', requirementStatus: 'in_progress', result: 'r', evidence: 'e', acceptance: 'a', resultFresh: false }).code, 'RESULT_STALE')
})

test('a task with only unverified (待核实) records cannot be confirmed', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: iss } = await createIssue(root, id, '仅待核实')
  await updateIssue(root, id, iss.id, { problemOverview: 'p', triggerPath: 't', acceptance: 'a' })
  // Inject an objective section containing ONLY unverified lines.
  const file = issFile(root, id, iss.id)
  await writeFile(file, (await readFile(file, 'utf8')) + '\n## 处理结果\n\n### 客观记录（系统生成，请勿手改）\n- 待核实：src/x.js（补丁请求未确认完成，会话 s 第 9 条）\n')
  const issue = (await scanProject(root)).requirements[0].issues[0]
  assert.equal(issue.hasObjective, false) // unverified does not count as evidence
  await assert.rejects(confirmIssue(root, id, iss.id, { fileHash: await issueFileHash(root, id, iss.id) }), e => e.code === 'RESULT_EVIDENCE_REQUIRED')
})

test('an old done task cannot carry acceptance after another task is reopened', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const a = await doneIssue(root, id, '甲')
  await doneIssue(root, id, '乙')
  await submitRequirement(root, id, { summary: '旧摘要' })
  await reopenRequirement(root, id, { reason: '打回', reopen: [a] })
  // A legacy external edit can leave every task done without publishing a fresh result.
  const file = issFile(root, id, a)
  await writeFile(file, (await readFile(file, 'utf8')).replace('status: todo', 'status: done'))
  await assert.rejects(submitRequirement(root, id, { summary: '新摘要' }), { code: 'RESULT_EVIDENCE_REQUIRED' })
})

test('issue/continue is limited to in_review; resuming uses run/start', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const { data: iss } = await createIssue(root, id, 't')
  await link(root, id, iss.id)
  await moveIssue(root, id, iss.id, 'doing')
  await assert.rejects(continueIssue(root, id, iss.id, { text: '继续' }), e => e.code === 'INVALID_STATE')
})

// ---- 第二轮返工 3：决定与计划部分写入的一致性 ----

test('a saved plan with no recorded decision recovers exactly one decision', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const a = await doneIssue(root, id)
  await submitRequirement(root, id, { summary: 's' })
  // Plan persisted but decision write had not landed (reviewRound null).
  const plan = { at: new Date().toISOString(), atMs: Date.now(), reason: '打回', reviewRound: null,
    request: { reopen: [a], create: [] }, items: [{ id: a, action: 'reopen', done: false }] }
  const file = reqFile(root, id)
  await writeFile(file, (await readFile(file, 'utf8')).replace('status: pending', `status: in_progress\npendingReopen: "${JSON.stringify(plan).replace(/"/g, '\\"')}"`))
  await reopenRequirement(root, id, { reason: '打回', reopen: [a] })
  const req = (await scanProject(root)).requirements[0]
  assert.equal(req.pendingReopen, null)
  assert.equal(req.reviews.filter(r => r.kind === 'acceptance' && r.decision === 'returned').length, 1)
})

test('two review returns with the same reason record two decisions', async t => {
  const root = await makeRoot(t)
  const id = await draft(root)
  await updateRequirement(root, id, { goal: 'g', scope: 's', acceptance: 'a' })
  await saveReviewPrd(root, id)
  await moveRequirement(root, id, 'reviewing')
  await moveRequirement(root, id, 'backlog', { reason: '相同理由' })
  await moveRequirement(root, id, 'reviewing')
  await moveRequirement(root, id, 'backlog', { reason: '相同理由' })
  const req = (await scanProject(root)).requirements[0]
  assert.equal(req.reviews.filter(r => r.kind === 'review' && r.decision === 'returned').length, 2)
})

test('a different selection cannot hijack a pending reopen plan', async t => {
  const root = await makeRoot(t)
  const id = await started(root)
  const a = await doneIssue(root, id, '甲')
  const b = await doneIssue(root, id, '乙')
  await submitRequirement(root, id, { summary: 's' })
  const plan = { at: new Date().toISOString(), atMs: Date.now(), reason: '打回', reviewRound: 1,
    request: { reopen: [a], create: ['新任务'] },
    items: [{ id: a, action: 'reopen', done: false }, { id: 'iss-20261112-abcdef', action: 'create', title: '新任务', done: false }] }
  const file = reqFile(root, id)
  await writeFile(file, (await readFile(file, 'utf8')).replace('status: pending', `status: in_progress\npendingReopen: "${JSON.stringify(plan).replace(/"/g, '\\"')}"`))
  // A different selection conflicts.
  await assert.rejects(reopenRequirement(root, id, { reason: '打回', reopen: [b] }), e => e.code === 'REOPEN_CONFLICT')
  // Editing the requirement is also blocked while the plan is pending.
  await assert.rejects(updateRequirement(root, id, { goal: '新目标' }, { confirmReviewInvalid: true, reason: 'x' }), e => e.code === 'REOPEN_PENDING')
  // The original selection (or empty continuation) resumes the same plan.
  const res = await reopenRequirement(root, id, { reason: '打回', reopen: [a], create: [{ title: '新任务' }] })
  assert.equal(res.data.status, 'in_progress')
  assert.equal((await scanProject(root)).requirements[0].issues.length, 3)
})
