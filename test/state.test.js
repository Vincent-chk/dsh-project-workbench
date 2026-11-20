import assert from 'node:assert/strict'
import test from 'node:test'
import { canMoveRequirement, canMoveIssue, canCreateIssue, startBlockers, REQUIREMENT_STATES, ISSUE_STATES } from '../core/state.js'

const accepted = [{ id: 'i1', status: 'done', result: 'r', evidence: 'e' }, { id: 'i2', status: 'done' }]
const submitBase = { issues: accepted, summary: '交付摘要' }

// Every ordered requirement pair against the PRD §10.3 whitelist.
const REQ_ALLOWED = {
  'backlog>reviewing': { q_pain: '需求概述' },
  'reviewing>ready': { hasAIReview: true },
  'reviewing>backlog': { reason: '补充' },
  'ready>in_progress': {},
  'ready>backlog': { reason: '改目标', confirmReviewInvalid: true },
  'in_progress>backlog': { reason: '改范围', confirmReviewInvalid: true },
  'in_progress>pending': submitBase,
  'pending>completed': {},
  'pending>in_progress': { reason: '修改要求', reopenCount: 1 },
  'completed>in_progress': { reason: '重新开发', reopenCount: 1 },
}
test('requirement transition whitelist (PRD 10.3)', () => {
  let allowed = 0
  for (const from of REQUIREMENT_STATES) for (const to of REQUIREMENT_STATES) {
    if (from === to) continue
    const key = `${from}>${to}`
    const base = { from, to, title: 't', issues: accepted, reason: 'r', actor: 'human', ...(REQ_ALLOWED[key] ?? {}) }
    const res = canMoveRequirement(base)
    if (REQ_ALLOWED[key]) { assert.equal(res.ok, true, `${key} should pass: ${res.reason}`); allowed++ }
    else assert.equal(res.ok, false, `${key} should be rejected`)
  }
  assert.equal(allowed, 10)
})

test('requirement: review info, return reason, invalidation confirm, running tasks', () => {
  assert.equal(canMoveRequirement({ from: 'backlog', to: 'reviewing', title: 't', q_pain: ' ', scope: 's' }).code, 'REVIEW_INFO_REQUIRED')
  assert.equal(canMoveRequirement({ from: 'backlog', to: 'reviewing', title: 't', goal: '旧目标' }).ok, true)
  assert.equal(canMoveRequirement({ from: 'backlog', to: 'reviewing', title: '  ', goal: 'g', scope: 's', acceptance: 'a' }).code, 'TITLE_REQUIRED')
  assert.equal(canMoveRequirement({ from: 'reviewing', to: 'backlog', reason: '' }).code, 'REASON_REQUIRED')
  assert.equal(canMoveRequirement({ from: 'ready', to: 'backlog', reason: 'x' }).code, 'REVIEW_INVALIDATION_REQUIRED')
  assert.equal(canMoveRequirement({ from: 'in_progress', to: 'backlog', reason: 'x', confirmReviewInvalid: true, running: ['iss-1'] }).code, 'RUNNING_ISSUES')
  assert.equal(canMoveRequirement({ from: 'ready', to: 'backlog', reason: 'x', confirmReviewInvalid: true }).ok, true)
})

test('requirement: only a person decides; submission may be automatic', () => {
  for (const actor of ['ai', 'system']) {
    assert.equal(canMoveRequirement({ from: 'reviewing', to: 'ready', actor }).code, 'HUMAN_ONLY')
    assert.equal(canMoveRequirement({ from: 'pending', to: 'completed', actor, issues: accepted }).code, 'HUMAN_ONLY')
    assert.equal(canMoveRequirement({ from: 'ready', to: 'in_progress', actor }).code, 'HUMAN_ONLY')
    assert.equal(canMoveRequirement({ from: 'backlog', to: 'reviewing', actor, goal: 'g', scope: 's', acceptance: 'a' }).code, 'HUMAN_ONLY')
    assert.equal(canMoveRequirement({ from: 'in_progress', to: 'pending', actor, ...submitBase }).ok, true)
  }
})

