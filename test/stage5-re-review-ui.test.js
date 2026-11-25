// A retained task must use its parent requirement's newer delivery round.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { taskResult } from '../client-src/workbench-content.js'

const require = createRequire(import.meta.url)
const reactStub = { name: 'react-stub', setup(b) {
  b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'react-stub' }))
  b.onLoad({ filter: /.*/, namespace: 'react-stub' }, () => ({ contents: 'export default globalThis.__roundReact', loader: 'js' }))
} }
async function component(relative, name, internal = false) {
  const file = fileURLToPath(new URL(relative, import.meta.url))
  const entry = internal
    ? { stdin: { contents: (await readFile(file, 'utf8')) + `\nexport { ${name} }\n`, sourcefile: file, resolveDir: dirname(file) } }
    : { entryPoints: [file] }
  const out = await build({ ...entry, bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports[name]
}
function host() {
  let state = [], cursor = 0
  const api = {
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) { return { type, props: { ...props, children } } },
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial
      return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] },
    useEffect() {},
    useRef(initial) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i] },
    useCallback(callback) { return callback },
  }
  return { api, render(Component, props) { cursor = 0; return Component(props) } }
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null
  if (predicate(tree)) return tree
  for (const item of [...(tree.props?.children ?? []), ...(tree.props?.actions ?? [])].flat(Infinity)) {
    const found = find(item, predicate); if (found) return found
  }
  return null
}
const named = name => node => node.type?.name === name
const button = label => node => node.type === 'button' && node.props.children.includes(label)
const req = { id: 'r', title: '需求', status: 'in_progress', deliveryStartedAt: 200 }
const oldTask = { id: 'i', reqId: 'r', title: '任务', status: 'in_review', problemOverview: '问题', acceptance: '标准',
  deliveryStartedAt: 50, resultAt: 100, evidenceAt: 100, resultSummary: '旧摘要', evidence: '旧依据', resultFresh: true }
const newTask = { ...oldTask, resultAt: 201, evidenceAt: 201, resultScopeAt: 200, resultSummary: '本轮摘要', evidence: '本轮依据' }

test('delivery detail delegates accept, return and recovery to the existing move flow', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const DeliveryDetail = await component('../client-src/detail/acceptance-detail.js', 'DeliveryDetail')
  const pending = { ...req, status: 'pending', reviews: [], issues: [] }
  const moves = []
  const props = { req: pending, t: x => x, onMove: (...args) => moves.push(args) }
  let tree = h.render(DeliveryDetail, props)
  find(tree, button('acceptRequirement')).props.onClick()
  find(tree, button('sendBack')).props.onClick()
  assert.deepEqual(moves, [[pending, 'completed'], [pending, 'in_progress']])
  assert.equal(find(tree, button('locateBoard')), null)
  assert.equal(find(tree, named('AcceptanceAssist')), null)
  tree = h.render(DeliveryDetail, { ...props, busy: true })
  assert.equal(find(tree, button('acceptRequirement')).props.disabled, true)
  assert.equal(find(tree, button('sendBack')).props.disabled, true)
  const completed = { ...pending, status: 'completed' }
  tree = h.render(DeliveryDetail, { ...props, req: completed })
  assert.equal(find(tree, button('acceptRequirement')), null)
  assert.equal(find(tree, button('sendBack')), null)
  find(tree, button('reopen')).props.onClick()
  assert.deepEqual(moves.at(-1), [completed, 'in_progress'])
  const recovering = { ...pending, status: 'in_progress', pendingReopen: { items: [] } }
  tree = h.render(DeliveryDetail, { ...props, req: recovering })
  assert.equal(find(tree, button('acceptRequirement')), null)
  assert.equal(find(tree, button('sendBack')), null)
  find(tree, button('resumeReopen')).props.onClick()
  assert.deepEqual(moves.at(-1), [recovering, 'completed'])
  tree = h.render(DeliveryDetail, { ...props, req: recovering, busy: true })
  assert.equal(find(tree, button('resumeReopen')).props.disabled, true)
})

