// CT-19 write scope for the rc.3 wiki generation child (no dedicated preset):
// the Host guard keeps it to openwiki/ and away from shells/patch tools.
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { wikiGuardDenial, wikiMetadataIssue, wikiCheckpointIssue } from '../core/wiki-guard.js'
import { makeRoot } from './util.js'

const root = '/tmp/pw-wiki-guard-root'
const target = { root, mode: 'update' }

test('Wiki metadata check protects pages and claims while ignoring unrelated companions', async t => {
  const root = await makeRoot(t)
  const wiki = join(root, 'openwiki')
  const dir = join(wiki, 'nested')
  const claims = join(wiki, '.claims', 'nested')
  const child = { root, mode: 'update' }
  await mkdir(dir, { recursive: true })
  await mkdir(claims, { recursive: true })
  await writeFile(join(wiki, '._.run.json'), 'unrelated metadata')
  await writeFile(join(dir, '._attachment.txt'), 'unrelated attachment')
  await writeFile(join(dir, 'page.md'), '# Existing page')
  assert.equal(wikiMetadataIssue(root), undefined)
  assert.equal(wikiGuardDenial('mcp__openwiki__openwiki_begin', { root, mode: 'update' }, child), undefined)
  assert.ok(wikiGuardDenial('edit', { file_path: 'openwiki/nested/._page.md' }, child))
  const page = join(dir, '._page.md')
  const sidecar = join(claims, '._page.json')
  for (const file of [page, sidecar]) {
    await writeFile(file, 'valuable companion')
    assert.equal(wikiMetadataIssue(root), 'unsafe')
    assert.match(wikiGuardDenial('mcp__openwiki__openwiki_begin', { root, mode: 'update' }, child), /系统伴随文件/)
    await rm(file)
  }
  assert.equal(wikiMetadataIssue(root), undefined)
  await writeFile(join(wiki, '.run.json'), JSON.stringify({ runId: 'current-run' }))
  assert.equal(wikiGuardDenial('mcp__openwiki__openwiki_finish', { runId: 'current-run' }, child), undefined)
  await writeFile(sidecar, 'created during generation')
  assert.match(wikiGuardDenial('mcp__openwiki__openwiki_finish', { runId: 'current-run' }, child), /系统伴随文件/)
  assert.equal(await readFile(sidecar, 'utf8'), 'created during generation')
})

test('Wiki metadata check detects claims aliases without following symlinks or relying on directory type bits', async t => {
  const root = await makeRoot(t)
  const wiki = join(root, 'openwiki')
  const upper = join(wiki, '.CLAIMS')
  const lower = join(wiki, '.claims')
  await mkdir(upper, { recursive: true })
  const file = join(upper, '._page.json')
  await writeFile(file, 'companion')
  const realLstat = fs.lstatSync
  const realReadDir = fs.readdirSync
  // Preserve case-sensitive behaviour on a filesystem where these differ;
  // then emulate a case-insensitive lookup of the same on-disk directory.
  let sameDirectory = false
  try { sameDirectory = (await fs.promises.stat(lower)).ino === (await fs.promises.stat(upper)).ino } catch {}
  assert.equal(wikiMetadataIssue(root), sameDirectory ? 'unsafe' : undefined)
  let deny = false
  const lstat = t.mock.method(fs, 'lstatSync', (path, ...args) => {
    if (deny && path === file) throw Object.assign(new Error('denied'), { code: 'EACCES' })
    return realLstat(path === lower ? upper : path, ...args)
  })
  const readdir = t.mock.method(fs, 'readdirSync', (path, options) => {
    const names = realReadDir(path)
    if (options?.withFileTypes) return names.map(name => ({ name, isDirectory: () => false, isFile: () => false, isSymbolicLink: () => false }))
    return names
  })
  syncBuiltinESMExports()
  try {
    assert.equal(wikiMetadataIssue(root), 'unsafe', 'unknown directory type bits cannot hide a companion')
    assert.equal(await readFile(file, 'utf8'), 'companion')
    deny = true
    assert.equal(wikiMetadataIssue(root), 'unreadable', 'a failed lstat cannot be treated as safe')
  } finally {
    lstat.mock.restore()
    readdir.mock.restore()
    syncBuiltinESMExports()
  }
  await rm(upper, { recursive: true })
  const outside = await makeRoot(t)
  await writeFile(join(outside, '._outside.md'), 'outside')
  await symlink(outside, join(wiki, 'linked'))
  assert.equal(wikiMetadataIssue(root), undefined, 'directory symlinks are not traversed')
})

