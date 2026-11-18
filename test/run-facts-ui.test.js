import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { awaitingAuthSessions, awaitingAuthDetails, snapshotAuthStatus, homeDuringAuthRefresh } from '../client-src/shell/nav-state.js'
import { homeSummary } from '../core/derive.js'

test('approval times require a unique matching current interaction in every linked waiting session', () => {
  const now = Date.now()
  const approval = (sessionId, key, callId = 'call', toolName = 'bash') => ({ kind: 'approval', sessionId, key, callId, toolName })
  const facts = [{ issueId: 'i', sessionId: 'a', sessionIds: ['a', 'b'], approvalRequests: [
    { sessionId: 'a', approvalId: 'r1', callId: 'call', toolName: 'bash', askedAt: now - 1000 },
    { sessionId: 'b', approvalId: 'r2', callId: 'call', toolName: 'bash', askedAt: now - 2000 },
    { sessionId: 'other', approvalId: 'other', callId: 'call', toolName: 'bash', askedAt: now - 5000 },
  ] }]
  const statuses = new Map([['a', { pendingInteraction: approval('a', 'a1') }], ['b', { pendingInteraction: approval('b', 'b1') }]])
  const detail = () => awaitingAuthDetails(facts, statuses).get('i')
  assert.equal(detail().askedAt, now - 2000)
  const firstIdentity = detail().identity
  const frozen = snapshotAuthStatus(statuses)
  statuses.set('a', { pendingInteraction: approval('a', 'a2') })
  assert.notEqual(detail().identity, firstIdentity) // replacement invalidates in-flight replies
  assert.equal(awaitingAuthDetails(facts, frozen).get('i').identity, firstIdentity)
  // Even a producer that mutates its input cannot change the captured identity.
  statuses.get('a').pendingInteraction.key = 'a3'
  assert.equal(awaitingAuthDetails(facts, frozen).get('i').identity, firstIdentity)
  statuses.set('b', { pendingInteraction: approval('b', 'b2', undefined, 'read') })
  assert.equal(detail().askedAt, null) // wrong tool
  statuses.set('b', { pendingInteraction: approval('b', 'b3', '') })
  assert.equal(detail().askedAt, null) // no call id
  statuses.set('b', { pendingInteraction: approval('elsewhere', 'b4') })
  assert.equal(detail().askedAt, null) // different owning session
  statuses.set('b', { pendingInteraction: approval('b', 'b5') })
  facts[0].approvalRequests.push({ sessionId: 'b', approvalId: 'r3', callId: 'call', toolName: 'bash', askedAt: now - 3000 })
  assert.equal(detail().askedAt, null) // two unresolved requests cannot be paired safely
  statuses.set('b', { pendingInteraction: { kind: 'question' } })
  assert.equal(detail().askedAt, now - 1000) // questions do not become approvals
  statuses.set('a', { pendingInteraction: { kind: 'plan-review' } })
  assert.equal(awaitingAuthDetails(facts, statuses).size, 0)
})

test('home describes the matched time as authorization request start', async t => {
  globalThis.__runFactsReact = { createElement: node, Fragment: Symbol('fragment') }
  t.after(() => { delete globalThis.__runFactsReact })
  const HomePage = await component(fileURLToPath(new URL('../client-src/pages/home.js', import.meta.url)), 'HomePage')
  const labels = { waitHour: '已等待 {n} 小时', waitNow: '刚刚', authRequestWait: '授权请求发起：{wait}',
    blockedWaitWithAuth: '阻塞：{wait}；授权请求发起：{auth}', runWaiting: '等待授权' }
  const askedAt = Date.now() - 3600000
  const wb = { t: k => labels[k] ?? k, requirements: [{ id: 'r', title: '需求', status: 'in_progress', issues: [{ id: 'i', title: '任务' }] }],
    runFacts: [{ reqId: 'r', issueId: 'i' }], runError: null, authDetails: new Map([['i', { askedAt }]]),
    awaitingAuthSessions: new Map([['i', 's']]), blocked: { proposals: [], deliveryFailed: [] }, nav: { filters: {} },
    home: { counts: {}, reminders: [{ issueId: 'i', reqId: 'r', title: '任务', kind: 'awaitingAuth', kinds: ['awaitingAuth'],
      waitingKind: 'awaitingAuth', waitingSince: askedAt, authWaitingSince: askedAt }] },
    openDetail() {}, openTaskSession() {}, locateBoard() {}, locateTask() {}, setFilter() {}, navigate() {}, refreshBlocked() {}, refreshHome() {}, setModal() {} }
  assert.ok(all(HomePage({ wb })).includes('授权请求发起：已等待 1 小时'))
})

