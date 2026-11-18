import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { atomicWrite } from '../core/files.js'
import { dispatch, handleRequest } from '../core/rpc.js'

async function fixture(t) {
  const root = await mkdtemp(join(process.cwd(), '.tmp-project-workbench-rpc-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('probe/read returns the specified data envelope', async (t) => {
  const root = await fixture(t)
  await atomicWrite(join(root, 'note.md'), '你好\r\n')
  const result = await dispatch('probe/read', { root, path: 'note.md' }, new AbortController().signal)
  assert.equal(result.ok, true)
  assert.equal(result.data.content, '你好\r\n')
})

test('RPC rejects invalid input, traversal, and unknown methods without throwing', async (t) => {
  const root = await fixture(t)
  const signal = new AbortController().signal
  assert.equal((await dispatch('probe/read', { root }, signal)).code, 'INVALID_PATH')
  assert.equal((await dispatch('probe/read', { root, path: '../secret' }, signal)).code, 'PATH_ESCAPE')
  assert.equal((await dispatch('unknown', {}, signal)).code, 'NOT_FOUND')
})

test('shared Fetch route handles JSON and rejects malformed bodies', async (t) => {
  const root = await fixture(t)
  await atomicWrite(join(root, 'note.md'), 'HTTP 读取\n')
  const response = await handleRequest(new Request('http://localhost/api/project-workbench', {
    method: 'POST', body: JSON.stringify({ method: 'probe/read', input: { root, path: 'note.md' } }),
  }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.content, 'HTTP 读取\n')
  const malformed = await handleRequest(new Request('http://localhost/api/project-workbench', { method: 'POST', body: '{' }))
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).code, 'INVALID_JSON')
})

test('RPC returns a structured cancellation', async () => {
  const controller = new AbortController()
  controller.abort()
  assert.deepEqual(await dispatch('probe/read', {}, controller.signal), {
    ok: false, code: 'CANCELLED', message: 'request was cancelled',
  })
})
