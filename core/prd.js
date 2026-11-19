import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { atomicWrite, readWorkspaceFile, WorkbenchError } from './files.js'
import { parseFrontmatter } from './frontmatter.js'

const prdId = /^prd-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/u
const requirementId = /^req-\d{8}-[\da-f]{6}$/u
const imageName = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.(png|jpe?g|gif|webp)$/u
const pathOf = id => `.project/prds/${id}.md`
const imagePath = id => `.project/prds/${id}.assets`
const versionOf = text => createHash('sha256').update(text).digest('hex')
const writes = new Map()
const maxImageBytes = 2 * 1024 * 1024
const maxImageBytesPerSave = 4 * maxImageBytes
const imageMime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

function assertPrdId(id) {
  if (typeof id !== 'string' || !prdId.test(id)) throw new WorkbenchError('INVALID_ID', 'PRD 编号无效。')
}

async function directoryAt(directory, create, description) {
  if (create) await mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error })
  if (!(await lstat(directory)).isDirectory()) throw new WorkbenchError('INVALID_PATH', description + '不可用。')
  return directory
}

async function prdDirectory(root, create = false) {
  const project = await directoryAt(join(root, '.project'), false, '项目数据目录')
  return directoryAt(join(project, 'prds'), create, 'PRD 目录')
}

// Save, link, delete and submit-for-review share the workspace's write queue.
export async function withPrdLock(root, action) {
  const directory = await realpath(root)
  const previous = writes.get(directory) ?? Promise.resolve()
  const run = () => action(directory)
  const next = previous.then(run, run)
  writes.set(directory, next)
  try { return await next } finally { if (writes.get(directory) === next) writes.delete(directory) }
}

function viewOf(id, doc, content, modified) {
  const reqIds = doc.get('requirements')
  const revision = doc.get('revision') ?? 1
  const updated = doc.get('updated') || modified
  const deletedAt = doc.get('deletedAt') || null
  if (!doc.hasFm || doc.get('id') !== id || !Array.isArray(reqIds) || reqIds.some(id => typeof id !== 'string' || !requirementId.test(id))
      || !Number.isSafeInteger(revision) || revision < 1) {
    throw new WorkbenchError('INVALID_PRD', 'PRD 的文档信息无法读取。')
  }
  const markdown = doc.body.trim()
  validatePrdDraft(reqIds, markdown)
  const title = /^#[ \t]+(.+)$/m.exec(markdown)[1]
  return { id, title, reqIds, markdown, revision, updated, version: versionOf(content), deleted: !!deletedAt }
}

async function loadPrd(root, id) {
  assertPrdId(id)
  await prdDirectory(root)
  if (!(await lstat(join(root, pathOf(id)))).isFile()) throw new WorkbenchError('INVALID_PATH', 'PRD 路径不是普通文件。')
  const { content, modified } = await readWorkspaceFile(root, pathOf(id))
  const doc = parseFrontmatter(content)
  return { doc, view: viewOf(id, doc, content, modified) }
}

