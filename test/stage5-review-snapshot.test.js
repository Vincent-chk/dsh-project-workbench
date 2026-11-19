// Exercise the actual confirmation components with a small hook host and real
// store/RPC: background refresh cannot silently approve unreviewed changes.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'
import { makeRoot, issueFileHash, saveReviewPrd } from './util.js'
import * as store from '../core/store.js'
import { dispatch } from '../core/rpc.js'
import { deliveryFingerprint } from '../client-src/project-state.js'
import { taskRunView } from '../client-src/rightbar/task-state.js'

const require = createRequire(import.meta.url)
const reactStub = {
  name: 'test-react', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'test-react' }))
    b.onLoad({ filter: /.*/, namespace: 'test-react' }, () => ({ contents: 'export default globalThis.__stage5React', loader: 'js' }))
  },
}
async function component(file, name) {
  const result = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports[name]
}
async function internalComponent(file, name) {
  const contents = (await readFile(file, 'utf8')) + `\nexport { ${name} }\n`
  const result = await build({ stdin: { contents, sourcefile: file, resolveDir: dirname(file) }, bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports[name]
}
function hookHost() {
  let state = [], cursor = 0
  const api = {
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) { return { type, props: { ...props, children } } },
    useState(initial) {
      const i = cursor++
      if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial
      return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }]
    },
    useEffect() {},
    useRef(initial) {
      const i = cursor++
      if (!(i in state)) state[i] = { current: initial }
      return state[i]
    },
    useCallback(callback) { return callback },
  }
  return { api, render(Component, props) { cursor = 0; return Component(props) } }
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null
  if (predicate(tree)) return tree
  for (const item of [...(tree.props?.children ?? []), ...(tree.props?.actions ?? [])].flat(Infinity)) {
    const got = find(item, predicate)
    if (got) return got
  }
  return null
}
function findAll(tree, predicate, matches = []) {
  if (!tree || typeof tree !== 'object') return matches
  if (predicate(tree)) matches.push(tree)
  for (const item of [...(tree.props?.children ?? []), ...(tree.props?.actions ?? [])].flat(Infinity)) findAll(item, predicate, matches)
  return matches
}
async function fixture(t, pending = false) {
  const root = await makeRoot(t)
  await store.initProject(root)
  const reqId = (await store.createRequirement(root, '需求')).data.id
  await store.updateRequirement(root, reqId, { goal: '目标', scope: '范围', acceptance: '标准' })
  await saveReviewPrd(root, reqId)
  await store.moveRequirement(root, reqId, 'reviewing')
  await store.moveRequirement(root, reqId, 'ready')
  await store.moveRequirement(root, reqId, 'in_progress')
  const issueId = (await store.createIssue(root, reqId, '任务')).data.id
  await store.updateIssue(root, reqId, issueId, { problemOverview: '问题', acceptance: '标准', resultSummary: '旧结果', evidence: '依据' })
  await store.moveIssue(root, reqId, issueId, 'done', { fileHash: await issueFileHash(root, reqId, issueId) })
  if (pending) await store.submitRequirement(root, reqId, { summary: '旧交付摘要' })
  return { root, reqId, issueId, view: async () => (await store.scanProject(root)).requirements.find(r => r.id === reqId) }
}
async function changeTask({ root, reqId, issueId }) {
  const path = join(root, '.project', 'requirements', reqId, 'issues', `${issueId}.md`)
  const raw = await readFile(path, 'utf8')
  await writeFile(path, raw.replace(/^updated: .+$/m, 'updated: 2026-11-16T12:00:00.000Z'))
}
function installFetch(t) {
  const previous = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    const { method, input } = JSON.parse(options.body)
    return { json: async () => dispatch(method, input, new AbortController().signal) }
  }
  t.after(() => { globalThis.fetch = previous; delete globalThis.__stage5React })
}

