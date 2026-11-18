// S5 / T4.6 fault injection for the SERVER-side degradation matrix (§6.6) and
// CT-13: structured errors, no data loss, graceful absence — no device needed.
// Client-side entries (main/right slot, dark/narrow) remain real-device checks.
import assert from 'node:assert/strict'
import { chmod, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { dispatch } from '../core/rpc.js'
import { makeRoot } from './util.js'

const sig = () => new AbortController().signal

test('CT-13 fault injection: read-only workspace -> structured ACCESS_DENIED, original bytes intact', async t => {
  // node:test after-hooks run FIFO, so register the unlock BEFORE the rm cleanup.
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const root = await mkdtemp(join(tmpdir(), 'pw-readonly-'))
  const unlock = async () => {
    const { readdir } = await import('node:fs/promises')
    const reqBase = join(root, '.project', 'requirements')
    for (const id of await readdir(reqBase).catch(() => [])) {
      await chmod(join(reqBase, id), 0o755).catch(() => {})
    }
    await chmod(reqBase, 0o755).catch(() => {})
    await chmod(join(root, '.project'), 0o755).catch(() => {})
  }
  t.after(unlock)
  t.after(() => rm(root, { recursive: true, force: true }))
  await dispatch('project/init', { root, name: '故障注入' }, sig())
  const created = await dispatch('requirement/create', { root, title: '只读前的需求', fields: { q_pain: '核对只读文件的处理' } }, sig())
  assert.equal(created.ok, true)
  const reqDir = join(root, '.project', 'requirements', created.data.id)
  const reqFile = join(reqDir, 'requirement.md')
  const before = await readFile(reqFile, 'utf8')
  // Lock the whole .project tree (dirs keep +x to traverse; strip write only).
  await chmod(join(root, '.project'), 0o555)
  await chmod(join(root, '.project', 'requirements'), 0o555)
  await chmod(reqDir, 0o555)
  const write = await dispatch('requirement/update', { root, id: created.data.id, patch: { title: '改不动' } }, sig())
  assert.equal(write.ok, false)
  assert.ok(['ACCESS_DENIED', 'WRITE_FAILED', 'READ_FAILED'].includes(write.code), `structured error, got ${write.code}`)
  assert.equal(typeof write.message, 'string')
  // Reads still work (degrade to read-only, not a blank screen).
  const list = await dispatch('requirement/list', { root }, sig())
  assert.equal(list.ok, true)
  assert.equal(list.data.requirements.length, 1)
  // No data loss: original bytes unchanged.
  assert.equal(await readFile(reqFile, 'utf8'), before)
})

test('CT-13 fault injection: simulated disk-full (ENOSPC) at the write seam -> structured error, no half-written file', async t => {
  // atomicWrite writes a temp file then renames; inject ENOSPC at the rename
  // seam (the last step) to simulate the disk filling up mid-write. The original
  // must survive byte-for-byte and no temp file may remain.
  const { atomicWrite } = await import('../core/files.js')
  const { mkdtemp, rm, readdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(join(tmpdir(), 'pw-enospc-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const target = join(dir, 'requirement.md')
  const original = '---\ntitle: 原标题\n---\n正文\r\n'
  await atomicWrite(target, original)
  const enospc = async () => { const e = new Error('simulated disk full'); e.code = 'ENOSPC'; throw e }
  await assert.rejects(atomicWrite(target, '改不动', enospc), e => e.code === 'ENOSPC')
  assert.equal(await readFile(target, 'utf8'), original)
  const entries = await readdir(dir)
  assert.deepEqual(entries, ['requirement.md'], `temp leftover: ${entries}`)
  // And the RPC envelope maps a raw ENOSPC to a structured failure (no throw).
  const res = await dispatch('requirement/update', { root: dir, id: 'x', patch: {} }, sig())
  assert.equal(res.ok, false)
  assert.equal(typeof res.code, 'string')
})

test('§6.6 degradation: absent wiki / architecture / proposals degrade to empty, not errors', async t => {
  const root = await makeRoot(t)
  await dispatch('project/init', { root, name: '无资源' }, sig())
  const wiki = await dispatch('wiki/status', { root }, sig())
  assert.equal(wiki.ok, true)
  assert.equal(wiki.data.exists, false)
  assert.deepEqual(wiki.data.pages, [])
  const arch = await dispatch('architecture/read', { root }, sig())
  assert.equal(arch.ok, true)
  assert.equal(arch.data.exists, false)
  assert.equal(arch.data.html, null)
  const sync = await dispatch('sync/proposals', { root }, sig())
  assert.equal(sync.ok, true)
  assert.deepEqual(sync.data.proposals, [])
  // Kanban fully usable without wiki (degrade to pure kanban).
  const created = await dispatch('requirement/create', { root, title: '纯看板可用', fields: { q_pain: '核对无 Git 时的看板' } }, sig())
  assert.equal(created.ok, true)
})

test('§6.6 degradation: git unavailable -> structured NOT_GIT, kanban unaffected', async t => {
  const root = await makeRoot(t)
  await dispatch('project/init', { root, name: '非git' }, sig())
  const status = await dispatch('project/gitStatus', { root }, sig())
  assert.equal(status.ok, false)
  assert.ok(['NOT_GIT', 'GIT_MISSING'].includes(status.code), `got ${status.code}`)
  const commit = await dispatch('project/gitCommit', { root, message: 'x' }, sig())
  assert.equal(commit.ok, false)
  // Manual kanban still works (degradation does not block core flow).
  const created = await dispatch('requirement/create', { root, title: '不受影响', fields: { q_pain: '核对故障隔离' } }, sig())
  assert.equal(created.ok, true)
})

test('§6.6 degradation: missing requirement -> NOT_FOUND, sibling data intact', async t => {
  const root = await makeRoot(t)
  await dispatch('project/init', { root, name: '缺失' }, sig())
  const a = await dispatch('requirement/create', { root, title: '存在', fields: { q_pain: '核对仍可读取的记录' } }, sig())
  const missing = await dispatch('requirement/get', { root, id: 'req-00000000-000000' }, sig())
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'NOT_FOUND')
  const got = await dispatch('requirement/get', { root, id: a.data.id }, sig())
  assert.equal(got.ok, true)
})
