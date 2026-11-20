import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { deriveRequirement } from '../core/derive.js'

const require = createRequire(import.meta.url)
const node = (type, props, ...children) => ({ type, props: { ...props, children } })
const reactStub = {
  name: 'test-react',
  setup(bundler) {
    bundler.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }))
    bundler.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default globalThis.__pwbListTestReact', loader: 'js' }))
  },
}
const load = async file => {
  const path = fileURLToPath(new URL('../client-src/' + file, import.meta.url))
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require)
  return module.exports
}
function all(tree) {
  if (tree == null || typeof tree === 'boolean') return []
  if (Array.isArray(tree)) return tree.flatMap(all)
  if (typeof tree !== 'object') return [tree]
  return [tree, ...all(tree.props.children)]
}

function setup(t, state = []) {
  const values = [...state]
  globalThis.__pwbListTestReact = {
    createElement: node,
    Fragment: Symbol('fragment'),
    cloneElement: (element, props) => ({ ...element, props: { ...element.props, ...props } }),
    useState: fallback => [values.length ? values.shift() : (typeof fallback === 'function' ? fallback() : fallback), () => {}],
    useEffect() {},
    useLayoutEffect() {},
    useRef: initial => ({ current: initial }),
  }
  t.after(() => { delete globalThis.__pwbListTestReact })
}

const requirement = (title, status, supplementary = {}) => ({ id: title, title, status, ...supplementary })

test('development table compares active work and routes through the original detail and board entry points', async t => {
  setup(t)
  const { DevPage } = await load('pages/development.js')
  const calls = []
  const req = requirement('签到', 'in_progress', {
    activity: ['2026-03-11 12:00 长进展应由详情呈现'],
    issues: ['done', 'cancelled', 'in_review', 'blocked', 'doing', 'todo'].map(status => ({ status })),
  })
  req.derived = deriveRequirement(req, req.issues)
  const labels = { devBlocked: '{n} 个阻塞', devInReview: '{n} 个待验收', cancelledCount: '{n} 项取消' }
  const wb = {
    t: key => labels[key] || key, requirements: [req], nav: { filters: {} },
    openDetail: (...args) => calls.push(args), locateBoard: item => calls.push([item.id]),
  }
  const list = DevPage({ wb })
  const nodes = all(list.type(list.props))
  const columns = nodes.filter(n => n?.type === 'th').map(n => n.props.children[0])
  assert.deepEqual(columns, ['listRequirement', 'listEffectiveProgress', 'listAttention', 'listActions'])
  const progress = nodes.find(n => n?.props?.className === 'pw-list-value')
  assert.deepEqual(all(progress.props.children).filter(n => typeof n !== 'object'), [1, ' / ', 5])
  assert.ok(nodes.includes('1 个阻塞'))
  assert.ok(nodes.includes('1 个待验收'))
  assert.ok(nodes.includes('1 项取消'))
  assert.ok(!nodes.some(n => typeof n === 'string' && n.includes('长进展')))
  nodes.find(n => n?.props?.id === 'pw-list-item-签到').props.onClick()
  nodes.find(n => n?.type === 'button' && n.props.children.includes('locateBoard')).props.onClick()
  assert.deepEqual(calls, [[{ reqId: '签到', issueId: null }, 'dev'], ['签到']])
})

test('ready queue shows canonical positions while searching and only exposes move buttons in sort mode', async t => {
  setup(t, ['project'])
  const { ReadyPage } = await load('pages/requirements.js')
  const calls = []
  const reqs = [
    requirement('登记', 'ready', { order: 1 }),
    requirement('签到', 'ready', { order: 2 }),
    requirement('导出', 'ready', { order: 3 }),
  ]
  const wb = { t: key => key, projectKey: 'project', requirements: reqs, nav: { filters: { ready: { query: '签到' } } },
    reorder: (...args) => calls.push(args) }
  let list = ReadyPage({ wb })
  assert.equal(list.props.items.length, 1)
  let nodes = all(list.type(list.props))
  assert.ok(nodes.includes(2))
  nodes.find(n => n?.props?.['aria-label'] === 'moveUp · 签到').props.onClick()
  assert.deepEqual(calls, [['requirement', null, reqs, '签到', 'up']])
  list = ReadyPage({ wb })
  nodes = all(list.type(list.props))
  assert.ok(!nodes.some(n => n?.props?.['aria-label'] === 'moveUp · 签到'))
})

test('PRD drawer is read-only and full reading outlines only rendered headings', async t => {
  const root = '/example'
  const linked = [{ id: 'p1', revision: 2, title: '签到文档', reqIds: ['r1'] }]
  const prd = {
    ...linked[0], version: 'revision2',
    markdown: '# 签到文档\n<!--\n## 隐藏\n-->\n## 流程\n记录编号。\n```md\n## 示例\n```\n## **验收**\n确认时间。',
  }
  const result = { root, id: 'p1', deleted: false, revision: 0, res: { ok: true, data: prd } }
  setup(t, [0, { root, id: undefined, deleted: false, revision: 0, res: { ok: true, data: linked } },
    '', false, null, '', 0, result, 0, result])
  const { PrdDocuments, PrdReader } = await load('pages/prds.js')
  const opened = []
  const useT = key => key === 'reqPrdCount' ? '{n} 份' : key
  const docs = PrdDocuments({ root, reqId: 'r1', requirements: [], t: useT, readOnly: true,
    activeId: 'p1', onRead() {}, onOpenFull: id => opened.push(id) })
  const drawer = all(docs)
  assert.ok(drawer.includes('签到文档'))
  assert.ok(!drawer.includes('prdNew'))
  assert.ok(!drawer.includes('prdUnlink'))
  assert.ok(!drawer.some(n => n?.type === 'form'))
  const reader = drawer.find(n => n?.type === PrdReader)
  const reading = all(PrdReader(reader.props))
  assert.ok(!reading.includes('edit'))
  reading.find(n => n?.type === 'button' && n.props.children.includes('prdOpenFull')).props.onClick()
  assert.deepEqual(opened, ['p1'])

  const full = all(PrdReader({ root, id: 'p1', requirements: [], t: useT, backLabel: '返回资料抽屉', onBack() {} }))
  assert.ok(full.includes('返回资料抽屉'))
  const outline = full.find(n => n?.type === 'nav')
  const links = all(outline).filter(n => n?.type === 'button').map(n => n.props.children[0])
  assert.deepEqual(links, ['流程', '验收'])
})
