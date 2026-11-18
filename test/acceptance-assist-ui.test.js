import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const reactStub = { name: 'react-stub', setup(b) {
  b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'react-stub' }))
  b.onLoad({ filter: /.*/, namespace: 'react-stub' }, () => ({ contents: 'export default globalThis.__acceptanceReact', loader: 'js' }))
} }
async function load() {
  const out = await build({ entryPoints: [fileURLToPath(new URL('../client-src/detail/acceptance-assist.js', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports.AcceptanceAssist
}
function host() {
  let state = [], cursor = 0, effects = []
  const api = {
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) { return { type, props: { ...props, children } } },
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial
      return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] },
    useRef(initial) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i] },
    useEffect(fn, deps) {
      const i = cursor++, previous = state[i]
      if (!previous || deps.some((dep, n) => dep !== previous.deps[n])) {
        effects.push(() => { previous?.cleanup?.(); state[i] = { deps, cleanup: fn() } })
      }
    },
  }
  return {
    api,
    render(Component, props) { cursor = 0; effects = []; const tree = Component(props); effects.forEach(fn => fn()); return tree },
    unmount() { for (const item of state) item?.cleanup?.() },
  }
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null
  if (predicate(tree)) return tree
  for (const item of (tree.props?.children ?? []).flat(Infinity)) {
    const found = find(item, predicate)
    if (found) return found
  }
  return null
}
const button = name => node => node.type === 'button' && node.props.children.includes(name)
const issue = { id: 'i', title: '任务一', status: 'in_review', hash: 'i1' }
const req = { id: 'r', status: 'in_progress', hash: 'r1', issues: [issue] }
const props = { root: '/sample', req, issue, sessionId: 'session-parent', t: key => key }

test('verification is explicit, binds the selected task, and separates real command records from the AI report', async t => {
  const env = host(), before = globalThis.fetch
  globalThis.__acceptanceReact = env.api
  const calls = []
  globalThis.fetch = async (_url, options) => { calls.push(JSON.parse(options.body)); return { json: async () => ({ ok: true, data: {
    kind: 'verify', report: '模型认为测试覆盖了部分标准', commands: [{ command: 'node --test', outcome: 'exit:0', output: '3 passed' }], stale: false,
  } }) } }
  t.after(() => { globalThis.fetch = before; delete globalThis.__acceptanceReact })
  const View = await load()
  const tree = env.render(View, props)
  assert.equal(calls.length, 0)
  assert.ok(find(tree, node => node.props?.children?.includes('acceptanceVerifyNotice')))
  await find(tree, button('acceptanceVerify')).props.onClick()
  assert.deepEqual(calls[0], { method: 'acceptance/assist', input: { root: '/sample', reqId: 'r', issueId: 'i', sessionId: 'session-parent', kind: 'verify' } })
  const rendered = JSON.stringify(env.render(View, props))
  for (const text of ['acceptanceReport', '模型认为测试覆盖了部分标准', 'acceptanceCommands', 'node --test', 'acceptanceCommandOk', '3 passed']) assert.ok(rendered.includes(text), text)
  const changed = JSON.stringify(env.render(View, { ...props, req: { ...req, hash: 'r2' } }))
  assert.ok(changed.includes('acceptanceStale'))
  const other = JSON.stringify(env.render(View, { ...props, root: '/other' }))
  assert.ok(!other.includes('模型认为测试覆盖了部分标准'))
})

test('a zero-exit command with failing tests remains visibly failed', async t => {
  const env = host(), before = globalThis.fetch
  globalThis.__acceptanceReact = env.api
  globalThis.fetch = async () => ({ json: async () => ({ ok: true, data: {
    report: '检查已运行', commands: [{ command: 'npm test || true', outcome: 'exit:0', testConclusion: 'failed', testSummary: 'not ok 1', output: 'not ok 1' }],
  } }) })
  t.after(() => { globalThis.fetch = before; delete globalThis.__acceptanceReact })
  const View = await load()
  await find(env.render(View, props), button('acceptanceVerify')).props.onClick()
  const rendered = JSON.stringify(env.render(View, props))
  assert.ok(rendered.includes('acceptanceCommandOk'))
  assert.ok(rendered.includes('acceptanceTestFailed'))
  assert.ok(rendered.includes('not ok 1'))
  assert.ok(!rendered.includes('acceptanceTestPassed'))
  // The condensed sidebar keeps a failure visible even while its long report is closed.
  const sidebar = env.render(View, { ...props, compact: true })
  const report = find(sidebar, node => node.type === 'details' && node.props.children[0].props.children.includes('acceptanceCheckReport'))
  assert.ok(report && !report.props.open)
  assert.ok(find(report, node => node.props?.children?.includes('not ok 1')))
  assert.ok(find(sidebar, node => node.props?.role === 'status' && node.props.children.includes('acceptanceTestFailed')))
})

