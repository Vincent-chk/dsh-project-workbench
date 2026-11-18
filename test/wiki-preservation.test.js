import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, realpath, stat, symlink, truncate, unlink, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { apply } from '../index.js'
import { prepareWikiView, markWikiViewReady, wikiStatus, wikiPage, wikiEvidence } from '../core/wiki.js'
import { makeRoot, stubSpawnHost, waitFor } from './util.js'

// Only this test's temporary repository is mutated. The child is an explicit
// stub: page and checkpoint writes below simulate work by the generator.
async function setup(t, { metadata = true, empty = false } = {}) {
  const root = await makeRoot(t)
  const templates = join(root, 'empty-git-templates')
  await mkdir(templates)
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TEMPLATE_DIR: templates }
  execFileSync('git', ['init', '--quiet', root], { env })
  await writeFile(join(root, '.gitignore'), 'openwiki/\n.project/.local/\nempty-git-templates/\n')
  await writeFile(join(root, 'demo.js'), 'export const value = 1\n')
  execFileSync('git', ['-C', root, 'add', '.gitignore', 'demo.js'], { env })
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { env })
  await mkdir(join(root, '.project'))
  const wiki = join(root, 'openwiki')
  const page = join(wiki, 'quickstart.md')
  const claims = join(wiki, '.claims', 'quickstart.json')
  const attachment = join(wiki, 'images', 'diagram.bin')
  const companion = join(wiki, '._.run.json')
  const oldPage = '# 原正文\n'
  const oldClaims = JSON.stringify({ claims: [{ statement: '原声明', evidence: [{ resource: 'repo://demo.js#L1-L1' }] }] })
  const oldAttachment = Buffer.from([0, 1, 127, 128, 255, 0, 42])
  const oldCompanion = Buffer.from([0, 5, 22, 7, 0, 255])
  if (!empty) {
    await mkdir(join(wiki, '.claims'), { recursive: true })
    await mkdir(join(wiki, 'images'), { recursive: true })
    await writeFile(page, oldPage)
    await writeFile(claims, oldClaims)
    await writeFile(attachment, oldAttachment)
    await writeFile(companion, oldCompanion)
    if (metadata) await writeFile(join(wiki, '.last-update.json'), JSON.stringify({ status: 'complete', updatedAt: new Date(Date.now() - 60000).toISOString() }))
  }
  const { ctx, children, agents } = stubSpawnHost(root)
  const originalStart = ctx.subagents.startActivation
  ctx.subagents.startActivation = async options => {
    const result = await originalStart(options)
    children.at(-1).cwd = options.cwd
    return result
  }
  const routes = new Map()
  ctx.skills = { register: () => {} }
  ctx.mcpManager = { register: () => {} }
  ctx.connection = { fetch: { register: route => routes.set(route.path, route.fetch) } }
  ctx.effect = effect => {
    const result = effect()
    if (typeof result?.next === 'function') { for (const _ of result) { /* register host routes */ } }
    if (typeof result === 'function') t.after(result)
  }
  const { sessionId } = await ctx.sessionController.create({ cwd: root })
  await apply(ctx)
  const call = async (route, overrides = {}) => (await routes.get(`/api/project-workbench/${route}`)(new Request('http://local', {
    method: 'POST', body: JSON.stringify({ root, sessionId, ...overrides }),
  }))).json()
  const jobPath = join(root, '.project', '.local', 'wiki-job.json')
  const pointer = join(root, '.project', '.local', 'wiki-preserved-views', 'current.json')
  const job = async () => JSON.parse(await readFile(jobPath, 'utf8'))
  const waitJob = async (status, childId) => {
    await waitFor(async () => {
      try { const saved = await job(); return saved.status === status && (!childId || saved.childId === childId) } catch { return false }
    })
    return job()
  }
  const snapshot = async () => JSON.parse(await readFile(pointer, 'utf8'))
  return { root, wiki, page, claims, attachment, companion, oldPage, oldClaims, oldAttachment, oldCompanion,
    ctx, children, agents, call, job, waitJob, snapshot, pointer }
}

const changedClaims = JSON.stringify({ claims: [{ statement: '本轮未完成的新声明', evidence: [{ resource: 'repo://new.js#L1-L1' }] }] })
const run = { schemaVersion: 1, runId: 'isolated-run', mode: 'update', phase: 'generating', initialPages: ['quickstart.md'] }

