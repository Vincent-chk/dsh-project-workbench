import { randomUUID } from 'node:crypto'
import { open, mkdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export const MAX_READ_BYTES = 1024 * 1024

export class WorkbenchError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WorkbenchError'
    this.code = code
  }
}

function inside(root, target) {
  const path = relative(root, target)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

export async function resolveWorkspaceFile(root, relativePath) {
  if (typeof root !== 'string' || !isAbsolute(root) || root.includes('\0') || root.length > 4096) {
    throw new WorkbenchError('INVALID_ROOT', 'root must be an absolute directory path')
  }
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.length > 1024
    || relativePath.includes('\0') || isAbsolute(relativePath)) {
    throw new WorkbenchError('INVALID_PATH', 'path must be a non-empty relative file path')
  }
  const realRoot = await realpath(root)
  if (!(await stat(realRoot)).isDirectory()) {
    throw new WorkbenchError('INVALID_ROOT', 'root must be a directory')
  }
  const candidate = resolve(realRoot, relativePath)
  if (!inside(realRoot, candidate)) throw new WorkbenchError('PATH_ESCAPE', 'path leaves the workspace')
  const file = await realpath(candidate)
  if (!inside(realRoot, file)) throw new WorkbenchError('PATH_ESCAPE', 'symbolic link leaves the workspace')
  if (!(await stat(file)).isFile()) throw new WorkbenchError('NOT_A_FILE', 'path is not a regular file')
  return { root: realRoot, file, path: relative(realRoot, file).split(sep).join('/') }
}

export async function readWorkspaceFile(root, relativePath) {
  const resolved = await resolveWorkspaceFile(root, relativePath)
  const info = await stat(resolved.file)
  if (info.size > MAX_READ_BYTES) throw new WorkbenchError('FILE_TOO_LARGE', 'file exceeds the 1 MiB read limit')
  const content = await readFile(resolved.file, 'utf8')
  return { ...resolved, content, bytes: info.size, modified: info.mtime.toISOString() }
}

// The rename seam makes pre-rename failures deterministic in tests.
export async function atomicWrite(file, content, renameOperation = rename) {
  const directory = dirname(file)
  await mkdir(directory, { recursive: true })
  const temporary = resolve(directory, `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await renameOperation(temporary, file)
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}