test('a reopened requirement exposes the previous delivery and separately linked decisions', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const RequirementDelivery = await component('../client-src/detail/acceptance-detail.js', 'RequirementDelivery')
  const DeliveryResult = await component('../client-src/detail/requirement-content.js', 'DeliveryResult')
  const RequirementDecisionRecords = await component('../client-src/detail/requirement-content.js', 'RequirementDecisionRecords')
  const RequirementReviewDecisions = await component('../client-src/detail/requirement-content.js', 'RequirementReviewDecisions')
  const reviewed = { kind: 'review', decision: 'approved', marker: 'review-decision', opinion: '评审意见' }
  const returned = { kind: 'acceptance', decision: 'returned', round: 2, opinion: '返工原因', summary: '旧交付摘要' }
  const reopened = { ...req, deliverySummary: returned.summary, deliverySummaryAt: 100, reviews: [reviewed, returned] }
  const props = { req: reopened, t: x => x }
  const delivery = h.render(RequirementDelivery, props)
  const result = h.render(DeliveryResult, find(delivery, named('DeliveryResult')).props)
  assert.equal(result.props.label, 'previousResult')
  assert.equal(find(result, node => node.props?.value === returned.summary).type.name, 'ReadingText')

  const deliveryDecisions = find(delivery, named('RequirementDecisionRecords')).props
  assert.deepEqual(deliveryDecisions.records, [returned])
  const [deliveryRecord] = h.render(RequirementDecisionRecords, deliveryDecisions)
  assert.equal(deliveryRecord.props.id, 'pw-requirement-record-delivery-2')
  assert.equal(find(deliveryRecord, node => node.props?.value === returned.opinion).type.name, 'ReadingText')

  const decisions = h.render(RequirementReviewDecisions, props).props
  assert.deepEqual(decisions.records, [reviewed])
  const [reviewRecord] = h.render(RequirementDecisionRecords, decisions)
  assert.equal(reviewRecord.props.id, 'pw-requirement-record-review-review-decision')
})

test('board confirmation rejects an older round and accepts a current result', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const ReasonModal = await component('../client-src/shared/modals.js', 'ReasonModal')
  const props = { modal: { kind: 'confirmIssue', req, reqId: req.id, issue: oldTask }, t: x => x, setModal() {}, root: '/tmp/test' }
  let tree = h.render(ReasonModal, props)
  assert.equal(find(tree, button('taskAccept')).props.disabled, true)
  assert.equal(find(tree, named('TaskResult')).props.since, 200)
  const h2 = host(); globalThis.__roundReact = h2.api
  const CurrentModal = await component('../client-src/shared/modals.js', 'ReasonModal')
  tree = h2.render(CurrentModal, { ...props, modal: { ...props.modal, issue: newTask } })
  assert.equal(find(tree, button('taskAccept')).props.disabled, false)
})

test('after a confirmation conflict, the refreshed requirement round is reviewed with the task', async t => {
  const h = host(); globalThis.__roundReact = h.api
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({ json: async () => ({ ok: true, data: { ...req, issues: [oldTask] } }) })
  t.after(() => { globalThis.fetch = previousFetch; delete globalThis.__roundReact })
  const ReasonModal = await component('../client-src/shared/modals.js', 'ReasonModal')
  const props = { modal: { kind: 'confirmIssue', req: { ...req, deliveryStartedAt: 50 }, reqId: req.id, issue: oldTask },
    t: x => x, setModal() {}, root: '/tmp/test', mutate: async () => ({ ok: false, code: 'CONFLICT' }) }
  let tree = h.render(ReasonModal, props)
  assert.equal(find(tree, button('taskAccept')).props.disabled, false)
  await find(tree, button('taskAccept')).props.onClick()
  tree = h.render(ReasonModal, props)
  assert.equal(find(tree, named('TaskResult')).props.since, 200)
  assert.equal(find(tree, button('taskAccept')).props.disabled, true)
})

