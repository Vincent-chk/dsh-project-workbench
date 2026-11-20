// Stage-5 acceptance rework: human submissions bind to the exact requirement +
// task content the user reviewed, and terminal tasks accept order-only moves.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, seedAIReview, issueFileHash, seedReviewPrd } from './util.js'
import { scanProject, initProject, createRequirement, updateRequirement, moveRequirement,
  createIssue, updateIssue, moveIssue, submitRequirement, deliveryFingerprint } from '../core/store.js'
import { deliveryFingerprint as clientFingerprint } from '../client-src/project-state.js'

// External drift the guards cannot block (AI objective sync, other tools, git):
// rewrite the task file with a changed updated stamp, keeping it parseable.
async function touchTask(root, reqId, id) {
  const file = join(root, '.project', 'requirements', reqId, 'issues', `${id}.md`)
  const raw = await readFile(file, 'utf8')
  await writeFile(file, raw.replace(/^updated: .+$/m, 'updated: 2026-11-16T12:00:00.000Z'))
}

async function started(root, title = '需求') {
  await initProject(root)
  const { data } = await createRequirement(root, title)
  const id = data.id
  await updateRequirement(root, id, { goal: '目标', scope: '范围', acceptance: '完成标准' })
  await seedReviewPrd(root, id)
  await moveRequirement(root, id, 'reviewing')
  await seedAIReview(root, id)
  await moveRequirement(root, id, 'ready')
  await moveRequirement(root, id, 'in_progress')
  return id
}
async function doneTask(root, reqId, title = '任务') {
  const { data } = await createIssue(root, reqId, title)
  await updateIssue(root, reqId, data.id, { problemOverview: 'p', acceptance: 'a', resultSummary: '结果', evidence: '依据' })
  await moveIssue(root, reqId, data.id, 'done', { fileHash: await issueFileHash(root, reqId, data.id) })
  return data.id
}

test('terminal task: content stays read-only but a human order-only move persists', async t => {
  const root = await makeRoot(t)
  const reqId = await started(root)
  const a = await doneTask(root, reqId, 'A')
  const { data: b } = await createIssue(root, reqId, 'B')
  await updateIssue(root, reqId, b.id, { problemOverview: 'p', acceptance: 'a' })
  await assert.rejects(updateIssue(root, reqId, a, { title: '改标题' }), e => e.code === 'TERMINAL_READ_ONLY')
  await assert.rejects(updateIssue(root, reqId, a, { order: 5, title: 'x' }), e => e.code === 'TERMINAL_READ_ONLY')
  await assert.rejects(updateIssue(root, reqId, a, { order: 5 }, { actor: 'ai' }), e => e.code === 'TERMINAL_READ_ONLY')
  // Human list reorder: order-only patch on the done task lands and persists.
  await updateIssue(root, reqId, a, { order: 9 }, { fileHash: await issueFileHash(root, reqId, a) })
  const issue = (await scanProject(root)).requirements.find(r => r.id === reqId).issues.find(i => i.id === a)
  assert.equal(issue.order, 9)
  assert.equal(issue.status, 'done')
  assert.equal(issue.resultSummary, '结果') // untouched content
})

test('manual delivery submit: stale task content rejects, fresh fingerprint submits', async t => {
  const root = await makeRoot(t)
  const reqId = await started(root)
  const iss = await doneTask(root, reqId)
  const view = async () => (await scanProject(root)).requirements.find(r => r.id === reqId)
  const shown = deliveryFingerprint(await view())
  // The user fills the summary; meanwhile the task content changes externally.
  await touchTask(root, reqId, iss)
  await assert.rejects(
    submitRequirement(root, reqId, { summary: '交付摘要', expectFingerprint: shown, actor: 'human' }),
    e => e.code === 'ROUND_CHANGED')
  assert.equal((await view()).status, 'in_progress') // NOT auto-advanced on rejection
  // Re-check the new content, then submit with the matching fingerprint.
  await submitRequirement(root, reqId, { summary: '交付摘要', expectFingerprint: deliveryFingerprint(await view()), actor: 'human' })
  assert.equal((await view()).status, 'pending')
})

