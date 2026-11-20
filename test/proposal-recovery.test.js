import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { makeRoot, seedAIReview, seedReviewPrd } from './util.js'

const originalRename = fs.rename
let failFile = null
let failWrite = 0
fs.rename = async (from, to) => {
  if (to === failFile && --failWrite === 0) {
    throw Object.assign(new Error('injected failure'), { code: 'EIO' })
  }
  return originalRename(from, to)
}
syncBuiltinESMExports()
const { dispatch } = await import('../core/rpc.js')
const signal = new AbortController().signal

for (const kind of ['field_draft', 'review']) {
  test(`proposal ${kind} retry after applied effect does not repeat it`, async t => {
    const root = await makeRoot(t)
    const call = (method, input = {}) => dispatch(method, { root, ...input }, signal)
    const ok = async (method, input) => {
      const result = await call(method, input)
      assert.equal(result.ok, true, JSON.stringify(result))
      return result.data
    }
    await ok('project/init')
    const { id: reqId } = await ok('requirement/create', { title: '需求', fields: { q_pain: '验证采用建议的重试' } })
    await ok('requirement/update', { id: reqId, patch: { goal: '目标', scope: '范围', acceptance: '标准' } })
    await seedReviewPrd(root, reqId)
    await ok('requirement/review', { id: reqId, action: 'submit' })
    await seedAIReview(root, reqId)
    let issueId
    if (kind === 'field_draft') {
      await ok('requirement/review', { id: reqId, action: 'approve' })
      await ok('requirement/startDev', { id: reqId })
      issueId = (await ok('issue/create', { reqId, title: '任务', fields: { problemOverview: '已有任务说明' } })).id
    }
    const target = issueId ? { reqId, issueId } : { reqId }
    const suggested_patch = issueId ? { problemOverview: '建议内容' } : { to: 'ready' }
    const { saved: [proposalId] } = await ok('sync/submit', { proposals: [{ kind, target, suggested_patch, reason: '原因', evidence: ['session://s/1'] }] })
    failFile = join(root, '.project', '.local', 'tmp', 'sync', proposalId + '.json')
    failWrite = 2
    const failed = await call('proposal/adopt', { proposalId })
    assert.equal(failed.ok, false)
    failFile = null
    if (issueId) {
      const task = (await ok('requirement/get', { id: reqId })).issues[0]
      await ok('issue/update', { reqId, id: issueId, patch: { problemOverview: '人工修订' }, fileHash: task.hash })
    }
    await ok('sync/apply', { proposalId })
    const req = await ok('requirement/get', { id: reqId })
    if (issueId) assert.equal(req.issues[0].problemOverview, '人工修订')
    else {
      assert.equal(req.status, 'ready')
      assert.equal(req.reviews.filter(r => r.decision === 'approved').length, 1)
    }
  })
}