test('Wiki checkpoint preflight detects companion paths without altering the saved run', async t => {
  const root = await makeRoot(t)
  const wiki = join(root, 'openwiki')
  await mkdir(wiki)
  const file = join(wiki, '.run.json')
  const base = { runId: 'current-run', initialPages: ['quickstart.md'], requiredRewritePages: [], preparedWiki: { generatedProvenance: [] } }
  const cases = [
    { initialPages: ['nested/._ghost.md'] },
    { requiredRewritePages: ['nested\\._ghost.md'] },
    { preparedWiki: { generatedProvenance: [{ page: '._ghost.md' }] } },
    { plan: { pages: [{ path: 'nested/._ghost.md' }] } },
    { plan: { pages: [{ path: 'safe.md', relatedPages: ['nested\\._ghost.md'] }] } },
    { plan: { deletePages: ['._ghost.md'] } },
    { plan: { deferredClaimPages: ['nested/._ghost.md'] } },
    { plan: { pages: [{ path: 'safe.md', seedPaths: ['openwiki/nested/._ghost.md'] }] } },
  ]
  for (const unsafe of cases) {
    const serialized = JSON.stringify({ ...base, ...unsafe })
    await writeFile(file, serialized)
    assert.equal(wikiCheckpointIssue(root), 'unsafe')
    for (const name of ['openwiki_begin', 'openwiki_next_page', 'openwiki_finish']) {
      assert.match(wikiGuardDenial(`mcp__openwiki__${name}`, { runId: 'current-run', root, mode: 'update' }, { root, mode: 'update' }), /更新记录包含系统伴随文件/)
    }
    assert.equal(await readFile(file, 'utf8'), serialized)
  }
  const safe = JSON.stringify({ ...base, plan: { pages: [{ path: 'safe.md', seedPaths: ['src/._source.js'], title: 'Mention ._ghost.md as ordinary prose' }] } })
  await writeFile(file, safe)
  assert.equal(wikiCheckpointIssue(root), undefined)
  const child = { root, mode: 'update' }
  const call = args => wikiGuardDenial('mcp__openwiki__openwiki_submit_plan', { runId: 'current-run', ...args }, child)
  assert.equal(call({ pages: [{ path: 'safe.md', seedPaths: ['src/._source.js'] }] }), undefined)
  assert.match(call({ pages: [{ path: '._new.md' }] }), /不能提交/)
  assert.match(call({ pages: [{ path: 'safe.md', relatedPages: ['a\\._related.md'] }] }), /不能提交/)
  assert.match(call({ pages: [], deletePages: ['._delete.md'] }), /不能提交/)
  assert.match(call({ pages: [{ path: 'safe.md', seedPaths: ['openwiki/._seed.md'] }] }), /不能提交/)
  assert.equal(await readFile(file, 'utf8'), safe, 'rejected proposals do not modify checkpoint')
})

test('wiki child may write only inside openwiki/', async t => {
  const root = await makeRoot(t)
  const target = { root, mode: 'update' }
  assert.equal(wikiGuardDenial('write', { file_path: join(root, 'openwiki/a.md') }, target), undefined)
  await mkdir(join(root, 'openwiki/sub'), { recursive: true })
  assert.equal(wikiGuardDenial('edit', { file_path: join(root, 'openwiki/sub/b.md') }, target), undefined)
  assert.equal(wikiGuardDenial('write', { file_path: 'openwiki/c.md' }, target), undefined)
})

test('wiki child cannot touch project data, source, or escape openwiki/', () => {
  for (const file of [
    join(root, '.project/project.md'),
    join(root, 'src/index.js'),
    join(root, 'openwiki/../src/x.js'),
    'openwiki/../.project/project.md',
    '/etc/passwd',
  ]) {
    const denial = wikiGuardDenial('write', { file_path: file }, target)
    assert.ok(denial, `expected denial for ${file}`)
  }
  // Required target path.
  assert.ok(wikiGuardDenial('edit', {}, target))
})

test('wiki child cannot write through symlinks outside openwiki, including new files', async t => {
  const root = await makeRoot(t)
  const outside = await makeRoot(t)
  const wiki = join(root, 'openwiki')
  await mkdir(wiki)
  await mkdir(join(root, '.project'))
  await writeFile(join(root, '.project', 'project.md'), 'original')
  await symlink(join(root, '.project'), join(wiki, 'project-link'))
  await symlink(outside, join(wiki, 'outside-link'))
  await symlink(join(root, '.project', 'project.md'), join(wiki, 'file-link'))
  await symlink(join(root, 'missing'), join(wiki, 'dangling-link'))
  const target = { root, mode: 'update' }
  for (const path of ['project-link/project.md', 'project-link/new.md', 'outside-link/new.md', 'file-link', 'dangling-link/new.md']) {
    assert.ok(wikiGuardDenial('write', { file_path: join(wiki, path) }, target), path)
  }
  await mkdir(join(wiki, 'safe'))
  await symlink(join(wiki, 'safe'), join(wiki, 'safe-link'))
  assert.equal(wikiGuardDenial('write', { file_path: join(wiki, 'safe-link/new.md') }, target), undefined)
})

