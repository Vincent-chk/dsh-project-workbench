import { createHash } from 'node:crypto'
import { link, lstat, mkdir, readdir, realpath, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite, readWorkspaceFile, WorkbenchError } from './files.js'
import { parseFrontmatter } from './frontmatter.js'

const prdId = /^prd-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/u
const requirementId = /^req-\d{8}-[\da-f]{6}$/u
const pathOf = id => `.project/prds/${id}.md`
const versionOf = text => createHash('sha256').update(text).digest('hex')
const saves = new Map()

async function prdDirectory(root, create = false) {
  const project = join(root, '.project')
  const directory = join(project, 'prds')
  if (!(await lstat(project)).isDirectory()) throw new WorkbenchError('INVALID_PATH', '项目数据目录不可用。')
  if (create) await mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error })
  if (!(await lstat(directory)).isDirectory()) throw new WorkbenchError('INVALID_PATH', 'PRD 目录不可用。')
  return directory
}

export async function readPrd(root, id) {
  if (typeof id !== 'string' || !prdId.test(id)) throw new WorkbenchError('INVALID_ID', 'PRD 编号无效。')
  await prdDirectory(root)
  if (!(await lstat(join(root, pathOf(id)))).isFile()) throw new WorkbenchError('INVALID_PATH', 'PRD 路径不是普通文件。')
  const { content } = await readWorkspaceFile(root, pathOf(id))
  const doc = parseFrontmatter(content)
  const reqIds = doc.get('requirements')
  if (!doc.hasFm || doc.get('id') !== id || !Array.isArray(reqIds) || !reqIds.length || reqIds.some(req => !requirementId.test(req))) {
    throw new WorkbenchError('INVALID_PRD', 'PRD 的关联信息无法读取。')
  }
  const markdown = doc.body.trim()
  const title = /^#[ \t]+(.+)$/m.exec(markdown)?.[1] || id
  return { id, title, reqIds, markdown, version: versionOf(content) }
}

export async function listPrds(root, reqId) {
  let files
  try { files = await readdir(await prdDirectory(root), { withFileTypes: true }) } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const docs = []
  for (const file of files) {
    const id = file.name.slice(0, -3)
    if (!file.isFile() || !file.name.endsWith('.md') || !prdId.test(id)) continue
    let doc
    try { doc = await readPrd(root, id) } catch (error) {
      if (['ENOENT', 'INVALID_PRD'].includes(error.code)) continue
      throw error
    }
    if (!reqId || doc.reqIds.includes(reqId)) docs.push({ id, title: doc.title, reqIds: doc.reqIds })
  }
  return docs.sort((a, b) => a.title.localeCompare(b.title))
}

export function validatePrdDraft(reqIds, markdown) {
  if (!Array.isArray(reqIds) || !reqIds.length || reqIds.some(id => !requirementId.test(id))) {
    throw new WorkbenchError('REQ_REQUIRED', '请选择至少一条当前项目的需求。')
  }
  if (typeof markdown !== 'string' || markdown.length > 60000 || !/^#[ \t]+\S/.test(markdown.trim())) {
    throw new WorkbenchError('INVALID_PRD', '请输入包含一级标题的 Markdown，最多 60,000 字符。')
  }
}

export async function savePrd(root, draft) {
  const { id } = draft
  if (typeof id !== 'string' || !prdId.test(id)) throw new WorkbenchError('INVALID_ID', 'PRD 编号无效。')
  const directory = await realpath(root)
  const key = join(directory, pathOf(id))
  const previous = saves.get(key) ?? Promise.resolve()
  const save = () => commitPrd(directory, draft)
  const next = previous.then(save, save)
  saves.set(key, next)
  try { return await next } finally { if (saves.get(key) === next) saves.delete(key) }
}

async function commitPrd(root, { id, reqIds, markdown, version }) {
  validatePrdDraft(reqIds, markdown)
  for (const reqId of reqIds) await readWorkspaceFile(root, `.project/requirements/${reqId}/requirement.md`)
  await prdDirectory(root, true)
  const content = `---\nid: ${id}\nrequirements: ${JSON.stringify([...new Set(reqIds)])}\n---\n\n${markdown.trim()}\n`
  const file = join(root, pathOf(id))
  // Use the final atomic-write step for the compare. Creating via a hard link
  // makes an existing destination a conflict even across Host processes.
  await atomicWrite(file, content, async (temporary, destination) => {
    await prdDirectory(root)
    if (version == null) {
      try { await link(temporary, destination) } catch (error) {
        if (error.code === 'EEXIST') throw new WorkbenchError('PRD_CONFLICT', '这个 PRD 已保存，请重新核对。')
        throw error
      }
      await rm(temporary, { force: true })
    } else {
      const current = await readPrd(root, id)
      if (current.version !== version) throw new WorkbenchError('PRD_CONFLICT', 'PRD 已被修改。请核对现有版本后重试。')
      await rename(temporary, destination)
    }
  })
  return readPrd(root, id)
}