test('current verification survives a newer requirement round', () => {
  const verification = { status: 'passed', passed: 1, failed: 0, incomplete: 0, unconfirmedChanges: 0, hasManualEvidence: false }
  const task = { ...newTask, requirementDeliveryStartedAt: 200, verification }
  assert.deepEqual(taskResult(task, 200).verification, verification)
})

test('task details and sidebar pass the requirement round to reading and result editing', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const IssueDetail = await component('../client-src/detail/task-detail.js', 'IssueDetail')
  const doing = { ...oldTask, status: 'doing' }
  const props = { issue: doing, req, t: x => x, root: '/tmp/test', projectKey: 'p', uiMemory: { drafts: {} }, rootRef: { current: '/tmp/test' } }
  let tree = h.render(IssueDetail, props)
  assert.equal(find(tree, named('TaskReading')).props.since, 200)
  find(tree, button('recordTaskResult')).props.onClick()
  tree = h.render(IssueDetail, props)
  assert.equal(find(tree, named('TaskResultForm')).props.since, 200)

  const bar = host(); globalThis.__roundReact = bar.api
  const LinkedTaskDetails = await component('../client-src/rightbar/task-pane.js', 'LinkedTaskDetails', true)
  const barProps = { task: doing, req, runView: { locked: false }, linkState: { link: {} }, proposals: [], delivery: null,
    t: x => x, root: '/tmp/test', sessionId: 's', projectKey: 'p', uiMemory: { drafts: {} }, busy: false,
    leaveRef: { current: null }, toolbar: more => more, notices: null }
  tree = bar.render(LinkedTaskDetails, barProps)
  assert.equal(find(tree, named('TaskReading')).props.since, 200)
  find(tree, button('recordTaskResult')).props.onClick()
  tree = bar.render(LinkedTaskDetails, barProps)
  assert.equal(find(tree, named('TaskResultForm')).props.since, 200)
})

test('terminal tasks under a completed requirement point back to reopening development', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const IssueDetail = await component('../client-src/detail/task-detail.js', 'IssueDetail')
  const task = { ...oldTask, status: 'cancelled' }
  const completedReq = { ...req, status: 'completed' }
  const props = { issue: task, req: completedReq, t: x => x, root: '/tmp/test', projectKey: 'p', uiMemory: { drafts: {} }, rootRef: { current: '/tmp/test' } }
  assert.match(JSON.stringify(h.render(IssueDetail, props)), /errNotActive/)

  const bar = host(); globalThis.__roundReact = bar.api
  const LinkedTaskDetails = await component('../client-src/rightbar/task-pane.js', 'LinkedTaskDetails', true)
  const barProps = { task, req: completedReq, runView: { locked: false }, linkState: { link: {} }, proposals: [], delivery: null,
    t: x => x, root: '/tmp/test', sessionId: 's', projectKey: 'p', uiMemory: { drafts: {} }, busy: false,
    leaveRef: { current: null }, toolbar: () => null, notices: null }
  assert.match(JSON.stringify(bar.render(LinkedTaskDetails, barProps)), /errNotActive/)
})

test('task table opens the selected acceptance without changing its status', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const IssueSidebar = await component('../client-src/detail/requirement-detail.js', 'IssueSidebar')
  const opened = []
  const props = { req: { ...req, issues: [newTask] }, onOpenIssue: (...args) => opened.push(args), t: x => x }
  let tree = h.render(IssueSidebar, props)
  find(tree, button('taskGoToAcceptance')).props.onClick()
  assert.deepEqual(opened, [[newTask.id, true]])
  tree = h.render(IssueSidebar, { ...props, readOnly: true })
  assert.equal(find(tree, button('taskGoToAcceptance')), null)
})