test('risk page shows the authorization request start in local time, or unknown', async t => {
  globalThis.__runFactsReact = { createElement: node, Fragment: Symbol('fragment') }
  const originalTimezone = process.env.TZ
  process.env.TZ = 'Asia/Shanghai'
  t.after(() => {
    delete globalThis.__runFactsReact
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  })
  const BlockedPage = await component(fileURLToPath(new URL('../client-src/pages/development.js', import.meta.url)), 'BlockedPage')
  const labels = { authRequestWait: '授权请求发起：{wait}', authWaitUnknown: '授权等待时间未知', runWaiting: '等待授权' }
  const wb = { t: k => labels[k] ?? k, requirements: [{ id: 'r', title: '需求', status: 'in_progress', issues: [{ id: 'i', title: '任务' }] }],
    runFacts: [{ reqId: 'r', issueId: 'i' }], runError: null,
    authDetails: new Map([['i', { askedAt: Date.parse('2026-11-17T04:34:00Z') }]]),
    awaitingAuthSessions: new Map([['i', 's']]), blocked: { proposals: [], deliveryFailed: [] }, nav: { filters: {} },
    openDetail() {}, openTaskSession() {}, locateBoard() {}, locateTask() {}, setFilter() {}, navigate() {}, refreshBlocked() {} }
  assert.ok(all(BlockedPage({ wb })).includes('等待授权 · 授权请求发起：2026-11-17 12:34'))
  assert.ok(all(BlockedPage({ wb: { ...wb, authDetails: new Map() } })).includes('等待授权 · 授权等待时间未知'))
})

test('while an approval snapshot is replaced, home keeps unrelated reminders and offers retry without presenting a false empty state', async t => {
  globalThis.__runFactsReact = { createElement: node, Fragment: Symbol('fragment') }
  t.after(() => { delete globalThis.__runFactsReact })
  const HomePage = await component(fileURLToPath(new URL('../client-src/pages/home.js', import.meta.url)), 'HomePage')
  const source = { counts: { blocked: 1 }, reminders: [
    { kind: 'blocked', kinds: ['blocked', 'awaitingAuth'], issueId: 'merged', title: '合并' },
    { kind: 'awaitingAuth', kinds: ['awaitingAuth'], issueId: 'auth', title: '授权' },
    { kind: 'ready', kinds: ['ready'], reqId: 'normal', title: '普通需求', waitingSince: null },
  ] }
  assert.equal(homeDuringAuthRefresh(source, false), source)
  const shown = homeDuringAuthRefresh(source, true)
  assert.deepEqual(shown.reminders.map(item => item.title), ['普通需求'])
  assert.equal(shown.counts.blocked, 1)
  let retries = 0
  const wb = { t: key => key, home: shown, homeError: null, runError: null, requirements: [],
    refreshHome() { retries++ }, setModal() {}, navigate() {}, openDetail() {}, openTaskSession() {} }
  const nodes = all(HomePage({ wb }))
  assert.ok(nodes.includes('authRemindersRefreshing'))
  assert.ok(nodes.includes('普通需求'))
  nodes.find(x => x?.type === 'button' && all(x.props.children).includes('retryRead')).props.onClick()
  assert.equal(retries, 1)
  const emptyNodes = all(HomePage({ wb: { ...wb, home: homeDuringAuthRefresh({ ...source, reminders: source.reminders.slice(0, 2) }, true) } }))
  assert.ok(!emptyNodes.includes('homeNothing'))
  assert.ok(!emptyNodes.includes('homeFirstRequirement'))
})

