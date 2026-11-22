import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, lstat, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { atomicWrite, readWorkspaceFile, resolveWorkspaceFile, WorkbenchError } from './files.js'

const renderer = fileURLToPath(new URL('../vendor/answer-me-with-html/am.mjs', import.meta.url))
const exec = promisify(execFile)
const controls = ['heading', 'text', 'input', 'button', 'feedback']
const invalid = () => new WorkbenchError('PROTOTYPE_INVALID', '原型需要任务说明、流程以及至少一张含有控件的页面线框。')

function label(value, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\r\n\u0000-\u001f]/u.test(value)) throw invalid()
  return value.trim()
}

export function parsePrototype(text) {
  let value
  try { value = JSON.parse(text) } catch { throw invalid() }
  if (!value || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 4000
    || !Array.isArray(value.flow) || !value.flow.length || value.flow.length > 20
    || !Array.isArray(value.screens) || !value.screens.length || value.screens.length > 8) throw invalid()
  return {
    summary: value.summary.trim(),
    flow: value.flow.map(step => ({ from: label(step?.from, 60), to: label(step?.to, 60), when: label(step?.when, 80) })),
    screens: value.screens.map(screen => {
      if (!Array.isArray(screen?.elements) || !screen.elements.length || screen.elements.length > 12) throw invalid()
      return {
        title: label(screen.title), state: label(screen.state),
        elements: screen.elements.map(control => {
          if (!controls.includes(control?.kind)) throw invalid()
          return { kind: control.kind, label: label(control.label) }
        }),
      }
    }),
  }
}

const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const markdownText = text => escape(text).replace(/([\\`*_{}\[\]()#+.!|~$:\-])/gu, '\\$1')
const diagramText = text => text.replace(/[^\p{L}\p{M}\p{N}　 ，。？！、（）·]/gu, ' ').trim() || '…'

export async function renderPrototype(material, title) {
  const markup = material.screens.map(screen =>
    '<section style="background:var(--panel,#fff);color:#1e293b;border:1px solid #9aa9bc;border-radius:10px;padding:18px;min-width:210px;flex:1">' +
    '<h3>' + escape(screen.title) + '</h3><p style="color:#475569">' + escape(screen.state) + '</p>' +
    screen.elements.map(({ kind, label: text }) => {
      const content = escape(text)
      if (kind === 'heading') return '<h4>' + content + '</h4>'
      if (kind === 'input') return '<div style="margin:10px 0;padding:8px;border:1px solid #8799aa;border-radius:5px">' + content + '</div>'
      if (kind === 'button') return '<span style="display:inline-block;background:#253d61;color:white;border-radius:5px;padding:6px 12px;margin:5px">' + content + '</span>'
      if (kind === 'feedback') return '<p style="padding:8px;background:#e7eef8;border-radius:5px">' + content + '</p>'
      return '<p>' + content + '</p>'
    }).join('') + '</section>').join('')
  const flow = material.flow.map(step => diagramText(step.from) + ' -> ' + diagramText(step.to) + ': ' + diagramText(step.when))
  const draft = [
    '---', 'template: doc', 'lang: zh', 'title: 流程图与原型', '---', '',
    '## 任务说明', '', markdownText(title.replace(/[\r\n]+/gu, ' ')), '',
    ...material.summary.split(/\r?\n/u).map(line => markdownText(line)), '',
    '## 操作流程', '', '```flow', ...flow, '```', '',
    '## 页面线框', '', '```html',
    '<div style="display:flex;flex-wrap:wrap;gap:12px">' + markup + '</div>', '```', '',
  ].join('\n')
  const dir = await mkdtemp(join(tmpdir(), 'workbench-prototype-'))
  try {
    await writeFile(join(dir, 'prototype.md'), draft)
    await exec(process.execPath, [renderer, 'render', 'prototype.md', '-o', 'prototype.html', '--no-open', '--style', 'off'], {
      cwd: dir, env: { ...process.env, AM_HOME: join(dir, 'am'), CI: '1' }, timeout: 20_000,
    })
    const html = await readFile(join(dir, 'prototype.html'), 'utf8')
    // The workbench only embeds the static document. The CLI's page controls
    // and their scripts are for a standalone interactive explainer.
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, '')
      .replace('</head>', '<style>.am-toolbar,.am-diagram-expand,.am-reply,.am-reply-bar { display: none !important }</style></head>')
  } catch {
    throw new WorkbenchError('PROTOTYPE_RENDER_FAILED', '原型预览生成失败，请检查流程后重试。')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const relativeDirectory = reqId => '.project/requirements/' + reqId + '/prototypes'
const filename = number => number + '.json'

async function prototypeDirectory(root, reqId) {
  if (!/^req-\d{8}-[a-f0-9]{6}$/u.test(reqId)) throw invalid()
  const parent = await resolveWorkspaceFile(root, '.project/requirements/' + reqId + '/requirement.md')
  return join(dirname(parent.file), 'prototypes')
}

export async function listPrototypes(root, reqId) {
  const dir = await prototypeDirectory(root, reqId)
  const info = await lstat(dir).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (!info) return []
  if (!info.isDirectory()) throw invalid()
  return (await readdir(dir)).filter(name => /^[1-9]\d*\.json$/u.test(name))
    .map(name => Number.parseInt(name, 10)).filter(Number.isSafeInteger).sort((a, b) => b - a)
}

export async function readPrototype(root, reqId, version) {
  if (!Number.isSafeInteger(version) || version < 1) throw invalid()
  const { content } = await readWorkspaceFile(root, relativeDirectory(reqId) + '/' + filename(version))
  const record = JSON.parse(content)
  if (record.version !== version || typeof record.html !== 'string' || !Array.isArray(record.prds)) throw invalid()
  return { ...record, material: parsePrototype(JSON.stringify(record.material)) }
}

export async function latestPrototype(root, reqId) {
  const versions = await listPrototypes(root, reqId)
  return versions.length ? readPrototype(root, reqId, versions[0]) : null
}

// Only called under the requirement lock, after revalidating the draft and sources.
export async function savePrototype(root, reqId, record, version) {
  const dir = await prototypeDirectory(root, reqId)
  await mkdir(dir).catch(error => { if (error.code !== 'EEXIST') throw error })
  if (!(await lstat(dir)).isDirectory()) throw invalid()
  const saved = { ...record, version, savedAt: new Date().toISOString() }
  await atomicWrite(join(dir, filename(version)), JSON.stringify(saved))
  return { version, savedAt: saved.savedAt }
}
