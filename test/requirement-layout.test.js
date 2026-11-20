import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const reactStub = {
  name: 'requirement-layout-react',
  setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'layout-test' }))
    builder.onLoad({ filter: /.*/, namespace: 'layout-test' }, () => ({ contents: 'export default globalThis.__requirementLayoutReact', loader: 'js' }))
  },
}
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../client-src/detail/requirement-layout.js', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub],
})

const defaultOrder = ['basic', 'prds', 'review', 'tasks', 'development', 'delivery', 'log']
const blocks = Object.fromEntries(defaultOrder.map(id => [id, { label: id, body: id }]))

function all(tree, matches) {
  if (Array.isArray(tree)) return tree.flatMap(item => all(item, matches))
  if (!tree || typeof tree !== 'object') return []
  return [...(matches(tree) ? [tree] : []), ...all(tree.props.children, matches)]
}
const details = tree => all(tree, node => node.type === 'details')
const blockId = node => node.props.id.replace('pw-requirement-block-', '')
const displayed = tree => details(tree).map(blockId)
const exposed = tree => details(tree).filter(node => node.props.open).map(blockId)
const sortRow = (tree, id) => all(tree, node => node.props['data-requirement-sort-row'] === id)[0]
const button = (tree, label) => all(tree, node => node.type === 'button' &&
  (node.props['aria-label'] === label || node.props.children.includes(label)))[0]

function layoutHost(t) {
  const stored = new Map()
  const globals = {
    __requirementLayoutReact: {
      createElement(type, props, ...children) { return { type, props: { ...props, children } } },
      useState(initial) {
        const frame = current
        const index = frame.next++
        if (!(index in frame.state)) frame.state[index] = typeof initial === 'function' ? initial() : initial
        return [frame.state[index], update => {
          frame.state[index] = typeof update === 'function' ? update(frame.state[index]) : update
        }]
      },
      useRef(initial) {
        const index = current.next++
        return current.state[index] ??= { current: initial }
      },
      useEffect(effect) { current.effects.push(effect) },
    },
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key),
    },
    document: {
      elementFromPoint() {
        return hovered && {
          closest: () => ({ dataset: { requirementSortRow: hovered }, getBoundingClientRect: () => ({ top: 20, height: 20 }) }),
        }
      },
    },
  }
  let current
  let hovered
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous)
      else delete globalThis[name]
    })
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(mod, mod.exports, require)
  const { RequirementLayout, requirementBlockOrder, requirementLayoutLocale } = mod.exports
  const translate = key => requirementLayoutLocale.en[key] ?? key
  function mount(initial = {}) {
    const frame = { state: [] }
    let props = { blocks, layoutKey: 'project-a/requirement-a', status: 'backlog', uiMemory: {}, t: translate, onFinish() {}, ...initial }
    return overrides => {
      props = { ...props, ...overrides }
      current = frame
      frame.next = 0
      frame.effects = []
      const tree = RequirementLayout(props)
      for (const effect of frame.effects) effect()
      return tree
    }
  }
  return { mount, requirementBlockOrder, stored, hover: id => { hovered = id } }
}

test('all seven sections exist in each phase and only the phase defaults start open', t => {
  const host = layoutHost(t)
  const render = host.mount()
  for (const [status, expected] of Object.entries({
    backlog: ['basic', 'prds'],
    reviewing: ['prds', 'review'],
    ready: ['basic', 'review'],
    in_progress: ['tasks', 'development'],
    pending: ['tasks', 'delivery'],
    completed: ['delivery'],
  })) {
    const tree = render({ status })
    assert.deepEqual(displayed(tree), defaultOrder)
    assert.deepEqual(exposed(tree), expected)
  }
  const log = details(render()).find(node => blockId(node) === 'log')
  const control = { open: true }
  log.props.onToggle({ target: control, currentTarget: control })
  assert.deepEqual(exposed(render()), ['delivery', 'log'])
  assert.deepEqual(exposed(render({ status: 'in_progress' })), ['tasks', 'development'])
})

test('section order saves only movable IDs and is isolated by requirement and project', t => {
  const host = layoutHost(t)
  assert.deepEqual(host.requirementBlockOrder(['log', 'delivery', 'delivery', 'old', 'basic']),
    ['basic', 'delivery', 'prds', 'review', 'tasks', 'development', 'log'])
  const render = host.mount({ arranging: true })
  const tree = render()
  assert.equal(all(tree, node => node.props.className === 'pw-requirement-grip').length, 5)
  for (const id of ['basic', 'log']) {
    assert.equal(all(sortRow(tree, id), node => node.type === 'button').length, 0)
  }
  assert.equal(button(tree, 'moveUp prds').props.disabled, true)
  assert.equal(button(tree, 'moveDown delivery').props.disabled, true)
  button(tree, 'moveUp development').props.onClick()
  const reordered = ['basic', 'prds', 'review', 'development', 'tasks', 'delivery', 'log']
  assert.deepEqual(displayed(render()), reordered)
  button(render(), 'cancel').props.onClick()
  assert.deepEqual(displayed(render()), defaultOrder)
  assert.equal(host.stored.size, 0)

  button(render(), 'moveUp development').props.onClick()
  button(render(), 'Done').props.onClick()
  assert.deepEqual([...host.stored.values()].map(value => JSON.parse(value)), [reordered.slice(1, -1)])
  assert.deepEqual(displayed(host.mount({ status: 'pending' })()), reordered)
  assert.deepEqual(displayed(host.mount({ layoutKey: 'project-a/requirement-b' })()), defaultOrder)
  assert.deepEqual(displayed(host.mount({ layoutKey: 'project-b/requirement-a' })()), defaultOrder)

  button(render(), 'Restore default order').props.onClick()
  button(render(), 'Done').props.onClick()
  assert.equal(host.stored.size, 0)
  assert.deepEqual(displayed(host.mount()()), defaultOrder)
})

test('pointer dragging moves a section and ignores drops on the pinned rows', t => {
  const host = layoutHost(t)
  const render = host.mount({ arranging: true })
  const drag = (id, target, endY, mouseOnly = false) => {
    const tree = render()
    const grip = all(sortRow(tree, id), node => node.props.className === 'pw-requirement-grip')[0]
    const down = { button: 0, pointerId: 5, clientX: 0, clientY: 0, currentTarget: { setPointerCapture() {} } }
    grip.props.onPointerDown(down)
    host.hover(target)
    const end = { ...down, clientY: endY }
    if (mouseOnly) tree.props.onMouseUpCapture({ ...end, pointerId: undefined })
    else {
      grip.props.onPointerMove(end)
      tree.props.onPointerUpCapture(end)
    }
  }
  drag('delivery', 'basic', 25)
  drag('delivery', 'log', 35)
  assert.deepEqual(displayed(render()), defaultOrder)
  drag('delivery', 'prds', 25, true)
  assert.deepEqual(displayed(render()), ['basic', 'delivery', 'prds', 'review', 'tasks', 'development', 'log'])
})