test('wiki child rejects a redirected openwiki root', async t => {
  const root = await makeRoot(t)
  await mkdir(join(root, '.project'))
  await symlink(join(root, '.project'), join(root, 'openwiki'))
  assert.ok(wikiGuardDenial('write', { file_path: 'openwiki/new.md' }, { root, mode: 'init' }))
})

test('wiki child cannot use shells, subagents, communication or unknown tools', () => {
  for (const name of ['bash', 'pwsh', 'apply_patch', 'str_replace_editor', 'terminal_open', 'terminal_send', 'subagent', 'subagent_fork', 'working_directory', 'create_worktree', 'send_message', 'list_agents', 'wait_agent', 'interrupt_agent', 'unrecognized_tool']) {
    assert.ok(wikiGuardDenial(name, {}, target), `expected ${name} denial`)
  }
})

test('wiki child keeps read/search/skill/openwiki tools', async t => {
  const root = await makeRoot(t)
  const target = { root, mode: 'update' }
  await writeFile(join(root, 'source.md'), 'source')
  assert.equal(wikiGuardDenial('read', { file_path: 'source.md' }, target), undefined)
  for (const name of ['glob', 'grep']) {
    assert.equal(wikiGuardDenial(name, {}, target), undefined)
  }
  assert.equal(wikiGuardDenial('skill', { name: 'openwiki' }, target), undefined)
  assert.ok(wikiGuardDenial('skill', { name: 'other-skill' }, target))
  assert.ok(wikiGuardDenial('skill', {}, target))
  assert.equal(wikiGuardDenial('mcp__openwiki__openwiki_begin', { mode: 'update', root }, target), undefined)
  // Other sessions are never affected.
  assert.equal(wikiGuardDenial('bash', {}, undefined), undefined)
})

test('wiki read and searches reject outside roots, home expansion and symlink escapes', async t => {
  const root = await makeRoot(t)
  const outside = await makeRoot(t)
  const target = { root, mode: 'update' }
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'inside.md'), 'inside')
  await writeFile(join(outside, 'secret.md'), 'outside')
  await mkdir(join(outside, 'nested'))
  await symlink(outside, join(root, 'escape'))
  await symlink(join(outside, 'nested'), join(root, 'nested-link'))
  await symlink(join(outside, 'secret.md'), join(root, 'secret-link'))
  await symlink(join(root, 'src'), join(root, 'safe-link'))
  for (const path of ['src/inside.md', join(root, 'src', 'inside.md'), 'safe-link/inside.md']) {
    assert.equal(wikiGuardDenial('read', { file_path: path }, target), undefined, path)
  }
  for (const path of [join(outside, 'secret.md'), '../outside', 'escape/secret.md', 'nested-link/../secret.md', 'secret-link', '~/secret', 'missing.md']) {
    assert.ok(wikiGuardDenial('read', { file_path: path }, target), path)
  }
  assert.ok(wikiGuardDenial('read', {}, target))
  for (const name of ['glob', 'grep']) {
    assert.equal(wikiGuardDenial(name, {}, target), undefined, `${name} defaults to child cwd`)
    assert.equal(wikiGuardDenial(name, { path: 'src' }, target), undefined)
    assert.equal(wikiGuardDenial(name, { path: join(root, 'src') }, target), undefined)
    for (const path of [outside, '..', 'escape', '~/outside', 'missing']) {
      assert.ok(wikiGuardDenial(name, { path }, target), `${name}: ${path}`)
    }
  }
  assert.ok(wikiGuardDenial('write', { file_path: 'openwiki/escape/../source.md' }, target))
})

test('wiki child rejects programmatic tool mode before Node code can run', () => {
  const denial = wikiGuardDenial('run_code', {
    code: 'const fs = await import("node:fs"); fs.writeFileSync("src/changed.js", "x"); await tools.send_message({recipient: "lead", message: "x"})',
  }, target)
  assert.match(denial, /PTC/)
  assert.match(denial, /不支持/)
})

