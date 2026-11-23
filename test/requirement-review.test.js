import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { installLinks } from '../core/link.js'
import { installRequirementReview } from '../core/requirement-review.js'
import { dispatch } from '../core/rpc.js'
import { savePrd } from '../core/prd.js'
import { saveAIReview } from '../core/store.js'
import { makeRoot, seedReviewPreparation, seedReviewPrd, stubSpawnHost, waitFor } from './util.js'

const reply = (text, stopReason = 'completed') => ({ stopReason, output: [{ type: 'text', text }] })

async function setup(t) {
  const root = await makeRoot(t)
  const { ctx, agents, children } = stubSpawnHost(root)
  const requests = []
  ctx.agentDefaultModel = { currentSelection: () => ({ provider: 'fake-model', model: 'fixture' }) }
  ctx.llm = { async *stream(options) {
    const response = await new Promise(resolve => requests.push({ options, prompt: options.messages[0].content[0].text, resolve }))
    yield { type: 'text-delta', index: 0, text: response.output[0].text }
    yield { type: 'finish', reason: { kind: response.stopReason === 'completed' ? 'stop' : response.stopReason } }
  } }
  const links = installLinks(ctx)
  const { routes } = installRequirementReview(ctx)
  const signal = new AbortController().signal
  const call = (method, input = {}) => dispatch(method, { root, ...input }, signal, { ...links.routes, ...routes })
  const ok = async (method, input) => {
    const result = await call(method, input)
    assert.equal(result.ok, true, JSON.stringify(result))
    return result.data
  }
  await ok('project/init', { name: '问候产品', goal: '清楚反馈输入错误' })
  const create = async (title, submit = true) => {
    const { id } = await ok('requirement/create', { title, fields: { q_pain: '输入空值时给出提示' } })
    if (submit) {
      await seedReviewPreparation(root, id)
      await ok('requirement/review', { id, action: 'submit' })
    }
    return id
  }
  const status = id => ok('requirement/review/status', { id })
  const waitState = async (id, state) => {
    let result
    await waitFor(async () => {
      result = await status(id)
      return result.state === state
    })
    return result
  }
  return { root, call, ok, create, status, waitState, agents, requests, children, links, ctx }
}