function independentView(root) {
  const wikiModule = new URL('../core/wiki.js', import.meta.url).href
  const script = `import { wikiStatus, wikiPage, wikiEvidence } from ${JSON.stringify(wikiModule)};
    const root = process.argv[1], status = await wikiStatus(root);
    const page = await wikiPage(root, 'quickstart.md', status.viewVersion);
    const evidence = await wikiEvidence(root, 'quickstart.md', page.viewVersion);
    process.stdout.write(JSON.stringify({ status, page, evidence }));`
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, root], { encoding: 'utf8' }))
}

async function savedFile(root, snapshotId, originalPath) {
  const dir = join(root, '.project', '.local', 'wiki-preserved-views', snapshotId)
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
  const entry = manifest.files.find(item => item.path === originalPath)
  assert.ok(entry, `snapshot contains ${originalPath}`)
  assert.match(entry.blob, /^blob-[0-9]{8}$/)
  return join(dir, 'blobs', entry.blob)
}

function readAttribute(path, name) {
  const output = execFileSync('/usr/bin/xattr', ['-p', '-x', name, path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return Buffer.from(output.replace(/\s/g, ''), 'hex')
}

function writeAttribute(path, name, bytes) {
  execFileSync('/usr/bin/xattr', ['-w', '-x', name, bytes.toString('hex'), path], { stdio: 'pipe' })
}

function recordedAttribute(attrs, name) {
  const entry = attrs.find(item => item.name === name)
  assert.ok(entry, `snapshot records extended attribute ${name}`)
  return Buffer.from(entry.value, 'base64')
}

test('failed staged Wiki generation leaves the old tree readable and a new retry publishes only after completion', async t => {
  const f = await setup(t)
  const start = await f.call('wiki-generate')
  assert.equal(start.ok, true)
  await f.waitJob('running', start.data.childId)
  const candidate = join(f.children[0].cwd, 'openwiki')
  await mkdir(join(candidate, '.claims'), { recursive: true })
  await writeFile(join(candidate, 'quickstart.md'), '# 未完成的新正文\n')
  await writeFile(join(candidate, '.claims', 'quickstart.json'), changedClaims)
  const during = independentView(f.root)
  assert.equal(during.page.content, f.oldPage)
  assert.equal(during.evidence.claims[0].statement, '原声明')
  assert.deepEqual(await readFile(f.attachment), f.oldAttachment)
  assert.deepEqual(await readFile(f.companion), f.oldCompanion)
  f.children[0].resolve({ stopReason: 'error', output: [] })
  await f.waitJob('failed', start.data.childId)
  assert.equal((await wikiPage(f.root, 'quickstart.md')).content, f.oldPage)
  assert.equal(await readFile(f.claims, 'utf8'), f.oldClaims)
  assert.deepEqual(await readFile(f.attachment), f.oldAttachment)
  assert.deepEqual(await readFile(f.companion), f.oldCompanion)

  const retry = await f.call('wiki-generate')
  assert.equal(retry.ok, true)
  await f.waitJob('running', retry.data.childId)
  assert.notEqual(f.children[0].cwd, f.children[1].cwd, 'retry starts a fresh candidate')
  const next = join(f.children[1].cwd, 'openwiki')
  await mkdir(join(next, '.claims'), { recursive: true })
  await writeFile(join(next, 'quickstart.md'), '# 全新完成的正文\n')
  await writeFile(join(next, '.claims', 'quickstart.json'), changedClaims)
  await writeFile(join(next, '.last-update.json'), JSON.stringify({ status: 'complete', updatedAt: new Date().toISOString() }))
  assert.equal((await wikiPage(f.root, 'quickstart.md')).content, f.oldPage)
  f.children[1].resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'WIKI_DONE pages=1' }] })
  await f.waitJob('done', retry.data.childId)
  const status = await wikiStatus(f.root)
  const page = await wikiPage(f.root, 'quickstart.md', status.viewVersion)
  assert.equal(page.content, '# 全新完成的正文\n')
  assert.equal((await wikiEvidence(f.root, 'quickstart.md', page.viewVersion)).claims[0].statement, '本轮未完成的新声明')
  await assert.rejects(wikiPage(f.root, 'quickstart.md', during.status.viewVersion), { code: 'WIKI_VIEW_CHANGED' })
  const local = join(f.root, '.project', '.local')
  const backupNames = (await fs.promises.readdir(local)).filter(name => name.startsWith('wiki-old-'))
  assert.equal(backupNames.length, 1)
  const backup = join(local, backupNames[0], 'openwiki')
  assert.equal(await readFile(join(backup, 'quickstart.md'), 'utf8'), f.oldPage)
  assert.equal(await readFile(join(backup, '.claims', 'quickstart.json'), 'utf8'), f.oldClaims)
  assert.deepEqual(await readFile(join(backup, 'images', 'diagram.bin')), f.oldAttachment)
  assert.deepEqual(await readFile(join(backup, '._.run.json')), f.oldCompanion)
})