test('manual delivery retains the reviewed snapshot through refresh and asks for another submit after drift', async t => {
  installFetch(t)
  const ctx = await fixture(t)
  const original = await ctx.view()
  const host = hookHost(); globalThis.__stage5React = host.api
  const ManualDelivery = await component(fileURLToPath(new URL('../client-src/detail/requirement-content.js', import.meta.url)), 'ManualDelivery')
  const calls = []
  const act = async (method, input) => { const res = await dispatch(method, input, new AbortController().signal); calls.push(res); return res }
  let props = { req: original, root: ctx.root, t: x => x, act, userFacing: true }
  let tree = host.render(ManualDelivery, props)
  find(tree, e => e.type === 'textarea').props.onChange({ target: { value: '人工摘要' } })
  await changeTask(ctx)
  props = { ...props, req: await ctx.view() } // a poll refreshes the parent
  tree = host.render(ManualDelivery, props)
  await tree.props.onSubmit({ preventDefault() {} })
  assert.equal(calls[0].code, 'ROUND_CHANGED')
  assert.equal((await ctx.view()).status, 'in_progress')
  tree = host.render(ManualDelivery, props)
  assert.equal(find(tree, e => e.type === 'textarea').props.value, '人工摘要')
  assert.ok(find(tree, e => e.props?.role === 'alert'))
  await tree.props.onSubmit({ preventDefault() {} })
  assert.equal(calls[1].ok, true)
  assert.equal((await ctx.view()).status, 'pending')
})

test('automatic delivery wins while a manual draft is open: show current result and keep unsaved inputs', async t => {
  installFetch(t)
  const ctx = await fixture(t)
  const original = await ctx.view()
  const host = hookHost(); globalThis.__stage5React = host.api
  const ManualDelivery = await component(fileURLToPath(new URL('../client-src/detail/requirement-content.js', import.meta.url)), 'ManualDelivery')
  const calls = []
  const act = async (method, input) => { const res = await dispatch(method, input, new AbortController().signal); calls.push(res); return res }
  const props = { req: original, root: ctx.root, t: x => x, act, userFacing: true }
  let tree = host.render(ManualDelivery, props)
  const inputs = findAll(tree, e => e.type === 'textarea')
  assert.equal(inputs.length, 1)
  inputs[0].props.onChange({ target: { value: '尚未保存的人工摘要' } })
  await store.submitRequirement(ctx.root, ctx.reqId, {
    summary: '已提交的自动摘要', actor: 'system',
    expectFingerprint: store.deliveryFingerprint(original),
  })
  tree = host.render(ManualDelivery, props)
  await tree.props.onSubmit({ preventDefault() {} })
  assert.equal(calls[0].code, 'ROUND_CHANGED')
  tree = host.render(ManualDelivery, props)
  const remaining = findAll(tree, e => e.type === 'textarea')
  assert.deepEqual(remaining.map(e => e.props.value), ['尚未保存的人工摘要'])
  assert.equal(find(tree, e => e.props?.role === 'alert').props.children[0], 'errDeliveryStatusChanged')
  const current = find(tree, e => e.type?.name === 'DeliveryResult')
  assert.equal(current.props.req.deliverySummary, '已提交的自动摘要')
  assert.equal(find(tree, e => e.type === 'button' && e.props.type === 'submit').props.disabled, true)
  await tree.props.onSubmit({ preventDefault() {} })
  assert.equal(calls.length, 1)
  const saved = await ctx.view()
  assert.equal(saved.status, 'pending')
  assert.equal(saved.deliverySummary, '已提交的自动摘要')
  const unchanged = await dispatch('requirement/submit', { root: ctx.root, id: ctx.reqId, summary: '再提交', expectFingerprint: store.deliveryFingerprint(saved) }, new AbortController().signal)
  assert.equal(unchanged.code, 'ILLEGAL_TRANSITION')
})

test('a restored delivery draft keeps the reviewed snapshot and rejects later task changes', async t => {
  installFetch(t)
  const ctx = await fixture(t)
  const original = await ctx.view()
  const memory = {}; const draftKey = 'delivery:test|' + ctx.reqId
  const firstHost = hookHost(); globalThis.__stage5React = firstHost.api
  const FirstEditor = await component(fileURLToPath(new URL('../client-src/detail/requirement-content.js', import.meta.url)), 'ManualDelivery')
  const calls = []
  const act = async (method, input) => { const res = await dispatch(method, input, new AbortController().signal); calls.push(res); return res }
  const props = { req: original, root: ctx.root, t: x => x, act, userFacing: true, draftMemory: memory, draftKey }
  const tree = firstHost.render(FirstEditor, props)
  find(tree, e => e.type === 'textarea').props.onChange({ target: { value: '离开前的人工摘要' } })
  await changeTask(ctx)
  const nextHost = hookHost(); globalThis.__stage5React = nextHost.api
  const RestoredEditor = await component(fileURLToPath(new URL('../client-src/detail/requirement-content.js', import.meta.url)), 'ManualDelivery')
  let restored = nextHost.render(RestoredEditor, { ...props, req: await ctx.view() })
  assert.equal(find(restored, e => e.type === 'textarea').props.value, '离开前的人工摘要')
  await restored.props.onSubmit({ preventDefault() {} })
  assert.equal(calls[0].code, 'ROUND_CHANGED')
  assert.equal((await ctx.view()).status, 'in_progress')
  restored = nextHost.render(RestoredEditor, { ...props, req: await ctx.view() })
  assert.equal(find(restored, e => e.type === 'textarea').props.value, '离开前的人工摘要')
  assert.equal(find(restored, e => e.props?.role === 'alert').props.children[0], 'errReviewUpdated')
})