test('inline reviews deduplicate across workspace aliases, archive snapshots without a chat, and gate human approval', async t => {
  const { root, call, ok, create, status, waitState, agents, requests, children } = await setup(t)
  const id = await create('空输入提示', false)
  const other = await create('另一个需求', false)
  const prd = await savePrd(root, { id: 'prd-' + randomUUID(), reqIds: [id, other], markdown: '# 问候说明\n\n空输入提示。' })
  await seedReviewPreparation(root, id, { prd: false })
  await seedReviewPreparation(root, other, { prd: false })
  await ok('requirement/review', { id, action: 'submit' })
  await ok('requirement/review', { id: other, action: 'submit' })
  const alias = join(root, 'workspace-alias')
  await symlink(root, alias)
  // A human return is a history record, yet it takes no AI round number.
  await ok('requirement/review', { id, action: 'return', reason: '复核范围' })
  assert.equal((await call('requirement/review/start', { id, after: null })).code, 'REVIEW_NOT_ACTIVE')
  await ok('requirement/review', { id, action: 'submit' })
  assert.equal((await call('requirement/review', { id, action: 'approve' })).code, 'REVIEW_REPORT_REQUIRED')
  const [first, duplicate] = await Promise.all([root, alias].map(path => ok('requirement/review/start', { root: path, id, after: null })))
  assert.equal(first.state, 'running')
  assert.equal(duplicate.runId, first.runId)
  await waitFor(() => requests.length === 1)
  assert.deepEqual(requests[0].options.tools, [])
  assert.equal(requests[0].options.sessionId, undefined)
  assert.equal(requests[0].options.provider, 'fake-model')
  const prompt = requests[0].prompt
  for (const expected of ['问候产品', '第 1 次评审', '空输入提示', '只评审需求', '产品价值', '用户价值', '使用频率', '改造难度', prd.version]) {
    assert.ok(prompt.includes(expected), expected)
  }
  assert.ok(!prompt.includes('另一个需求'))
  assert.equal((await call('requirement/move', { id, to: 'ready' })).code, 'REVIEW_REPORT_REQUIRED')
  const changedPrd = await savePrd(root, { id: prd.id, version: prd.version, reqIds: prd.reqIds, markdown: '# 问候说明\n\n只提示纯空格输入。' })
  requests[0].resolve(reply('建议暂缓。频率待核实。'))
  // Only after the child finished do we ask for status, as if returning to the detail.
  const done = await waitState(id, 'done')
  assert.deepEqual(done.reports.map(item => item.opinion), ['建议暂缓。频率待核实。'])
  assert.equal(done.reports[0].source.prds[0].version, prd.version)
  assert.equal(done.reports[0].marker, first.runId)
  assert.equal(done.stale, true)
  const lateDuplicate = await ok('requirement/review/start', { id, after: null })
  assert.equal(lateDuplicate.state, 'done')
  assert.equal(requests.length, 1)
  assert.equal((await call('requirement/move', { id: other, to: 'ready' })).code, 'REVIEW_REPORT_REQUIRED')
  const second = await ok('requirement/review/start', { id, after: done.reports[0].marker })
  assert.notEqual(second.runId, first.runId)
  await waitFor(() => requests.length === 2)
  assert.match(requests[1].prompt, /第 2 次评审/)
  assert.ok(requests[1].prompt.includes(changedPrd.version))
  requests[1].resolve(reply('建议暂缓，先验证触发频率。'))
  const reviewed = await waitState(id, 'done')
  assert.equal(reviewed.reports.length, 2)
  assert.equal(reviewed.stale, false)
  await ok('requirement/update', { id, patch: { scope: '仅提示空值' } })
  assert.equal((await status(id)).stale, true)
  assert.equal((await call('requirement/review', { id, action: 'approve' })).code, 'REVIEW_REPORT_REQUIRED')
  await ok('requirement/review/start', { id, after: reviewed.reports[1].marker })
  await waitFor(() => requests.length === 3)
  requests[2].resolve(reply('建议推进。'))
  const final = await waitState(id, 'done')
  await ok('requirement/review', { id, action: 'approve', reviewMarker: final.reports[2].marker })
  const approved = await ok('requirement/get', { id })
  assert.equal(approved.status, 'ready')
  assert.equal(approved.reviews.filter(item => item.decision === 'approved' && item.by === 'human').length, 1)
  assert.deepEqual(approved.issues, [])
  assert.equal(approved.reviewTask, undefined)
  const issueDir = join(root, '.project', 'requirements', id, 'issues')
  assert.deepEqual(await readdir(issueDir).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return []
  }), [])
  assert.deepEqual((await ok('run/list')).runs, [])
  assert.equal(agents.size, 0)
  assert.equal(children.length, 0)
  assert.equal(approved.reviews.at(-1).source.reportMarker, final.reports[2].marker)
})

test('an interrupted reply is discarded and a failed save retries the complete report once', async t => {
  const { root, call, ok, create, status, waitState, requests } = await setup(t)
  const id = await create('保存评审')
  await ok('requirement/review/start', { id, after: null })
  await waitFor(() => requests.length === 1)
  requests[0].resolve(reply('被中断的回复', 'aborted'))
  assert.deepEqual((await waitState(id, 'failed')).reports, [])
  assert.equal((await call('requirement/move', { id, to: 'ready' })).code, 'REVIEW_REPORT_REQUIRED')
  const second = await ok('requirement/review/start', { id, after: null })
  await waitFor(() => requests.length === 2)
  assert.match(requests[1].prompt, /第 1 次评审/)
  const reviews = join(root, '.project', 'requirements', id, 'reviews')
  await writeFile(reviews, 'fixture obstructs the report directory')
  requests[1].resolve(reply('完整报告'))
  assert.equal((await waitState(id, 'save_failed')).reportsUnavailable, true)
  assert.equal((await call('requirement/move', { id, to: 'ready' })).ok, false)
  await rm(reviews)
  await ok('requirement/review/start', { id, retrySave: true, runId: 'stale' })
  assert.equal((await status(id)).state, 'save_failed')
  await Promise.all([0, 1].map(() => ok('requirement/review/start', { id, retrySave: true, runId: second.runId })))
  const done = await waitState(id, 'done')
  assert.equal(requests.length, 2)
  assert.deepEqual(done.reports.map(item => item.opinion), ['完整报告'])
  assert.equal(done.reports[0].marker, second.runId)
  assert.match(await readFile(join(reviews, '1.md'), 'utf8'), /by: ai/)
  assert.deepEqual(await readdir(reviews), ['1.md'])
})