async function currentPrd(root, id) {
  try { return await loadPrd(root, id) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function readPrd(root, id) {
  const current = await currentPrd(root, id)
  if (!current || current.view.deleted) throw new WorkbenchError('PRD_NOT_FOUND', '找不到这份 PRD，可能已删除。')
  return current.view
}

export async function listPrds(root, reqId, { deleted = false } = {}) {
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
    try { ({ view: doc } = await loadPrd(root, id)) } catch (error) {
      if (['ENOENT', 'INVALID_PATH', 'INVALID_PRD', 'FILE_TOO_LARGE', 'EACCES', 'EPERM'].includes(error.code)) continue
      throw error
    }
    if (doc.deleted !== deleted || (reqId && !doc.reqIds.includes(reqId))) continue
    const { markdown, ...summary } = doc
    docs.push(summary)
  }
  return docs.sort((a, b) => String(b.updated).localeCompare(String(a.updated)) || a.title.localeCompare(b.title))
}

export function validatePrdDraft(reqIds, markdown) {
  if (!Array.isArray(reqIds) || reqIds.some(id => typeof id !== 'string' || !requirementId.test(id))) {
    throw new WorkbenchError('REQ_REQUIRED', '请选择当前项目中的需求。')
  }
  if (typeof markdown !== 'string' || markdown.length > 60000 || !/^#[ \t]+[^\s\r\n]/.test(markdown.trim())) {
    throw new WorkbenchError('INVALID_PRD', '请输入包含一级标题的 Markdown，最多 60,000 字符。')
  }
}

async function checkRequirement(root, id) {
  if (typeof id !== 'string' || !requirementId.test(id)) throw new WorkbenchError('REQ_REQUIRED', '请选择当前项目中的需求。')
  const relative = `.project/requirements/${id}/requirement.md`
  try {
    await directoryAt(join(root, '.project', 'requirements'), false, '项目需求目录')
    await directoryAt(join(root, '.project', 'requirements', id), false, '需求目录')
    if ((await lstat(join(root, relative))).isFile()) {
      const { content } = await readWorkspaceFile(root, relative)
      if (parseFrontmatter(content).get('id') === id) return
    }
  } catch (error) {
    if (!['ENOENT', 'INVALID_PATH', 'PATH_ESCAPE'].includes(error.code)) throw error
  }
  throw new WorkbenchError('REQ_REQUIRED', '请选择当前项目中的需求。')
}

function assertBase(current, version) {
  if ((current?.view.version ?? null) !== (version ?? null)) {
    throw new WorkbenchError('PRD_CONFLICT', 'PRD 已被修改。请读取最新版后重试。')
  }
}

async function writePrd(root, id, current, { reqIds, markdown, revision, deletedAt }) {
  const doc = current?.doc ?? parseFrontmatter(`---\nid: ${id}\n---\n`)
  doc.setPlain('requirements', JSON.stringify(reqIds))
  doc.setPlain('revision', revision)
  const updated = new Date().toISOString()
  doc.setString('updated', updated)
  doc.setString('deletedAt', deletedAt ?? '')
  if (!current || current.view.markdown !== markdown) doc.setBody(`${doc.eol}${markdown}${doc.eol}`)
  const content = doc.toString()
  const view = viewOf(id, doc, content, updated)
  await atomicWrite(join(root, pathOf(id)), content, async (temporary, destination) => {
    await prdDirectory(root)
    assertBase(await currentPrd(root, id), current?.view.version)
    await rename(temporary, destination)
  })
  return view
}

function referencedImages(markdown) {
  const images = new Set()
  for (const match of markdown.matchAll(/!\[[^\]\r\n]*\]\(assets\/([^\s)]+)\)/gu)) {
    if (imageName.test(match[1])) images.add(match[1])
  }
  return images
}

function validImage(name, bytes) {
  if (!imageName.test(name) || !bytes.length || bytes.length > maxImageBytes) return false
  const ext = extname(name).slice(1)
  if (ext === 'png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  if (ext === 'jpg' || ext === 'jpeg') return bytes.length >= 4 && bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
  if (ext === 'gif') return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
  return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
}

function parseImages(images, references) {
  if (!Array.isArray(images)) throw new WorkbenchError('PRD_IMAGE_INVALID', 'PRD 图片格式无效。')
  const files = new Map()
  let total = 0
  for (const image of images) {
    const { name, base64 } = image ?? {}
    if (typeof name !== 'string' || !imageName.test(name) || files.has(name) ||
        typeof base64 !== 'string' || base64.length > 4 * Math.ceil(maxImageBytes / 3) || !references.has(name)) {
      throw new WorkbenchError('PRD_IMAGE_INVALID', '请选择正文引用的有效本地图片，每张不超过 2 MiB。')
    }
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.toString('base64') !== base64 || !validImage(name, bytes)) {
      throw new WorkbenchError('PRD_IMAGE_INVALID', '图片格式无效，或大小超过 2 MiB。')
    }
    total += bytes.length
    if (total > maxImageBytesPerSave) throw new WorkbenchError('PRD_IMAGE_INVALID', '一次保存的新增图片总大小不能超过 8 MiB。')
    files.set(name, bytes)
  }
  return files
}

async function readImageBytes(file) {
  const info = await lstat(file)
  if (!info.isFile() || info.size > maxImageBytes) throw new WorkbenchError('PRD_IMAGE_INVALID', '无法读取这张 PRD 图片。')
  return readFile(file)
}

async function attachImages(root, id, images, inserted) {
  if (!images.size) return
  const directory = await directoryAt(join(root, imagePath(id)), true, 'PRD 图片目录')
  for (const [name, bytes] of images) {
    const file = join(directory, name)
    await atomicWrite(file, bytes, async (temporary, destination) => {
      await prdDirectory(root)
      await directoryAt(directory, false, 'PRD 图片目录')
      try {
        const existing = await readImageBytes(destination)
        if (!existing.equals(bytes)) throw new WorkbenchError('PRD_IMAGE_INVALID', '图片已存在，请重新选取。')
        await rm(temporary)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        await rename(temporary, destination)
        inserted.push(name)
      }
    })
  }
}