test('stopping a staged Wiki generation leaves the live page, source and attachments unchanged', async t => {
  const f = await setup(t)
  const start = await f.call('wiki-generate')
  assert.equal(start.ok, true)
  await f.waitJob('running', start.data.childId)
  const candidate = join(f.children[0].cwd, 'openwiki')
  await mkdir(join(candidate, '.claims'), { recursive: true })
  await writeFile(join(candidate, 'quickstart.md'), '# 生成中的内容\n')
  await writeFile(join(candidate, '.claims', 'quickstart.json'), changedClaims)
  assert.equal((await f.call('wiki-generate-stop')).ok, true)
  f.children[0].resolve({ stopReason: 'stopped', output: [] })
  await f.waitJob('failed', start.data.childId)
  const status = await wikiStatus(f.root)
  const page = await wikiPage(f.root, 'quickstart.md', status.viewVersion)
  assert.equal(page.content, f.oldPage)
  assert.equal((await wikiEvidence(f.root, 'quickstart.md', page.viewVersion)).claims[0].statement, '原声明')
  assert.equal(await readFile(f.claims, 'utf8'), f.oldClaims)
  assert.deepEqual(await readFile(f.attachment), f.oldAttachment)
  assert.deepEqual(await readFile(f.companion), f.oldCompanion)
})

test('publication with delayed or failed terminal status remains visible and is reported truthfully', async t => {
  for (const fail of [false, true]) {
    await t.test(fail ? 'terminal write fails' : 'terminal write is delayed', async t => {
      const f = await setup(t)
      const start = await f.call('wiki-generate')
      assert.equal(start.ok, true)
      await f.waitJob('running', start.data.childId)
      const candidate = join(f.children[0].cwd, 'openwiki')
      await mkdir(join(candidate, '.claims'), { recursive: true })
      await writeFile(join(candidate, 'quickstart.md'), '# 完成的新内容\n')
      await writeFile(join(candidate, '.claims', 'quickstart.json'), changedClaims)
      await writeFile(join(candidate, '.last-update.json'), JSON.stringify({ status: 'complete', updatedAt: new Date().toISOString() }))
      const originalRename = fs.promises.rename
      let release, entered, finished
      const blocked = new Promise(resolve => { release = resolve })
      const enteredWrite = new Promise(resolve => { entered = resolve })
      const finishedWrite = new Promise(resolve => { finished = resolve })
      let intercepted = false
      fs.promises.rename = async (source, target, ...args) => {
        if (!intercepted && String(target) === join(f.root, '.project', '.local', 'wiki-job.json') && JSON.parse(await readFile(source, 'utf8')).status === 'done') {
          intercepted = true; entered(); await blocked
          try {
            if (fail) throw new Error('isolated terminal write failure')
            return await originalRename.call(fs.promises, source, target, ...args)
          } finally { finished() }
        }
        return originalRename.call(fs.promises, source, target, ...args)
      }
      syncBuiltinESMExports()
      try {
        f.children[0].resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'WIKI_DONE pages=1' }] })
        await Promise.race([enteredWrite, new Promise((_, reject) => setTimeout(() => reject(new Error('terminal write was not attempted')), 3000))])
        const during = await f.call('wiki-generate-status')
        assert.notEqual(during.data.status, 'done')
        assert.equal((await wikiPage(f.root, 'quickstart.md')).content, '# 完成的新内容\n', 'publication already occurred')
        release()
        if (fail) {
          await finishedWrite
          await waitFor(async () => (await f.call('wiki-generate-status')).data?.status === 'failed')
          const after = await f.call('wiki-generate-status')
          assert.equal(after.data.error, 'Wiki was published but its status could not be saved')
          assert.equal((await wikiPage(f.root, 'quickstart.md')).content, '# 完成的新内容\n')
        } else {
          await f.waitJob('done', start.data.childId)
          assert.equal((await wikiPage(f.root, 'quickstart.md')).content, '# 完成的新内容\n')
        }
      } finally {
        release()
        if (intercepted) await finishedWrite
        fs.promises.rename = originalRename
        syncBuiltinESMExports()
      }
    })
  }
})