test('old review reports remain readable, legacy tasks stay hidden, and rejection works with zero reports', async t => {
  const { root, ok, call, create, status, links } = await setup(t)
  const other = await create('未生成报告')
  await ok('requirement/move', { id: other, to: 'backlog', reason: '先厘清使用场景' })
  const rejected = await ok('requirement/get', { id: other })
  assert.equal(rejected.status, 'backlog')
  assert.equal(rejected.reviews[0].opinion, '先厘清使用场景')
  assert.deepEqual((await status(other)).reports, [])

  const id = await create('旧版需求')
  const issueId = 'iss-20261119-000001'
  const sessionId = 'session-legacy'
  const issueDir = join(root, '.project', 'requirements', id, 'issues')
  await mkdir(issueDir, { recursive: true })
  await writeFile(join(issueDir, issueId + '.md'), `---\nschema: 2\nid: ${issueId}\ntitle: "旧评审任务"\nstatus: todo\npurpose: requirement_review\n---\n`)
  await saveAIReview(root, id, { report: '旧版正式报告', requestId: 'legacy-round', source: { taskId: issueId, sessionId } })
  const linkFile = links.linkFile(root, sessionId)
  const runFile = links.runFile(root, issueId)
  await mkdir(join(linkFile, '..'), { recursive: true })
  await mkdir(join(runFile, '..'), { recursive: true })
  await writeFile(linkFile, JSON.stringify({ sessionId, issueId, reqId: id, purpose: 'requirement_review' }))
  await writeFile(runFile, JSON.stringify({ sessionId, runId: 'legacy-unsaved', state: 'save_failed', review: {} }))
  await ok('requirement/move', { id, to: 'backlog', reason: '可在需求池看历史' })
  assert.deepEqual((await status(id)).reports.map(record => record.opinion), ['旧版正式报告'])
  assert.deepEqual((await ok('requirement/get', { id })).issues, [])
  assert.deepEqual((await ok('run/list')).runs, [])
  assert.equal((await ok('link/get', { sessionId })).link, null)
  assert.equal((await call('run/start', { issueId, sessionId })).code, 'REVIEW_TASK_ONLY')
})

test('review entry and approval require a linked PRD, including requirements already under review', async t => {
  const { root, ok, call, create, status, waitState, requests } = await setup(t)
  const other = await create('另一条已有 PRD 的需求')
  const id = await create('历史需求待补 PRD', false)
  assert.equal((await call('requirement/review', { id, action: 'submit' })).code, 'REVIEW_PRD_REQUIRED')
  assert.equal((await call('requirement/move', { id, to: 'reviewing' })).code, 'REVIEW_PRD_REQUIRED')
  assert.equal((await ok('requirement/get', { id })).status, 'backlog')

  // A stored requirement may already be under review from a version with no PRD guard.
  const file = join(root, '.project', 'requirements', id, 'requirement.md')
  await writeFile(file, (await readFile(file, 'utf8')).replace('status: backlog', 'status: reviewing'))
  await seedReviewPreparation(root, id, { prd: false })
  await saveAIReview(root, id, { requestId: 'old-no-prd', report: '早期没有 PRD 的报告', source: { prds: [] } })
  assert.equal((await status(id)).hasPrd, false)
  assert.equal((await call('requirement/review/start', { id, after: 'old-no-prd' })).code, 'REVIEW_PRD_REQUIRED')
  assert.equal((await call('requirement/review', { id, action: 'approve' })).code, 'REVIEW_PRD_REQUIRED')
  assert.equal(requests.length, 0)
  const prd = await seedReviewPrd(root, id)
  assert.equal((await status(id)).hasReview, false)
  assert.equal((await call('requirement/review', { id, action: 'approve' })).code, 'REVIEW_REPORT_REQUIRED')
  await ok('requirement/review/start', { id, after: 'old-no-prd' })
  await waitFor(() => requests.length === 1)
  requests[0].resolve(reply('基于关联 PRD 的评审。'))
  assert.equal((await waitState(id, 'done')).hasReview, true)
  await savePrd(root, { ...prd, reqIds: [other] })
  await seedReviewPrd(root, id)
  assert.equal((await status(id)).hasReview, false)
  assert.equal((await call('requirement/move', { id, to: 'ready' })).code, 'REVIEW_REPORT_REQUIRED')
  assert.deepEqual((await status(id)).reports.map(report => report.opinion), ['早期没有 PRD 的报告', '基于关联 PRD 的评审。'])
})