test('rightbar shows the conversation action appropriate to its pending interaction', async t => {
  const host = hookHost(); globalThis.__stage5React = host.api
  t.after(() => { delete globalThis.__stage5React })
  const LinkedTaskDetails = await internalComponent(fileURLToPath(new URL('../client-src/rightbar/task-pane.js', import.meta.url)), 'LinkedTaskDetails')
  let opened = 0
  const props = {
    task: { id: 'i', reqId: 'r', title: '任务', status: 'doing', problemOverview: '说明', acceptance: '标准' },
    req: { id: 'r', status: 'in_progress' }, linkState: { link: {} }, proposals: [], delivery: null,
    t: key => key, root: '/tmp/test', sessionId: 's', projectKey: 'p', uiMemory: { drafts: {} }, busy: false,
    act: async () => ({ ok: true }), start() {}, showConversation: () => { opened++ },
    leaveRef: { current: null }, toolbar: () => null, notices: null,
  }
  for (const [kind, label, description] of [
    ['approval', 'goAuthorize', 'runWaiting'], ['question', 'viewConversation', 'runInteraction'],
    ['plan-review', 'viewConversation', 'runInteraction'], ['future-kind', 'viewConversation', 'runInteraction'],
  ]) {
    const runView = taskRunView({ running: true, pendingInteraction: { kind } }, null)
    const tree = host.render(LinkedTaskDetails, { ...props, runView })
    const button = find(tree, node => node.type === 'button' && node.props.children.includes(label))
    assert.ok(button, kind)
    assert.ok(find(tree, node => node.type === 'p' && node.props.children.includes(description)), kind)
    assert.equal(find(tree, node => node.type === 'button' && node.props.children.includes('startTask')), null)
    button.props.onClick()
  }
  assert.equal(opened, 4)
})

