// Exercise WikiView with real status data and controlled Host job states.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { wikiStatus } from '../core/wiki.js'

const require = createRequire(import.meta.url)
const reactStub = {
  name: 'wiki-test-react', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'wiki-test-react' }))
    b.onLoad({ filter: /.*/, namespace: 'wiki-test-react' }, () => ({ contents: 'export default globalThis.__wikiReact', loader: 'js' }))
  },
}
function hookHost() {
  const state = [], effects = [], cleanups = []
  let cursor = 0
  const api = {
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) { return { type, props: { ...props, children } } },
    useState(initial) {
      const i = cursor++
      if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial
      return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }]
    },
    useRef(initial) { const i = cursor++; return state[i] ??= { current: initial } },
    useCallback(callback) { cursor++; return callback },
    useEffect(callback) {
      const i = cursor++
      if (!(i in state)) { state[i] = true; effects.push(callback) }
    },
  }
  return {
    api,
    render(Component, props) { cursor = 0; return Component(props) },
    async mount() { for (const effect of effects.splice(0)) { const cleanup = effect(); if (typeof cleanup === 'function') cleanups.push(cleanup) }; await new Promise(resolve => setImmediate(resolve)) },
    unmount() { for (const cleanup of cleanups) cleanup() },
  }
}
function all(tree, predicate, found = []) {
  if (!tree || typeof tree !== 'object') return found
  if (predicate(tree)) found.push(tree)
  for (const item of [...(tree.props?.children ?? []), ...(tree.props?.actions ?? [])].flat(Infinity)) all(item, predicate, found)
  return found
}
function textOf(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (!tree || typeof tree !== 'object') return ''
  return (tree.props?.children ?? []).flat(Infinity).map(textOf).join(' ')
}

