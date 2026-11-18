import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { atomicWrite, readWorkspaceFile } from '../core/files.js'

async function fixture(t) {
  const directory = await mkdtemp(join(process.cwd(), '.tmp-project-workbench-'))
  t.after(async () => {
    await chmod(directory, 0o700).catch(() => {})
    const { rm } = await import('node:fs/promises')
    await rm(directory, { recursive: true, force: true })
  })
  return directory
}

test('atomic write preserves Chinese and CRLF bytes', async (t) => {
  const root = await fixture(t)
  const file = join(root, '需求.md')
  const content = '中文标题\r\n第二行\r\n'
  await atomicWrite(file, content)
  assert.equal(await readFile(file, 'utf8'), content)
  assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.tmp')), [])
})

test('atomic write replaces an existing file and handles a large payload', async (t) => {
  const root = await fixture(t)
  const file = join(root, 'large.md')
  await atomicWrite(file, 'old')
  const content = '项目🚀\n'.repeat(300000)
  await atomicWrite(file, content)
  assert.equal(await readFile(file, 'utf8'), content)
})

test('read-only directory failure retains the original and removes temporary files', async (t) => {
  if (process.getuid?.() === 0) return t.skip('permission bits do not restrict root')
  const root = await mkdtemp(join(tmpdir(), 'project-workbench-readonly-'))
  t.after(async () => {
    await chmod(root, 0o700).catch(() => {})
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  })
  const file = join(root, 'project.md')
  await writeFile(file, 'original')
  await chmod(root, 0o500)
  try {
    await assert.rejects(atomicWrite(file, 'replacement'), error => error.code === 'EACCES' || error.code === 'EPERM')
    assert.equal(await readFile(file, 'utf8'), 'original')
    assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.tmp')), [])
  } finally {
    await chmod(root, 0o700)
  }
})

test('CT-11: pre-rename failure retains the original and cleans the temporary file', async (t) => {
  const root = await fixture(t)
  const file = join(root, 'project.md')
  await writeFile(file, 'original')
  await assert.rejects(atomicWrite(file, 'replacement', async () => {
    const error = new Error('simulated read-only rename')
    error.code = 'EACCES'
    throw error
  }), error => error.code === 'EACCES')
  assert.equal(await readFile(file, 'utf8'), 'original')
  assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.tmp')), [])
})

test('workspace reader round-trips a nested UTF-8 file', async (t) => {
  const root = await fixture(t)
  await atomicWrite(join(root, '.project', 'project.md'), 'name: "项目"\n')
  const result = await readWorkspaceFile(root, '.project/project.md')
  assert.equal(result.content, 'name: "项目"\n')
  assert.equal(result.path, '.project/project.md')
})

test('workspace reader rejects traversal and escaping symlinks', async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, 'outside.md'), 'secret')
  const workspace = join(root, 'workspace')
  await atomicWrite(join(workspace, 'inside.md'), 'visible')
  await symlink(join(root, 'outside.md'), join(workspace, 'escape.md'))
  await assert.rejects(readWorkspaceFile(workspace, '../outside.md'), error => error.code === 'PATH_ESCAPE')
  await assert.rejects(readWorkspaceFile(workspace, 'escape.md'), error => error.code === 'PATH_ESCAPE')
  assert.equal((await readWorkspaceFile(workspace, 'inside.md')).content, 'visible')
})
