import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseFrontmatter } from '../core/frontmatter.js'
import * as store from '../core/store.js'
import { taskResult } from '../client-src/workbench-content.js'
import { makeRoot, issueFileHash, saveReviewPrd } from './util.js'

async function developingRequirement(root) {
  await store.initProject(root)
  const reqId = (await store.createRequirement(root, '需求')).data.id
  await store.updateRequirement(root, reqId, { goal: '目标', scope: '范围', acceptance: '标准' })
  await saveReviewPrd(root, reqId)
  for (const state of ['reviewing', 'ready', 'in_progress']) await store.moveRequirement(root, reqId, state)
  return reqId
}

async function objectiveRecord(root, reqId, issueId) {
  const file = join(root, '.project', 'requirements', reqId, 'issues', issueId + '.md')
  const doc = parseFrontmatter(await readFile(file, 'utf8'))
  store.appendObjective(doc, ['- 执行命令：pwd（结果 ok，会话 test 第 1 条）'])
  doc.setPlain('objectiveAt', Date.now())
  await writeFile(file, doc.toString())
}

test('objective records supply evidence but never substitute for a result summary', async t => {
  const root = await makeRoot(t)
  const reqId = await developingRequirement(root)
  const issueId = (await store.createIssue(root, reqId, '任务')).data.id
  await store.updateIssue(root, reqId, issueId, { acceptance: '标准' })
  await objectiveRecord(root, reqId, issueId)
  const confirm = () => issueFileHash(root, reqId, issueId).then(fileHash => store.confirmIssue(root, reqId, issueId, { fileHash }))
  await assert.rejects(confirm(), { code: 'RESULT_EVIDENCE_REQUIRED' })

  await store.updateIssue(root, reqId, issueId, { resultSummary: '完成的结果' })
  await store.updateIssue(root, reqId, issueId, { resultSummary: '' })
  await assert.rejects(confirm(), { code: 'RESULT_EVIDENCE_REQUIRED' })

  await store.updateIssue(root, reqId, issueId, { resultSummary: '本次完成的结果' })
  await confirm()
  assert.equal((await store.submitRequirement(root, reqId, { summary: '交付' })).data.to, 'pending')
})

test('new objective evidence after a result requires a new summary before confirmation', async t => {
  const root = await makeRoot(t)
  const reqId = await developingRequirement(root)
  const issueId = (await store.createIssue(root, reqId, '任务')).data.id
  await store.updateIssue(root, reqId, issueId, { acceptance: '标准', resultSummary: '文件未创建' })
  const realNow = Date.now
  let now = 1900000000000
  Date.now = () => now
  try {
    const createdAt = new Date(now + 1000).toISOString()
    await store.appendObjectiveSync(root, reqId, issueId, { sid: 'test', entries: [
      { seq: 1, line: `- 改动文件：demo.txt（write，会话 test 第 1 条，${createdAt}）` },
    ] })
    let issue = (await store.scanProject(root)).requirements[0].issues[0]
    assert.equal(issue.resultFresh, false)
    assert.equal(taskResult(issue).summary, '')
    assert.equal(taskResult(issue).previousSummary, '文件未创建')
    await assert.rejects(store.confirmIssue(root, reqId, issueId, { fileHash: issue.hash }), { code: 'RESULT_STALE' })
    now += 2000
    issue = (await store.scanProject(root)).requirements[0].issues[0]
    await store.updateIssue(root, reqId, issueId, { resultSummary: '文件已创建，内容已核对', evidence: '' }, { recordResult: true, fileHash: issue.hash })
    issue = (await store.scanProject(root)).requirements[0].issues[0]
    assert.equal(issue.resultFresh, true)
    await store.confirmIssue(root, reqId, issueId, { fileHash: issue.hash })
  } finally { Date.now = realNow }
})