test('a damaged legacy saved view never falls back to changed live page or evidence', async t => {
  for (const damage of ['missing file', 'missing pointer', 'corrupt manifest', 'altered manifest', 'missing attachment', 'altered attachment']) {
    await t.test(damage, async t => {
      const f = await setup(t)
      const pointer = await prepareWikiView(f.root)
      await markWikiViewReady(f.root, pointer.epoch)
      await writeFile(join(f.root, '.project', '.local', 'wiki-job.json'), JSON.stringify({
        status: 'failed', childId: 'legacy-child', viewEpoch: pointer.epoch, viewSnapshotId: pointer.snapshotId,
      }))
      await writeFile(f.page, '# 不可作为旧版的新内容\n')
      const before = await wikiStatus(f.root)
      assert.equal(before.viewIsSnapshot, true)
      assert.equal((await wikiPage(f.root, 'quickstart.md', before.viewVersion)).content, f.oldPage)
      const saved = join(f.root, '.project', '.local', 'wiki-preserved-views', pointer.snapshotId)
      const pageBlob = await savedFile(f.root, pointer.snapshotId, 'quickstart.md')
      const attachmentBlob = await savedFile(f.root, pointer.snapshotId, 'images/diagram.bin')
      if (damage === 'missing file') await unlink(pageBlob)
      else if (damage === 'missing pointer') await unlink(f.pointer)
      else if (damage === 'corrupt manifest') await writeFile(join(saved, 'manifest.json'), '{invalid')
      else if (damage === 'altered manifest') {
        const manifestPath = join(saved, 'manifest.json')
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
        manifest.files = manifest.files.filter(item => item.path !== 'images/diagram.bin')
        await writeFile(manifestPath, JSON.stringify(manifest))
      } else if (damage === 'missing attachment') await unlink(attachmentBlob)
      else await writeFile(attachmentBlob, Buffer.from([9, 9, 9, 9, 9, 9, 9]))
      await assert.rejects(wikiStatus(f.root), e => e.code === 'WIKI_SNAPSHOT_UNREADABLE')
      await assert.rejects(wikiPage(f.root, 'quickstart.md'), e => e.code === 'WIKI_SNAPSHOT_UNREADABLE')
      await assert.rejects(wikiEvidence(f.root, 'quickstart.md'), e => e.code === 'WIKI_SNAPSHOT_UNREADABLE')
      assert.equal(await readFile(f.page, 'utf8'), '# 不可作为旧版的新内容\n')
    })
  }
})

test('a legacy saved view stays readable while an independent update fails', async t => {
  const f = await setup(t)
  const pointer = await prepareWikiView(f.root)
  await markWikiViewReady(f.root, pointer.epoch)
  await writeFile(join(f.root, '.project', '.local', 'wiki-job.json'), JSON.stringify({
    status: 'failed', childId: 'legacy-child', viewEpoch: pointer.epoch, viewSnapshotId: pointer.snapshotId,
  }))
  await writeFile(f.page, '# 旧版生成留下的不完整正文\n')
  await writeFile(f.claims, changedClaims)
  const old = await wikiStatus(f.root)
  assert.equal(old.viewIsSnapshot, true)
  assert.equal((await wikiPage(f.root, 'quickstart.md', old.viewVersion)).content, f.oldPage)
  const start = await f.call('wiki-generate')
  assert.equal(start.ok, true)
  await f.waitJob('running', start.data.childId)
  const candidate = join(f.children[0].cwd, 'openwiki')
  await mkdir(candidate)
  await writeFile(join(candidate, 'quickstart.md'), '# 新候选未完成\n')
  assert.equal((await wikiPage(f.root, 'quickstart.md')).content, f.oldPage)
  f.children[0].resolve({ stopReason: 'error', output: [] })
  await f.waitJob('failed', start.data.childId)
  const failed = await wikiStatus(f.root)
  assert.equal(failed.viewIsSnapshot, true)
  const page = await wikiPage(f.root, 'quickstart.md', failed.viewVersion)
  assert.equal(page.content, f.oldPage)
  assert.equal((await wikiEvidence(f.root, 'quickstart.md', page.viewVersion)).claims[0].statement, '原声明')
  assert.equal(await readFile(f.page, 'utf8'), '# 旧版生成留下的不完整正文\n')
})

test('changes to the live Wiki while a candidate runs refuse publication and preserve the edit', async t => {
  const f = await setup(t)
  const start = await f.call('wiki-generate')
  assert.equal(start.ok, true)
  await f.waitJob('running', start.data.childId)
  const candidate = join(f.children[0].cwd, 'openwiki')
  await mkdir(candidate)
  await writeFile(join(candidate, 'quickstart.md'), '# 已完成的候选\n')
  await writeFile(join(candidate, '.last-update.json'), JSON.stringify({ status: 'complete', updatedAt: new Date().toISOString() }))
  await writeFile(f.page, '# 用户生成时的新编辑\n')
  f.children[0].resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'WIKI_DONE pages=1' }] })
  const failed = await f.waitJob('failed', start.data.childId)
  assert.match(failed.error, /changed during generation/)
  assert.equal(await readFile(f.page, 'utf8'), '# 用户生成时的新编辑\n')
  assert.equal(await readFile(f.claims, 'utf8'), f.oldClaims)
  assert.deepEqual(await readFile(f.attachment), f.oldAttachment)
  assert.deepEqual(await readFile(f.companion), f.oldCompanion)
})