test('only active task pages preview the overview, and all task states can open fuller information', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const IssueDetail = await component('../client-src/detail/task-detail.js', 'IssueDetail')
  const base = { req, t: x => x, root: '/tmp/test', projectKey: 'p', uiMemory: { drafts: {} }, rootRef: { current: '/tmp/test' } }
  const issue = { ...newTask, problemOverview: '已记录概述', triggerPath: '完整复现步骤', rootCause: '已定位根因',
    description: '独立补充说明', refs: ['wiki:guide'] }
  for (const status of ['todo', 'doing', 'blocked', 'in_review', 'done', 'cancelled']) {
    let tree = h.render(IssueDetail, { ...base, issue: { ...issue, status } })
    const page = find(tree, node => node.props?.['aria-label'] === 'issueDetail')
    assert.equal(page.props.children[0].type, 'header', status)
    const info = find(page, node => node.props?.['aria-labelledby'] === 'pw-task-info-heading')
    const hasPreview = !!find(info, node => node.type === 'p' && node.props.children.includes(issue.problemOverview))
    assert.equal(hasPreview, ['todo', 'doing'].includes(status), status)
    assert.equal(find(page, node => node.props?.value === issue.rootCause), null, status)
    const trigger = {}
    const openInfo = find(info, button('taskOpenInfo'))
    assert.equal(openInfo.props['aria-expanded'], false)
    openInfo.props.onClick({ currentTarget: trigger })
    tree = h.render(IssueDetail, { ...base, issue: { ...issue, status } })
    const { drawer } = tree.props
    assert.equal(drawer.key, 'info')
    assert.equal(drawer.trigger, trigger)
    assert.equal(find(tree, button('taskOpenInfo')).props['aria-expanded'], true)
    for (const [label, value] of [
      ['taskOverviewField', issue.problemOverview], ['taskSteps', issue.triggerPath],
      ['taskCause', issue.rootCause], ['taskSupplement', issue.description],
    ]) assert.ok(find(drawer.body, node => node.props?.label === label && node.props.value === value), label)
    const refs = find(drawer.body, named('TaskReferences'))
    assert.deepEqual(refs.props.refs, issue.refs)
    tree.props.onClose()
  }

  const legacy = { ...newTask, status: 'doing', problemOverview: '', description: '仅有旧说明', rootCause: '根因' }
  let tree = h.render(IssueDetail, { ...base, issue: legacy })
  assert.ok(find(tree, node => node.type === 'p' && node.props.children.includes(legacy.description)))
  find(tree, button('taskOpenInfo')).props.onClick({ currentTarget: {} })
  tree = h.render(IssueDetail, { ...base, issue: legacy })
  assert.ok(find(tree.props.drawer.body, node => node.props?.label === 'taskOverviewField' && node.props.value === legacy.description))
  assert.equal(find(tree.props.drawer.body, node => node.props?.label === 'taskSupplement').props.value, '')
  tree.props.onClose()
  const shortOverview = { ...legacy, rootCause: '' }
  tree = h.render(IssueDetail, { ...base, issue: shortOverview })
  find(tree, button('taskOpenInfo')).props.onClick({ currentTarget: {} })
  tree = h.render(IssueDetail, { ...base, issue: shortOverview })
  assert.ok(find(tree.props.drawer.body, node => node.props?.label === 'taskOverviewField' && node.props.value === legacy.description))
  assert.ok(find(tree.props.drawer.body, node => node.type === 'p' && node.props.children.includes('taskInfoEmpty')))
})