test('submit conditions (PRD 9.5): tasks, all tasks approved, result+evidence, summary, pendingReopen', () => {
  const base = { from: 'in_progress', to: 'pending' }
  assert.equal(canMoveRequirement({ ...base, ...submitBase, issues: [] }).code, 'NO_ISSUES')
  assert.equal(canMoveRequirement({ ...base, ...submitBase, issues: [{ status: 'todo' }] }).code, 'TASKS_NOT_ACCEPTED')
  assert.equal(canMoveRequirement({ ...base, ...submitBase, issues: [{ status: 'doing' }] }).code, 'TASKS_NOT_ACCEPTED')
  assert.equal(canMoveRequirement({ ...base, ...submitBase, issues: [{ status: 'blocked' }] }).code, 'TASKS_NOT_ACCEPTED')
  assert.equal(canMoveRequirement({ ...base, ...submitBase, issues: [{ status: 'in_review', result: 'r', evidence: 'e' }] }).code, 'TASKS_NOT_ACCEPTED')
  assert.equal(canMoveRequirement({ ...base, ...submitBase, issues: [{ status: 'cancelled' }] }).code, 'TASKS_NOT_ACCEPTED')
  assert.equal(canMoveRequirement({ ...base, ...submitBase, issues: [{ status: 'done' }] }).code, 'RESULT_EVIDENCE_REQUIRED')
  assert.equal(canMoveRequirement({ ...base, ...submitBase, issues: [{ status: 'done', result: 'r' }] }).code, 'RESULT_EVIDENCE_REQUIRED')
  assert.equal(canMoveRequirement({ ...base, issues: accepted }).code, 'SUMMARY_REQUIRED')
  assert.equal(canMoveRequirement({ ...base, ...submitBase, issues: [accepted[0], { status: 'cancelled' }], cancelImpact: '旧说明' }).code, 'TASKS_NOT_ACCEPTED')
  assert.equal(canMoveRequirement({ ...base, ...submitBase, pendingReopen: { at: 1 } }).code, 'REOPEN_PENDING')
  assert.equal(canMoveRequirement({ ...base, issues: [accepted[0]], summary: 's' }).ok, true)
  assert.equal(canMoveRequirement({ ...base, ...submitBase }).ok, true)
})

test('acceptance pass and reopen selection', () => {
  assert.equal(canMoveRequirement({ from: 'pending', to: 'completed', issues: [{ status: 'doing' }] }).code, 'TASKS_NOT_ACCEPTED')
  assert.equal(canMoveRequirement({ from: 'pending', to: 'completed', issues: accepted }).ok, true)
  assert.equal(canMoveRequirement({ from: 'pending', to: 'in_progress', reason: 'x' }).code, 'REOPEN_SELECTION_REQUIRED')
  assert.equal(canMoveRequirement({ from: 'completed', to: 'in_progress', reason: '' , reopenCount: 1 }).code, 'REASON_REQUIRED')
  assert.equal(canMoveRequirement({ from: 'completed', to: 'in_progress', reason: 'x', reopenCount: 2 }).ok, true)
})

// Full issue matrix with the requirement in development.
const ISSUE_ALLOWED = new Set([
  'todo>doing', 'todo>blocked', 'doing>blocked', 'blocked>doing', 'doing>in_review', 'in_review>doing',
  'todo>in_review', 'blocked>in_review',
  'todo>done', 'doing>done', 'blocked>done', 'in_review>done',
  'todo>cancelled', 'doing>cancelled', 'blocked>cancelled', 'in_review>cancelled',
  'done>todo', 'cancelled>todo', 'doing>todo', 'blocked>todo', 'in_review>todo',
])
const issueBase = { requirementStatus: 'in_progress', reason: 'r', blockedReason: 'b', linked: true, result: 'r', evidence: 'e', acceptance: 'a' }
test('issue transition matrix (PRD 10.3)', () => {
  let allowed = 0
  for (const from of ISSUE_STATES) for (const to of ISSUE_STATES) {
    if (from === to) continue
    const key = `${from}>${to}`
    const res = canMoveIssue({ from, to, ...issueBase })
    if (ISSUE_ALLOWED.has(key)) { assert.equal(res.ok, true, `${key}: ${res.reason}`); allowed++ }
    else assert.equal(res.ok, false, `${key} should be rejected`)
  }
  assert.equal(allowed, 21)
})

