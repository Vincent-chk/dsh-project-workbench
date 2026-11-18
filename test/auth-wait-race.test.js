// Exercise the real shell callbacks across a delayed run/list response.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { defaultViewState } from '../client-src/shell/nav-state.js'

const require = createRequire(import.meta.url)
const entry = fileURLToPath(new URL('../client-src/shell/main-shell.js', import.meta.url))
const compiled = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'race-react', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'race-react' }))
    b.onLoad({ filter: /.*/, namespace: 'race-react' }, () => ({ contents: 'export default globalThis.__authRaceReact', loader: 'js' }))
  } }] })

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

function find(tree, fn) {
  if (!tree || typeof tree !== 'object') return null
  if (fn(tree)) return tree
  for (const child of (tree.props?.children ?? []).flat(Infinity)) {
    const found = find(child, fn)
    if (found) return found
  }
  return null
}

function shellHost() {
  const slots = []
  let cursor = 0, stateOrdinal = 0
  const data = { project: { name: '隔离项目' }, requirements: [], diagnostics: [] }
  const api = {
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) { return { type, props: { ...props, children } } },
    useState(initial) {
      const i = cursor++, ordinal = stateOrdinal++
      if (!(i in slots)) slots[i] = ordinal === 2 ? data : (typeof initial === 'function' ? initial() : initial)
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }]
    },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useCallback(fn) { return fn },
    useEffect() {},
  }
  return { api, render(Component, props) { cursor = 0; stateOrdinal = 0; return Component(props) } }
}

test('first risk-page read retries a changed approval once and binds the returned time to the new request', async t => {
  const host = shellHost()
  const oldReact = globalThis.__authRaceReact, oldFetch = globalThis.fetch
  globalThis.__authRaceReact = host.api
  t.after(() => { globalThis.__authRaceReact = oldReact; globalThis.fetch = oldFetch })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(mod, mod.exports, require)
  let statuses = new Map()
  const workspace = { workspaceId: 'w', path: '/isolated', title: '隔离' }
  const memory = { picked: { id: 'w' }, views: { 'id:w': { ...defaultViewState(), page: 'blocked' } },
    drafts: {}, newRequirements: {}, wikiGen: {}, taskReviews: {} }
  const props = { t: key => key, css: '', uiMemory: memory, useCurrentSession: cb => cb(undefined),
    useSessions: cb => cb({ byId: {} }), useSessionStatus: cb => cb(statuses),
    useWorkspaces: cb => cb({ items: [workspace] }) }
  const renderWb = () => find(host.render(mod.exports.MainShell, props), node => node.props?.wb)?.props.wb
  const first = deferred()
  const askedAt = Date.now() - 5000
  const facts = [{ reqId: 'r', issueId: 'i', sessionId: 's', sessionIds: ['s'], approvalRequests: [
    { sessionId: 's', approvalId: 'id', callId: 'call', toolName: 'bash', askedAt },
  ] }]
  let reads = 0
  globalThis.fetch = async (_url, options) => {
    const { method } = JSON.parse(options.body)
    if (method === 'run/list') {
      reads++
      return { json: () => reads === 1 ? first.promise : Promise.resolve({ ok: true, data: { runs: facts } }) }
    }
    if (method === 'proposal/list') return { json: async () => ({ ok: true, data: { proposals: [] } }) }
    throw new Error('unexpected RPC ' + method)
  }
  const pending = renderWb().refreshBlocked()
  statuses = new Map([['s', { pendingInteraction: { kind: 'approval', sessionId: 's', key: 'approval:1', callId: 'call', toolName: 'bash' } }]])
  renderWb() // update the shell's current status while the first Host read is delayed
  first.resolve({ ok: true, data: { runs: facts } })
  await pending
  const wb = renderWb()
  assert.equal(reads, 2)
  assert.equal(wb.authDetails.get('i').askedAt, askedAt)
  assert.equal(wb.runError, null)
})

test('a second change during the risk-page retry stops the chain and exposes a retryable read error', async t => {
  const host = shellHost()
  const oldReact = globalThis.__authRaceReact, oldFetch = globalThis.fetch
  globalThis.__authRaceReact = host.api
  t.after(() => { globalThis.__authRaceReact = oldReact; globalThis.fetch = oldFetch })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(mod, mod.exports, require)
  let statuses = new Map()
  const memory = { picked: { id: 'w' }, views: { 'id:w': { ...defaultViewState(), page: 'blocked' } },
    drafts: {}, newRequirements: {}, wikiGen: {}, taskReviews: {} }
  const props = { t: key => key, css: '', uiMemory: memory, useCurrentSession: cb => cb(undefined),
    useSessions: cb => cb({ byId: {} }), useSessionStatus: cb => cb(statuses),
    useWorkspaces: cb => cb({ items: [{ workspaceId: 'w', path: '/isolated', title: '隔离' }] }) }
  const renderWb = () => find(host.render(mod.exports.MainShell, props), node => node.props?.wb)?.props.wb
  const first = deferred(), second = deferred(), secondStarted = deferred()
  const facts = [{ reqId: 'r', issueId: 'i', sessionId: 's', sessionIds: ['s'], approvalRequests: [
    { sessionId: 's', approvalId: 'id', callId: 'call', toolName: 'bash', askedAt: Date.now() - 1000 },
  ] }]
  let reads = 0
  globalThis.fetch = async (_url, options) => {
    const { method } = JSON.parse(options.body)
    if (method === 'run/list') {
      reads++
      if (reads === 2) secondStarted.resolve()
      return { json: () => reads === 1 ? first.promise : second.promise }
    }
    if (method === 'proposal/list') return { json: async () => ({ ok: true, data: { proposals: [] } }) }
    throw new Error('unexpected RPC ' + method)
  }
  const pending = renderWb().refreshBlocked()
  const statusFor = key => new Map([['s', { pendingInteraction: { kind: 'approval', sessionId: 's', key, callId: 'call', toolName: 'bash' } }]])
  statuses = statusFor('approval:1')
  renderWb()
  first.resolve({ ok: true, data: { runs: facts } })
  await secondStarted.promise
  statuses = statusFor('approval:2')
  renderWb()
  second.resolve({ ok: true, data: { runs: facts } })
  await pending
  const wb = renderWb()
  assert.equal(reads, 2)
  assert.equal(wb.runError.code, 'READ_FAILED')
  assert.match(wb.runError.message, /重试/)
})
