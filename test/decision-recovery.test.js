import { reviewPrds, savePrd } from '../core/prd.js'
import { reviewMaterial } from '../core/review-material.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { makeRoot, seedAIReview, issueFileHash, seedReviewPrd } from './util.js'
import * as store from '../core/store.js'
import { dispatch } from '../core/rpc.js'

const rename = fs.rename
let fault = null
fs.rename = async (from, to) => {
  if (fault && fault.target(to) && --fault.remaining === 0) {
    fault = null
    throw Object.assign(new Error('injected write failure'), { code: 'EIO' })
  }
  return rename(from, to)
}
syncBuiltinESMExports()

async function makeRequirement(t, developing = false) {
  const root = await makeRoot(t)
  await store.initProject(root)
  const id = (await store.createRequirement(root, '需求')).data.id
  await store.updateRequirement(root, id, { goal: '目标', scope: '范围', acceptance: '标准' })
  await seedReviewPrd(root, id)
  await store.moveRequirement(root, id, 'reviewing')
  if (developing) {
    await seedAIReview(root, id)
    await store.moveRequirement(root, id, 'ready')
    await store.moveRequirement(root, id, 'in_progress')
  }
  return { root, id, file: join(root, '.project', 'requirements', id, 'requirement.md') }
}

test('a failed approval cannot turn a different decision into approval', async t => {
  const { root, id } = await makeRequirement(t)
  await seedAIReview(root, id)
  const beforeEdit = (await store.scanProject(root)).requirements[0]
  await store.updateRequirement(root, id, { acceptance: '核对新标准' })
  await assert.rejects(store.moveRequirement(root, id, 'ready', { fileHash: beforeEdit.hash }), { code: 'CONFLICT' })
  await seedAIReview(root, id)
  const current = (await store.scanProject(root)).requirements[0]
  const options = { opinion: '同意', fileHash: current.hash }
  fault = { target: path => path.endsWith('/reviews/1.md'), remaining: 1 }
  await assert.rejects(store.moveRequirement(root, id, 'ready', options), { code: 'EIO' })
  await assert.rejects(store.moveRequirement(root, id, 'backlog', { reason: '退回' }), { code: 'DECISION_PENDING' })
  await store.moveRequirement(root, id, 'ready', options)
  const req = (await store.scanProject(root)).requirements[0]
  assert.equal(req.status, 'ready')
  assert.deepEqual(req.reviews.filter(r => r.kind === 'review').map(r => r.decision), ['approved'])
})

test('a retried approval records the new review marker when the PRD changed after a failed decision write', async t => {
  const { root, id } = await makeRequirement(t)
  await seedAIReview(root, id)
  fault = { target: path => path.endsWith('/reviews/1.md'), remaining: 1 }
  await assert.rejects(store.moveRequirement(root, id, 'ready', { reviewMarker: 'test-ai-review' }), { code: 'EIO' })
  const [prd] = await reviewPrds(root, id)
  const edited = await savePrd(root, { ...prd, markdown: '# 更新后的 PRD' })
  const { source } = await reviewMaterial(root, await store.readRequirement(root, id), [edited])
  await store.saveAIReview(root, id, { report: '建议推进', requestId: 'updated-report', source })
  await store.moveRequirement(root, id, 'ready', { reviewMarker: 'updated-report' })
  const { reviews } = (await store.scanProject(root)).requirements[0]
  assert.equal(reviews.filter(record => record.kind === 'review').length, 1)
  assert.equal(reviews.at(-1).source.reportMarker, 'updated-report')
})

test('failed invalidation preserves reviewed content and retries with original fingerprint', async t => {
  const { root, id } = await makeRequirement(t, true)
  const original = (await store.scanProject(root)).requirements[0]
  fault = { target: path => path.endsWith('/reviews/2.md'), remaining: 1 }
  const options = { confirmReviewInvalid: true, reason: '调整目标', fileHash: original.hash }
  await assert.rejects(store.updateRequirement(root, id, { goal: '新目标' }, options), { code: 'EIO' })
  let req = (await store.scanProject(root)).requirements[0]
  assert.equal(req.goal, '目标')
  assert.equal(req.status, 'in_progress')
  await store.updateRequirement(root, id, { goal: '新目标' }, options)
  req = (await store.scanProject(root)).requirements[0]
  assert.equal(req.goal, '新目标')
  assert.equal(req.status, 'backlog')
  assert.equal(req.reviews.filter(r => r.decision === 'returned').length, 1)
})