test('fresh objective evidence cannot make a previous delivery result fresh', async t => {
  const root = await makeRoot(t)
  const reqId = await developingRequirement(root)
  const issueId = (await store.createIssue(root, reqId, '任务')).data.id
  await store.updateIssue(root, reqId, issueId, { resultSummary: '旧结果', evidence: '旧依据' })
  await store.confirmIssue(root, reqId, issueId, { fileHash: await issueFileHash(root, reqId, issueId) })
  await store.submitRequirement(root, reqId, { summary: '旧交付' })
  // An earlier timestamp makes the previous delivery unambiguously older than reopen.
  const file = join(root, '.project', 'requirements', reqId, 'issues', issueId + '.md')
  const doc = parseFrontmatter(await readFile(file, 'utf8'))
  doc.setPlain('resultAt', 1)
  await writeFile(file, doc.toString())
  await store.reopenRequirement(root, reqId, { reason: '补充结果', reopen: [issueId] })
  await objectiveRecord(root, reqId, issueId)
  const confirm = () => issueFileHash(root, reqId, issueId).then(fileHash => store.confirmIssue(root, reqId, issueId, { fileHash }))
  await assert.rejects(confirm(), { code: 'RESULT_STALE' })
  await store.updateIssue(root, reqId, issueId, { resultSummary: '新结果' })
  await confirm()
  assert.equal((await store.submitRequirement(root, reqId, { summary: '新交付' })).data.to, 'pending')
})

test('generic move requires modification request, while a substantive edit invalidates the result', async t => {
  const root = await makeRoot(t)
  const reqId = await developingRequirement(root)
  const issueId = (await store.createIssue(root, reqId, '任务')).data.id
  await store.updateIssue(root, reqId, issueId, { acceptance: '标准', resultSummary: '结果', evidence: '依据' })
  // An in-review result may also be supplied by an existing active session.
  const file = join(root, '.project', 'requirements', reqId, 'issues', issueId + '.md')
  const doc = parseFrontmatter(await readFile(file, 'utf8'))
  doc.setPlain('status', 'doing')
  await writeFile(file, doc.toString())
  await store.moveIssue(root, reqId, issueId, 'in_review')
  await assert.rejects(store.moveIssue(root, reqId, issueId, 'doing'), { code: 'REASON_REQUIRED' })
  const result = await store.updateIssue(root, reqId, issueId, { acceptance: '调整后的标准' })
  assert.equal(result.data.invalidated, true)
  const issue = (await store.scanProject(root)).requirements[0].issues[0]
  assert.equal(issue.status, 'doing')
})

test('reopening a task in the same millisecond does not reuse its previous result', async t => {
  const root = await makeRoot(t)
  const reqId = await developingRequirement(root)
  const issueId = (await store.createIssue(root, reqId, '任务')).data.id
  const now = Date.now
  Date.now = () => 1900000000000
  try {
    await store.updateIssue(root, reqId, issueId, { resultSummary: '旧结果', evidence: '旧依据' })
    await store.confirmIssue(root, reqId, issueId, { fileHash: await issueFileHash(root, reqId, issueId) })
    await store.moveIssue(root, reqId, issueId, 'todo', { reason: '重新处理' })
    await assert.rejects(store.confirmIssue(root, reqId, issueId, { fileHash: await issueFileHash(root, reqId, issueId) }), { code: 'RESULT_STALE' })
    await store.updateIssue(root, reqId, issueId, { resultSummary: '新结果', evidence: '新依据' })
    await store.confirmIssue(root, reqId, issueId, { fileHash: await issueFileHash(root, reqId, issueId) })
  } finally {
    Date.now = now
  }
})

