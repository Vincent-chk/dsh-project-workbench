import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { parseFrontmatter, parseScalar } from '../core/frontmatter.js'

const sha = s => createHash('sha256').update(s).digest('hex')

const SAMPLE = [
  '---',
  'schema: 1',
  'id: req-20261112-a1b2c3',
  'title: "旧标题"',
  'status: in_progress',
  'custom_unknown: "keep me"',
  'nested:',
  '  a: 1',
  'order: 3',
  'updated: 2026-11-12T19:00:00+08:00',
  '---',
  '',
  '## 背景',
  '正文 with `code` and | table |',
  '',
  '```js',
  'const x = 1',
  '```',
  '',
].join('\n')

test('CT-01: editing title preserves every other byte (unknown fields, order, body)', () => {
  const doc = parseFrontmatter(SAMPLE)
  doc.setString('title', '新标题')
  const out = doc.toString()
  const before = SAMPLE.split('\n'), after = out.split('\n')
  assert.equal(before.length, after.length)
  for (let i = 0; i < before.length; i++) {
    if (before[i].startsWith('title:')) assert.equal(after[i], 'title: "新标题"')
    else assert.equal(after[i], before[i], `line ${i} changed`)
  }
  assert.match(out, /custom_unknown: "keep me"/)
})

test('CT-02: body with code fence and table round-trips unchanged', () => {
  const doc = parseFrontmatter(SAMPLE)
  assert.equal(doc.toString(), SAMPLE)
  assert.match(doc.body, /```js/)
  assert.match(doc.body, /\| table \|/)
})

test('CT-03: CRLF input is not normalized to LF', () => {
  const crlf = SAMPLE.replace(/\n/g, '\r\n')
  const doc = parseFrontmatter(crlf)
  doc.setString('title', '改')
  const out = doc.toString()
  assert.ok(out.includes('\r\n'))
  assert.ok(!/[^\r]\n/.test(out), 'no bare LF introduced')
  assert.equal(doc.eol, '\r\n')
})

test('new file writes use LF', () => {
  const doc = parseFrontmatter('---\ntitle: "a"\n---\nbody')
  assert.equal(doc.eol, '\n')
})

test('unknown-field hash stability across a status edit', () => {
  const doc = parseFrontmatter(SAMPLE)
  const unknownLine = 'custom_unknown: "keep me"'
  doc.setPlain('status', 'pending')
  const out = doc.toString()
  assert.ok(out.includes(unknownLine))
  // Only status + (no other) lines differ.
  const b = SAMPLE.split('\n'), a = out.split('\n')
  const diff = b.map((l, i) => l !== a[i] ? i : -1).filter(i => i >= 0)
  assert.deepEqual(diff, [b.findIndex(l => l.startsWith('status:'))])
})

test('parseScalar handles quoted, plain, numbers, booleans, comments', () => {
  assert.equal(parseScalar('"a\\"b"'), 'a"b')
  assert.equal(parseScalar("'it''s'"), "it's")
  assert.equal(parseScalar('in_progress'), 'in_progress')
  assert.equal(parseScalar('3'), 3)
  assert.equal(parseScalar('true'), true)
  assert.equal(parseScalar('standard  # comment'), 'standard')
  assert.equal(parseScalar(''), '')
})

test('reads inline and block string arrays', () => {
  const inline = parseFrontmatter('---\nrefs: ["a.md", "b.md"]\n---\n')
  assert.deepEqual(inline.get('refs'), ['a.md', 'b.md'])
  const block = parseFrontmatter('---\nrefs:\n  - "a.md"\n  - b.md\n---\n')
  assert.deepEqual(block.get('refs'), ['a.md', 'b.md'])
  const empty = parseFrontmatter('---\nrefs: []\n---\n')
  assert.deepEqual(empty.get('refs'), [])
})

test('inserting a missing field appends without disturbing existing lines', () => {
  const doc = parseFrontmatter('---\nid: req-20261112-aaaaaa\ntitle: "t"\n---\nbody')
  doc.setString('next', 'do it')
  const out = doc.toString()
  assert.match(out, /next: "do it"/)
  assert.match(out, /id: req-20261112-aaaaaa/)
  assert.ok(out.endsWith('body'))
})

test('string escaping round-trips special characters', () => {
  const doc = parseFrontmatter('---\ntitle: "x"\n---\n')
  doc.setString('title', 'a"b\\c\nd')
  const out = doc.toString()
  assert.equal(parseFrontmatter(out).get('title'), 'a"b\\c\nd')
})

test('document without frontmatter is flagged, body preserved', () => {
  const doc = parseFrontmatter('just text, no fm')
  assert.equal(doc.hasFm, false)
  assert.equal(doc.toString(), 'just text, no fm')
  assert.throws(() => doc.setString('title', 'x'))
})

test('unterminated frontmatter degrades to no-fm without throwing', () => {
  const doc = parseFrontmatter('---\ntitle: "x"\nno closing delimiter')
  assert.equal(doc.hasFm, false)
})

test('get returns undefined for absent field', () => {
  const doc = parseFrontmatter('---\ntitle: "x"\n---\n')
  assert.equal(doc.get('nope'), undefined)
})