test('task review prominently exposes decisions and assistance while retaining earlier evidence in the drawer', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const IssueDetail = await component('../client-src/detail/task-detail.js', 'IssueDetail')
  const moves = []
  const failedRecord = '- 执行命令：npm test（结果 error，会话 s 第 1 条，2026-11-25T02:00:00.000Z）\n  输出：失败记录'
  const issue = { ...newTask, knownLimits: '刷新后仍待核实', knownLimitsAt: 201, evidence: '以前的验证', evidenceAt: 100,
    objective: failedRecord, objectiveAt: 201, requirementDeliveryStartedAt: 200,
    verification: { passed: 3, failed: 1, incomplete: 1, unconfirmedChanges: 0, hasManualEvidence: false },
    verificationChecks: [{ status: 'failed', command: 'npm test', at: '2026-11-25T02:00:00.000Z', recordIndex: 0 }],
    activity: ['2026-11-25T10:30:00+08:00 补充 Safari 实机验收：已补测恢复路径。真实设备休眠未实测，恢复重算有自动化覆盖。'] }
  const props = { issue, req, t: x => x, root: '/tmp/test', projectKey: 'p', uiMemory: { drafts: {} }, rootRef: { current: '/tmp/test' },
    onMoveIssue: (...args) => moves.push(args) }
  const renderResult = tree => {
    const reading = find(tree, named('TaskReading'))
    const result = find(reading.type(reading.props), named('TaskResult'))
    return result.type(result.props)
  }
  let tree = h.render(IssueDetail, props)
  let result = renderResult(tree)
  assert.ok(find(result, node => node.props?.label === 'demoResult' && node.props.value === '本轮摘要'))
  assert.equal(find(result, node => node.props?.label === 'requirementCriteria'), null)
  const children = result.props.children.flat().filter(Boolean)
  const checks = children.find(named('Verification'))
  const decisions = children.find(node => node.props?.['aria-labelledby'] === 'pw-task-decision')
  const assists = children.find(named('AcceptanceAssist'))
  assert.ok(children.indexOf(checks) < children.indexOf(decisions))
  assert.ok(children.indexOf(decisions) < children.indexOf(assists))
  assert.match(JSON.stringify(checks.type(checks.props)), /taskReviewIncomplete.*checksPassed/)
  assert.ok(assists.props.compact)
  assert.equal(assists.props.showInstructions, false)
  assert.ok(find(result, node => node.props?.label === 'demoLimits' && node.props.value === '真实设备休眠未实测'))
  assert.doesNotMatch(JSON.stringify(children.filter(child => child !== assists)), /失败记录|已补测恢复路径/)
  assert.equal(find(result, button('taskAccept')).props.disabled, false)
  find(result, button('taskReject')).props.onClick()
  find(result, button('taskAccept')).props.onClick()
  assert.deepEqual(moves, [['doing', 'pw-task-reject'], ['done', 'pw-task-accept']])
  const trigger = {}
  find(checks.type(checks.props), button('checksFailed')).props.onClick({ currentTarget: trigger })
  tree = h.render(IssueDetail, props)
  const { drawer } = tree.props
  assert.equal(drawer.trigger, trigger)
  assert.equal(drawer.focusId, 'pw-task-failed-checks')
  assert.equal(find(renderResult(tree), button('taskOpenRecords')).props['aria-expanded'], true)
  const evidence = drawer.body.type(drawer.body.props)
  const failed = find(evidence, node => node.props?.['aria-label'] === 'taskCheck_failed')
  assert.ok(find(failed, node => node.props?.id === drawer.focusId))
  const details = find(failed, node => node.type === 'details')
  assert.match(JSON.stringify(details.props.children[0]), /npm test|2026-11-25/)
  assert.match(JSON.stringify(details.props.children[1]), /失败记录/)
  assert.ok(find(evidence, node => node.props?.label?.startsWith('taskCheckFollowUp')))
  assert.ok(find(find(evidence, node => node.props?.label === 'taskPreviousEvidence'), node => node.props?.value === '以前的验证'))
  assert.ok(find(find(evidence, node => node.props?.label === 'requirementCriteria'), node => node.props?.value === '标准'))
  assert.ok(find(find(evidence, node => node.props?.label === 'taskObjectiveRecords'), node => node.props?.value === failedRecord))
  tree.props.onClose()
  tree = h.render(IssueDetail, { ...props, issue: oldTask })
  result = renderResult(tree)
  assert.equal(tree.props.drawer, null)
  assert.equal(find(result, button('taskAccept')).props.disabled, true)
  assert.ok(find(result, node => node.props?.role === 'status' && node.props.children.includes('taskReviewNeedsResult')))
  assert.equal(find(result, button('taskReject')).props.disabled, false)
  tree = h.render(IssueDetail, { ...props, runFact: { sessionRunning: true } })
  for (const action of ['taskAccept', 'taskReject']) assert.equal(find(renderResult(tree), button(action)).props.disabled, true)
})