test('a Wiki without completion metadata remains readable after a failed candidate', async t => {
  const f = await setup(t, { metadata: false })
  const start = await f.call('wiki-generate')
  assert.equal(start.ok, true)
  await f.waitJob('running', start.data.childId)
  const candidate = join(f.children[0].cwd, 'openwiki')
  await mkdir(candidate)
  await writeFile(join(candidate, 'quickstart.md'), '# 未完成的候选\n')
  f.children[0].resolve({ stopReason: 'error', output: [] })
  await f.waitJob('failed', start.data.childId)
  const status = await wikiStatus(f.root)
  assert.equal(status.lastCompleted, null)
  assert.equal((await wikiPage(f.root, 'quickstart.md', status.viewVersion)).content, f.oldPage)
  assert.equal(await readFile(f.claims, 'utf8'), f.oldClaims)
})

test('a symlinked local directory cannot redirect job records outside the project', async t => {
  const f = await setup(t)
  const outside = join(f.root, 'outside-sentinel')
  await mkdir(outside)
  await writeFile(join(outside, 'keep.txt'), 'untouched')
  await symlink(outside, join(f.root, '.project', '.local'))
  const start = await f.call('wiki-generate')
  assert.equal(start.ok, false)
  assert.equal(start.code, 'WIKI_STAGING_FAILED')
  assert.equal(f.children.length, 0)
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'untouched')
  await assert.rejects(readFile(join(outside, 'wiki-job.json')), e => e.code === 'ENOENT')
})

test('legacy preservation rejects an oversized snapshot without changing prior files', async t => {
  const f = await setup(t)
  const largeFile = join(f.wiki, 'images', 'large.bin')
  await writeFile(largeFile, '')
  await truncate(largeFile, 256 * 1024 * 1024 + 1) // sparse test file; no bulk payload is allocated
  await assert.rejects(prepareWikiView(f.root), { code: 'WIKI_SNAPSHOT_FAILED' })
  assert.equal(f.children.length, 0)
  assert.equal((await stat(largeFile)).size, 256 * 1024 * 1024 + 1)
  assert.equal(await readFile(f.page, 'utf8'), f.oldPage)
  assert.equal(await readFile(f.claims, 'utf8'), f.oldClaims)
})

test('legacy macOS snapshot preserves file xattrs, resource forks, and directory metadata', { skip: process.platform !== 'darwin' }, async t => {
  const f = await setup(t)
  const fileAttribute = 'com.example.workbench.test-file'
  const directoryAttribute = 'com.example.workbench.test-directory'
  const rootAttribute = 'com.example.workbench.test-root'
  const fileValue = Buffer.from([0, 1, 2, 127, 128, 255])
  const resourceValue = Buffer.from([0, 3, 127, 0, 255, 1, 2, 42])
  const directoryValue = Buffer.from([255, 0, 42, 18])
  const rootValue = Buffer.from([7, 0, 250, 0, 13])
  const imageDir = join(f.wiki, 'images')
  writeAttribute(f.page, fileAttribute, fileValue)
  writeAttribute(f.page, 'com.apple.ResourceFork', resourceValue)
  writeAttribute(imageDir, directoryAttribute, directoryValue)
  writeAttribute(f.wiki, rootAttribute, rootValue)
  const pointer = await prepareWikiView(f.root)
  const snapshotDir = join(f.root, '.project', '.local', 'wiki-preserved-views', pointer.snapshotId)
  const manifest = JSON.parse(await readFile(join(snapshotDir, 'manifest.json'), 'utf8'))
  const page = manifest.files.find(item => item.path === 'quickstart.md')
  const directory = manifest.dirs.find(item => item.path === 'images')
  assert.ok(page)
  assert.ok(directory)
  assert.deepEqual(recordedAttribute(page.attrs, fileAttribute), fileValue)
  assert.deepEqual(recordedAttribute(page.attrs, 'com.apple.ResourceFork'), resourceValue)
  assert.deepEqual(recordedAttribute(directory.attrs, directoryAttribute), directoryValue)
  assert.deepEqual(recordedAttribute(manifest.root.attrs, rootAttribute), rootValue)
  const pageBlob = await savedFile(f.root, pointer.snapshotId, 'quickstart.md')
  assert.deepEqual(readAttribute(pageBlob, fileAttribute), fileValue)
  assert.deepEqual(readAttribute(pageBlob, 'com.apple.ResourceFork'), resourceValue)
  assert.deepEqual(readAttribute(f.page, fileAttribute), fileValue)
  assert.deepEqual(readAttribute(f.page, 'com.apple.ResourceFork'), resourceValue)
  assert.deepEqual(readAttribute(imageDir, directoryAttribute), directoryValue)
  assert.deepEqual(readAttribute(f.wiki, rootAttribute), rootValue)
})