test('issue: AI may record facts but never confirm/cancel/reopen', () => {
  for (const actor of ['ai', 'system']) {
    for (const to of ['done', 'cancelled']) {
      assert.equal(canMoveIssue({ from: 'in_review', to, ...issueBase, actor }).code, 'HUMAN_ONLY')
    }
    assert.equal(canMoveIssue({ from: 'done', to: 'todo', ...issueBase, actor }).code, 'HUMAN_ONLY')
    assert.equal(canMoveIssue({ from: 'in_review', to: 'doing', ...issueBase, actor }).code, 'HUMAN_ONLY')
    assert.equal(canMoveIssue({ from: 'doing', to: 'todo', ...issueBase, actor }).code, 'HUMAN_ONLY')
  }
  // Factual records are allowed for AI/system.
  assert.equal(canMoveIssue({ from: 'todo', to: 'doing', ...issueBase, actor: 'system' }).ok, true)
  assert.equal(canMoveIssue({ from: 'doing', to: 'blocked', ...issueBase, actor: 'ai' }).ok, true)
  assert.equal(canMoveIssue({ from: 'blocked', to: 'doing', ...issueBase, actor: 'system' }).ok, true)
  assert.equal(canMoveIssue({ from: 'doing', to: 'in_review', ...issueBase, actor: 'ai' }).ok, true)
})

test('issue guards: reasons, link, running, result/evidence, requirement stage', () => {
  assert.equal(canMoveIssue({ from: 'doing', to: 'blocked', ...issueBase, blockedReason: '' }).code, 'BLOCKED_REASON_REQUIRED')
  assert.equal(canMoveIssue({ from: 'todo', to: 'cancelled', ...issueBase, reason: '' }).code, 'REASON_REQUIRED')
  assert.equal(canMoveIssue({ from: 'done', to: 'todo', ...issueBase, reason: '' }).code, 'REASON_REQUIRED')
  assert.equal(canMoveIssue({ from: 'cancelled', to: 'todo', ...issueBase, reason: '' }).code, 'REASON_REQUIRED')
  assert.equal(canMoveIssue({ from: 'doing', to: 'todo', ...issueBase, reason: '' }).code, 'REASON_REQUIRED')
  assert.equal(canMoveIssue({ from: 'todo', to: 'doing', ...issueBase, linked: false }).code, 'NOT_LINKED')
  assert.equal(canMoveIssue({ from: 'todo', to: 'doing', ...issueBase, running: true }).code, 'RUNNING')
  assert.equal(canMoveIssue({ from: 'doing', to: 'cancelled', ...issueBase, running: true }).code, 'RUNNING')
  assert.equal(canMoveIssue({ from: 'in_review', to: 'done', ...issueBase, running: true }).code, 'RUNNING')
  assert.equal(canMoveIssue({ from: 'doing', to: 'todo', ...issueBase, running: true }).code, 'RUNNING')
  assert.equal(canMoveIssue({ from: 'doing', to: 'done', ...issueBase, result: '' }).code, 'RESULT_EVIDENCE_REQUIRED')
  assert.equal(canMoveIssue({ from: 'doing', to: 'done', ...issueBase, evidence: '' }).code, 'RESULT_EVIDENCE_REQUIRED')
  assert.equal(canMoveIssue({ from: 'todo', to: 'doing', ...issueBase, requirementStatus: 'pending' }).code, 'REQ_NOT_ACTIVE')
  assert.equal(canMoveIssue({ from: 'todo', to: 'doing', ...issueBase, requirementStatus: 'completed' }).code, 'REQ_NOT_ACTIVE')
  assert.equal(canMoveIssue({ from: 'todo', to: 'doing', ...issueBase, requirementStatus: 'reviewing' }).code, 'REQ_NOT_ACTIVE')
})

test('issue creation only when in_progress', () => {
  assert.equal(canCreateIssue('in_progress').ok, true)
  for (const s of ['backlog', 'reviewing', 'ready', 'pending', 'completed']) assert.equal(canCreateIssue(s).ok, false)
})

