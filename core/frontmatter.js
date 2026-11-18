// Surgical YAML-frontmatter editing. Unknown fields, field order, comments, the
// body, and original line endings are preserved byte-for-byte; only the targeted
// scalar line is replaced (R-02 / CT-01 / CT-03). Arrays are read-only here.

const FIELD_RE = /^([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(.*)$/

export function detectEol(text) {
  const m = text.match(/\r?\n/)
  return m ? m[0] : '\n'
}

// Split into lines keeping each line's exact terminator.
function splitLines(text) {
  const lines = []
  const re = /([^\r\n]*)(\r\n|\n|$)/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (m[1] === '' && m[2] === '') break
    lines.push({ text: m[1], eol: m[2] })
    if (m[2] === '') break
  }
  return lines
}

function joinLines(lines) {
  return lines.map(l => l.text + l.eol).join('')
}

export function parseScalar(raw) {
  const s = raw.trim()
  if (s === '' || s === '~' || s === 'null') return ''
  if (s.startsWith('"')) {
    let out = '', i = 1
    while (i < s.length) {
      const c = s[i]
      if (c === '\\') {
        const n = s[i + 1]
        out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n
        i += 2
      } else if (c === '"') break
      else { out += c; i++ }
    }
    return out
  }
  if (s.startsWith("'")) {
    let out = '', i = 1
    while (i < s.length) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") { out += "'"; i += 2 } else break
      } else { out += s[i]; i++ }
    }
    return out
  }
  const noComment = s.split(/\s+#/)[0].trim()
  if (/^-?\d+$/.test(noComment)) return Number(noComment)
  if (noComment === 'true') return true
  if (noComment === 'false') return false
  return noComment
}

function encodeString(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"'
}

export class FrontmatterDoc {
  constructor(text) {
    this.original = text
    this.eol = detectEol(text)
    const lines = splitLines(text)
    this.hasFm = lines.length > 0 && lines[0].text.trim() === '---'
    if (!this.hasFm) {
      this.head = null; this.fm = []; this.close = null; this.body = text
      return
    }
    let closeIdx = -1
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].text.trim() === '---') { closeIdx = i; break }
    }
    if (closeIdx === -1) {
      // Unterminated frontmatter: treat whole remainder as body, flag via hasFm.
      this.hasFm = false
      this.head = null; this.fm = []; this.close = null; this.body = text
      return
    }
    this.head = lines[0]
    this.fm = lines.slice(1, closeIdx)
    this.close = lines[closeIdx]
    this.body = joinLines(lines.slice(closeIdx + 1))
  }

  _findIndex(key) {
    return this.fm.findIndex(l => {
      const m = l.text.match(FIELD_RE)
      return m && m[1] === key
    })
  }

  // Read a scalar or a string array (inline or block). Unknown/complex -> raw string.
  get(key) {
    const idx = this._findIndex(key)
    if (idx === -1) return undefined
    const raw = this.fm[idx].text.match(FIELD_RE)[2]
    const trimmed = raw.trim()
    if (trimmed.startsWith('[')) {
      const inner = trimmed.slice(1, trimmed.lastIndexOf(']'))
      if (inner.trim() === '') return []
      return inner.split(',').map(p => parseScalar(p.trim()))
    }
    if (trimmed === '') {
      const items = []
      for (let i = idx + 1; i < this.fm.length; i++) {
        const t = this.fm[i].text
        const item = t.match(/^[ \t]+-[ \t]*(.*)$/)
        if (item) items.push(parseScalar(item[1]))
        else if (/^[A-Za-z_]/.test(t)) break
        else if (t.trim() === '') continue
        else break
      }
      if (items.length) return items
    }
    return parseScalar(raw)
  }

  // Replace/insert a double-quoted string field, preserving all other bytes.
  setString(key, value) { return this._setLine(key, `${key}: ${encodeString(value)}`) }
  // Replace/insert a plain scalar (status / order / timestamp).
  setPlain(key, value) { return this._setLine(key, `${key}: ${value}`) }

  _setLine(key, lineText) {
    if (!this.hasFm) throw new Error('document has no frontmatter')
    const idx = this._findIndex(key)
    if (idx !== -1) {
      this.fm[idx] = { text: lineText, eol: this.fm[idx].eol || this.eol }
    } else {
      const eol = this.fm.length ? (this.fm[this.fm.length - 1].eol || this.eol) : this.eol
      this.fm.push({ text: lineText, eol })
    }
    return this
  }

  setBody(body) { this.body = body; return this }

  toString() {
    if (!this.hasFm) return this.body
    return joinLines([this.head]) + joinLines(this.fm) + joinLines([this.close]) + this.body
  }
}

export function parseFrontmatter(text) { return new FrontmatterDoc(text) }
