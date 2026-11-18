// Pure wiki-source helpers (no React) so node --test can cover the evidence
// parsing rules used by the resources page.

// Generated wiki pages carry a frontmatter block; readers get the body only.
export const stripFrontmatter = content => String(content ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')

// Timestamps from OpenWiki are UTC; the date displayed to a reader must use
// the browser's local timezone. A date-only value has no timezone to convert.
export function wikiLocalDate(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const text = value.trim()
  const date = new Date(text)
  if (!Number.isFinite(date.getTime())) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return date.toISOString().slice(0, 10) === text ? text : ''
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// repo://path#L1-L20 → { kind:'file', path, from, to }; wiki:page.md or
// openwiki/dir/page.md → { kind:'wiki', path }; everything else stays text.
export function parseEvidenceRef(ref) {
  const text = String(ref ?? '').trim()
  const repo = text.match(/^repo:\/\/([^#]+)(?:#L(\d+)(?:-L(\d+))?)?$/)
  if (repo) {
    const parts = repo[1].split('/').map(part => {
      try { return decodeURIComponent(part) } catch { return part }
    })
    if (parts.some(part => !part || part === '.' || part === '..' || /[/\\\0]/.test(part))) return { kind: 'text', label: text }
    return { kind: 'file', path: parts.join('/'), from: Number(repo[2]) || 0, to: Number(repo[3]) || Number(repo[2]) || 0, label: text }
  }
  const wiki = text.match(/^(?:wiki:|openwiki\/)([^\s#]+\.md)/)
  if (wiki) return { kind: 'wiki', path: wiki[1], label: text }
  return { kind: 'text', label: text }
}

// Slice the referenced range; an unanchored ref previews the file head so a
// huge file still opens quickly (the 1 MiB read limit is enforced host-side).
export const evidenceLines = (content, from, to) => {
  const lines = String(content ?? '').split(/\r?\n/)
  if (!from) return lines.slice(0, 80).join('\n')
  return lines.slice(from - 1, Math.max(to, from)).join('\n')
}