test('reopened task keeps prior limits as unverified history until explicitly replaced', async t => {
  const root = await makeRoot(t)
  const reqId = await developingRequirement(root)
  const id = (await store.createIssue(root, reqId, '任务')).data.id
  const read = async () => (await store.scanProject(root)).requirements[0].issues[0]
  const now = Date.now
  Date.now = () => 1900000000000
  try {
    await store.updateIssue(root, reqId, id, { acceptance: '标准', resultSummary: '旧结果', evidence: '旧依据', knownLimits: '旧限制第一行\n第二行' })
    const before = await read()
    assert.ok(before.knownLimitsAt > 0)
    await store.confirmIssue(root, reqId, id, { fileHash: await issueFileHash(root, reqId, id) })
    await store.submitRequirement(root, reqId, { summary: '旧交付' })
    await store.reopenRequirement(root, reqId, { reason: '再次核验', reopen: [id] })
    let issue = await read()
    assert.ok(issue.deliveryStartedAt > before.knownLimitsAt)
    assert.equal(taskResult(issue).unverifiedLimits, '旧限制第一行\n第二行')
    await store.updateIssue(root, reqId, id, { title: '只改标题' })
    issue = await read()
    assert.equal(issue.knownLimitsAt, before.knownLimitsAt)
    assert.equal(issue.knownLimits, '旧限制第一行\n第二行')
    await assert.rejects(store.updateIssue(root, reqId, id, { resultSummary: '新结果', evidence: '新依据', knownLimits: '新限制' },
      { recordResult: true, fileHash: 'stale' }), { code: 'CONFLICT' })
    assert.equal((await read()).knownLimits, '旧限制第一行\n第二行')
    await store.updateIssue(root, reqId, id, { resultSummary: '新结果', evidence: '新依据' },
      { recordResult: true, fileHash: await issueFileHash(root, reqId, id) })
    issue = await read()
    assert.equal(taskResult(issue).limits, '')
    assert.equal(taskResult(issue).unverifiedLimits, '旧限制第一行\n第二行')
    await store.updateIssue(root, reqId, id, { resultSummary: '新结果', evidence: '新依据', knownLimits: '新限制' },
      { recordResult: true, fileHash: await issueFileHash(root, reqId, id) })
    issue = await read()
    assert.equal(taskResult(issue).limits, '新限制')
    assert.equal(taskResult(issue).unverifiedLimits, '')
    assert.ok(issue.knownLimitsAt >= issue.deliveryStartedAt)
    assert.ok(issue.activity.some(entry => entry.includes('旧限制第一行\n第二行')))
    await store.updateIssue(root, reqId, id, { resultSummary: '再次记录', evidence: '新依据' },
      { recordResult: true, fileHash: await issueFileHash(root, reqId, id) })
    assert.equal((await read()).knownLimits, '新限制')
  } finally { Date.now = now }
})

test('a requirement reopened in the same millisecond cannot use an unrelated old done task', async t => {
  const root = await makeRoot(t)
  const reqId = await developingRequirement(root)
  const now = Date.now
  Date.now = () => 1900000000000
  try {
    const first = (await store.createIssue(root, reqId, '甲')).data.id
    const second = (await store.createIssue(root, reqId, '乙')).data.id
    for (const id of [first, second]) {
      await store.updateIssue(root, reqId, id, { resultSummary: '旧结果', evidence: '旧依据' })
      await store.confirmIssue(root, reqId, id, { fileHash: await issueFileHash(root, reqId, id) })
    }
    await store.submitRequirement(root, reqId, { summary: '旧交付' })
    await store.reopenRequirement(root, reqId, { reason: '修改', reopen: [first] })
    const file = join(root, '.project', 'requirements', reqId, 'issues', `${first}.md`)
    await writeFile(file, (await readFile(file, 'utf8')).replace('status: todo', 'status: done'))
    await assert.rejects(store.submitRequirement(root, reqId, { summary: '新交付' }), { code: 'RESULT_EVIDENCE_REQUIRED' })
    const third = (await store.createIssue(root, reqId, '新任务')).data.id
    await store.updateIssue(root, reqId, third, { resultSummary: '新结果', evidence: '新依据' })
    await store.confirmIssue(root, reqId, third, { fileHash: await issueFileHash(root, reqId, third) })
    assert.equal((await store.submitRequirement(root, reqId, { summary: '新交付' })).data.to, 'pending')
  } finally {
    Date.now = now
  }
})