test('acceptance confirm: task or requirement drift rejects; unchanged content passes', async t => {
  const root = await makeRoot(t)
  const reqId = await started(root)
  const iss = await doneTask(root, reqId)
  await submitRequirement(root, reqId, { summary: '交付摘要', actor: 'human' })
  const view = async () => (await scanProject(root)).requirements.find(r => r.id === reqId)
  // Task changed after the confirm window opened → the reviewed fingerprint is stale.
  const shown = await view()
  const fp = deliveryFingerprint(shown)
  await touchTask(root, reqId, iss)
  await assert.rejects(
    moveRequirement(root, reqId, 'completed', { fileHash: (await view()).hash, expectFingerprint: fp, actor: 'human' }),
    e => e.code === 'ROUND_CHANGED')
  assert.equal((await view()).status, 'pending')
  // Requirement content differs from what was opened (e.g. stamped by another
  // write) → the plain content hash check already refuses the stale page.
  await assert.rejects(
    moveRequirement(root, reqId, 'completed', { fileHash: 'stale-hash', expectFingerprint: fp, actor: 'human' }),
    e => e.code === 'CONFLICT')
  // Unchanged content → confirm succeeds exactly once.
  const fresh = await view()
  await moveRequirement(root, reqId, 'completed', { fileHash: fresh.hash, expectFingerprint: deliveryFingerprint(fresh), actor: 'human' })
  assert.equal((await view()).status, 'completed')
})

test('client deliveryFingerprint matches the store implementation', async t => {
  const root = await makeRoot(t)
  const reqId = await started(root)
  await doneTask(root, reqId, 'A')
  await doneTask(root, reqId, 'B')
  const view = (await scanProject(root)).requirements.find(r => r.id === reqId)
  // The client sees the same JSON payload shape the rpc layer returned (hash included).
  const json = JSON.parse(JSON.stringify(view))
  assert.equal(await clientFingerprint(json), deliveryFingerprint(view))
  const edited = JSON.parse(JSON.stringify(view))
  edited.issues[0].hash = 'deadbeef'
  assert.notEqual(await clientFingerprint(edited), deliveryFingerprint(view))
})

test('wiki evidence refs open files with line ranges; page bodies drop frontmatter', async () => {
  const { parseEvidenceRef, evidenceLines, stripFrontmatter } = await import('../client-src/pages/wiki-source.js')
  assert.deepEqual(parseEvidenceRef('repo://demo.mjs#L1-L11'), { kind: 'file', path: 'demo.mjs', from: 1, to: 11, label: 'repo://demo.mjs#L1-L11' })
  assert.equal(parseEvidenceRef('repo://src/a.js').path, 'src/a.js')
  assert.equal(parseEvidenceRef('repo://docs/workbench-mvp/%E8%A7%84%E8%8C%83/PRD.md').path, 'docs/workbench-mvp/规范/PRD.md')
  assert.equal(parseEvidenceRef('repo://docs/name%2Fpart.md').kind, 'text')
  assert.equal(parseEvidenceRef('wiki:quickstart.md').kind, 'wiki')
  assert.equal(parseEvidenceRef('openwiki/data/store.md').path, 'data/store.md')
  assert.equal(parseEvidenceRef('session://abc').kind, 'text')
  assert.equal(evidenceLines('a\nb\nc\nd', 2, 3), 'b\nc')
  assert.equal(evidenceLines('a\nb', 0, 0), 'a\nb')
  assert.equal(stripFrontmatter('---\nschema: 1\n---\n# 标题\n正文'), '# 标题\n正文')
  assert.equal(stripFrontmatter('# 无 frontmatter'), '# 无 frontmatter')
})
