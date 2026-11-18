// Architecture diagrams via vendored Archify (MIT, vendor/archify/ARCHIFY-LICENSE).
// Flow: a read-only child reads SOURCE CODE and authors an archify candidate.json;
// the Host renders it with the archify CLI and serves the self-contained HTML
// as-is (iframe srcdoc in the panel), preserving Archify's styling + interactivity.
// Degradation approved by the user: do NOT extract/re-theme the SVG (that dropped
// Archify's stylesheet and made labels invisible).
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile, mkdtemp, rm, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { atomicWrite, readWorkspaceFile, WorkbenchError } from './files.js'

const exec = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const ARCHIFY_CLI = join(here, '..', 'vendor', 'archify', 'archify', 'bin', 'archify.mjs')

const archDir = root => join(root, '.project', '.local', 'archify')

// Render a candidate with the vendored archify CLI and persist the full
// self-contained HTML. Returns { html, title }.
export async function renderArchitecture(root, candidatePath, signal) {
  // Render into an isolated temp dir: archify's target-integrity gate rejects
  // output paths inside a repo whose files change during rendering.
  const tmp = await mkdtemp(join(tmpdir(), 'pw-archify-'))
  const outHtml = join(tmp, 'architecture.html')
  let html
  try {
    const candidate = JSON.parse(await readFile(candidatePath, 'utf8'))
    const sources = []
    // Archify's native citations require a pinned Git origin, which is not
    // available in many DSH workspaces. Validate local citations with the same
    // workspace boundary as the source viewer, then render the diagram without
    // claiming the renderer's Git-based verification.
    for (const component of candidate.components ?? []) {
      for (const ref of Array.isArray(component.sources) ? component.sources : []) {
        if (!ref || typeof ref.path !== 'string') throw new WorkbenchError('ARCH_SOURCE_INVALID', 'architecture source must name a workspace-relative file')
        const source = await readWorkspaceFile(root, ref.path).catch(() => { throw new WorkbenchError('ARCH_SOURCE_INVALID', `cannot read architecture source: ${ref.path}`) })
        if (source.path === '.project' || source.path.startsWith('.project/')) {
          throw new WorkbenchError('ARCH_SOURCE_INVALID', 'workbench .project/ records are not program source; cite the implementation files instead')
        }
        const start = ref.line == null ? 0 : ref.line
        const end = ref.end_line == null ? start : ref.end_line
        const lineCount = source.content ? source.content.split(/\r\n|\r|\n/).length - (/(?:\r\n|\r|\n)$/.test(source.content) ? 1 : 0) : 0
        if (!Number.isInteger(start) || !Number.isInteger(end) || (ref.line != null && start < 1) || end < start || end > lineCount || (!start && end)) {
          throw new WorkbenchError('ARCH_SOURCE_INVALID', `invalid architecture source range: ${ref.path}`)
        }
        sources.push({ label: String(component.label ?? ''), path: source.path, from: start, to: end })
      }
      delete component.sources
    }
    if (!sources.length) throw new WorkbenchError('ARCH_SOURCE_REQUIRED', 'add at least one source file actually read from this workspace')
    if (candidate.meta) delete candidate.meta.repository
    const renderInput = join(tmp, 'candidate.json')
    await writeFile(renderInput, JSON.stringify(candidate), 'utf8')
    try {
      await exec(process.execPath, [ARCHIFY_CLI, 'render', 'architecture', renderInput, outHtml, '--quality', 'standard', '--repo-root', root], { cwd: tmp, timeout: 180000, maxBuffer: 64 * 1024 * 1024, signal })
    } catch (e) {
      const detail = (e.stderr || e.stdout || e.message || '').toString()
      throw new WorkbenchError('ARCHIFY_RENDER_FAILED', detail.slice(-6000))
    }
    html = await readFile(outHtml, 'utf8')
    const metadata = JSON.stringify(sources).replace(/[<>&]/g, c => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[c])
    html = html.replace('</body>', `<script id="pw-architecture-sources" type="application/json">${metadata}</script></body>`)
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
  if (!/<svg[\s\S]*<\/svg>/.test(html)) throw new WorkbenchError('ARCHIFY_NO_SVG', 'archify output contained no diagram')
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || 'Architecture'
  const outDir = archDir(root)
  await mkdir(outDir, { recursive: true })
  signal?.throwIfAborted()
  await atomicWrite(join(outDir, 'architecture.html'), html, async (from, to) => { signal?.throwIfAborted(); await rename(from, to) })
  return { html, title }
}

// Read the last rendered architecture HTML (if any) for display.
export async function readArchitecture(root) {
  try {
    const html = await readFile(join(archDir(root), 'architecture.html'), 'utf8')
    let sources = []
    const metadata = html.match(/<script id="pw-architecture-sources" type="application\/json">([\s\S]*?)<\/script>/)
    try { if (metadata) { const parsed = JSON.parse(metadata[1]); if (Array.isArray(parsed)) sources = parsed } } catch { /* retain the last diagram even if its source metadata is corrupt */ }
    return { exists: true, html, sources }
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, html: null, sources: [] }
    throw new WorkbenchError('READ_FAILED', 'could not read the saved architecture diagram')
  }
}
