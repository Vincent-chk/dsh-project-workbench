import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, open, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareWikiStaging } from '../core/wiki-staging.js'

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'wiki-stage-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Wiki test')
  git(root, 'config', 'user.email', 'wiki@example.invalid')
  await writeFile(join(root, '.gitignore'), 'ignored.txt\nprivate.txt\nnode_modules/\n')
  await writeFile(join(root, '.openwikiignore'), 'private.txt\nnode_modules/\n')
  await writeFile(join(root, 'staged.txt'), 'committed staged\n')
  await writeFile(join(root, 'unstaged.txt'), 'committed unstaged\n')
  await writeFile(join(root, 'deleted.txt'), 'committed deleted\n')
  await mkdir(join(root, 'openwiki'))
  await writeFile(join(root, 'openwiki', 'index.md'), 'original wiki\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'baseline')
  await writeFile(join(root, 'staged.txt'), 'staged content\n')
  git(root, 'add', 'staged.txt')
  await writeFile(join(root, 'staged.txt'), 'staged plus working content\n')
  await writeFile(join(root, 'unstaged.txt'), 'unstaged content\n')
  await writeFile(join(root, 'untracked.txt'), 'untracked content\n')
  await writeFile(join(root, 'ignored.txt'), 'ignored content\n')
  await writeFile(join(root, 'private.txt'), 'excluded by Wiki\n')
  await mkdir(join(root, 'node_modules'))
  await writeFile(join(root, 'node_modules', 'dependency.txt'), 'dependency\n')
  await rm(join(root, 'deleted.txt'))
  return root
}

test('stages the current Git working tree without changing the original', async t => {
  const root = await fixture(t)
  const head = git(root, 'rev-parse', 'HEAD')
  const status = git(root, 'status', '--porcelain=v1', '--untracked-files=all')
  const index = await readFile(join(root, '.git', 'index'))
  const staged = await prepareWikiStaging(root)
  t.after(staged.cleanup)
  assert.notEqual(staged.root, root)
  assert.equal(git(staged.root, 'rev-parse', 'HEAD'), head)
  assert.equal(git(staged.root, 'status', '--porcelain=v1', '--untracked-files=all'), status)
  assert.equal(git(staged.root, 'show', ':staged.txt'), 'staged content\n')
  assert.equal(await readFile(join(staged.root, 'staged.txt'), 'utf8'), 'staged plus working content\n')
  assert.equal(await readFile(join(staged.root, 'unstaged.txt'), 'utf8'), 'unstaged content\n')
  assert.equal(await readFile(join(staged.root, 'untracked.txt'), 'utf8'), 'untracked content\n')
  await assert.rejects(readFile(join(staged.root, 'ignored.txt')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(staged.root, 'private.txt')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(staged.root, 'node_modules', 'dependency.txt')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(staged.root, 'deleted.txt')), { code: 'ENOENT' })
  await writeFile(join(staged.root, 'openwiki', 'index.md'), 'isolated change\n')
  git(staged.root, 'add', 'openwiki/index.md')
  const newObject = git(staged.root, 'rev-parse', ':openwiki/index.md').trim()
  assert.throws(() => git(root, 'cat-file', '-e', newObject), 'new staging objects must not be written to the source')
  assert.equal(await readFile(join(root, 'openwiki', 'index.md'), 'utf8'), 'original wiki\n')
  assert.equal(git(root, 'status', '--porcelain=v1', '--untracked-files=all'), status)
  assert.deepEqual(await readFile(join(root, '.git', 'index')), index)
  assert.equal(await staged.verifySource(), true)
  // Porcelain still says MM, so a status-only comparison misses this change.
  await writeFile(join(root, 'staged.txt'), 'different working content\n')
  assert.equal(git(root, 'status', '--porcelain=v1', '--untracked-files=all'), status)
  assert.equal(await staged.verifySource(), false)
})