test('macOS source provenance is recorded when a simulated blob value differs', { skip: process.platform !== 'darwin' }, async t => {
  const wikiModule = new URL('../core/wiki.js', import.meta.url).href
  const script = `import childProcess from 'node:child_process';
    import { promisify } from 'node:util'; import { syncBuiltinESMExports } from 'node:module';
    import { readFile } from 'node:fs/promises'; import { join } from 'node:path';
    const [root, attribute] = process.argv.slice(1), original = childProcess.execFile, originalAsync = promisify(original);
    const wrapped = (...args) => original(...args);
    Object.defineProperty(wrapped, promisify.custom, { value: async (file, args, options) => {
      if (file === '/usr/bin/xattr' && args[0] === '-p' && args[2] === attribute) {
        return { stdout: Buffer.from(args[3].includes('/blobs/') ? '02\\n' : '01\\n'), stderr: Buffer.alloc(0) };
      }
      const result = await originalAsync(file, args, options);
      if (file === '/usr/bin/xattr' && args.length === 1) {
        const names = result.stdout.toString('utf8').split('\\n').filter(Boolean);
        if (!names.includes(attribute)) names.push(attribute);
        return { ...result, stdout: Buffer.from(names.join('\\n') + '\\n') };
      }
      return result;
    }});
    childProcess.execFile = wrapped; syncBuiltinESMExports();
    const { prepareWikiView } = await import(${JSON.stringify(wikiModule)});
    try {
      const pointer = await prepareWikiView(root);
      const manifest = JSON.parse(await readFile(join(root, '.project', '.local', 'wiki-preserved-views', pointer.snapshotId, 'manifest.json'), 'utf8'));
      const entry = manifest.files.find(item => item.path === 'quickstart.md');
      process.stdout.write(JSON.stringify({ ok: true, recorded: entry.attrs.find(item => item.name === attribute)?.value }));
    } catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code })); }`
  for (const [attribute, expected] of [['com.apple.provenance', true], ['com.example.workbench.ordinary', false]]) {
    await t.test(attribute, async t => {
      const f = await setup(t)
      const observed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, f.root, attribute], { encoding: 'utf8' }))
      assert.equal(observed.ok, expected)
      if (expected) assert.equal(observed.recorded, Buffer.from([1]).toString('base64'), 'the manifest records source bytes, not blob bytes')
      else assert.equal(observed.code, 'WIKI_SNAPSHOT_FAILED')
      assert.equal(await readFile(f.page, 'utf8'), f.oldPage)
      assert.equal(await readFile(f.claims, 'utf8'), f.oldClaims)
    })
  }
})

test('legacy snapshot preparation fails safely when macOS xattrs cannot be inspected', { skip: process.platform !== 'darwin' }, async t => {
  const f = await setup(t)
  const name = 'com.example.workbench.failure-probe'
  const value = Buffer.from([0, 255, 2, 0, 71])
  writeAttribute(f.page, name, value)
  const wikiModule = new URL('../core/wiki.js', import.meta.url).href
  const script = `import childProcess from 'node:child_process';
    import { promisify } from 'node:util'; import { syncBuiltinESMExports } from 'node:module';
    const original = childProcess.execFile, originalAsync = promisify(original); let calls = 0;
    const wrapped = (...args) => original(...args);
    Object.defineProperty(wrapped, promisify.custom, { value: async (file, ...args) => {
      if (file === '/usr/bin/xattr') { calls++; const error = new Error('injected xattr failure'); error.code = 'EIO'; throw error; }
      return originalAsync(file, ...args);
    }});
    childProcess.execFile = wrapped; syncBuiltinESMExports();
    const { prepareWikiView } = await import(${JSON.stringify(wikiModule)});
    try { await prepareWikiView(process.argv[1]); process.stdout.write(JSON.stringify({ ok: true, calls })); }
    catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code, calls })); }`
  const observed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, f.root], { encoding: 'utf8' }))
  assert.ok(observed.calls > 0)
  assert.equal(observed.ok, false)
  assert.equal(observed.code, 'WIKI_SNAPSHOT_FAILED')
  assert.equal(await readFile(f.page, 'utf8'), f.oldPage)
  assert.equal(await readFile(f.claims, 'utf8'), f.oldClaims)
  assert.deepEqual(readAttribute(f.page, name), value)
  await assert.rejects(readFile(join(f.wiki, '.run.json')), { code: 'ENOENT' })
})