test('rightbar keeps an in-progress delivery draft when a refresh reports the requirement submitted', async t => {
  installFetch(t)
  const ctx = await fixture(t)
  const original = await ctx.view()
  const task = { ...original.issues[0], reqId: ctx.reqId }
  const parent = hookHost(); const editor = hookHost()
  globalThis.__stage5React = parent.api
  const LinkedTaskDetails = await internalComponent(fileURLToPath(new URL('../client-src/rightbar/task-pane.js', import.meta.url)), 'LinkedTaskDetails')
  const props = {
    task, req: original, runView: { locked: false }, linkState: { link: {} }, proposals: [],
    delivery: { status: 'failed' }, t: x => x, root: ctx.root, sessionId: 'test', projectKey: 'test',
    uiMemory: { drafts: {} }, busy: false, act: async () => ({ ok: true }),
    leaveRef: { current: null }, toolbar: () => null, notices: null,
  }
  let parentTree = parent.render(LinkedTaskDetails, props)
  const firstEditor = find(parentTree, e => e.type?.name === 'ManualDelivery')
  assert.ok(firstEditor)
  globalThis.__stage5React = editor.api
  const ManualDelivery = await component(fileURLToPath(new URL('../client-src/detail/requirement-content.js', import.meta.url)), 'ManualDelivery')
  let editorTree = editor.render(ManualDelivery, firstEditor.props)
  find(editorTree, e => e.type === 'textarea').props.onChange({ target: { value: '右栏未保存的摘要' } })
  // A transient missing requirement must not unmount or dereference the draft.
  globalThis.__stage5React = parent.api
  parentTree = parent.render(LinkedTaskDetails, { ...props, req: null })
  const duringMissingRead = find(parentTree, e => e.type?.name === 'ManualDelivery')
  assert.ok(duringMissingRead)
  assert.equal(duringMissingRead.props.req.id, original.id)
  globalThis.__stage5React = editor.api
  editorTree = editor.render(ManualDelivery, duringMissingRead.props)
  assert.equal(find(editorTree, e => e.type === 'textarea').props.value, '右栏未保存的摘要')
  // Polling replaces the requirement prop after a separate submit wins.
  await store.submitRequirement(ctx.root, ctx.reqId, { summary: '新的交付摘要', actor: 'system', expectFingerprint: store.deliveryFingerprint(original) })
  const pending = await ctx.view()
  globalThis.__stage5React = parent.api
  parentTree = parent.render(LinkedTaskDetails, { ...props, req: pending, delivery: { status: 'done' } })
  const keptEditor = find(parentTree, e => e.type?.name === 'ManualDelivery')
  assert.ok(keptEditor, 'the same editor stays mounted rather than being replaced')
  assert.equal(keptEditor.props.key, firstEditor.props.key)
  globalThis.__stage5React = editor.api
  editorTree = editor.render(ManualDelivery, keptEditor.props)
  assert.equal(find(editorTree, e => e.type === 'textarea').props.value, '右栏未保存的摘要')
  assert.equal(find(editorTree, e => e.props?.role === 'alert').props.children[0], 'errDeliveryStatusChanged')
  assert.equal(find(editorTree, e => e.type?.name === 'DeliveryResult').props.req.deliverySummary, '新的交付摘要')
  assert.equal(find(editorTree, e => e.type === 'button' && e.props.type === 'submit').props.disabled, true)
  // Switching away remounts task details. Returning to this requirement in the
  // same project restores its own draft; another project cannot inherit it.
  const restoredHost = hookHost(); globalThis.__stage5React = restoredHost.api
  const RestoredDetails = await internalComponent(fileURLToPath(new URL('../client-src/rightbar/task-pane.js', import.meta.url)), 'LinkedTaskDetails')
  const restored = find(restoredHost.render(RestoredDetails, { ...props, req: pending, delivery: { status: 'done' } }), e => e.type?.name === 'ManualDelivery')
  assert.ok(restored)
  const restoredEditorHost = hookHost(); globalThis.__stage5React = restoredEditorHost.api
  const RestoredEditor = await component(fileURLToPath(new URL('../client-src/detail/requirement-content.js', import.meta.url)), 'ManualDelivery')
  assert.equal(find(restoredEditorHost.render(RestoredEditor, restored.props), e => e.type === 'textarea').props.value, '右栏未保存的摘要')
  const otherHost = hookHost(); globalThis.__stage5React = otherHost.api
  const OtherDetails = await internalComponent(fileURLToPath(new URL('../client-src/rightbar/task-pane.js', import.meta.url)), 'LinkedTaskDetails')
  const other = find(otherHost.render(OtherDetails, { ...props, projectKey: 'other-project' }), e => e.type?.name === 'ManualDelivery')
  assert.ok(other)
  assert.notEqual(other.props.draftKey, restored.props.draftKey)
  const otherEditorHost = hookHost(); globalThis.__stage5React = otherEditorHost.api
  const OtherEditor = await component(fileURLToPath(new URL('../client-src/detail/requirement-content.js', import.meta.url)), 'ManualDelivery')
  assert.equal(find(otherEditorHost.render(OtherEditor, other.props), e => e.type === 'textarea').props.value, '')
  const otherReqHost = hookHost(); globalThis.__stage5React = otherReqHost.api
  const OtherReqDetails = await internalComponent(fileURLToPath(new URL('../client-src/rightbar/task-pane.js', import.meta.url)), 'LinkedTaskDetails')
  const otherReq = { ...original, id: 'another-requirement' }
  const otherTask = { ...task, id: 'another-task', reqId: otherReq.id }
  const another = find(otherReqHost.render(OtherReqDetails, { ...props, task: otherTask, req: otherReq }), e => e.type?.name === 'ManualDelivery')
  assert.ok(another)
  assert.notEqual(another.props.draftKey, restored.props.draftKey)
  const anotherEditorHost = hookHost(); globalThis.__stage5React = anotherEditorHost.api
  const AnotherEditor = await component(fileURLToPath(new URL('../client-src/detail/requirement-content.js', import.meta.url)), 'ManualDelivery')
  assert.equal(find(anotherEditorHost.render(AnotherEditor, another.props), e => e.type === 'textarea').props.value, '')
})

