import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

test('conversation cards refresh when the session event source is unavailable', async t => {
  const original = {
    fetch: globalThis.fetch,
    document: globalThis.document,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    react: globalThis.__conversationReact,
  }
  t.after(() => {
    globalThis.fetch = original.fetch
    globalThis.document = original.document
    globalThis.setTimeout = original.setTimeout
    globalThis.clearTimeout = original.clearTimeout
    globalThis.__conversationReact = original.react
  })
  const state = [], effects = [], timers = new Map()
  let cursor = 0, timerId = 0, cards = []
  globalThis.__conversationReact = {
    Fragment: Symbol('fragment'),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], value => { state[index] = value }]
    },
    useRef(initial) { const index = cursor++; return state[index] ??= { current: initial } },
    useEffect(effect) { if (!(cursor in state)) { state[cursor] = true; effects.push(effect) }; cursor++ },
  }
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
  globalThis.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id }
  globalThis.clearTimeout = id => timers.delete(id)
  globalThis.fetch = async () => ({ json: async () => ({ ok: true, data: { cards } }) })
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../client-src/conversation.js', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['@deepseek-ai/dsh-client-ui-primitives'],
    plugins: [{ name: 'react-stub', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'react-stub' }))
      builder.onLoad({ filter: /.*/, namespace: 'react-stub' }, () => ({ contents: 'export default globalThis.__conversationReact', loader: 'js' }))
    } }],
  })
  const mod = { exports: {} }
  const require = createRequire(import.meta.url)
  const nativeUi = { Button: 'native-button', Modal: 'native-modal' }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports,
    name => name === '@deepseek-ai/dsh-client-ui-primitives' ? nativeUi : require(name))
  const props = { sessionId: 'test-session', t: key => key, css: '', uiMemory: {} }
  const render = () => {
    cursor = 0
    const dock = mod.exports.ConversationDock(props)
    return dock.type(dock.props)
  }
  assert.equal(render().props.children[0], null)
  const cleanup = effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(render().props.children[0], null)
  const poll = [...timers.values()].find(timer => timer.delay === 3000)
  assert.ok(poll)
  cards = [{ id: 'prd-1', kind: 'prd', title: '聊天网页', markdown: '# 聊天网页', requirements: [] }]
  await poll.callback()
  const root = render()
  const tree = root.props.children[0]
  assert.equal(tree.props['aria-label'], 'workbenchConversation')
  const [action] = tree.props.children[1]
  assert.equal(action.props.card.id, 'prd-1')
  state[2] = { id: 'receipt-1', kind: 'resource', state: 'done', type: 'wiki' }
  const withToast = render()
  assert.equal(withToast.type, root.type)
  assert.equal(withToast.props.children[0].type, tree.type)
  assert.equal(withToast.props.children[0].props.children[1][0].props.card.id, 'prd-1')
  state[2] = null
  const resubscribeCleanup = effects[0]()
  assert.equal(render().props.children[0].props.children[1][0].props.card.id, 'prd-1')
  resubscribeCleanup()
  const renderAction = () => { cursor = 20; return action.type(action.props) }
  const row = renderAction()
  assert.equal(row.props.children[1].props.children[0], 'pwbPreviewPrd')
  row.props.children[1].props.onClick()
  let panel = renderAction().props.children[1]
  assert.equal(panel.type, nativeUi.Modal)
  const field = panel.props.children[3].props.children[0].props.children[1]
  field.props.onChange({ target: { value: '# 手动编辑' } })
  // The host Modal forwards the click from its aria-hidden mask to onClose.
  // A second click on the preview button's old position must leave the editor open.
  panel.props.onClose({ currentTarget: { getAttribute: name => name === 'aria-hidden' ? 'true' : null } })
  assert.equal(renderAction().props.children[1]?.type, nativeUi.Modal)
  panel.props.onClose({ currentTarget: { getAttribute: () => null } })
  const collapsed = renderAction()
  assert.equal(collapsed.type, 'div')
  collapsed.props.children[1].props.onClick()
  panel = renderAction().props.children[1]
  assert.equal(panel.props.children[3].props.children[0].props.children[1].props.value, '# 手动编辑')
  panel.props.onClose() // Escape is still an explicit dismissal.
  assert.equal(renderAction().type, 'div')

  const workspaces = [{ workspaceId: 'w1', path: '/isolated' }]
  const memory = { views: {} }
  const receipt = { root: '/isolated', prdId: 'prd-1', reqId: 'req-1' }
  mod.exports.openConversationTarget(receipt, workspaces, memory, () => {})
  assert.equal(memory.views['id:w1'].page, 'pool')
  assert.deepEqual(memory.views['id:w1'].params, { reqId: 'req-1', issueId: null, prdId: 'prd-1' })
  mod.exports.openConversationTarget({ ...receipt, reqId: undefined }, workspaces, memory, () => {})
  assert.equal(memory.views['id:w1'].page, 'prds')
  assert.deepEqual(memory.views['id:w1'].params, { prdId: 'prd-1' })
  cleanup()
})
