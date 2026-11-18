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
  tree = h.render(DeliveryDetail, { ...props, req: { ...pending, status: 'completed' } })
  assert.equal(find(tree, button('acceptRequirement')), null)
  assert.equal(find(tree, button('sendBack')), null)
  const recovering = { ...pending, status: 'in_progress', pendingReopen: { items: [] } }
  tree = h.render(DeliveryDetail, { ...props, req: recovering })
  assert.equal(find(tree, button('acceptRequirement')), null)
  assert.equal(find(tree, button('sendBack')), null)
  find(tree, button('resumeReopen')).props.onClick()
  assert.deepEqual(moves.at(-1), [recovering, 'completed'])
  tree = h.render(DeliveryDetail, { ...props, req: recovering, busy: true })
  assert.equal(find(tree, button('resumeReopen')).props.disabled, true)
})

test('board confirmation rejects an older round and accepts a current result', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const ReasonModal = await component('../client-src/shared/modals.js', 'ReasonModal')
  const props = { modal: { kind: 'confirmIssue', req, reqId: req.id, issue: oldTask }, t: x => x, setModal() {}, root: '/tmp/test' }
  let tree = h.render(ReasonModal, props)
  assert.equal(find(tree, button('demoConfirm')).props.disabled, true)
  assert.equal(find(tree, named('TaskResult')).props.since, 200)
  const h2 = host(); globalThis.__roundReact = h2.api
  const CurrentModal = await component('../client-src/shared/modals.js', 'ReasonModal')
  tree = h2.render(CurrentModal, { ...props, modal: { ...props.modal, issue: newTask } })
  assert.equal(find(tree, button('demoConfirm')).props.disabled, false)
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
  assert.equal(find(tree, button('demoConfirm')).props.disabled, false)
  await find(tree, button('demoConfirm')).props.onClick()
  tree = h.render(ReasonModal, props)
  assert.equal(find(tree, named('TaskResult')).props.since, 200)
  assert.equal(find(tree, button('demoConfirm')).props.disabled, true)
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

test('sidebar reading shows saved task context and parent scope before the result', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const TaskReading = await component('../client-src/detail/task-content.js', 'TaskReading')
  const actions = { type: 'button', props: { children: ['confirm'] } }
  const task = { ...newTask, description: '旧的补充说明', rootCause: '已知情况', triggerPath: '实际步骤', refs: ['wiki:guide'] }
  const requirement = { ...req, scope: '当前范围', q_out: '不包括的内容' }
  let tree = h.render(TaskReading, { task, requirement, t: x => x, sidebar: true, resultActions: actions })
  const children = tree.props.children.flat().filter(Boolean)
  const field = label => children.find(node => node.type?.name === 'ReadingText' && node.props.label === label)
  assert.equal(field('sidebarTaskDescription').props.value, '问题')
  assert.equal(field('sidebarFinding').props.value, '已知情况')
  assert.equal(field('taskSteps').props.value, '实际步骤')
  const scope = children.find(node => node.type === 'section')
  assert.ok(find(scope, node => node.props?.value === '当前范围'))
  assert.ok(find(scope, node => node.props?.label === 'q_out' && node.props.value === '不包括的内容'))
  const result = children.find(named('TaskResult'))
  assert.ok(children.indexOf(scope) < children.indexOf(result))
  assert.equal(result.props.children[0], actions)
  assert.equal(result.props.showSummary, false)
  const review = result.type(result.props)
  assert.equal(review.props['aria-label'], 'sidebarReviewDetails')
  assert.equal(find(review, node => node.props?.label === 'demoResult'), null)
  assert.equal(find(review, node => node.props?.label === 'requirementCriteria').props.value, '标准')
  assert.ok(find(review, named('Verification')))
  assert.ok(find(review, node => node.props?.label === 'demoLimits'))
  assert.ok(find(review, button('confirm')))
  const normalReview = result.type({ ...result.props, showSummary: true })
  assert.ok(find(normalReview, node => node.props?.label === 'demoResult' && node.props.value === '本轮摘要'))
  assert.ok(find(tree, node => node.props?.label === 'taskSupplement' && node.props.value === '旧的补充说明'))
  assert.equal(find(tree, named('UpdateLog')), null)

  const staleReading = h.render(TaskReading, { task: { ...oldTask, knownLimits: '旧限制' }, requirement, t: x => x, sidebar: true, since: 200 })
  const staleResult = find(staleReading, named('TaskResult'))
  const staleReview = staleResult.type(staleResult.props)
  assert.ok(find(staleReview, node => node.type === 'p' && node.props.children.includes('previousResultUnverified')))
  const oldLimits = find(staleReview, node => node.props?.label === 'previousLimits')
  assert.ok(find(oldLimits, node => node.props?.value === '旧限制'))
  assert.equal(find(staleReview, node => node.props?.value === '旧摘要'), null)

  tree = h.render(TaskReading, { task: { ...task, problemOverview: '', rootCause: '' }, requirement: { id: 'r' }, t: x => x, sidebar: true })
  assert.equal(find(tree, node => node.props?.label === 'sidebarTaskDescription').props.value, '旧的补充说明')
  assert.equal(find(tree, node => node.props?.label === 'sidebarFinding').props.value, 'sidebarNotRecorded')
  assert.ok(find(find(tree, node => node.type === 'section'), node => node.props?.value === 'sidebarNotRecorded'))
  assert.equal(find(tree, node => node.props?.label === 'taskSupplement').props.value, '')
  tree = h.render(TaskReading, { task, requirement: { id: 'r', q_out: '旧范围外内容' }, t: x => x, sidebar: true })
  const oldScope = find(tree, node => node.type === 'section')
  assert.ok(find(oldScope, node => node.props?.label === 'q_out' && node.props.value === '旧范围外内容'))
  assert.equal(find(oldScope, node => node.props?.value === 'sidebarNotRecorded'), null)
})

test('sidebar progress remains last after delivery and suggestions, including while editing', async t => {
  const h = host(); globalThis.__roundReact = h.api
  t.after(() => { delete globalThis.__roundReact })
  const LinkedTaskDetails = await component('../client-src/rightbar/task-pane.js', 'LinkedTaskDetails', true)
  const requirement = { ...req, status: 'pending', scope: '范围' }
  const props = { task: { ...newTask, status: 'doing' }, req: requirement, runView: { locked: false }, linkState: { link: {} },
    proposals: [{ id: 'p' }], delivery: null, t: x => x, root: '/tmp/test', sessionId: 's', projectKey: 'p',
    uiMemory: { drafts: {} }, busy: false, leaveRef: { current: null }, toolbar: () => null, notices: null }
  let tree = h.render(LinkedTaskDetails, props)
  let section = find(tree, node => node.type === 'section' && node.props['aria-label'] === 'issueDetail')
  assert.equal(find(tree, named('TaskReading')).props.requirement, requirement)
  assert.ok(find(section, node => node.props?.label === 'requirementDelivery'))
  assert.ok(find(section, node => node.props?.label === 'demoDrafts'))
  let last = section.props.children.at(-1)
  assert.equal(last.props.hidden, false)
  assert.equal(last.props.children[0].type.name, 'UpdateLog')
  assert.equal(last.props.children[0].props.timeline, true)
  find(tree, button('edit')).props.onClick()
  tree = h.render(LinkedTaskDetails, props)
  section = find(tree, node => node.type === 'section' && node.props['aria-label'] === 'issueDetail')
  last = section.props.children.at(-1)
  assert.equal(last.props.hidden, true)
  assert.equal(last.props.children[0].type.name, 'UpdateLog')
})