test('an old checkpoint does not block a fresh update or hide current status and errors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pw-wiki-checkpoint-ui-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const base = join(root, 'openwiki')
  await mkdir(base)
  await writeFile(join(base, 'quickstart.md'), '# Existing')
  await writeFile(join(base, '.last-update.json'), JSON.stringify({ status: 'interrupted', updatedAt: '2026-11-16T08:03:58Z' }))
  const checkpoint = join(base, '.run.json')
  await writeFile(checkpoint, JSON.stringify({ initialPages: ['._quickstart.md'] }))
  let pageStatus = await wikiStatus(root)
  assert.equal(pageStatus.checkpointIssue, 'unsafe')
  assert.deepEqual(pageStatus.pages, ['quickstart.md'])

  const originalFetch = globalThis.fetch, originalReact = globalThis.__wikiReact
  t.after(() => { globalThis.fetch = originalFetch; globalThis.__wikiReact = originalReact })
  let job = { ok: true, data: { status: 'idle' } }
  let startResponse = { ok: false, code: 'SESSION_NOT_LIVE' }, attempts = 0
  globalThis.fetch = async (url, options) => ({ json: async () => {
    if (url.endsWith('/wiki-generate-status')) return job
    if (url.endsWith('/wiki-generate')) { attempts++; return startResponse }
    assert.equal(JSON.parse(options.body).method, 'wiki/status')
    return { ok: true, data: pageStatus }
  } })
  const result = await build({ entryPoints: [fileURLToPath(new URL('../client-src/pages/resources.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const props = { root, t: key => key, uiMemory: { wikiGen: {} } }
  const render = async () => {
    const host = hookHost(); globalThis.__wikiReact = host.api
    const mod = { exports: {} }
    new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
    host.render(mod.exports.WikiView, props)
    await host.mount()
    return { host, tree: host.render(mod.exports.WikiView, props), component: mod.exports.WikiView }
  }
  let current = await render()
  assert.match(textOf(current.tree), /wikiTryAgain/)
  assert.doesNotMatch(textOf(current.tree), /wikiCheckpointUnsafe|wikiDone/)
  const update = all(current.tree, node => node.type === 'button' && textOf(node) === 'wikiUpdate')[0]
  assert.equal(Boolean(update.props.disabled), false)
  await update.props.onClick()
  assert.match(textOf(current.host.render(current.component, props)), /generationNeedsSession/)
  startResponse = { ok: true, data: { started: true } }
  await all(current.host.render(current.component, props), node => node.type === 'button' && textOf(node) === 'wikiUpdate')[0].props.onClick()
  assert.equal(attempts, 2)
  assert.match(textOf(current.host.render(current.component, props)), /wikiGenerating/)
  current.host.unmount()

  job = { ok: true, data: { status: 'running' } }; props.uiMemory.wikiGen = {}
  current = await render()
  assert.match(textOf(current.tree), /wikiGenerating/)
  assert.doesNotMatch(textOf(current.tree), /wikiCheckpointUnsafe/)
  current.host.unmount()

  await writeFile(checkpoint, '{')
  pageStatus = await wikiStatus(root)
  assert.equal(pageStatus.checkpointIssue, 'unreadable')
  assert.deepEqual(pageStatus.pages, ['quickstart.md'])
  job = { ok: true, data: { status: 'failed' } }; props.uiMemory.wikiGen = {}
  current = await render()
  assert.match(textOf(current.tree), /wikiTryAgain/)
  assert.doesNotMatch(textOf(current.tree), /wikiStateUnreadable|wikiDone/)
  current.host.unmount()

  job = { ok: true, data: { status: 'idle' } }
  pageStatus = { exists: false }
  startResponse = { ok: false, code: 'NOT_GIT' }
  props.uiMemory.wikiGen = {}
  current = await render()
  await all(current.tree, node => node.type === 'button' && textOf(node) === 'wikiGenerate')[0].props.onClick()
  const failed = current.host.render(current.component, props)
  const banner = all(failed, node => node.props.role === 'alert' && node.props.className === 'pw-banner pw-error')[0]
  assert.equal(textOf(banner), 'wikiNeedsGit')
  current.host.unmount()
})

test('interrupted wiki shows the last completed date without masking an active Host job', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pw-wiki-status-ui-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const base = join(root, 'openwiki')
  await mkdir(base)
  await writeFile(join(base, 'quickstart.md'), '# Existing page')
  await writeFile(join(base, '.last-update.json'), JSON.stringify({ status: 'interrupted', updatedAt: '2026-11-16T08:03:58Z' }))
  await writeFile(join(base, '.run.json'), JSON.stringify({ phase: 'planning', previousLastUpdate: { status: 'complete', updatedAt: '2026-11-14T16:25:59Z' } }))
  const pageStatus = await wikiStatus(root)
  const previousDate = new Date(pageStatus.lastCompleted.updatedAt).toLocaleDateString('sv-SE')
  const interruptedDate = new Date(pageStatus.lastUpdate.updatedAt).toLocaleDateString('sv-SE')

  const originalFetch = globalThis.fetch
  const originalReact = globalThis.__wikiReact
  t.after(() => { globalThis.fetch = originalFetch; globalThis.__wikiReact = originalReact })
  let job, startError
  globalThis.fetch = async (url, options) => ({ json: async () => {
    if (url.endsWith('/wiki-generate-status')) return job
    if (url.endsWith('/wiki-generate')) return { ok: false, code: startError }
    const { method } = JSON.parse(options.body)
    assert.equal(method, 'wiki/status')
    return { ok: true, data: pageStatus }
  } })
  const result = await build({ entryPoints: [fileURLToPath(new URL('../client-src/pages/resources.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const props = { root, t: key => key, uiMemory: { wikiGen: {} } }

  for (const [hostStatus, expectedMessage, busy] of [
    [{ ok: true, data: { status: 'idle', last: { status: 'done' } } }, 'wikiTryAgain', false],
    [{ ok: true, data: { status: 'running' } }, 'wikiGenerating', true],
    [{ ok: false }, 'generationStatusUnavailable', false],
  ]) {
    job = hostStatus
    const host = hookHost(); globalThis.__wikiReact = host.api
    const mod = { exports: {} }
    new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
    host.render(mod.exports.WikiView, props)
    await host.mount()
    const tree = host.render(mod.exports.WikiView, props)
    const rendered = textOf(tree)
    assert.ok(rendered.includes(`wikiLastUpdate: ${previousDate}`))
    assert.ok(!rendered.includes(`wikiLastUpdate: ${interruptedDate}`))
    assert.match(rendered, new RegExp(expectedMessage))
    if (busy || !hostStatus.ok) assert.doesNotMatch(rendered, /wikiTryAgain/)
    const button = all(tree, node => node.type === 'button' && textOf(node) === 'wikiUpdate')[0]
    assert.equal(!!button.props.disabled, busy)
    if (hostStatus.data?.status === 'idle') {
      for (const [code, message] of [
        ['SESSION_NOT_LIVE', 'generationNeedsSession'],
        ['WORKSPACE_MISMATCH', 'errWrongWorkspace'],
        ['WIKI_BUSY', 'wikiBusy'],
        ['WIKI_ROOT_NOT_TOPLEVEL', 'wikiRootNotTopLevel'],
        ['NOT_GIT', 'wikiNeedsGit'],
        ['GIT_MISSING', 'wikiGitMissing'],
        ['WIKI_ROOT_UNAVAILABLE', 'wikiRootUnavailable'],
        ['WIKI_SOURCE_UNSUPPORTED', 'wikiSourceUnsupported'],
        ['WIKI_STATE_UNREADABLE', 'wikiStateUnreadable'],
        ['WIKI_METADATA_UNSAFE', 'wikiMetadataUnsafe'],
        ['WIKI_CHECKPOINT_UNSAFE', 'wikiCheckpointUnsafe'],
        ['WIKI_SNAPSHOT_FAILED', 'wikiSnapshotFailed'],
        ['WIKI_SNAPSHOT_UNREADABLE', 'wikiSnapshotUnreadable'],
        ['WIKI_EXTERNAL_CHANGE', 'wikiExternalChangeBlocked'],
      ]) {
        startError = code
        await button.props.onClick()
        const afterFailure = host.render(mod.exports.WikiView, props)
        const banner = all(afterFailure, node => node.props.role === 'alert' && node.props.className === 'pw-banner pw-error')[0]
        assert.equal(textOf(banner), message)
        assert.ok(textOf(afterFailure).includes(`wikiLastUpdate: ${previousDate}`))
        assert.equal(!!all(afterFailure, node => node.type === 'button' && textOf(node) === 'wikiUpdate')[0].props.disabled, false)
      }
    }
    host.unmount()
    props.uiMemory.wikiGen = {}
  }

  // A malformed persisted timestamp must not crash the Wiki reader.
  pageStatus.lastCompleted = { status: 'complete', updatedAt: { invalid: true } }
  job = { ok: true, data: { status: 'idle' } }
  const host = hookHost(); globalThis.__wikiReact = host.api
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
  host.render(mod.exports.WikiView, props)
  await host.mount()
  assert.ok(textOf(host.render(mod.exports.WikiView, props)).includes('wikiLastUpdate: wikiDateUnknown'))
  host.unmount()
})

test('architecture generation shows source errors in a banner and keeps the previous diagram', async t => {
  const host = hookHost()
  const originalReact = globalThis.__wikiReact
  globalThis.__wikiReact = host.api
  t.after(() => { globalThis.__wikiReact = originalReact })
  let pollStatus
  let status = { status: 'idle' }
  const html = '<svg></svg>'
  t.mock.method(globalThis, 'setInterval', callback => { pollStatus = callback; return 1 })
  t.mock.method(globalThis, 'clearInterval', () => {})
  t.mock.method(globalThis, 'fetch', async (url, options) => ({ json: async () => {
    if (url.endsWith('/arch-status')) return { ok: true, data: status }
    if (url.endsWith('/arch-generate')) return { ok: true, data: { started: true } }
    assert.equal(JSON.parse(options.body).method, 'architecture/read')
    return { ok: true, data: { exists: true, html } }
  } }))
  const result = await build({ entryPoints: [fileURLToPath(new URL('../client-src/pages/resources.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
  const props = { root: '/sample', t: key => key }
  const render = () => host.render(mod.exports.ArchView, props)
  render()
  await host.mount()
  t.after(() => host.unmount())
  for (const [code, message] of [['ARCH_SOURCE_REQUIRED', 'archSourceRequired'], ['ARCH_SOURCE_INVALID', 'archSourceInvalid']]) {
    const button = all(render(), node => node.type === 'button' && textOf(node) === 'archRegenerate')[0]
    assert.equal(Boolean(button.props.disabled), false)
    await button.props.onClick()
    status = { status: 'failed', code }
    await pollStatus()
    const failed = render()
    const banner = all(failed, node => node.props.role === 'alert' && node.props.className === 'pw-banner pw-error')[0]
    assert.equal(textOf(banner), message)
    assert.equal(all(failed, node => node.type === 'iframe')[0].props.srcDoc, html)
  }
})

test('wiki reader follows local Markdown links and hides generated HTML diagnostics', async t => {
  const originalReact = globalThis.__wikiReact
  t.after(() => { globalThis.__wikiReact = originalReact })
  const host = hookHost(); globalThis.__wikiReact = host.api
  const result = await build({ entryPoints: [fileURLToPath(new URL('../client-src/pages/resources.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
  const opened = []
  const source = [
    '<!-- openwiki: broken internal link: diagnostic --> [问候](/openwiki/concepts/greet.md)',
    '[相邻页](../quickstart.md) [外链](https://example.com) [越界](../../secret.md)',
    '| 类别 | 详情 |',
    '| --- | --- |',
    '<!-- openwiki: broken internal link --> | 函数 | [表格链接](/openwiki/concepts/greet.md) |',
    '示例 `<!-- keep inline -->`',
    '```html',
    '<!-- keep fenced -->',
    '```',
    '<!-- hidden',
    'multiline -->继续阅读',
  ].join('\n')
  const tree = host.api.createElement('div', null, mod.exports.renderMarkdown(source, key => key, { pagePath: 'concepts/index.md', open: path => opened.push(path) }))
  const rendered = textOf(tree)
  assert.doesNotMatch(rendered, /diagnostic|hidden|multiline/)
  assert.match(rendered, /继续阅读/)
  assert.match(rendered, /<!-- keep inline -->/)
  const block = all(tree, node => typeof node.type === 'function' && node.props.code)[0]
  assert.equal(block.props.code, '<!-- keep fenced -->')
  const links = all(tree, node => node.type === 'a')
  assert.equal(links.length, 4)
  let prevented = false
  links[0].props.onClick({ preventDefault() { prevented = true } })
  links[1].props.onClick({ preventDefault() {} })
  assert.equal(prevented, true)
  assert.deepEqual(opened, ['concepts/greet.md', 'quickstart.md'])
  assert.equal(links[2].props.href, 'https://example.com')
  assert.equal(textOf(all(tree, node => node.type === 'table')[0]).includes('表格链接'), true)
  links[3].props.onClick({ preventDefault() {} })
  assert.equal(opened[2], 'concepts/greet.md')
})

test('wiki reader retries the whole page and evidence pair when its view changes', async t => {
  const originalFetch = globalThis.fetch
  const originalReact = globalThis.__wikiReact
  t.after(() => { globalThis.fetch = originalFetch; globalThis.__wikiReact = originalReact })
  const calls = []
  let statusCalls = 0
  globalThis.fetch = async (url, options) => ({ json: async () => {
    if (url.endsWith('/wiki-generate-status')) return { ok: true, data: { status: 'idle' } }
    const { method, input } = JSON.parse(options.body)
    calls.push([method, input.viewVersion])
    if (method === 'wiki/status') {
      statusCalls++
      return { ok: true, data: { exists: true, pages: ['quickstart.md'], viewVersion: statusCalls < 3 ? 'snapshot:old' : 'live:new', viewIsSnapshot: statusCalls < 3 } }
    }
    if (method === 'wiki/page') return { ok: true, data: { path: input.path, content: input.viewVersion === 'snapshot:old' ? '# Old page' : '# New page', viewVersion: `${input.viewVersion}:page` } }
    if (method === 'wiki/evidence') return input.viewVersion === 'snapshot:old:page'
      ? { ok: false, code: 'WIKI_VIEW_CHANGED' }
      : { ok: true, data: { claims: [{ statement: 'New source', evidence: [] }] } }
    throw new Error(`unexpected ${method}`)
  } })
  const host = hookHost(); globalThis.__wikiReact = host.api
  const result = await build({ entryPoints: [fileURLToPath(new URL('../client-src/pages/resources.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
  const props = { root: '/isolated', t: key => key, uiMemory: { wikiGen: {} } }
  host.render(mod.exports.WikiView, props)
  await host.mount()
  const initial = host.render(mod.exports.WikiView, props)
  assert.match(textOf(initial), /wikiShowingPrevious/)
  await all(initial, node => node.type === 'button' && textOf(node) === 'quickstart.md')[0].props.onClick()
  const rendered = textOf(host.render(mod.exports.WikiView, props))
  assert.match(rendered, /New page/)
  assert.match(rendered, /New source/)
  assert.doesNotMatch(rendered, /Old page|wikiShowingPrevious/)
  assert.deepEqual(calls.filter(([name]) => name !== 'wiki/status'), [
    ['wiki/page', 'snapshot:old'], ['wiki/evidence', 'snapshot:old:page'],
    ['wiki/page', 'live:new'], ['wiki/evidence', 'live:new:page'],
  ])
  host.unmount()
})

test('wiki reader explains when its saved view cannot be read', async t => {
  const originalFetch = globalThis.fetch
  const originalReact = globalThis.__wikiReact
  t.after(() => { globalThis.fetch = originalFetch; globalThis.__wikiReact = originalReact })
  globalThis.fetch = async url => ({ json: async () => url.endsWith('/wiki-generate-status')
    ? { ok: true, data: { status: 'idle' } }
    : { ok: false, code: 'WIKI_SNAPSHOT_UNREADABLE' } })
  const host = hookHost(); globalThis.__wikiReact = host.api
  const result = await build({ entryPoints: [fileURLToPath(new URL('../client-src/pages/resources.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
  const props = { root: '/isolated', t: key => key, uiMemory: { wikiGen: {} } }
  host.render(mod.exports.WikiView, props)
  await host.mount()
  const rendered = textOf(host.render(mod.exports.WikiView, props))
  assert.match(rendered, /wikiSavedViewUnreadable/)
  assert.match(rendered, /retryRead/)
  host.unmount()
})

test('wiki reader identifies an earlier saved view after an external change', async t => {
  const originalFetch = globalThis.fetch
  const originalReact = globalThis.__wikiReact
  t.after(() => { globalThis.fetch = originalFetch; globalThis.__wikiReact = originalReact })
  globalThis.fetch = async url => ({ json: async () => url.endsWith('/wiki-generate-status')
    ? { ok: true, data: { status: 'done' } }
    : url.endsWith('/wiki-generate')
      ? { ok: false, code: 'WIKI_EXTERNAL_CHANGE' }
      : { ok: true, data: { exists: true, pages: ['quickstart.md'], viewVersion: 'snapshot:old', viewIsSnapshot: true, viewExternalChanged: true, lastCompleted: null, lastUpdate: { status: 'complete', updatedAt: '2026-11-17T08:00:00Z' } } } })
  const host = hookHost(); globalThis.__wikiReact = host.api
  const result = await build({ entryPoints: [fileURLToPath(new URL('../client-src/pages/resources.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
  const props = { root: '/isolated', t: key => key, uiMemory: { wikiGen: {} } }
  host.render(mod.exports.WikiView, props)
  await host.mount()
  const initial = host.render(mod.exports.WikiView, props)
  const rendered = textOf(initial)
  assert.match(rendered, /wikiExternalChangeView/)
  assert.doesNotMatch(rendered, /wikiShowingPrevious|wikiDone|wikiLastUpdate/)
  await all(initial, node => node.type === 'button' && textOf(node) === 'wikiUpdate')[0].props.onClick()
  assert.match(textOf(host.render(mod.exports.WikiView, props)), /wikiExternalChangeBlocked/)
  host.unmount()
})

test('an external completed Wiki is read and updated through the ordinary controls', async t => {
  const originalFetch = globalThis.fetch, originalReact = globalThis.__wikiReact
  t.after(() => { globalThis.fetch = originalFetch; globalThis.__wikiReact = originalReact })
  const requests = []
  globalThis.fetch = async (url, options) => ({ json: async () => {
    if (url.endsWith('/wiki-generate-status')) return { ok: true, data: { status: 'idle' } }
    if (url.endsWith('/wiki-generate')) { requests.push(JSON.parse(options.body)); return { ok: true, data: { childId: 'child' } } }
    const { method, input } = JSON.parse(options.body)
    if (method === 'wiki/status') return { ok: true, data: { exists: true, pages: ['quickstart.md'], viewVersion: 'live:external', viewIsSnapshot: false } }
    if (method === 'wiki/page') return { ok: true, data: { path: input.path, content: '# External current page', viewVersion: 'live:external|pair' } }
    if (method === 'wiki/evidence') return { ok: true, data: { claims: [{ statement: 'External source', evidence: [] }] } }
    throw new Error(`unexpected RPC ${method}`)
  } })
  const host = hookHost(); globalThis.__wikiReact = host.api
  const result = await build({ entryPoints: [fileURLToPath(new URL('../client-src/pages/resources.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
  const props = { root: '/isolated', sessionId: 'session', t: key => key, uiMemory: { wikiGen: {} } }
  const render = () => host.render(mod.exports.WikiView, props)
  render(); await host.mount()
  let tree = render()
  assert.doesNotMatch(textOf(tree), /wikiPreviewOpen|wikiPreviewNotice|wikiUsePreviewUpdate/)
  await all(tree, node => node.type === 'button' && textOf(node) === 'quickstart.md')[0].props.onClick()
  tree = render()
  assert.match(textOf(tree), /External current page/)
  assert.match(textOf(tree), /External source/)
  await all(tree, node => node.type === 'button' && textOf(node) === 'wikiUpdate')[0].props.onClick()
  assert.deepEqual(requests, [{ root: '/isolated', sessionId: 'session' }])
  host.unmount()
})

test('wiki reader does not retain a success message after a read failure', async t => {
  const originalFetch = globalThis.fetch
  const originalReact = globalThis.__wikiReact
  t.after(() => { globalThis.fetch = originalFetch; globalThis.__wikiReact = originalReact })
  let reads = 0
  globalThis.fetch = async url => ({ json: async () => {
    if (url.endsWith('/wiki-generate-status')) return { ok: true, data: { status: 'done' } }
    if (url.endsWith('/wiki-generate')) return { ok: false, code: 'WIKI_EXTERNAL_CHANGE' }
    return ++reads === 1
      ? { ok: true, data: { exists: true, pages: ['quickstart.md'], viewVersion: 'live:initial' } }
      : { ok: false, code: 'WIKI_SNAPSHOT_UNREADABLE' }
  } })
  const host = hookHost(); globalThis.__wikiReact = host.api
  const result = await build({ entryPoints: [fileURLToPath(new URL('../client-src/pages/resources.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
  const props = { root: '/isolated', t: key => key, uiMemory: { wikiGen: {} } }
  host.render(mod.exports.WikiView, props)
  await host.mount()
  const initial = host.render(mod.exports.WikiView, props)
  assert.match(textOf(initial), /wikiDone/)
  await all(initial, node => node.type === 'button' && textOf(node) === 'quickstart.md')[0].props.onClick()
  const rendered = textOf(host.render(mod.exports.WikiView, props))
  assert.match(rendered, /wikiSavedViewUnreadable/)
  assert.doesNotMatch(rendered, /wikiDone/)
  await all(host.render(mod.exports.WikiView, props), node => node.type === 'button' && textOf(node) === 'wikiUpdate')[0].props.onClick()
  const afterUpdate = textOf(host.render(mod.exports.WikiView, props))
  assert.match(afterUpdate, /wikiSavedViewUnreadable/)
  assert.match(afterUpdate, /wikiExternalChangeBlocked/)
  host.unmount()
})

test('a view change never labels the previous page and Claims as the new view', async t => {
  const originalFetch = globalThis.fetch
  const originalReact = globalThis.__wikiReact
  t.after(() => { globalThis.fetch = originalFetch; globalThis.__wikiReact = originalReact })
  let statusCalls = 0, pageCalls = 0, finishPage
  const pendingPage = new Promise(resolve => { finishPage = resolve })
  globalThis.fetch = async (url, options) => ({ json: async () => {
    if (url.endsWith('/wiki-generate-status')) return { ok: true, data: { status: 'idle' } }
    const { method } = JSON.parse(options.body)
    if (method === 'wiki/status') {
      const external = ++statusCalls >= 4
      return { ok: true, data: { exists: true, pages: ['quickstart.md'], viewVersion: external ? 'snapshot:old' : 'live:new', viewIsSnapshot: external, viewExternalChanged: external } }
    }
    if (method === 'wiki/page') {
      if (++pageCalls === 1) return { ok: true, data: { path: 'quickstart.md', content: '# Live page', viewVersion: 'live:new|pair' } }
      if (pageCalls === 2) return { ok: false, code: 'NOT_FOUND' }
      return pendingPage
    }
    if (method === 'wiki/evidence') return { ok: true, data: { claims: [{ statement: 'Live source', evidence: [] }] } }
    throw new Error(`unexpected ${method}`)
  } })
  const host = hookHost(); globalThis.__wikiReact = host.api
  const result = await build({ entryPoints: [fileURLToPath(new URL('../client-src/pages/resources.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
  const props = { root: '/isolated', t: key => key, uiMemory: { wikiGen: {} } }
  host.render(mod.exports.WikiView, props)
  await host.mount()
  let tree = host.render(mod.exports.WikiView, props)
  await all(tree, node => node.type === 'button' && textOf(node) === 'quickstart.md')[0].props.onClick()
  tree = host.render(mod.exports.WikiView, props)
  assert.match(textOf(tree), /Live page/)
  assert.match(textOf(tree), /Live source/)
  await all(tree, node => node.type === 'button' && textOf(node) === 'quickstart.md')[0].props.onClick()
  tree = host.render(mod.exports.WikiView, props)
  const retry = all(tree, node => node.type === 'button' && textOf(node) === 'retry')[0].props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  const switching = textOf(host.render(mod.exports.WikiView, props))
  assert.match(switching, /wikiExternalChangeView/)
  assert.doesNotMatch(switching, /Live page|Live source/)
  finishPage({ ok: false, code: 'WIKI_SNAPSHOT_UNREADABLE' })
  await retry
  const failed = textOf(host.render(mod.exports.WikiView, props))
  assert.match(failed, /wikiSavedViewUnreadable/)
  assert.doesNotMatch(failed, /Live page|Live source/)
  host.unmount()
})

test('a remembered Wiki target reopens the same article after the view remounts', async t => {
  const originalFetch = globalThis.fetch, originalReact = globalThis.__wikiReact
  t.after(() => { globalThis.fetch = originalFetch; globalThis.__wikiReact = originalReact })
  const reads = []
  globalThis.fetch = async (url, options) => ({ json: async () => {
    if (url.endsWith('/wiki-generate-status')) return { ok: true, data: { status: 'idle' } }
    const { method, input } = JSON.parse(options.body)
    if (method === 'wiki/status') return { ok: true, data: { exists: true, pages: ['quickstart.md'], viewVersion: 'live:remembered' } }
    if (method === 'wiki/page') { reads.push(input.path); return { ok: true, data: { path: input.path, content: '# 记住的正文', viewVersion: 'live:remembered|page' } } }
    if (method === 'wiki/evidence') return { ok: true, data: { claims: [] } }
    throw new Error(`unexpected RPC ${method}`)
  } })
  const result = await build({ entryPoints: [fileURLToPath(new URL('../client-src/pages/resources.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const changes = []
  const props = { root: '/project-a', target: 'quickstart.md', onPageChange: path => changes.push(path), t: key => key, uiMemory: { wikiGen: {} } }
  const mount = async () => {
    const host = hookHost(); globalThis.__wikiReact = host.api
    const mod = { exports: {} }
    new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require)
    host.render(mod.exports.WikiView, props)
    await host.mount()
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve))
    assert.match(textOf(host.render(mod.exports.WikiView, props)), /记住的正文/)
    return host
  }
  const first = await mount()
  first.unmount()
  await mount()
  assert.deepEqual(reads, ['quickstart.md', 'quickstart.md'])
  assert.deepEqual(changes, ['quickstart.md', 'quickstart.md'])
})

test('leaving a Wiki page and switching projects reconnects to the original background job', async t => {
  const saved = { fetch: globalThis.fetch, react: globalThis.__wikiReact,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval }
  t.after(() => { globalThis.fetch = saved.fetch; globalThis.__wikiReact = saved.react;
    globalThis.setInterval = saved.setInterval; globalThis.clearInterval = saved.clearInterval })
  const timers = new Map(), jobs = new Map([['/project-a', 'idle'], ['/project-b', 'idle']])
  const requests = []
  let nextTimer = 0
  globalThis.setInterval = fn => { const id = ++nextTimer; timers.set(id, fn); return id }
  globalThis.clearInterval = id => timers.delete(id)
  globalThis.fetch = async (url, options) => ({ json: async () => {
    const body = JSON.parse(options.body)
    requests.push({ url, body })
    if (url.endsWith('/wiki-generate-status')) return { ok: true, data: { status: jobs.get(body.root) } }
    if (url.endsWith('/wiki-generate')) { jobs.set(body.root, 'running'); return { ok: true, data: { started: true } } }
    if (url.endsWith('/wiki-generate-stop')) throw new Error('navigation must not stop generation')
    assert.equal(body.method, 'wiki/status')
    return { ok: true, data: { exists: true, pages: ['quickstart.md'], viewVersion: `live:${body.input.root}` } }
  } })
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../client-src/pages/resources.js', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [reactStub] })
  const uiMemory = { wikiGen: {} }
  const mount = async root => {
    const host = hookHost(); globalThis.__wikiReact = host.api
    const mod = { exports: {} }
    new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require)
    const props = { root, sessionId: `session:${root}`, t: key => key, uiMemory }
    const render = () => host.render(mod.exports.WikiView, props)
    render(); await host.mount()
    return { host, render }
  }

  let view = await mount('/project-a')
  await all(view.render(), node => node.type === 'button' && textOf(node) === 'wikiUpdate')[0].props.onClick()
  assert.equal(jobs.get('/project-a'), 'running')
  assert.match(textOf(view.render()), /wikiGenerating/)
  assert.equal(timers.size, 1)
  view.host.unmount()
  assert.equal(timers.size, 0) // only polling is stopped; the Host job remains running

  view = await mount('/project-b')
  assert.doesNotMatch(textOf(view.render()), /wikiGenerating/)
  assert.equal(jobs.get('/project-a'), 'running')
  view.host.unmount()

  view = await mount('/project-a')
  let tree = view.render()
  assert.match(textOf(tree), /wikiGenerating/)
  assert.equal(all(tree, node => node.type === 'button' && textOf(node) === 'wikiUpdate')[0].props.disabled, true)
  assert.equal(timers.size, 1)
  jobs.set('/project-a', 'done')
  await [...timers.values()][0]()
  tree = view.render()
  assert.match(textOf(tree), /wikiDone/)
  assert.equal(all(tree, node => node.type === 'button' && textOf(node) === 'wikiUpdate')[0].props.disabled, false)
  assert.equal(timers.size, 0)
  assert.equal(requests.filter(r => r.url.endsWith('/wiki-generate')).length, 1)
  assert.equal(requests.filter(r => r.url.endsWith('/wiki-generate-stop')).length, 0)
  assert.deepEqual(requests.filter(r => r.url.endsWith('/wiki-generate-status')).map(r => r.body.root), ['/project-a', '/project-b', '/project-a', '/project-a'])
  view.host.unmount()
})