test('re-review uses the later requirement round for result and verification, even in the same millisecond', async t => {
  const root = await makeRoot(t)
  const realNow = Date.now
  let now = 1900000000000
  Date.now = () => now
  try {
    const reqId = await developingRequirement(root)
    const issueId = (await store.createIssue(root, reqId, '重审中的任务')).data.id
    await store.updateIssue(root, reqId, issueId, { acceptance: '结果可核验' })
    await store.recordRunStart(root, reqId, issueId)
    let req = (await store.scanProject(root)).requirements[0]
    const oldStart = req.issues[0].deliveryStartedAt
    const oldTime = new Date(oldStart + 1).toISOString()
    await store.appendObjectiveSync(root, reqId, issueId, { sid: 'test', entries: [
      { seq: 1, line: `- 执行命令：node --test old.test（结果 ok，测试结论 passed，测试摘要 # fail 0，会话 test 第 1 条，${oldTime}）` },
    ] })
    await store.updateIssue(root, reqId, issueId, { resultSummary: '旧轮结果', knownLimits: '旧轮限制' })
    await store.updateRequirement(root, reqId, { goal: '修改后的目标' }, { confirmReviewInvalid: true, reason: '需求改变' })
    for (const state of ['reviewing', 'ready', 'in_progress']) await store.moveRequirement(root, reqId, state)
    req = (await store.scanProject(root)).requirements[0]
    let issue = req.issues[0]
    assert.equal(issue.status, 'doing')
    assert.equal(issue.deliveryStartedAt, oldStart)
    assert.ok(req.deliveryStartedAt > oldStart + 1)
    assert.equal(issue.verification.passed, 0)
    assert.equal(taskResult(issue).unverifiedLimits, '旧轮限制')
    const hash = () => issueFileHash(root, reqId, issueId)
    await assert.rejects(store.updateIssue(root, reqId, issueId, { resultSummary: '新结果', evidence: '' }, { recordResult: true, fileHash: await hash() }), { code: 'RESULT_EVIDENCE_REQUIRED' })
    await assert.rejects(store.submitIssueResult(root, reqId, issueId, { summary: '新结果', fileHash: await hash() }), { code: 'RESULT_STALE' })
    await assert.rejects(store.confirmIssue(root, reqId, issueId, { summary: '新结果', fileHash: await hash() }), { code: 'RESULT_STALE' })
    const newTime = new Date(req.deliveryStartedAt + 1).toISOString()
    now = req.deliveryStartedAt + 2
    await store.appendObjectiveSync(root, reqId, issueId, { sid: 'test', entries: [
      { seq: 2, line: `- 执行命令：node --test new.test（结果 ok，测试结论 passed，测试摘要 # fail 0，会话 test 第 2 条，${newTime}）` },
    ] })
    await store.updateIssue(root, reqId, issueId, { resultSummary: '新结果', evidence: '' }, { recordResult: true, fileHash: await hash() })
    issue = (await store.scanProject(root)).requirements[0].issues[0]
    assert.equal(issue.verification.passed, 1)
    assert.ok(issue.resultAt >= req.deliveryStartedAt)
    assert.equal(issue.resultScopeAt, req.deliveryStartedAt)
    await store.confirmIssue(root, reqId, issueId, { fileHash: await hash() })
  } finally { Date.now = realNow }
})

test('legacy multiline limits and evidence remain readable after replacement and explicit clearing', async t => {
  const root = await makeRoot(t)
  const reqId = await developingRequirement(root)
  const id = (await store.createIssue(root, reqId, '历史资料')).data.id
  const oldLimits = '第一段\n\n- 列表一\n- 列表二\n\n最后一段'
  const oldEvidence = '旧依据第一段\n\n- 步骤一\n- 步骤二'
  await store.updateIssue(root, reqId, id, { resultSummary: '旧结果', evidence: oldEvidence, knownLimits: oldLimits })
  const file = join(root, '.project', 'requirements', reqId, 'issues', `${id}.md`)
  const legacy = parseFrontmatter(await readFile(file, 'utf8'))
  legacy.setPlain('knownLimitsAt', 0)
  await writeFile(file, legacy.toString())
  const read = async () => (await store.scanProject(root)).requirements[0].issues[0]
  assert.equal(taskResult(await read()).unverifiedLimits, oldLimits)
  await assert.rejects(store.updateIssue(root, reqId, id, { knownLimits: '', evidence: '新依据' }, { fileHash: 'stale' }), { code: 'CONFLICT' })
  await store.updateIssue(root, reqId, id, { knownLimits: '', evidence: '新依据' }, { fileHash: await issueFileHash(root, reqId, id) })
  const issue = await read()
  assert.equal(issue.knownLimits, '')
  assert.equal(issue.activity.filter(entry => entry.includes('此前记录的限制')).length, 1)
  assert.ok(issue.activity.some(entry => entry.endsWith(oldLimits)))
  assert.ok(issue.activity.some(entry => entry.endsWith(oldEvidence)))
})
