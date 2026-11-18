import { readWorkspaceFile } from './files.js'

const privatePath = path => path.split('/').some(part => ['.git', '.project'].includes(part) || part.startsWith('.env'))

// Model references are only evidence when the literal excerpt is still present in the selected workspace.
export async function readSplitEvidence(root, sources) {
  const checked = []
  for (const source of Array.isArray(sources) ? sources : []) {
    const { path, quote } = source ?? {}
    if (typeof path !== 'string' || privatePath(path) || typeof quote !== 'string' || !quote.trim() || quote.length > 600) continue
    try {
      const file = await readWorkspaceFile(root, path)
      if (!privatePath(file.path) && file.content.replace(/\r\n/g, '\n').includes(quote.trim().replace(/\r\n/g, '\n'))) {
        checked.push({ path: file.path, quote: quote.trim() })
      }
    } catch { /* An inaccessible source cannot support an assessment. */ }
  }
  return checked
}