test('refuses symlinks and leaves the original untouched', async t => {
  const root = await fixture(t)
  await symlink('unstaged.txt', join(root, 'link'))
  const status = git(root, 'status', '--porcelain=v1', '--untracked-files=all')
  await assert.rejects(prepareWikiStaging(root), /unsupported source file: link/)
  assert.equal(git(root, 'status', '--porcelain=v1', '--untracked-files=all'), status)
})

test('requires the exact Git root', async t => {
  const root = await fixture(t)
  await mkdir(join(root, 'subdir'))
  await assert.rejects(prepareWikiStaging(join(root, 'subdir')), /exact Git root/)
})

test('refuses a conflicted index rather than silently losing staged entries', async t => {
  const root = await fixture(t)
  const blob = git(root, 'hash-object', '-w', 'staged.txt').trim()
  execFileSync('git', ['update-index', '--index-info'], {
    cwd: root, input: `100644 ${blob} 1\tconflict.txt\n100644 ${blob} 2\tconflict.txt\n`, stdio: ['pipe', 'pipe', 'pipe'],
  })
  const before = git(root, 'ls-files', '--stage')
  await assert.rejects(prepareWikiStaging(root), /conflicted indexes/)
  assert.equal(git(root, 'ls-files', '--stage'), before)
})

test('refuses index flags that cannot be reproduced safely', async t => {
  const root = await fixture(t)
  git(root, 'update-index', '--assume-unchanged', 'unstaged.txt')
  await assert.rejects(prepareWikiStaging(root), /assume-unchanged/)
})

test('copies larger source files while preserving original bytes, metadata and Git index', async t => {
  const root = await fixture(t)
  const source = join(root, 'large.bin')
  const out = await open(source, 'wx')
  try {
    for (let i = 0; i < 10; i++) await out.writeFile(Buffer.alloc(1024 * 1024, i))
  } finally { await out.close() }
  const sourceInfo = await stat(source)
  const sourceBytes = await readFile(source)
  const sourceIndex = await readFile(join(root, '.git', 'index'))
  const staged = await prepareWikiStaging(root)
  t.after(staged.cleanup)
  assert.deepEqual(await readFile(join(staged.root, 'large.bin')), sourceBytes)
  assert.deepEqual(await readFile(source), sourceBytes)
  assert.equal((await stat(source)).mtimeMs, sourceInfo.mtimeMs)
  assert.deepEqual(await readFile(join(root, '.git', 'index')), sourceIndex)
  assert.equal(await staged.verifySource(), true)
})

for (const hasIndex of [false, true]) test(`stages an unborn Git repository ${hasIndex ? 'with' : 'without'} an index`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'wiki-unborn-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  git(root, 'init', '-q')
  git(root, 'symbolic-ref', 'HEAD', 'refs/heads/workbench-new')
  await writeFile(join(root, 'source.js'), 'export const value = 1\n')
  if (hasIndex) git(root, 'add', 'source.js')
  const sourceStatus = git(root, 'status', '--porcelain=v1', '--untracked-files=all')
  const sourceIndex = hasIndex ? await readFile(join(root, '.git', 'index')) : null
  const staged = await prepareWikiStaging(root)
  t.after(staged.cleanup)
  assert.equal(git(staged.root, 'symbolic-ref', 'HEAD'), 'refs/heads/workbench-new\n')
  assert.throws(() => git(staged.root, 'rev-parse', '--verify', 'HEAD'))
  assert.equal(git(staged.root, 'status', '--porcelain=v1', '--untracked-files=all'), sourceStatus)
  assert.equal(await readFile(join(staged.root, 'source.js'), 'utf8'), 'export const value = 1\n')
  assert.equal(await staged.verifySource(), true)
  if (hasIndex) assert.deepEqual(await readFile(join(root, '.git', 'index')), sourceIndex)
  else await assert.rejects(readFile(join(root, '.git', 'index')), { code: 'ENOENT' })
  assert.equal(git(root, 'status', '--porcelain=v1', '--untracked-files=all'), sourceStatus)
})
