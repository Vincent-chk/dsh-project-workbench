import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureWikiBaseline, publishWikiCandidate } from '../core/wiki-publish.js'

async function fixture(t, { old = true } = {}) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'wiki-publish-test-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  let root = join(dir, 'project'), candidate = join(dir, 'candidate')
  await fs.mkdir(root); await fs.mkdir(candidate)
  root = await fs.realpath(root); candidate = await fs.realpath(candidate)
  await fs.mkdir(join(root, '.project', '.local'), { recursive: true })
  await fs.writeFile(join(candidate, 'quickstart.md'), 'new page')
  await fs.writeFile(join(candidate, '.last-update.json'), JSON.stringify({ status: 'complete', updatedAt: '2026-11-17T11:16:00Z' }))
  if (old) {
    await fs.mkdir(join(root, 'openwiki'))
    await fs.writeFile(join(root, 'openwiki', 'quickstart.md'), 'old page')
    await fs.writeFile(join(root, 'openwiki', '._quickstart.md'), Buffer.from([0, 5, 22, 7, 10, 42]))
    await fs.writeFile(join(root, 'openwiki', '.run.json'), 'old interrupted state')
  }
  return { root, candidate, target: join(root, 'openwiki') }
}

test('publishes a complete candidate and retains old Wiki including companion and checkpoint bytes', async t => {
  const f = await fixture(t), baseline = await captureWikiBaseline(f.root)
  const oldInfo = await fs.lstat(f.target)
  const { backup } = await publishWikiCandidate(f.root, f.candidate, baseline)
  assert.equal((await fs.lstat(backup)).ino, oldInfo.ino)
  assert.equal(await fs.readFile(join(f.target, 'quickstart.md'), 'utf8'), 'new page')
  assert.equal(await fs.readFile(join(backup, 'quickstart.md'), 'utf8'), 'old page')
  assert.deepEqual(await fs.readFile(join(backup, '._quickstart.md')), Buffer.from([0, 5, 22, 7, 10, 42]))
  assert.equal(await fs.readFile(join(backup, '.run.json'), 'utf8'), 'old interrupted state')
})

test('publishes the first Wiki without fabricating a backup', async t => {
  const f = await fixture(t, { old: false }), baseline = await captureWikiBaseline(f.root)
  assert.equal(baseline, null)
  assert.equal((await publishWikiCandidate(f.root, f.candidate, baseline)).backup, null)
  assert.equal(await fs.readFile(join(f.target, 'quickstart.md'), 'utf8'), 'new page')
})

test('detects a live Wiki change and leaves that change untouched', async t => {
  const f = await fixture(t), baseline = await captureWikiBaseline(f.root)
  await fs.writeFile(join(f.target, 'quickstart.md'), 'concurrent edit')
  await assert.rejects(publishWikiCandidate(f.root, f.candidate, baseline), { code: 'WIKI_CONFLICT' })
  assert.equal(await fs.readFile(join(f.target, 'quickstart.md'), 'utf8'), 'concurrent edit')
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['.project', 'openwiki'])
})

test('rejects unfinished candidate and candidates containing symlinks', async t => {
  const f = await fixture(t), baseline = await captureWikiBaseline(f.root)
  await fs.writeFile(join(f.candidate, '.run.json'), '{}')
  await assert.rejects(publishWikiCandidate(f.root, f.candidate, baseline), /unfinished/)
  await fs.unlink(join(f.candidate, '.run.json'))
  await fs.symlink(join(f.target, 'quickstart.md'), join(f.candidate, 'linked.md'))
  await assert.rejects(publishWikiCandidate(f.root, f.candidate, baseline), /symbolic link/)
  assert.equal(await fs.readFile(join(f.target, 'quickstart.md'), 'utf8'), 'old page')
})

test('rejects a redirected local directory without changing the existing Wiki', async t => {
  const f = await fixture(t), baseline = await captureWikiBaseline(f.root)
  const local = join(f.root, '.project', '.local')
  await fs.rmdir(local)
  await fs.symlink(f.candidate, local)
  await assert.rejects(publishWikiCandidate(f.root, f.candidate, baseline), /local directory is unsafe/)
  assert.equal(await fs.readFile(join(f.target, 'quickstart.md'), 'utf8'), 'old page')
})

test('restores old Wiki when installing the new tree fails', async t => {
  const f = await fixture(t), baseline = await captureWikiBaseline(f.root), originalRename = fs.rename
  let injected = false
  t.mock.method(fs, 'rename', async (from, to) => {
    if (!injected && to === f.target && from.includes('wiki-next-')) {
      injected = true
      throw new Error('injected publish failure')
    }
    return originalRename(from, to)
  })
  await assert.rejects(publishWikiCandidate(f.root, f.candidate, baseline), /injected publish failure/)
  assert.equal(await fs.readFile(join(f.target, 'quickstart.md'), 'utf8'), 'old page')
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['.project', 'openwiki'])
})

test('reports the retained old path if rollback cannot restore it', async t => {
  const f = await fixture(t), baseline = await captureWikiBaseline(f.root), originalRename = fs.rename
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === f.target) throw new Error('injected rename failure')
    return originalRename(from, to)
  })
  let failure
  try { await publishWikiCandidate(f.root, f.candidate, baseline) } catch (error) { failure = error }
  assert.match(failure?.message ?? '', /injected rename failure/)
  assert.match(failure?.rollbackError ?? '', /injected rename failure/)
  assert.equal(await fs.readFile(join(failure.backup, 'quickstart.md'), 'utf8'), 'old page')
  assert.equal(await fs.readFile(join(failure.backup, '.run.json'), 'utf8'), 'old interrupted state')
})