test('rejecting acceptance records the feedback against the reviewed snapshot and leaves the next action on the task', async t => {
  const dialog = host(); globalThis.__roundReact = dialog.api
  t.after(() => { delete globalThis.__roundReact })
  const ReasonModal = await component('../client-src/shared/modals.js', 'ReasonModal')
  const calls = [], focus = []
  const issue = { ...newTask, hash: 'reviewed' }
  const modal = { kind: 'rejectTaskAcceptance', req, reqId: req.id, issue, restoreFocus: saved => focus.push(saved) }
  const props = { modal, t: x => x, root: '/tmp/test', setModal() {}, mutate: async (...args) => { calls.push(args); return { ok: true } } }
  const reason = '刷新后未保留修改。\n补上回归测试。'
  let tree = dialog.render(ReasonModal, props)
  assert.equal(find(tree, button('taskConfirmReject')).props.disabled, true)
  find(tree, node => node.type === 'textarea').props.onChange({ target: { value: reason } })
  tree = dialog.render(ReasonModal, props)
  await find(tree, button('taskConfirmReject')).props.onClick()
  assert.deepEqual(calls, [['issue/continue', { root: '/tmp/test', reqId: req.id, id: issue.id, fileHash: issue.hash, text: reason }, { inlineError: true }]])
  assert.deepEqual(focus, [true])

  const detail = host(); globalThis.__roundReact = detail.api
  const IssueDetail = await component('../client-src/detail/task-detail.js', 'IssueDetail')
  const returned = { ...issue, status: 'doing', deliveryStartedAt: 203, activity: [`in_review → doing（继续修改）\n${reason}`] }
  const detailProps = { issue: returned, req, t: x => x, root: '/tmp/test', projectKey: 'p', uiMemory: { drafts: {} },
    rootRef: { current: '/tmp/test' }, onStartTask: (...args) => calls.push(args) }
  tree = detail.render(IssueDetail, detailProps)
  const rework = find(tree, node => node.props?.['aria-labelledby'] === 'pw-task-rework')
  assert.ok(find(find(rework, node => node.type === 'details'), node => node.props?.value === reason))
  assert.ok(find(rework, node => node.props?.children.includes('taskReworkNext')))
  assert.equal(find(rework, button('submitTaskAcceptance')), null)
  find(rework, button('demoContinue')).props.onClick()
  assert.deepEqual(calls.at(-1), [issue.id])
  tree = detail.render(IssueDetail, { ...detailProps, issue: { ...returned, resultAt: 204, evidenceAt: 204 } })
  assert.equal(find(tree, button('submitTaskAcceptance')).props.className, 'pw-button primary')
})