test('non-macOS preparation refuses an existing Wiki but permits first-time initialization', async t => {
  const existing = await setup(t)
  const firstTime = await setup(t, { empty: true })
  const wikiModule = new URL('../core/wiki.js', import.meta.url).href
  const script = `Object.defineProperty(process, 'platform', { value: 'linux' });
    const { prepareWikiView } = await import(${JSON.stringify(wikiModule)});
    try { process.stdout.write(JSON.stringify({ ok: true, data: await prepareWikiView(process.argv[1]) })); }
    catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code })); }`
  const execute = root => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, root], { encoding: 'utf8' }))
  const rejected = execute(existing.root)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'WIKI_SNAPSHOT_FAILED')
  assert.equal(await readFile(existing.page, 'utf8'), existing.oldPage)
  assert.equal(await readFile(existing.claims, 'utf8'), existing.oldClaims)
  assert.deepEqual(await readFile(existing.attachment), existing.oldAttachment)
  const initialized = execute(firstTime.root)
  assert.equal(initialized.ok, true)
  assert.equal(initialized.data.snapshotId, null)
})

test('an unavailable parent leaves the live Wiki intact and a retry retains subsequent edits', async t => {
  const f = await setup(t)
  const failed = await f.call('wiki-generate', { sessionId: 'session-not-live' })
  assert.equal(failed.ok, false)
  assert.equal(failed.code, 'SESSION_NOT_LIVE')
  assert.equal(f.children.length, 0)
  assert.equal(await readFile(f.page, 'utf8'), f.oldPage)
  await writeFile(f.page, '# 启动失败后用户的新编辑\n')
  await writeFile(f.claims, changedClaims)
  const restarted = await f.call('wiki-generate')
  assert.equal(restarted.ok, true)
  await f.waitJob('running', restarted.data.childId)
  const selected = await wikiStatus(f.root)
  const page = await wikiPage(f.root, 'quickstart.md', selected.viewVersion)
  assert.equal(page.content, '# 启动失败后用户的新编辑\n')
  assert.equal((await wikiEvidence(f.root, 'quickstart.md', page.viewVersion)).claims[0].statement, '本轮未完成的新声明')
  f.children[0].resolve({ stopReason: 'error', output: [] })
  await f.waitJob('failed', restarted.data.childId)
  assert.equal(await readFile(f.page, 'utf8'), '# 启动失败后用户的新编辑\n')
  assert.equal(await readFile(f.claims, 'utf8'), changedClaims)
})

test('a crash after fresh preparation captures later edits without deleting the first copy', async t => {
  const f = await setup(t)
  const first = await prepareWikiView(f.root)
  const pending = await f.snapshot()
  assert.equal(pending.phase, 'prepared')
  assert.equal(pending.fresh, true)
  assert.equal(pending.snapshotId, first.snapshotId)
  const firstSavedPage = await savedFile(f.root, first.snapshotId, 'quickstart.md')
  await writeFile(f.page, '# 准备后用户编辑\n')
  await writeFile(f.claims, changedClaims)
  const second = await prepareWikiView(f.root)
  assert.notEqual(second.snapshotId, first.snapshotId)
  assert.equal(await readFile(firstSavedPage, 'utf8'), f.oldPage)
  assert.equal(await readFile(await savedFile(f.root, second.snapshotId, 'quickstart.md'), 'utf8'), '# 准备后用户编辑\n')
  assert.equal(await readFile(await savedFile(f.root, second.snapshotId, '.claims/quickstart.json'), 'utf8'), changedClaims)
  assert.equal(f.children.length, 0)
})

test('legacy retry preparation preserves the existing failed-run baseline', async t => {
  const f = await setup(t)
  const original = await prepareWikiView(f.root)
  await markWikiViewReady(f.root, original.epoch)
  await writeFile(join(f.root, '.project', '.local', 'wiki-job.json'), JSON.stringify({
    status: 'failed', childId: 'legacy-child', viewEpoch: original.epoch, viewSnapshotId: original.snapshotId,
  }))
  await writeFile(f.page, '# 失败运行的部分内容\n')
  await writeFile(join(f.wiki, '.run.json'), JSON.stringify(run))
  const firstRetry = await prepareWikiView(f.root, { resume: true })
  const pending = await f.snapshot()
  assert.equal(pending.phase, 'prepared')
  assert.equal(pending.fresh, false)
  assert.equal(firstRetry.snapshotId, original.snapshotId)
  await writeFile(f.page, '# 再次准备期间的变动\n')
  const secondRetry = await prepareWikiView(f.root, { resume: true })
  assert.equal(secondRetry.snapshotId, original.snapshotId)
  assert.equal(await readFile(await savedFile(f.root, original.snapshotId, 'quickstart.md'), 'utf8'), f.oldPage)
  assert.equal(await readFile(f.page, 'utf8'), '# 再次准备期间的变动\n')
})