test('a previous report is marked stale during and after an unsuccessful retry', async t => {
  const env = host(), before = globalThis.fetch
  globalThis.__acceptanceReact = env.api
  let resolve, attempt = 0
  globalThis.fetch = () => {
    if (!attempt++) return Promise.resolve({ json: async () => ({ ok: true, data: { report: '旧检查结果', commands: [] } }) })
    return new Promise(r => { resolve = r })
  }
  t.after(() => { globalThis.fetch = before; delete globalThis.__acceptanceReact })
  const View = await load()
  await find(env.render(View, props), button('acceptanceVerify')).props.onClick()
  assert.ok(!JSON.stringify(env.render(View, props)).includes('acceptanceStale'))
  const second = find(env.render(View, props), button('acceptanceVerify')).props.onClick()
  assert.ok(JSON.stringify(env.render(View, props)).includes('acceptanceRetryStale'))
  resolve({ json: async () => ({ ok: false, code: 'FAILED', message: '检查失败' }) })
  await second
  const rendered = JSON.stringify(env.render(View, props))
  assert.ok(rendered.includes('acceptanceRetryStale'))
  assert.ok(rendered.includes('acceptanceHelpError'))
})

test('the pending run and its result survive leaving and returning within the same window', async t => {
  const before = globalThis.fetch, first = host(), memory = {}, running = []
  globalThis.__acceptanceReact = first.api
  let resolve, calls = 0
  globalThis.fetch = () => { calls++; return new Promise(r => { resolve = r }) }
  t.after(() => { globalThis.fetch = before; delete globalThis.__acceptanceReact })
  const View = await load()
  const options = { ...props, memory, onRunningChange: value => running.push(value) }
  const request = find(first.render(View, options), button('acceptanceVerify')).props.onClick()
  assert.equal(running.at(-1), true)
  first.unmount()
  assert.equal(running.at(-1), false)
  const second = host(); globalThis.__acceptanceReact = second.api
  const Again = await load()
  let tree = second.render(Again, options)
  assert.equal(running.at(-1), true)
  assert.equal(find(tree, button('acceptanceVerify')).props.disabled, true)
  await find(tree, button('acceptanceVerify')).props.onClick()
  assert.equal(calls, 1)
  resolve({ json: async () => ({ ok: true, data: { report: '已返回检查记录', commands: [] } }) })
  await request
  assert.equal(running.at(-1), false)
  tree = second.render(Again, options)
  assert.ok(JSON.stringify(tree).includes('已返回检查记录'))
  second.unmount()
  const third = host(); globalThis.__acceptanceReact = third.api
  const Last = await load()
  assert.ok(JSON.stringify(third.render(Last, options)).includes('已返回检查记录'))
})

test('unreadable execution records and unsupported guide sources remain clearly unverified', async t => {
  const env = host(), before = globalThis.fetch
  globalThis.__acceptanceReact = env.api
  globalThis.fetch = async (_url, options) => {
    const { kind } = JSON.parse(options.body).input
    return { json: async () => ({ ok: true, data: kind === 'verify'
      ? { report: '检查已尝试', commands: [], commandsUnavailable: true, childId: 'session-child' }
      : { guideStatus: 'steps', steps: [{ action: '打开设置。', expected: '显示设置页。' }],
        sourcesRequested: 2, sources: [{ path: 'README.md', quote: '入口说明' }] } }) }
  }
  t.after(() => { globalThis.fetch = before; delete globalThis.__acceptanceReact })
  const View = await load()
  await find(env.render(View, props), button('acceptanceVerify')).props.onClick()
  let rendered = JSON.stringify(env.render(View, props))
  assert.ok(rendered.includes('acceptanceCommandsUnavailable'))
  assert.ok(!rendered.includes('acceptanceNoCommands'))
  assert.ok(rendered.includes('session-child'))
  await find(env.render(View, props), button('acceptanceGuide')).props.onClick()
  const guide = env.render(View, props)
  rendered = JSON.stringify(guide)
  const steps = find(guide, node => node.type === 'ol')
  assert.ok(JSON.stringify(steps).includes('打开设置。'))
  assert.ok(JSON.stringify(steps).includes('显示设置页。'))
  for (const text of ['acceptanceSourcesInsufficient', 'acceptanceSourcesScope', 'README.md', '入口说明', 'acceptanceSourceLimit']) assert.ok(rendered.includes(text), text)
  globalThis.fetch = async () => ({ json: async () => ({ ok: true, data: { guideStatus: 'not_needed' } }) })
  await find(env.render(View, props), button('acceptanceGuide')).props.onClick()
  const skipped = env.render(View, props)
  assert.equal(find(skipped, node => node.type === 'ol'), null)
  assert.ok(find(skipped, node => node.props?.role === 'status' && node.props.children.includes('acceptanceGuideNotNeeded')))
})