test('the task progress preview shows a first line and opens the exact saved record for reading', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const IssueDetail = await component('../client-src/detail/task-detail.js', 'IssueDetail')
  const activity = ['2026-11-20T14:11:00+08:00 人工操作：完成逐人签到\n需要逐条核对重复编号']
  const issue = { ...newTask, status: 'doing', activity }
  const props = { issue, req, t: x => x, root: '/tmp/test', projectKey: 'p', uiMemory: { drafts: {} }, rootRef: { current: '/tmp/test' } }
  const tree = h.render(IssueDetail, props)
  const reading = find(tree, named('TaskReading'))
  const updates = find(reading.type(reading.props), named('UpdateLog'))
  const preview = updates.type(updates.props)
  assert.match(JSON.stringify(preview), /完成逐人签到/)
  assert.doesNotMatch(JSON.stringify(preview), /需要逐条核对/)
  const trigger = {}
  find(preview, button('taskReadProgress')).props.onClick({ currentTarget: trigger })
  const { drawer } = h.render(IssueDetail, props).props
  assert.equal(drawer.trigger, trigger)
  assert.equal(drawer.focusId, 'pw-task-current-progress')
  assert.equal(drawer.body.props.onAdd, undefined)
  assert.match(drawer.body.props.initialProgress, /完成逐人签到/)
  const timeline = drawer.body.type(drawer.body.props)
  assert.equal(timeline.props.records[0].detail, '需要逐条核对重复编号')
  const original = find(timeline.type(timeline.props), node => node.props?.id === drawer.focusId)
  assert.equal(original.props.open, true)
})

test('task PRDs restore the selected read-only document while the inactive rail requests only a count', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const IssueDetail = await component('../client-src/detail/task-detail.js', 'IssueDetail')
  const props = { issue: newTask, req, t: x => x, root: '/tmp/test', projectKey: 'p', uiMemory: { drafts: {} }, rootRef: { current: '/tmp/test' } }
  const requested = []
  let closed = false
  const renderPrds = (_onSummary, options) => { requested.push(options); return null }
  const onClosePrds = () => { closed = true }
  const tree = h.render(IssueDetail, { ...props, renderPrds, onClosePrds, initialPrdId: 'prd-active', modalActive: true })
  assert.deepEqual(requested, [{ readOnly: true }])
  assert.equal(tree.props.drawer.scrollKey, 'prd-active')
  assert.equal(tree.props.modalActive, true)
  tree.props.onClose()
  assert.equal(closed, true)
  const after = h.render(IssueDetail, { ...props, renderPrds, onClosePrds })
  assert.equal(after.props.drawer, null)
  assert.deepEqual(requested.at(-1), { summaryOnly: true })
})

test('sidebar confirmation does not treat the retained task old result as current', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const LinkedTaskDetails = await component('../client-src/rightbar/task-pane.js', 'LinkedTaskDetails', true)
  const props = { task: oldTask, req, runView: { locked: false }, linkState: { link: {} }, proposals: [], delivery: null,
    t: x => x, root: '/tmp/test', sessionId: 's', projectKey: 'p', uiMemory: { drafts: {} }, busy: false,
    leaveRef: { current: null }, toolbar: () => null, notices: null }
  let tree = h.render(LinkedTaskDetails, props)
  let reading = find(tree, named('TaskReading'))
  assert.equal(find(reading.props.resultActions, button('demoConfirm')).props.disabled, true)
  tree = h.render(LinkedTaskDetails, { ...props, task: newTask })
  reading = find(tree, named('TaskReading'))
  assert.equal(find(reading.props.resultActions, button('demoConfirm')).props.disabled, false)
})

