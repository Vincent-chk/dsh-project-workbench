import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const react = {
  Fragment: Symbol('fragment'),
  createElement(type, props, ...children) { return { type, props: { ...props, children } } },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  useRef(initial) { return { current: initial } },
  useEffect(callback) { effects.push(callback) },
}
let effects = []
const reactStub = {
  name: 'board-test-react', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'board-test-react' }))
    b.onLoad({ filter: /.*/, namespace: 'board-test-react' }, () => ({ contents: 'export default globalThis.__boardReact', loader: 'js' }))
  },
}
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../client-src/pages/board.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })

test('filtered-out board cards cannot be opened or moved by keyboard', async t => {
  const previousWindow = globalThis.window
  const previousReact = globalThis.__boardReact
  t.after(() => { globalThis.window = previousWindow; globalThis.__boardReact = previousReact })
  globalThis.__boardReact = react
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(mod, mod.exports, require)
  const listeners = []
  globalThis.window = { addEventListener(_name, callback) { listeners.push(callback) } }
  const req = { id: 'r1', title: '隐藏需求', status: 'ready', issues: [], reviews: [], derived: {} }
  const moved = [], opened = []
  const wb = query => ({
    t: key => key, requirements: [req], saving: false, modal: null,
    setModal() {}, doMove: (...args) => moved.push(args), navigate() {}, openDetail: (...args) => opened.push(args),
    setFilter() {}, setFocusTarget() {}, nav: { params: null, filters: { board: { query, cursor: 'r1' } } },
  })
  const render = query => {
    effects = []
    mod.exports.BoardPage({ wb: wb(query) })
    return effects.at(-1)
  }
  const key = key => ({ key, target: { tagName: 'DIV', isContentEditable: false }, preventDefault() {} })
  render('zzstage6none')()
  listeners.at(-1)(key('L'))
  listeners.at(-1)(key('Enter'))
  assert.deepEqual(moved, [])
  assert.deepEqual(opened, [])

  render('')()
  listeners.at(-1)(key('L'))
  assert.deepEqual(moved, [[req, 'in_progress']])
})
