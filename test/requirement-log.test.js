import assert from 'node:assert/strict'
import test from 'node:test'
import { requirementLogEntries } from '../client-src/workbench-content.js'

const t = key => ({
  requirementLogReportSaved: 'Report {n} saved',
  requirementLogTaskCreated: 'Task {title} created',
  requirementLogTaskMoved: 'Task {title} {move}',
})[key] ?? key
const at = seconds => `2026-11-20T09:30:${String(seconds).padStart(2, '0')}+08:00`
const report = (marker, seconds) => ({ kind: 'ai_review', by: 'ai', decision: 'reported', opinion: 'Saved report', marker, at: at(seconds) })

test('requirement activity merges live saved reports, decisions and task moves in time order', () => {
  const req = {
    created: at(1),
    activity: [
      `${at(9)} ready → in_progress`,
      `${at(8)} reviewing → ready`,
      `${at(2)} backlog → reviewing`,
    ],
    reviews: [report('review-1', 4), { kind: 'review', decision: 'approved', at: at(8), marker: 'approved' }],
    issues: [{
      id: 'task-1', title: 'Export $& list', created: at(10),
      activity: [
        `${at(13)} blocked → doing（人工）`,
        `${at(12)} doing → blocked（系统）\nWaiting for a dependency`,
        `${at(11)} todo → doing（系统）`,
        `${at(11)} Ordinary progress notes stay with the task`,
      ],
    }],
  }
  const fresh = [report('review-1', 4), report('review-2', 6), { ...report('unsaved', 7), opinion: '' }]
  const entries = requirementLogEntries(req, t, fresh)
  assert.deepEqual(entries.map(entry => entry.summary), [
    'Task Export $& list st_blocked → st_doing',
    'Task Export $& list st_doing → st_blocked',
    'Task Export $& list st_todo → st_doing',
    'Task Export $& list created',
    'requirementLogDevelopmentStarted',
    'reviewApproved',
    'Report 2 saved',
    'Report 1 saved',
    'requirementLogSubmitted',
    'requirementLogCreated',
  ])
  assert.deepEqual(entries[1].target, { kind: 'issue', id: 'task-1' })
  assert.deepEqual(entries[5].target, { kind: 'review', id: 'approved' })
  assert.deepEqual(entries[6].target, { kind: 'report', id: 'review-2' })
  assert.deepEqual(requirementLogEntries(req, t).filter(entry => entry.target?.kind === 'report').map(entry => entry.target.id), ['review-1'])
})

test('requirement activity preserves separate decisions and time-unknown legacy rows', () => {
  const returned = { kind: 'acceptance', decision: 'returned', opinion: 'Retry', at: at(10), marker: 'first' }
  const reopened = { ...returned, at: at(40), marker: 'second' }
  const entries = requirementLogEntries({
    activity: [
      `${at(41)} completed → in_progress（Retry）`,
      `${at(11)} pending → in_progress（Retry）`,
      'reviewing → backlog（旧意见）',
    ],
    reviews: [returned, reopened, { ...reopened }],
  }, t)
  assert.deepEqual(entries.map(({ at, summary, target }) => ({ at, summary, target })), [
    { at: at(40), summary: 'requirementLogReopened', target: { kind: 'acceptance', id: 'second' } },
    { at: at(10), summary: 'deliveryReturned', target: { kind: 'acceptance', id: 'first' } },
    { at: '', summary: 'reviewReturned（旧意见）', target: null },
  ])
})
