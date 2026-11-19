// Verify navigation keeps the original requirement and correct return destinations.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { defaultViewState, openDetail } from '../client-src/shell/nav-state.js'

const require = createRequire(import.meta.url)
const built = await build({ entryPoints: [fileURLToPath(new URL('../client-src/shell/main-shell.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'test-react', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'test-react' }))
    b.onLoad({ filter: /.*/, namespace: 'test-react' }, () => ({ contents: 'export default globalThis.__missingObjectReact', loader: 'js' }))
  } }] })
globalThis.__missingObjectReact = {
  Fragment: Symbol('fragment'),
  createElement: (...args) => globalThis.__missingObjectHost.createElement(...args),
  useState: (...args) => globalThis.__missingObjectHost.useState(...args),
  useRef: (...args) => globalThis.__missingObjectHost.useRef(...args),
  useCallback: (...args) => globalThis.__missingObjectHost.useCallback(...args),
  useEffect: (...args) => globalThis.__missingObjectHost.useEffect(...args),
}
const mod = { exports: {} }
new Function('module', 'exports', 'require', built.outputFiles[0].text)(mod, mod.exports, require)

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null
  if (predicate(tree)) return tree
  for (const child of (tree.props?.children ?? []).flat(Infinity)) {
    const found = find(child, predicate)
    if (found) return found
  }
  return null
}
function renderShell(nav, requirements) {
  let stateNumber = 0
  const data = { project: { name: '隔离项目' }, requirements, diagnostics: [] }
  const react = {
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) { return { type, props: { ...props, children } } },
    useState(initial) { const value = stateNumber++ === 2 ? data : (typeof initial === 'function' ? initial() : initial); return [value, () => {}] },
    useRef(value) { return { current: value } },
    useCallback(fn) { return fn },
    useEffect() {},
  }
  globalThis.__missingObjectHost = react
  const uiMemory = { picked: { id: 'w1' }, views: { 'id:w1': nav }, drafts: {}, newRequirements: {}, wikiGen: {}, taskReviews: {} }
  const words = { errMissing: '找不到此项内容', navBoard: '看板', navHome: '首页', navRecords: '验收记录', navDev: '开发中', backToTasks: '返回任务列表', backToPage: '返回{page}', backToPrevious: '返回上一页' }
  const shell = mod.exports.MainShell({ t: key => words[key] ?? key, css: '', uiMemory,
    useCurrentSession: cb => cb(undefined), useSessions: cb => cb({ byId: {} }),
    useWorkspaces: cb => cb({ items: [{ workspaceId: 'w1', path: '/isolated', title: '隔离项目' }] }),
  })
  return { shell, uiMemory }
}

function renderMissing(nav, requirements) {
  const { shell, uiMemory } = renderShell(nav, requirements)
  const panel = find(shell, node => node.props?.className === 'pw-init' && find(node, child => child.type === 'p' && child.props.children.includes('找不到此项内容')))
  assert.ok(panel, 'missing-object panel is rendered')
  return { button: find(panel, node => node.type === 'button'), uiMemory }
}

test('missing requirement returns to the board with an accurate label', t => {
  t.after(() => { delete globalThis.__missingObjectHost })
  const view = openDetail({ ...defaultViewState(), page: 'board' }, { reqId: 'r1' })
  const { button, uiMemory } = renderMissing(view, [])
  assert.equal(button.props.children[0], '返回看板')
  button.props.onClick()
  assert.equal(uiMemory.views['id:w1'].page, 'board')
  assert.equal(uiMemory.views['id:w1'].params, null)
})

test('missing task, parent and record describe their real return destinations', t => {
  t.after(() => { delete globalThis.__missingObjectHost })
  const req = { id: 'r1', title: '需求', issues: [], reviews: [] }
  const parent = openDetail({ ...defaultViewState(), page: 'dev' }, { reqId: 'r1' })
  const task = openDetail(parent, { reqId: 'r1', issueId: 'i1' })
  assert.equal(renderMissing(task, [req]).button.props.children[0], '返回任务列表')
  assert.equal(renderMissing(task, []).button.props.children[0], '返回上一页')
  const fromHome = openDetail(defaultViewState(), { reqId: 'r1', issueId: 'i1' }, 'dev')
  assert.equal(renderMissing(fromHome, [req]).button.props.children[0], '返回首页')
  const record = openDetail({ ...defaultViewState(), page: 'records' }, { record: { reqId: 'r1', round: 1 } })
  assert.equal(renderMissing(record, []).button.props.children[0], '返回验收记录')
})

test('opening an associated PRD keeps the original requirement detail and its navigation', t => {
  t.after(() => { delete globalThis.__missingObjectHost })
  const req = {
    id: 'r1', title: '通知偏好', status: 'backlog', q_pain: '通知太多', goal: '降低打扰',
    scope: '站内通知', acceptance: '可关闭通知', issues: [], reviews: [],
  }
  const view = openDetail({ ...defaultViewState(), page: 'pool' }, { reqId: req.id, issueId: null })
  const { shell, uiMemory } = renderShell(view, [req])
  const detail = find(shell, node => node.props?.req === req && node.props.onCreateTask)
  assert.ok(detail)
  const documents = detail.props.prdPanel ?? find(shell, node => node.props?.reqId === req.id && node.props.onRead)
  assert.ok(documents)
  documents.props.onRead('prd-1')

  const opened = uiMemory.views['id:w1']
  assert.equal(opened.page, 'pool', 'PRD reading must not replace the requirement page')
  assert.equal(opened.params.reqId, req.id)
  assert.equal(opened.params.prdId, 'prd-1')
  assert.deepEqual(opened.history, view.history)

  const { shell: reading, uiMemory: readingMemory } = renderShell(opened, [req])
  assert.deepEqual(find(reading, node => node.props?.req === req && node.props.onCreateTask)?.props.req, req)
  const stack = find(reading, node => node.props?.className === 'pw-subpage-stack')
  assert.equal(stack.props.children[0].props.req, req)
  const reader = stack.props.children[1]
  assert.equal(reader.props.activeId, 'prd-1')
  reader.props.onRead(null)
  assert.equal(readingMemory.views['id:w1'].params.reqId, req.id)
  assert.equal(readingMemory.views['id:w1'].params.prdId, null)
})