const require = createRequire(import.meta.url)
const reactStub = {
  name: 'test-react', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'test-react' }))
    b.onLoad({ filter: /.*/, namespace: 'test-react' }, () => ({ contents: 'export default globalThis.__runFactsReact', loader: 'js' }))
  },
}
async function component(path, name) {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports[name]
}
const node = (type, props, ...children) => ({ type, props: { ...props, children } })
function all(tree) {
  if (tree == null || typeof tree === 'boolean') return []
  if (Array.isArray(tree)) return tree.flatMap(all)
  if (typeof tree !== 'object') return [tree]
  return [tree, ...all(tree.props?.children)]
}
test('run-list failure keeps known reminders visible and never presents permission status as empty', async t => {
  globalThis.__runFactsReact = { createElement: node, Fragment: Symbol('fragment') }
  t.after(() => { delete globalThis.__runFactsReact })
  const HomePage = await component(fileURLToPath(new URL('../client-src/pages/home.js', import.meta.url)), 'HomePage')
  const BlockedPage = await component(fileURLToPath(new URL('../client-src/pages/development.js', import.meta.url)), 'BlockedPage')
  const tfn = key => key
  const runError = { ok: false, code: 'READ_FAILED' }
  const requirements = [{ id: 'r', title: '需求', status: 'in_progress', issues: [
    { id: 'i', title: '待授权任务', status: 'doing' },
  ] }]
  const runFacts = [{ reqId: 'r', issueId: 'i', sessionId: 's', runSince: Date.now() }]
  let retried = 0
  const retry = () => retried++
  const common = { t: tfn, requirements, runFacts, runError, awaitingAuthSessions: new Map([['i', 's']]),
    nav: { filters: {} }, blocked: { proposals: [], deliveryFailed: [] }, setFilter() {},
    openDetail() {}, openTaskSession() {}, locateBoard() {}, locateTask() {}, navigate() {}, refreshBlocked: retry }
  let nodes = all(BlockedPage({ wb: common }))
  assert.ok(nodes.includes('runFactsUnavailable'))
  assert.ok(nodes.includes('待授权任务'))
  assert.ok(!nodes.includes('blockedEmpty'))
  nodes.find(x => x?.type === 'button' && all(x.props.children).includes('retryRead')).props.onClick()
  assert.equal(retried, 1)
  nodes = all(BlockedPage({ wb: { ...common, runFacts: null, awaitingAuthSessions: new Map() } }))
  assert.ok(nodes.includes('runFactsUnavailable'))
  assert.ok(!nodes.includes('blockedEmpty'))
  const home = { reminders: [{ kind: 'awaitingAuth', reqId: 'r', issueId: 'i', title: '待授权任务', waitingSince: Date.now() }], counts: {} }
  nodes = all(HomePage({ wb: { ...common, home, homeError: runError, refreshHome: retry } }))
  assert.ok(nodes.includes('runFactsUnavailable'))
  assert.ok(nodes.includes('待授权任务'))
  assert.ok(!nodes.includes('homeNothing'))
  assert.ok(nodes.includes('—'))
})

test('permission reminders merge linked sessions and open the session actually waiting', async t => {
  globalThis.__runFactsReact = { createElement: node, Fragment: Symbol('fragment') }
  t.after(() => { delete globalThis.__runFactsReact })
  const HomePage = await component(fileURLToPath(new URL('../client-src/pages/home.js', import.meta.url)), 'HomePage')
  const BlockedPage = await component(fileURLToPath(new URL('../client-src/pages/development.js', import.meta.url)), 'BlockedPage')
  const facts = [{ reqId: 'r', issueId: 'i', sessionId: 'newer', sessionIds: ['newer', 'older'], runSince: Date.parse('2001-01-02T03:04:00Z') }]
  const statuses = new Map([['older', { pendingInteraction: { kind: 'approval' } }]])
  const awaiting = awaitingAuthSessions(facts, statuses)
  assert.deepEqual([...awaiting], [['i', 'older']])
  // Multiple pending sessions still produce one task reminder; the active
  // run's associated session takes precedence when it too is waiting.
  statuses.set('newer', { pendingInteraction: { kind: 'approval' } })
  assert.deepEqual([...awaitingAuthSessions(facts, statuses)], [['i', 'newer']])
  statuses.set('newer', { pendingInteraction: { kind: 'question' } })
  assert.deepEqual([...awaitingAuthSessions(facts, statuses)], [['i', 'older']])
  statuses.set('older', { pendingInteraction: { kind: 'plan-review' } })
  assert.deepEqual([...awaitingAuthSessions(facts, statuses)], [])
  statuses.set('newer', { pendingInteraction: {} })
  assert.deepEqual([...awaitingAuthSessions(facts, statuses)], [])
  statuses.set('older', { pendingInteraction: { kind: 'approval' } })
  statuses.delete('newer')
  assert.deepEqual([...awaitingAuthSessions([{ issueId: 'legacy', sessionId: 'older' }], statuses)], [['legacy', 'older']])

  const calls = []
  let refreshed = 0
  const common = { t: key => key, requirements: [{ id: 'r', title: '需求', status: 'in_progress', issues: [{ id: 'i', title: '待授权任务', status: 'doing' }] }],
    runFacts: facts, runError: null, awaitingAuthSessions: awaiting, nav: { filters: {} },
    blocked: { proposals: [], deliveryFailed: [] }, setFilter() {}, openDetail() {},
    openTaskSession: (...args) => calls.push(args), locateBoard() {}, locateTask() {}, navigate() {}, refreshBlocked() {},
    home: { reminders: [{ kind: 'awaitingAuth', reqId: 'r', issueId: 'i', title: '待授权任务', waitingSince: Date.now() }], counts: {} },
    homeError: null, refreshHome: () => refreshed++ }
  let nodes = all(HomePage({ wb: common }))
  nodes.find(x => x?.type === 'button' && all(x.props.children).includes('homeGoHandle')).props.onClick()
  nodes = all(BlockedPage({ wb: common }))
  assert.equal(nodes.filter(x => x === '待授权任务').length, 1)
  assert.ok(nodes.includes('runWaiting · authWaitUnknown'))
  assert.ok(!nodes.includes('2001-01-02 03:04'))
  nodes.find(x => x?.type === 'button' && all(x.props.children).includes('goAuthorize')).props.onClick()
  assert.deepEqual(calls, [['i', 'older'], ['i', 'older']])

  // A blocked task and its authorization are merged into one reminder. Its
  // primary action must still open the session that needs authorization.
  const mergedHome = { reminders: [{ kind: 'blocked', kinds: ['blocked', 'awaitingAuth'], reqId: 'r', issueId: 'i', title: '待授权任务', reasons: ['任务被阻塞', '等待授权'], waitingSince: Date.now() }], counts: {} }
  nodes = all(HomePage({ wb: { ...common, home: mergedHome } }))
  assert.equal(nodes.filter(x => x === '待授权任务').length, 1)
  assert.ok(nodes.includes('任务被阻塞、等待授权'))
  nodes.find(x => x?.type === 'button' && all(x.props.children).includes('homeGoHandle')).props.onClick()
  assert.deepEqual(calls.at(-1), ['i', 'older'])

  // A stale home reminder must refresh rather than open another session.
  nodes = all(HomePage({ wb: { ...common, home: mergedHome, awaitingAuthSessions: new Map() } }))
  nodes.find(x => x?.type === 'button' && all(x.props.children).includes('homeGoHandle')).props.onClick()
  assert.equal(refreshed, 1)
  assert.equal(calls.length, 3)
})