test('start blockers require a title, overview and criteria; steps and root cause are optional', () => {
  assert.deepEqual(startBlockers({ title: 't', problemOverview: 'p', acceptance: 'a' }), [])
  assert.deepEqual(startBlockers({ title: 't', problemOverview: ' ', description: '原任务说明', acceptance: 'a' }), [])
  assert.deepEqual(startBlockers({ title: 't', acceptance: 'a' }), ['problemOverview'])
  assert.deepEqual(startBlockers({ title: 't', problemOverview: 'p', acceptance: '  ' }), ['acceptance'])
  assert.deepEqual(startBlockers({ acceptance: 'a' }), ['title', 'problemOverview'])
})

test('in_review requires acceptance, result, evidence and a fresh result', () => {
  const base = { from: 'doing', to: 'in_review', requirementStatus: 'in_progress', actor: 'ai' }
  assert.equal(canMoveIssue({ ...base, result: 'r', evidence: 'e', acceptance: '' }).code, 'ACCEPTANCE_REQUIRED')
  assert.equal(canMoveIssue({ ...base, result: '', evidence: 'e', acceptance: 'a' }).code, 'RESULT_EVIDENCE_REQUIRED')
  assert.equal(canMoveIssue({ ...base, result: 'r', evidence: '', acceptance: 'a' }).code, 'RESULT_EVIDENCE_REQUIRED')
  assert.equal(canMoveIssue({ ...base, result: 'r', evidence: 'e', acceptance: 'a', resultFresh: false }).code, 'RESULT_STALE')
  assert.equal(canMoveIssue({ ...base, result: 'r', evidence: 'e', acceptance: 'a' }).ok, true)
})

test('done rejects a result that predates this delivery (reopen freshness)', () => {
  const base = { from: 'in_review', to: 'done', requirementStatus: 'in_progress', result: 'r', evidence: 'e', acceptance: 'a' }
  assert.equal(canMoveIssue({ ...base, resultFresh: false }).code, 'RESULT_STALE')
  assert.equal(canMoveIssue({ ...base, resultFresh: true }).ok, true)
})

test('requirement submit accepts synced objective evidence and rejects stale results', () => {
  const base = { from: 'in_progress', to: 'pending', summary: 's', summaryAt: 200, actor: 'system', reqDeliveryStartedAt: 100 }
  // Objective records can be evidence, but they do not make an old result fresh.
  assert.equal(canMoveRequirement({ ...base, issues: [{ status: 'done', result: 'r', hasObjective: true, resultAt: 1, objectiveAt: 200 }] }).code, 'RESULT_EVIDENCE_REQUIRED')
  assert.equal(canMoveRequirement({ ...base, issues: [{ status: 'done', result: 'r', hasObjective: true, resultAt: 200, objectiveAt: 200 }] }).ok, true)
  // New facts after the summary require a new summary even in the same round.
  assert.equal(canMoveRequirement({ ...base, issues: [{ status: 'done', result: 'r', hasObjective: true, resultAt: 200, objectiveAt: 201 }] }).code, 'RESULT_EVIDENCE_REQUIRED')
  assert.equal(canMoveRequirement({ ...base, issues: [{ status: 'done', result: 'r', hasObjective: true, resultAt: 201, objectiveAt: 200 }] }).ok, true)
  // A done task whose result AND evidence predate this delivery round cannot carry acceptance.
  assert.equal(canMoveRequirement({ ...base, issues: [{ status: 'done', result: 'r', evidence: 'e', resultAt: 1, evidenceAt: 1 }] }).code, 'RESULT_EVIDENCE_REQUIRED')
  // Updating only one of result/evidence leaves the other stale.
  assert.equal(canMoveRequirement({ ...base, issues: [{ status: 'done', result: 'r', evidence: 'e', resultAt: 200, evidenceAt: 1 }] }).code, 'RESULT_EVIDENCE_REQUIRED')
  // Both fresh → accepted.
  assert.equal(canMoveRequirement({ ...base, issues: [{ status: 'done', result: 'r', evidence: 'e', resultAt: 200, evidenceAt: 200 }] }).ok, true)
})