async function removeImages(root, id, names) {
  if (!names.length) return
  await prdDirectory(root)
  const directory = await directoryAt(join(root, imagePath(id)), false, 'PRD 图片目录')
  for (const name of names) await rm(join(directory, name), { force: true })
}

export async function readPrdImage(root, id, name) {
  const { markdown } = await readPrd(root, id)
  if (typeof name !== 'string' || !imageName.test(name) || !referencedImages(markdown).has(name)) {
    throw new WorkbenchError('PRD_IMAGE_INVALID', '找不到这张 PRD 图片。')
  }
  const directory = await directoryAt(join(root, imagePath(id)), false, 'PRD 图片目录')
  const bytes = await readImageBytes(join(directory, name))
  if (!validImage(name, bytes)) throw new WorkbenchError('PRD_IMAGE_INVALID', '无法读取这张 PRD 图片。')
  return { mime: imageMime[extname(name).slice(1)], base64: bytes.toString('base64') }
}

export async function savePrd(root, { id = 'prd-' + randomUUID(), reqIds, markdown, version, images = [] }) {
  assertPrdId(id)
  return withPrdLock(root, async root => {
    await prdDirectory(root, true)
    const current = await currentPrd(root, id)
    assertBase(current, version)
    const previous = current?.view
    if (previous?.deleted) throw new WorkbenchError('PRD_NOT_FOUND', '请先恢复已删除的 PRD。')
    const links = reqIds === undefined ? previous?.reqIds ?? [] : reqIds
    validatePrdDraft(links, markdown)
    const uniqueLinks = [...new Set(links)]
    for (const reqId of uniqueLinks) if (!previous?.reqIds.includes(reqId)) await checkRequirement(root, reqId)
    const cleanMarkdown = markdown.trim()
    const references = referencedImages(cleanMarkdown)
    const files = parseImages(images, references)
    const textChanged = cleanMarkdown !== previous?.markdown
    const linksChanged = uniqueLinks.length !== previous?.reqIds.length || uniqueLinks.some(reqId => !previous.reqIds.includes(reqId))
    const inserted = []
    let view
    try {
      await attachImages(root, id, files, inserted)
      if (previous && !textChanged && !linksChanged) return previous
      const revision = previous ? previous.revision + Number(textChanged) : 1
      view = await writePrd(root, id, current, { reqIds: uniqueLinks, markdown: cleanMarkdown, revision })
    } catch (error) {
      await removeImages(root, id, inserted).catch(() => {})
      throw error
    }
    if (textChanged && previous) {
      const unused = [...referencedImages(previous.markdown)].filter(name => !references.has(name))
      await removeImages(root, id, unused).catch(() => {})
    }
    return view
  })
}

export async function setPrdLink(root, { id, reqId, linked, version }) {
  if (typeof reqId !== 'string' || !requirementId.test(reqId) || typeof linked !== 'boolean') {
    throw new WorkbenchError('REQ_REQUIRED', '请选择当前项目中的需求。')
  }
  return withPrdLock(root, async root => {
    const current = await currentPrd(root, id)
    if (!current || current.view.deleted) throw new WorkbenchError('PRD_NOT_FOUND', '找不到这份 PRD，可能已删除。')
    assertBase(current, version)
    const { reqIds, markdown, revision } = current.view
    if (reqIds.includes(reqId) === linked) return current.view
    if (linked) await checkRequirement(root, reqId)
    const links = linked ? [...reqIds, reqId] : reqIds.filter(req => req !== reqId)
    return writePrd(root, id, current, { reqIds: links, markdown, revision })
  })
}

export async function setPrdDeleted(root, { id, version, deleted }) {
  return withPrdLock(root, async root => {
    const current = await currentPrd(root, id)
    if (!current) throw new WorkbenchError('PRD_NOT_FOUND', '找不到这份 PRD。')
    assertBase(current, version)
    if (current.view.deleted === deleted) return current.view
    const { reqIds, markdown, revision } = current.view
    return writePrd(root, id, current, { reqIds, markdown, revision, deletedAt: deleted ? new Date().toISOString() : null })
  })
}