test('home distinguishes unknown permission wait from a known blocked wait', async t => {
  globalThis.__runFactsReact = { createElement: node, Fragment: Symbol('fragment') }
  t.after(() => { delete globalThis.__runFactsReact })
  const HomePage = await component(fileURLToPath(new URL('../client-src/pages/home.js', import.meta.url)), 'HomePage')
  const labels = {
    waitUnknown: '等待时间未知', authWaitUnknown: '授权等待时间未知', waitHour: '已等待 {n} 小时', waitNow: '刚刚',
    blockedAndAuthWaitUnknown: '阻塞和授权等待时间均未知', confirmationAndAuthWaitUnknown: '确认和授权等待时间均未知',
    blockedWaitWithUnknownAuth: '阻塞：{wait}；授权等待时间未知',
  }
  const unknownMerged = homeSummary([{ id: 'r', title: '需求', status: 'in_progress' }], { r: [
    { id: 'legacy-block', title: '旧阻塞和授权', status: 'blocked', updated: '2026-01-01T00:00:00Z' },
    { id: 'legacy-confirm', title: '旧确认和授权', status: 'in_review', updated: '2026-01-01T00:00:00Z' },
  ] }, { running: [{ issueId: 'legacy-block', awaitingAuth: true }, { issueId: 'legacy-confirm', awaitingAuth: true }] }).reminders
  const wb = {
    t: key => labels[key] ?? key, requirements: [], homeError: null, runError: null,
    refreshHome() {}, setModal() {}, navigate() {}, openDetail() {}, openTaskSession() {},
    home: { counts: {}, reminders: [
      { issueId: 'unknown', reqId: 'r', title: '待授权', kind: 'awaitingAuth', kinds: ['awaitingAuth'], waitingSince: null },
      { issueId: 'merged', reqId: 'r', title: '阻塞并待授权', kind: 'blocked', kinds: ['blocked', 'awaitingAuth'], waitingKind: 'blocked', waitingSince: Date.now() - 7200000 },
      { issueId: 'other', reqId: 'r', title: '时间缺失', kind: 'blocked', kinds: ['blocked'], waitingSince: null },
      ...unknownMerged,
    ] },
  }
  const nodes = all(HomePage({ wb }))
  assert.ok(nodes.includes('授权等待时间未知'))
  assert.ok(nodes.includes('等待时间未知'))
  assert.ok(nodes.includes('阻塞：已等待 2 小时；授权等待时间未知'))
  assert.ok(nodes.includes('阻塞和授权等待时间均未知'))
  assert.ok(nodes.includes('确认和授权等待时间均未知'))
  assert.ok(!nodes.includes('刚刚'))
})
