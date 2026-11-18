import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wikiStatus, wikiPage, wikiEvidence, wikiBeginMode } from '../core/wiki.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pw-wiki-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'openwiki', 'architecture'), { recursive: true })
  await writeFile(join(root, 'openwiki', 'quickstart.md'), '# Quickstart\n\nHello **world**.\n')
  await writeFile(join(root, 'openwiki', 'architecture', 'calc.md'), '# Calc\n\n```mermaid\nflowchart LR\nA-->B\n```\n')
  await writeFile(join(root, 'openwiki', '.last-update.json'), JSON.stringify({ updatedAt: '2026-11-13T00:00:00Z', status: 'complete' }))
  return root
}

test('wikiStatus lists pages and reads last-update; wikiPage reads content', async t => {
  const root = await fixture(t)
  const status = await wikiStatus(root)
  assert.equal(status.exists, true)
  assert.deepEqual(status.pages, ['architecture/calc.md', 'quickstart.md'])
  assert.equal(status.lastUpdate.status, 'complete')
  assert.equal(status.lastCompleted.updatedAt, '2026-11-13T00:00:00Z')
  const page = await wikiPage(root, 'quickstart.md')
  assert.match(page.content, /Hello \*\*world\*\*/)
})

test('wikiStatus keeps the previous completed date when the latest update was interrupted', async t => {
  const root = await fixture(t)
  const base = join(root, 'openwiki')
  await writeFile(join(base, '.last-update.json'), JSON.stringify({ updatedAt: '2026-11-16T00:00:00Z', status: 'interrupted' }))
  await writeFile(join(base, '.run.json'), JSON.stringify({ phase: 'planning', previousLastUpdate: { status: 'complete', updatedAt: '2026-11-13T00:00:00Z' } }))
  let status = await wikiStatus(root)
  assert.equal(status.lastUpdate.status, 'interrupted')
  assert.equal(status.lastCompleted.updatedAt, '2026-11-13T00:00:00Z')
  assert.deepEqual(status.pages, ['architecture/calc.md', 'quickstart.md'])
  await rm(join(base, '.run.json'))
  status = await wikiStatus(root)
  assert.equal(status.lastCompleted, null) // do not invent a successful date
})

test('wikiStatus on a repo without openwiki returns exists=false', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pw-nowiki-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const status = await wikiStatus(root)
  assert.equal(status.exists, false)
  assert.equal(status.pageCount, 0)
})

test('wikiPage rejects traversal and escaping symlinks', async t => {
  const root = await fixture(t)
  await writeFile(join(root, 'secret.md'), 'secret')
  await symlink(join(root, 'secret.md'), join(root, 'openwiki', 'escape.md'))
  await assert.rejects(wikiPage(root, '../secret.md'), e => e.code === 'PATH_ESCAPE')
  await assert.rejects(wikiPage(root, 'escape.md'), e => e.code === 'PATH_ESCAPE')
  await assert.rejects(wikiPage(root, '/etc/passwd'), e => e.code === 'INVALID_PATH')
})

test('wikiEvidence reads claims sidecar; missing page returns empty; traversal rejected', async t => {
  const root = await fixture(t)
  await mkdir(join(root, 'openwiki', '.claims', 'architecture'), { recursive: true })
  await writeFile(join(root, 'openwiki', '.claims', 'architecture', 'calc.json'), JSON.stringify({
    claims: [{ statement: 'A computes B', evidence: [{ resource: 'repo://src/a.js#L1-L9', version: 'v1' }] }],
  }))
  const ev = await wikiEvidence(root, 'architecture/calc.md')
  assert.equal(ev.claims.length, 1)
  assert.equal(ev.claims[0].statement, 'A computes B')
  assert.deepEqual(ev.claims[0].evidence, ['repo://src/a.js#L1-L9'])
  const none = await wikiEvidence(root, 'quickstart.md')
  assert.deepEqual(none.claims, [])
  await assert.rejects(wikiEvidence(root, '../secret.md'), e => e.code === 'PATH_ESCAPE')
})

test('wiki status and evidence reads preserve AppleDouble data', async t => {
  const root = await fixture(t)
  const metadata = Buffer.from([0, 5, 0x16, 7, 0, 2, 0, 0])
  await mkdir(join(root, 'openwiki', '.claims', 'architecture'), { recursive: true })
  await writeFile(join(root, 'openwiki', '.claims', 'architecture', 'calc.json'), JSON.stringify({ claims: [] }))
  const companions = [
    join(root, 'openwiki', '.claims', 'architecture', '._calc.json'),
    join(root, 'openwiki', '._quickstart.md'),
    join(root, 'openwiki', 'architecture', '._calc.md'),
    join(root, '._AGENTS.md'),
  ]
  for (const file of companions) await writeFile(file, metadata)
  const status = await wikiStatus(root)
  assert.deepEqual(status.pages, ['architecture/calc.md', 'quickstart.md'])
  const ev = await wikiEvidence(root, 'architecture/calc.md')
  assert.deepEqual(ev.claims, [])
  for (const file of companions) assert.deepEqual(await readFile(file), metadata)
})

test('wikiBeginMode: init only for a new wiki, update when pages exist, resume an interrupted run', async t => {
  const root = await fixture(t)
  assert.deepEqual(await wikiBeginMode(root), { mode: 'update', resume: false })
  const empty = await mkdtemp(join(tmpdir(), 'pw-wiki-empty-'))
  t.after(() => rm(empty, { recursive: true, force: true }))
  assert.deepEqual(await wikiBeginMode(empty), { mode: 'init', resume: false })
  await mkdir(join(empty, 'openwiki'))
  assert.deepEqual(await wikiBeginMode(empty), { mode: 'init', resume: false })
  await writeFile(join(empty, 'openwiki', 'attachment.txt'), 'keep me')
  assert.deepEqual(await wikiBeginMode(empty), { mode: 'update', resume: false })
  const run = {
    schemaVersion: 1, runId: '6d27a28a-1a22-4d8b-8d41-a019f623843b', phase: 'generating', mode: 'update',
    startedAt: '2026-11-17T00:00:00.000Z', language: 'zh', languageChanged: false,
    requiredRewritePages: [], initialPages: [], sourceFingerprint: 'sha256:' + 'a'.repeat(64),
    actor: { producerActor: 'test', metadataModel: 'test' }, previousLastUpdate: null,
    beforeContentSnapshot: '', preparedWiki: { generatedProvenance: [] },
  }
  await writeFile(join(root, 'openwiki', '.run.json'), JSON.stringify(run))
  assert.deepEqual(await wikiBeginMode(root), { mode: 'update', resume: true, runId: run.runId })
  await writeFile(join(root, 'openwiki', '.run.json'), JSON.stringify({ ...run, mode: 'init' }))
  assert.deepEqual(await wikiBeginMode(root), { mode: 'init', resume: true, runId: run.runId })
  await writeFile(join(root, 'openwiki', '.run.json'), '{invalid')
  await assert.rejects(wikiBeginMode(root), e => e.code === 'WIKI_STATE_UNREADABLE')
  await writeFile(join(root, 'openwiki', '.run.json'), JSON.stringify({ ...run, phase: 'idle' }))
  await assert.rejects(wikiBeginMode(root), e => e.code === 'WIKI_STATE_UNREADABLE')
  await writeFile(join(root, 'openwiki', '.run.json'), JSON.stringify({ ...run, mode: 'invalid' }))
  await assert.rejects(wikiBeginMode(root), e => e.code === 'WIKI_STATE_UNREADABLE')
})