test('the Host owns the lifecycle mode: begin must match and never init over an existing wiki', async t => {
  const root = await makeRoot(t)
  const target = { root, mode: 'update' }
  assert.ok(wikiGuardDenial('mcp__openwiki__openwiki_begin', { mode: 'init', root }, target), 'init over update run denied')
  assert.ok(wikiGuardDenial('mcp__openwiki__openwiki_begin', { root }, target), 'missing mode denied')
  assert.ok(wikiGuardDenial('mcp__openwiki__openwiki_begin', { mode: 'update', root: '/other/repo' }, target), 'other root denied')
  assert.equal(wikiGuardDenial('mcp__openwiki__openwiki_begin', { mode: 'init', root }, { root, mode: 'init' }), undefined)
})

test('init rechecks the target immediately before begin and cannot repeat after a successful start', async t => {
  const root = await makeRoot(t)
  const wiki = join(root, 'openwiki')
  const args = { mode: 'init', root }
  const target = { root, mode: 'init', resumeRunId: null, initStarted: false }
  await mkdir(wiki)
  await writeFile(join(wiki, 'attachment.txt'), 'valuable')
  assert.ok(wikiGuardDenial('mcp__openwiki__openwiki_begin', args, target), 'late attachment blocks init')
  await rm(join(wiki, 'attachment.txt'))
  assert.equal(wikiGuardDenial('mcp__openwiki__openwiki_begin', args, target), undefined)
  assert.ok(wikiGuardDenial('mcp__openwiki__openwiki_begin', args, target), 'a second init call is denied even while empty')
  await writeFile(join(wiki, 'page.md'), 'generated page')
  assert.ok(wikiGuardDenial('mcp__openwiki__openwiki_begin', args, target), 'repeated init cannot replace generated pages')
})

test('resumed init remains bound to its original checkpoint', async t => {
  const root = await makeRoot(t)
  const wiki = join(root, 'openwiki')
  const checkpoint = join(wiki, '.run.json')
  const args = { mode: 'init', root }
  const target = { root, mode: 'init', resumeRunId: 'original', initStarted: false }
  await mkdir(wiki)
  await writeFile(checkpoint, JSON.stringify({ runId: 'original', mode: 'init' }))
  assert.equal(wikiGuardDenial('mcp__openwiki__openwiki_begin', args, target), undefined)
  await writeFile(checkpoint, JSON.stringify({ runId: 'other', mode: 'init' }))
  assert.match(wikiGuardDenial('mcp__openwiki__openwiki_begin', args, target), /更新记录.*变化/, 'replacement checkpoint reports record change')
  await rm(checkpoint)
  assert.match(wikiGuardDenial('mcp__openwiki__openwiki_begin', args, target), /更新记录.*变化/, 'missing checkpoint reports record change')
})

test('resumed update remains bound to its original checkpoint', async t => {
  const root = await makeRoot(t)
  const wiki = join(root, 'openwiki')
  const checkpoint = join(wiki, '.run.json')
  const args = { mode: 'update', root }
  const target = { root, mode: 'update', resumeRunId: 'original' }
  await mkdir(wiki)
  await writeFile(checkpoint, JSON.stringify({ runId: 'original', mode: 'update' }))
  assert.equal(wikiGuardDenial('mcp__openwiki__openwiki_begin', args, target), undefined)
  await writeFile(checkpoint, JSON.stringify({ runId: 'other', mode: 'update' }))
  assert.match(wikiGuardDenial('mcp__openwiki__openwiki_begin', args, target), /更新记录.*变化/, 'replacement checkpoint reports record change')
  assert.match(wikiGuardDenial('mcp__openwiki__openwiki_begin', args, { root, mode: 'update' }), /更新记录.*变化/, 'new run cannot resume a late checkpoint')
  await rm(checkpoint)
  assert.match(wikiGuardDenial('mcp__openwiki__openwiki_begin', args, target), /更新记录.*变化/, 'missing checkpoint reports record change')
  assert.equal(wikiGuardDenial('mcp__openwiki__openwiki_begin', args, { root, mode: 'update' }), undefined)
})

test('OpenWiki lifecycle calls must use the current project run', async t => {
  const root = await makeRoot(t)
  const wiki = join(root, 'openwiki')
  await mkdir(wiki)
  await writeFile(join(wiki, '.run.json'), JSON.stringify({ runId: 'current-run' }))
  const target = { root, mode: 'update' }
  for (const name of ['openwiki_submit_plan', 'openwiki_next_page', 'openwiki_inspect_page_claims', 'openwiki_submit_page', 'openwiki_finish']) {
    assert.equal(wikiGuardDenial(`mcp__openwiki__${name}`, { runId: 'current-run' }, target), undefined, name)
    assert.ok(wikiGuardDenial(`mcp__openwiki__${name}`, { runId: 'another-project-run' }, target), name)
    assert.ok(wikiGuardDenial(`mcp__openwiki__${name}`, {}, target), name)
  }
})
