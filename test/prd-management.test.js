import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { dispatch } from '../core/rpc.js'
import { createRequirement, initProject } from '../core/store.js'

async function project(t) {
  const root = await mkdtemp(join(tmpdir(), 'workbench-prds-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await initProject(root)
  const first = (await createRequirement(root, '聊天', { q_pain: '本地切换风格' })).data.id
  const second = (await createRequirement(root, '设置', { q_pain: '记住偏好' })).data.id
  const call = (method, input) => dispatch(method, { root, ...input }, new AbortController().signal)
  const success = async (method, input) => {
    const result = await call(method, input)
    assert.equal(result.ok, true, JSON.stringify(result))
    return result.data
  }
  return { root, first, second, call, success }
}

test('PRD CRUD preserves only latest Markdown and allows independent requirement links', async t => {
  const { root, first, second, call, success } = await project(t)
  const doc = await success('prd/save', { markdown: '# 本地聊天\n\n原文' })
  assert.equal(doc.revision, 1)
  assert.deepEqual(doc.reqIds, [])
  const id = doc.id
  const linked = await success('prd/link', { id, reqId: first, linked: true, version: doc.version })
  const shared = await success('prd/link', { id, reqId: second, linked: true, version: linked.version })
  assert.equal(shared.revision, 1)
  assert.deepEqual((await success('prd/list')).map(item => item.id), [id])
  assert.deepEqual((await success('prd/list', { reqId: second })).map(item => item.id), [id])
  assert.equal((await success('prd/list'))[0].markdown, undefined)

  const updated = await success('prd/save', { id, version: shared.version, markdown: '# 新名称\n\n新版正文' })
  assert.equal(updated.revision, 2)
  assert.deepEqual(updated.reqIds, [first, second])
  const directory = join(root, '.project', 'prds')
  assert.deepEqual(await readdir(directory), [id + '.md'])
  assert.doesNotMatch(await readFile(join(directory, id + '.md'), 'utf8'), /原文/)
  const unchanged = await success('prd/save', { id, version: updated.version, markdown: updated.markdown })
  assert.equal(unchanged.version, updated.version)
  const remove = await success('prd/link', { id, reqId: first, linked: false, version: unchanged.version })
  assert.equal(remove.revision, 2)
  assert.deepEqual(await success('prd/list', { reqId: first }), [])
  assert.deepEqual(remove.reqIds, [second])
  const deleted = await success('prd/delete', { id, version: remove.version })
  assert.equal(deleted.deleted, true)
  assert.deepEqual(await success('prd/list'), [])
  assert.equal((await call('prd/read', { id })).code, 'PRD_NOT_FOUND')
  assert.equal((await success('prd/list', { deleted: true }))[0].revision, 2)
  const restored = await success('prd/restore', { id, version: deleted.version })
  assert.deepEqual(restored.reqIds, [second])
  assert.equal((await success('prd/read', { id })).markdown, '# 新名称\n\n新版正文')
  assert.deepEqual(await success('prd/list', { deleted: true }), [])
})

test('legacy PRDs open as v1 and simultaneous saves preserve the winner', async t => {
  const { root, first, call, success } = await project(t)
  const id = 'prd-' + randomUUID()
  const directory = join(root, '.project', 'prds')
  const original = `---\nid: ${id}\nrequirements: ["${first}"]\n---\n\n# 老文档\n\n原有内容\n`
  await mkdir(directory)
  const file = join(directory, id + '.md')
  await writeFile(file, original)
  const legacy = await success('prd/read', { id })
  assert.equal(legacy.revision, 1)
  assert.equal(await readFile(file, 'utf8'), original)
  const concurrent = await Promise.all(['# 方案一', '# 方案二'].map(markdown => call('prd/save', { id, version: legacy.version, markdown })))
  assert.equal(concurrent.filter(result => result.ok).length, 1)
  assert.equal(concurrent.find(result => !result.ok).code, 'PRD_CONFLICT')
  assert.equal((await success('prd/read', { id })).revision, 2)
})

test('PRD attachments are stored locally and checked against the current Markdown', async t => {
  const { root, call, success } = await project(t)
  const name = randomUUID() + '.png'
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA3sAAAAASUVORK5CYII='
  const markdown = `# 图例\n\n![流程](assets/${name})`
  assert.equal((await call('prd/save', { markdown: '# 另一个稿件', images: [{ name, base64 }] })).code, 'PRD_IMAGE_INVALID')
  assert.equal((await call('prd/save', { markdown, images: [{ name, base64: 'PGh0bWw+' }] })).code, 'PRD_IMAGE_INVALID')
  const doc = await success('prd/save', { markdown, images: [{ name, base64 }] })
  assert.deepEqual(await success('prd/image', { id: doc.id, name }), { mime: 'image/png', base64 })
  const other = await success('prd/save', { markdown: '# 不相关' })
  assert.equal((await call('prd/image', { id: other.id, name })).code, 'PRD_IMAGE_INVALID')
  const file = join(root, '.project', 'prds', doc.id + '.assets', name)
  const linkedTarget = join(root, name)
  await writeFile(linkedTarget, Buffer.from(base64, 'base64'))
  await rm(file)
  await symlink(linkedTarget, file)
  assert.equal((await call('prd/image', { id: doc.id, name })).code, 'PRD_IMAGE_INVALID')
  await success('prd/save', { id: doc.id, version: doc.version, markdown: '# 移除插图' })
  assert.equal((await call('prd/image', { id: doc.id, name })).code, 'PRD_IMAGE_INVALID')
  assert.deepEqual(await readFile(linkedTarget), Buffer.from(base64, 'base64'))
})

test('review rejects absent, unrelated, deleted and unreadable PRDs across entry points', async t => {
  const { first, second, root, call, success } = await project(t)
  const id = first
  assert.equal((await call('requirement/review', { id, action: 'submit' })).code, 'REVIEW_PRD_REQUIRED')
  const other = await success('prd/save', { reqIds: [second], markdown: '# 其他需求' })
  assert.equal((await call('requirement/move', { id, to: 'reviewing' })).code, 'REVIEW_PRD_REQUIRED')
  const doc = await success('prd/save', { reqIds: [id], markdown: '# 评审资料' })
  const deleted = await success('prd/delete', { id: doc.id, version: doc.version })
  assert.equal((await call('requirement/review', { id, action: 'submit' })).code, 'REVIEW_PRD_REQUIRED')
  await success('prd/restore', { id: doc.id, version: deleted.version })
  await writeFile(join(root, '.project', 'prds', doc.id + '.md'), 'unreadable')
  assert.equal((await call('requirement/review', { id, action: 'submit' })).code, 'REVIEW_PRD_REQUIRED')
  assert.equal((await success('requirement/get', { id })).status, 'backlog')
  await success('prd/link', { id: other.id, reqId: id, linked: true, version: other.version })
  assert.equal((await success('requirement/move', { id, to: 'reviewing' })).to, 'reviewing')
})
