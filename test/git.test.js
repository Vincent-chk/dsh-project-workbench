import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { initProject, createRequirement } from '../core/store.js'
import { gitStatus, gitCommitProject } from '../core/git.js'

const exec = promisify(execFile)
async function repo(t) {
  const root = await mkdtemp(join(tmpdir(), 'pw-git-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await exec('git', ['init', '-q'], { cwd: root })
  await exec('git', ['config', 'user.email', 'probe@localhost'], { cwd: root })
  await exec('git', ['config', 'user.name', 'Probe'], { cwd: root })
  return root
}

test('gitStatus counts only .project changes; commit stages only .project', async t => {
  const root = await repo(t)
  await initProject(root, { name: 'g' })
  await createRequirement(root, 'r')
  const before = await gitStatus(root)
  assert.equal(before.available, true)
  assert.ok(before.uncommitted > 0)
  const res = await gitCommitProject(root, 'project: test')
  assert.equal(res.committed, true)
  const after = await gitStatus(root)
  assert.equal(after.uncommitted, 0)
  // only .project paths were committed
  const { stdout } = await exec('git', ['show', '--name-only', '--pretty=format:', 'HEAD'], { cwd: root })
  const files = stdout.split('\n').filter(Boolean)
  assert.ok(files.length > 0)
  assert.ok(files.every(f => f.startsWith('.project/')), files.join(','))
})

test('gitCommit with nothing to commit is rejected; non-git root rejected', async t => {
  const root = await repo(t)
  await initProject(root)
  await gitCommitProject(root)
  await assert.rejects(gitCommitProject(root), e => e.code === 'NOTHING_TO_COMMIT')
  const plain = await mkdtemp(join(tmpdir(), 'pw-nogit-'))
  t.after(() => rm(plain, { recursive: true, force: true }))
  await assert.rejects(gitStatus(plain), e => e.code === 'NOT_GIT')
})