test('acceptance confirmation passes the displayed snapshot and rejects a refreshed task before confirming again', async t => {
  installFetch(t)
  const ctx = await fixture(t, true)
  const original = await ctx.view()
  const host = hookHost(); globalThis.__stage5React = host.api
  const ReasonModal = await component(fileURLToPath(new URL('../client-src/shared/modals.js', import.meta.url)), 'ReasonModal')
  const calls = []
  const modal = { kind: 'confirmComplete', req: original, onOk: async reviewed => {
    const res = await dispatch('requirement/move', { root: ctx.root, id: ctx.reqId, to: 'completed', fileHash: reviewed.hash, expectFingerprint: await deliveryFingerprint(reviewed) }, new AbortController().signal)
    calls.push(res); return res
  } }
  let props = { modal, root: ctx.root, t: x => x, setModal() {}, requirements: [original] }
  host.render(ReasonModal, props)
  await changeTask(ctx)
  props = { ...props, requirements: [await ctx.view()] }
  let tree = host.render(ReasonModal, props)
  const confirm = tree.props.actions[1]
  await confirm.props.onClick()
  assert.equal(calls[0].code, 'ROUND_CHANGED')
  assert.equal((await ctx.view()).status, 'pending')
  tree = host.render(ReasonModal, props)
  assert.ok(find(tree, e => e.type?.name === 'ErrorDetails' && e.props.error?.code === 'REVIEW_CONTENT_UPDATED'))
  // A requirement edit after the first re-check also invalidates the page.
  const reqPath = join(ctx.root, '.project', 'requirements', ctx.reqId, 'requirement.md')
  const raw = await readFile(reqPath, 'utf8')
  await writeFile(reqPath, raw.replace(/^updated: .+$/m, 'updated: 2026-11-16T12:01:00.000Z'))
  await tree.props.actions[1].props.onClick()
  assert.equal(calls[1].code, 'CONFLICT')
  assert.equal((await ctx.view()).status, 'pending')
  tree = host.render(ReasonModal, props)
  await tree.props.actions[1].props.onClick()
  assert.equal(calls[2].ok, true)
  assert.equal((await ctx.view()).status, 'completed')
})

test('human delivery and acceptance reject an incomplete task scan even when the visible task is done', async t => {
  const ctx = await fixture(t)
  const second = (await store.createIssue(ctx.root, ctx.reqId, '另一个任务')).data.id
  await store.updateIssue(ctx.root, ctx.reqId, second, { problemOverview: '问题', acceptance: '标准', resultSummary: '结果', evidence: '依据' })
  await store.moveIssue(ctx.root, ctx.reqId, second, 'done', { fileHash: await issueFileHash(ctx.root, ctx.reqId, second) })
  const path = join(ctx.root, '.project', 'requirements', ctx.reqId, 'issues', `${second}.md`)
  const original = await readFile(path, 'utf8')
  const call = (method, input) => dispatch(method, input, new AbortController().signal)
  await writeFile(path, '内容损坏，缺少 frontmatter')
  let shown = await ctx.view()
  assert.equal(shown.issues.length, 1) // the damaged task is omitted from the scan
  let res = await call('requirement/submit', { root: ctx.root, id: ctx.reqId, summary: '摘要', expectFingerprint: store.deliveryFingerprint(shown) })
  assert.equal(res.code, 'DELIVERY_DATA_INCOMPLETE')
  assert.equal((await ctx.view()).status, 'in_progress')
  await writeFile(path, original)
  shown = await ctx.view()
  res = await call('requirement/submit', { root: ctx.root, id: ctx.reqId, summary: '摘要', expectFingerprint: store.deliveryFingerprint(shown) })
  assert.equal(res.ok, true)
  await writeFile(path, '内容损坏，缺少 frontmatter')
  shown = await ctx.view()
  res = await call('requirement/move', { root: ctx.root, id: ctx.reqId, to: 'completed', fileHash: shown.hash, expectFingerprint: store.deliveryFingerprint(shown) })
  assert.equal(res.code, 'DELIVERY_DATA_INCOMPLETE')
  assert.equal((await ctx.view()).status, 'pending')
  await writeFile(path, original)
  shown = await ctx.view()
  res = await call('requirement/move', { root: ctx.root, id: ctx.reqId, to: 'completed', fileHash: shown.hash, expectFingerprint: store.deliveryFingerprint(shown) })
  assert.equal(res.ok, true)
})