test('sidebar shows the result and decision before optional task context', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const TaskReading = await component('../client-src/detail/task-content.js', 'TaskReading')
  const actions = { type: 'button', props: { children: ['confirm'] } }
  const task = { ...newTask, description: '旧的补充说明', rootCause: '已知情况', triggerPath: '实际步骤', refs: ['wiki:guide'] }
  const requirement = { ...req, scope: '当前范围', q_out: '不包括的内容' }
  let tree = h.render(TaskReading, { task, requirement, t: x => x, sidebar: true, resultActions: actions })
  const children = tree.props.children.flat().filter(Boolean)
  const context = children.find(node => node.props?.label === 'taskInfo')
  const result = children.find(named('TaskResult'))
  assert.ok(children.indexOf(result) < children.indexOf(context))
  for (const [label, value] of [
    ['sidebarTaskDescription', '问题'], ['sidebarFinding', '已知情况'], ['taskSteps', '实际步骤'], ['sidebarRequirementScope', '当前范围'],
    ['q_out', '不包括的内容'], ['requirementCriteria', '标准'], ['taskSupplement', '旧的补充说明'],
  ]) assert.ok(find(context, node => node.props?.label === label && node.props.value === value), label)
  const review = result.type(result.props)
  assert.equal(review.props['aria-label'], 'demoResult')
  assert.ok(find(review, node => node.props?.label === 'demoResult' && node.props?.value === '本轮摘要'))
  assert.equal(find(review, node => node.props?.label === 'requirementCriteria'), null)
  assert.ok(find(review, named('Verification')))
  assert.ok(find(review, button('confirm')))
  assert.equal(find(tree, named('UpdateLog')), null)

  const staleReading = h.render(TaskReading, { task: { ...oldTask, knownLimits: '旧限制' }, requirement, t: x => x, sidebar: true, since: 200 })
  const staleResult = find(staleReading, named('TaskResult'))
  const staleReview = staleResult.type(staleResult.props)
  assert.ok(find(staleReview, node => node.props?.value === 'previousResultUnverified'))
  assert.equal(find(staleReview, node => node.props?.value === '旧摘要'), null)
  const staleEvidence = find(staleReview, named('TaskVerificationRecords'))
  assert.ok(find(staleEvidence.type(staleEvidence.props), node => node.props?.label === 'previousLimits'))

  tree = h.render(TaskReading, { task: { ...task, status: 'doing', problemOverview: '', rootCause: '' },
    requirement: { id: 'r', q_out: '旧范围外内容' }, t: x => x, sidebar: true })
  assert.ok(find(tree, node => node.type === 'p' && node.props.children.includes('旧的补充说明')))
  assert.equal(find(tree, node => node.props?.label === 'sidebarFinding' || node.props?.value === 'sidebarNotRecorded'), null)
  assert.ok(find(tree, node => node.props?.label === 'q_out' && node.props?.value === '旧范围外内容'))
})

test('sidebar progress is folded after delivery and suggestions and hidden while editing', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const LinkedTaskDetails = await component('../client-src/rightbar/task-pane.js', 'LinkedTaskDetails', true)
  const requirement = { ...req, status: 'pending', scope: '范围' }
  const props = { task: { ...newTask, status: 'doing', activity: ['已核对实现步骤'] }, req: requirement, runView: { locked: false }, linkState: { link: {} },
    proposals: [{ id: 'p' }], delivery: null, t: x => x, root: '/tmp/test', sessionId: 's', projectKey: 'p',
    uiMemory: { drafts: {} }, busy: false, leaveRef: { current: null }, toolbar: () => null, notices: null }
  let tree = h.render(LinkedTaskDetails, props)
  let section = find(tree, node => node.type === 'section' && node.props['aria-label'] === 'issueDetail')
  assert.equal(find(tree, named('TaskReading')).props.requirement, requirement)
  assert.ok(find(section, node => node.props?.label === 'requirementDelivery'))
  assert.ok(find(section, node => node.props?.label === 'demoDrafts'))
  let last = section.props.children.at(-1)
  assert.equal(last.props.hidden, false)
  const history = find(last, node => node.props?.label === 'progressRecords')
  assert.equal(history.type.name, 'Disclosure')
  assert.equal(history.props.open, undefined)
  assert.equal(find(history, named('UpdateLog')).props.timeline, true)
  find(tree, button('edit')).props.onClick()
  tree = h.render(LinkedTaskDetails, props)
  section = find(tree, node => node.type === 'section' && node.props['aria-label'] === 'issueDetail')
  last = section.props.children.at(-1)
  assert.equal(last.props.hidden, true)
  assert.ok(find(last, named('UpdateLog')))
})