test('only tasks awaiting acceptance show assistance; no command is never a passed test', async t => {
  const env = host(), before = globalThis.fetch
  globalThis.__acceptanceReact = env.api
  let calls = 0
  globalThis.fetch = async () => { calls++; return { json: async () => ({ ok: true, data: { report: '没有可用的自动测试', commands: [] } }) } }
  t.after(() => { globalThis.fetch = before; delete globalThis.__acceptanceReact })
  const View = await load()
  for (const status of ['todo', 'doing', 'blocked', 'done', 'cancelled']) {
    assert.equal(find(env.render(View, { ...props, issue: { ...issue, status } }), button('acceptanceVerify')), null)
  }
  assert.equal(find(env.render(View, { ...props, req: { ...req, status: 'pending' } }), button('acceptanceVerify')), null)
  assert.equal(calls, 0)
  await find(env.render(View, props), button('acceptanceVerify')).props.onClick()
  assert.equal(calls, 1)
  const rendered = JSON.stringify(env.render(View, props))
  assert.ok(rendered.includes('acceptanceNoCommands'))
  assert.ok(!rendered.includes('checksPassed'))
})

test('switching between tasks keeps each task’s own result', async t => {
  const env = host(), before = globalThis.fetch
  globalThis.__acceptanceReact = env.api
  globalThis.fetch = async (_url, options) => {
    const { issueId } = JSON.parse(options.body).input
    return { json: async () => ({ ok: true, data: { report: `结果 ${issueId}`, commands: [] } }) }
  }
  t.after(() => { globalThis.fetch = before; delete globalThis.__acceptanceReact })
  const View = await load()
  const first = { ...props, memory: {} }
  const other = { ...first, issue: { ...issue, id: 'i2', hash: 'i2' } }
  await find(env.render(View, first), button('acceptanceVerify')).props.onClick()
  assert.ok(JSON.stringify(env.render(View, first)).includes('"结果 i"'))
  assert.ok(!JSON.stringify(env.render(View, other)).includes('"结果 i"'))
  await find(env.render(View, other), button('acceptanceVerify')).props.onClick()
  assert.ok(JSON.stringify(env.render(View, other)).includes('"结果 i2"'))
  const returned = JSON.stringify(env.render(View, first))
  assert.ok(returned.includes('"结果 i"'))
  assert.ok(!returned.includes('"结果 i2"'))
})

test('guide warns that it is a draft, failure remains visible, and a response from another project is not shown', async t => {
  const env = host(), before = globalThis.fetch
  globalThis.__acceptanceReact = env.api
  let resolve
  globalThis.fetch = () => new Promise(r => { resolve = r })
  t.after(() => { globalThis.fetch = before; delete globalThis.__acceptanceReact })
  const View = await load()
  let tree = env.render(View, props)
  assert.ok(JSON.stringify(tree).includes('acceptanceGuideNotice'))
  const request = find(tree, button('acceptanceGuide')).props.onClick()
  tree = env.render(View, props)
  assert.equal(find(tree, button('acceptanceGuide')).props.disabled, true)
  env.render(View, { ...props, root: '/other' })
  resolve({ json: async () => ({ ok: true, data: { guideStatus: 'steps', steps: [{ action: '旧项目内容', expected: '旧项目结果' }] } }) })
  await request
  assert.ok(!JSON.stringify(env.render(View, { ...props, root: '/other' })).includes('旧项目内容'))
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, code: 'FAILED', message: '未执行' }) })
  await find(env.render(View, props), button('acceptanceGuide')).props.onClick()
  const failed = JSON.stringify(env.render(View, props))
  assert.ok(failed.includes('acceptanceHelpError'))
  assert.ok(failed.includes('FAILED'))
  assert.ok(failed.includes('未执行'))
})