test('human acceptance retries a partially written decision with a refreshed reviewed fingerprint', async t => {
  const { root, id } = await makeRequirement(t, true)
  const issueId = (await store.createIssue(root, id, '任务')).data.id
  await store.updateIssue(root, id, issueId, { resultSummary: '结果', evidence: '依据' })
  await store.confirmIssue(root, id, issueId, { fileHash: await issueFileHash(root, id, issueId) })
  await store.submitRequirement(root, id, { summary: '交付摘要' })
  const read = async () => (await store.scanProject(root)).requirements[0]
  const call = input => dispatch('requirement/move', input, new AbortController().signal)
  let shown = await read()
  const original = { root, id, to: 'completed', fileHash: shown.hash, expectFingerprint: store.deliveryFingerprint(shown) }
  fault = { target: path => path.endsWith('/reviews/2.md'), remaining: 1 }
  assert.equal((await call(original)).code, 'READ_FAILED')
  assert.equal((await read()).status, 'pending')
  // The saved recovery marker itself changes the fingerprint, requiring one
  // fresh review, but retry must continue the same decision exactly once.
  assert.equal((await call(original)).code, 'ROUND_CHANGED')
  shown = await read()
  assert.equal((await call({ ...original, fileHash: shown.hash, expectFingerprint: store.deliveryFingerprint(shown) })).ok, true)
  const result = await read()
  assert.equal(result.status, 'completed')
  assert.equal(result.reviews.filter(r => r.kind === 'acceptance' && r.decision === 'approved').length, 1)
})

test('reopen preserves multiline decision and completed item through a plan write failure', async t => {
  const { root, id, file } = await makeRequirement(t, true)
  const issueId = (await store.createIssue(root, id, '任务')).data.id
  await store.updateIssue(root, id, issueId, { resultSummary: '旧结果', evidence: '旧依据' })
  await store.confirmIssue(root, id, issueId, { fileHash: await issueFileHash(root, id, issueId) })
  await store.submitRequirement(root, id, { summary: '原摘要' })
  const original = (await store.scanProject(root)).requirements[0]
  const request = { reason: '需要调整\n\n## 细节\n请补充', reopen: [issueId], fileHash: original.hash }
  fault = { target: path => path === file, remaining: 2 }
  await assert.rejects(store.reopenRequirement(root, id, request), { code: 'EIO' })
  await assert.rejects(store.submitRequirement(root, id, { summary: '不应保存' }), { code: 'REOPEN_PENDING' })
  await store.reopenRequirement(root, id, request)
  let req = (await store.scanProject(root)).requirements[0]
  const returned = req.reviews.filter(r => r.kind === 'acceptance' && r.decision === 'returned')
  assert.equal(returned.length, 1)
  assert.equal(returned[0].opinion, request.reason)
  assert.equal(returned[0].summary, '原摘要')

  await store.updateIssue(root, id, issueId, { resultSummary: '新结果', evidence: '新依据' })
  await store.confirmIssue(root, id, issueId, { fileHash: await issueFileHash(root, id, issueId) })
  await store.submitRequirement(root, id, { summary: '第二摘要' })
  const secondHash = (await store.scanProject(root)).requirements[0].hash
  fault = { target: path => path === file, remaining: 3 }
  await assert.rejects(store.reopenRequirement(root, id, { reason: '再次打回', reopen: [issueId], fileHash: secondHash }),
    error => error.code === 'REOPEN_ITEM_FAILED' && error.message.includes(issueId))
  await store.moveIssue(root, id, issueId, 'cancelled', { reason: '改为取消' })
  await store.reopenRequirement(root, id, { reason: '再次打回', reopen: [issueId], fileHash: secondHash })
  req = (await store.scanProject(root)).requirements[0]
  assert.equal(req.issues[0].status, 'cancelled')
  assert.equal(req.pendingReopen, null)
})