test('legacy snapshot owner write and sync failures preserve the live Wiki and permit retry', async t => {
  for (const phase of ['writeFile', 'sync']) {
    await t.test(phase, async t => {
      const f = await setup(t)
      const ownerPath = join(await realpath(f.root), '.project', '.local', 'wiki-preserved-views', 'owner')
      const originalOpen = fs.promises.open
      let injected = false
      fs.promises.open = async (path, flags, ...args) => {
        const handle = await originalOpen.call(fs.promises, path, flags, ...args)
        if (!injected && String(path) === ownerPath && flags === 'wx') {
          injected = true
          handle[phase] = async () => { const error = new Error('isolated disk full'); error.code = 'ENOSPC'; throw error }
        }
        return handle
      }
      syncBuiltinESMExports()
      let failed
      try { await prepareWikiView(f.root) } catch (error) { failed = error } finally { fs.promises.open = originalOpen; syncBuiltinESMExports() }
      assert.equal(injected, true)
      assert.equal(failed.code, 'WIKI_SNAPSHOT_FAILED')
      assert.equal(f.children.length, 0)
      const status = await wikiStatus(f.root)
      assert.equal(status.viewIsSnapshot, false)
      assert.equal((await wikiPage(f.root, 'quickstart.md', status.viewVersion)).content, f.oldPage)
      assert.equal(await readFile(f.claims, 'utf8'), f.oldClaims)
      const retry = await prepareWikiView(f.root)
      assert.ok(retry.snapshotId)
    })
  }
})

test('an unrelated preservation directory remains readable and is never overwritten', async t => {
  const f = await setup(t)
  const dir = join(f.root, '.project', '.local', 'wiki-preserved-views')
  await mkdir(dir, { recursive: true })
  const foreign = join(dir, 'user-file.txt')
  await writeFile(foreign, 'user content')
  const status = await wikiStatus(f.root)
  assert.equal(status.viewIsSnapshot, false)
  assert.equal((await wikiPage(f.root, 'quickstart.md', status.viewVersion)).content, f.oldPage)
  const start = await f.call('wiki-generate')
  assert.equal(start.ok, true)
  assert.equal(f.children.length, 1)
  assert.equal(await readFile(foreign, 'utf8'), 'user content')
  await assert.rejects(readFile(join(dir, 'owner')), e => e.code === 'ENOENT')
  f.children[0].resolve({ stopReason: 'error', output: [] })
  await f.waitJob('failed', start.data.childId)
  assert.equal(await readFile(foreign, 'utf8'), 'user content')
})

test('legacy interrupted run without a saved baseline is identified, never labeled a successful snapshot', async t => {
  const f = await setup(t)
  await writeFile(join(f.wiki, '.run.json'), JSON.stringify({ ...run, previousLastUpdate: { status: 'complete', updatedAt: '2026-01-01T00:00:00Z' } }))
  await writeFile(join(f.wiki, '.last-update.json'), JSON.stringify({ status: 'interrupted', updatedAt: new Date().toISOString() }))
  await writeFile(f.page, '# 旧运行留下的未知内容\n')
  const status = await wikiStatus(f.root)
  assert.equal(status.viewIsSnapshot, false)
  assert.equal(status.viewUnprotected, true)
  assert.equal(status.viewSnapshotKind ?? null, null)
  assert.equal((await wikiPage(f.root, 'quickstart.md', status.viewVersion)).content, '# 旧运行留下的未知内容\n')
  assert.equal(await readFile(join(f.wiki, '.run.json'), 'utf8'), JSON.stringify({ ...run, previousLastUpdate: { status: 'complete', updatedAt: '2026-01-01T00:00:00Z' } }))
})

test('first generation of an empty Wiki does not claim a previous version', async t => {
  const f = await setup(t, { empty: true })
  const start = await f.call('wiki-generate')
  assert.equal(start.ok, true)
  await f.waitJob('running', start.data.childId)
  const status = await wikiStatus(f.root)
  assert.equal(status.viewIsSnapshot, false)
  assert.equal(status.viewSnapshotKind ?? null, null)
  assert.deepEqual(status.pages, [])
  f.children[0].resolve({ stopReason: 'error', output: [] })
  await f.waitJob('failed', start.data.childId)
})
