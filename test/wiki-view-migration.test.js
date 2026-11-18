import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prepareWikiView, markWikiViewReady, wikiStatus, wikiPage, wikiEvidence } from '../core/wiki.js'
import { makeRoot } from './util.js'

test('staged migration keeps the legacy readable view until success, then uses the new live view on later attempts', { skip: process.platform !== 'darwin' }, async t => {
  const root = await makeRoot(t)
  const wiki = join(root, 'openwiki')
  const claims = join(wiki, '.claims', 'quickstart.json')
  const job = join(root, '.project', '.local', 'wiki-job.json')
  await mkdir(join(wiki, '.claims'), { recursive: true })
  await writeFile(join(wiki, 'quickstart.md'), '# Legacy safe content\n')
  await writeFile(claims, JSON.stringify({ claims: [{ statement: 'legacy evidence', evidence: [] }] }))
  await writeFile(join(wiki, '.last-update.json'), JSON.stringify({ status: 'complete', updatedAt: new Date().toISOString() }))
  const oldView = await prepareWikiView(root)
  await markWikiViewReady(root, oldView.epoch)
  await writeFile(join(wiki, 'quickstart.md'), '# Interrupted partial content\n')
  await writeFile(claims, JSON.stringify({ claims: [{ statement: 'partial evidence', evidence: [] }] }))

  const setJob = async fields => writeFile(job, JSON.stringify({ strategy: 'staged', startedAt: 1, ...fields }))
  const readPair = async () => {
    const status = await wikiStatus(root)
    const page = await wikiPage(root, 'quickstart.md', status.viewVersion)
    const evidence = await wikiEvidence(root, 'quickstart.md', page.viewVersion)
    return { status, page, evidence }
  }

  await setJob({ status: 'running', baseView: 'legacy' })
  let result = await readPair()
  assert.equal(result.status.viewIsSnapshot, true)
  assert.equal(result.page.content, '# Legacy safe content\n')
  assert.equal(result.evidence.claims[0].statement, 'legacy evidence')
  await setJob({ status: 'failed', baseView: 'legacy' })
  result = await readPair()
  assert.equal(result.page.content, '# Legacy safe content\n')
  assert.equal(result.evidence.claims[0].statement, 'legacy evidence')

  // Simulate successful publication followed by a distinct update attempt.
  await writeFile(join(wiki, 'quickstart.md'), '# Newly published content\n')
  await writeFile(claims, JSON.stringify({ claims: [{ statement: 'new evidence', evidence: [] }] }))
  await setJob({ status: 'done', baseView: 'legacy' })
  result = await readPair()
  assert.equal(result.status.viewIsSnapshot, false)
  assert.equal(result.page.content, '# Newly published content\n')
  assert.equal(result.evidence.claims[0].statement, 'new evidence')

  for (const status of ['running', 'stopping', 'failed']) {
    await setJob({ status, baseView: 'live', startedAt: 2 })
    result = await readPair()
    assert.equal(result.status.viewIsSnapshot, false, status)
    assert.equal(result.page.content, '# Newly published content\n', status)
    assert.equal(result.evidence.claims[0].statement, 'new evidence', status)
  }
})

test('publication changes the view version within the same staged job', async t => {
  const root = await makeRoot(t)
  const wiki = join(root, 'openwiki')
  const pagePath = join(wiki, 'quickstart.md')
  const claimsPath = join(wiki, '.claims', 'quickstart.json')
  const local = join(root, '.project', '.local')
  const jobPath = join(local, 'wiki-job.json')
  await mkdir(join(wiki, '.claims'), { recursive: true })
  await mkdir(local, { recursive: true })
  await writeFile(pagePath, '# Previous page\n')
  await writeFile(claimsPath, JSON.stringify({ claims: [{ statement: 'previous source', evidence: [] }] }))

  const job = { strategy: 'staged', status: 'running', baseView: 'live', startedAt: 42 }
  await writeFile(jobPath, JSON.stringify(job))
  const before = await wikiStatus(root)
  const oldPage = await wikiPage(root, 'quickstart.md', before.viewVersion)
  const oldEvidence = await wikiEvidence(root, 'quickstart.md', oldPage.viewVersion)
  assert.equal(oldPage.content, '# Previous page\n')
  assert.equal(oldEvidence.claims[0].statement, 'previous source')

  // The host publishes a new page and Claims while retaining the same job ID
  // and startedAt. Readers holding the previous view must reload both.
  await writeFile(pagePath, '# Published page\n')
  await writeFile(claimsPath, JSON.stringify({ claims: [{ statement: 'published source', evidence: [] }] }))
  await writeFile(jobPath, JSON.stringify({ ...job, status: 'done' }))
  const after = await wikiStatus(root)
  assert.notEqual(after.viewVersion, before.viewVersion)
  await assert.rejects(wikiPage(root, 'quickstart.md', before.viewVersion), error => error.code === 'WIKI_VIEW_CHANGED')
  await assert.rejects(wikiEvidence(root, 'quickstart.md', oldPage.viewVersion), error => error.code === 'WIKI_VIEW_CHANGED')
  const newPage = await wikiPage(root, 'quickstart.md', after.viewVersion)
  const newEvidence = await wikiEvidence(root, 'quickstart.md', newPage.viewVersion)
  assert.equal(newPage.content, '# Published page\n')
  assert.equal(newEvidence.claims[0].statement, 'published source')
})
