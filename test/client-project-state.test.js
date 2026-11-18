import assert from 'node:assert/strict'
import test from 'node:test'
import {
  projectIdOf, reqDraftKey, issueDraftKey, reqDraftFrom, issueDraftFrom,
  sameDraft, draftOf, classifyProject, freshRead, createCardActions, clearSubmitted, taskContentPatch, taskFormError,
} from '../client-src/project-state.js'

test('project identity: workspace id, folder fallback for unregistered workspaces', () => {
  assert.equal(projectIdOf({ workspaceId: 'ws-1' }), 'ws-1')
  assert.equal(projectIdOf({ workspaceId: 'folder:/tmp/a' }), null)
  assert.equal(projectIdOf(undefined), null)
})

test('task definition drafts reuse legacy text and send only content changes', () => {
  const task = { title: 'T', description: '旧说明', resultSummary: '旧结果', evidence: '旧依据' }
  const draft = issueDraftFrom(task)
  assert.equal(draft.problemOverview, '旧说明')
  assert.equal(draft.description, '')
  assert.deepEqual(taskContentPatch({ ...draft, title: '新标题', resultSummary: '旧结果' }, task), { title: '新标题' })
  assert.deepEqual(taskContentPatch({ ...draft, description: '补充详情' }, task), { description: '补充详情', problemOverview: '旧说明' })
  assert.equal(taskFormError(draft), null)
  assert.match(taskFormError({ ...draft, problemOverview: ' ' }).message, /problemOverview/)
})

test('diagnostics classify: empty workspace is not-enabled, corrupt file and missing dir are read failures', () => {
  const empty = classifyProject({ project: null, requirements: [], diagnostics: [{ code: 'NOT_INITIALIZED' }] })
  assert.equal(empty.notInitialized, true)
  assert.equal(empty.readFailed, false)
  const corrupt = classifyProject({ project: null, requirements: [], diagnostics: [{ code: 'MISSING_FRONTMATTER' }] })
  assert.equal(corrupt.notInitialized, false)
  assert.equal(corrupt.readFailed, true)
  const missing = classifyProject({ project: null, requirements: [], diagnostics: [{ code: 'WORKSPACE_MISSING' }] })
  assert.equal(missing.readFailed, true)
  const healthy = classifyProject({ project: { name: 'p' }, requirements: [], diagnostics: [{ code: 'BAD_TIMESTAMP' }] })
  assert.equal(healthy.notInitialized, false)
  assert.equal(healthy.readFailed, false)
  assert.equal(healthy.diags.length, 1)
  assert.equal(classifyProject(null).readFailed, false)
})

test('a stale or foreign read never paints the current project', () => {
  assert.equal(freshRead('/b', '/b', 3, 3), true)
  assert.equal(freshRead('/b', '/a', 3, 3), false) // A answered after switching to B
  assert.equal(freshRead('/a', '/a', 4, 3), false) // an older request for the same project
})

test('A→B switch: the late A list read is dropped and B paints', () => {
  let currentRoot = '/a'
  let currentSeq = 0
  let painted = null
  const request = root => { const seq = ++currentSeq; return { root, seq } }
  const apply = (req, data) => {
    if (!freshRead(currentRoot, req.root, currentSeq, req.seq)) return
    painted = data
  }
  const aRead = request('/a') // A read starts
  currentRoot = '/b' // user switches to B before A answers
  const bRead = request('/b')
  apply(bRead, 'B data')
  apply(aRead, 'A data') // A answers late
  assert.equal(painted, 'B data')
})

test('drafts are keyed per project and compared against the saved values', () => {
  assert.notEqual(reqDraftKey('id:a', 'req-1'), reqDraftKey('id:b', 'req-1'))
  assert.notEqual(issueDraftKey('id:a', 'req-1', 'iss-1'), issueDraftKey('id:b', 'req-1', 'iss-1'))
  const req = { title: 't', next: '', q_who: '', q_pain: '', q_success: '', q_out: '' }
  const base = reqDraftFrom(req)
  assert.equal(sameDraft(base, reqDraftFrom(req)), true)
  assert.equal(reqDraftFrom({ ...req, goal: '旧目标' }).q_pain, '旧目标')
  const edited = { ...base, title: 'changed' }
  assert.equal(sameDraft(edited, base), false)
  const memory = { 'id:a|req|req-1': { fields: edited, fileHash: 'original' } }
  assert.equal(draftOf(memory, 'id:a|req|req-1', base).title, 'changed')
  assert.equal(draftOf(memory, 'id:b|req|req-1', base).title, 't')
  const issue = { title: 'i', description: '', acceptance: '', evidence: '' }
  assert.equal(sameDraft({ ...issueDraftFrom(issue), title: 'x' }, issueDraftFrom(issue)), false)
})

// ---- 任务卡异步动作：迟到响应不得作用于新会话（验收返工） ----

function cardHarness() {
  let key = 'A'
  let epoch = 0
  let note = ''
  let noteRevision = 0
  let busy = false
  let msg = ''
  let reloads = 0
  const calls = []
  const resolvers = []
  const rpc = (method, input) => {
    calls.push({ method, input })
    return new Promise(r => { resolvers.push(r) })
  }
  // 与组件一致：访问令牌 = 会话键 + 切换纪元
  const act = createCardActions({
    getKey: () => `${key}#${epoch}`, rpc,
    setBusy: v => { busy = v }, setMsg: v => { msg = v },
    reload: () => { reloads++ }, failText: '失败',
  })
  return {
    act, calls,
    switchTo: k => { key = k; epoch++; note = ''; busy = false; msg = '' }, // 组件切换 effect 的等价重置
    typeNote: v => { noteRevision++; note = v },
    // 模拟输入事件与组件 saveNote 的修订号接线。
    saveNote: text => {
      const submittedRevision = noteRevision
      return act('demo/note', { text }, () => { note = clearSubmitted(note, noteRevision, submittedRevision) })
    },
    settle: res => resolvers.shift()(res), // FIFO：先 settle 先在途的请求
    snapshot: () => ({ key, epoch, note, busy, msg, reloads }),
  }
}

test('任务卡: A 的迟到保存成功不清空 B 的草稿，也不应用任何状态', async () => {
  const h = cardHarness()
  h.typeNote('A 的进展')
  const pending = h.act('demo/note', { text: 'A 的进展' }, () => h.typeNote('')) // onOk = setNote('')
  h.switchTo('B') // A 尚未返回，用户切到 B
  h.typeNote('B 的新草稿')
  h.settle({ ok: true })
  await pending
  const s = h.snapshot()
  assert.equal(s.note, 'B 的新草稿') // 核心：B 的输入未被清空
  assert.equal(s.busy, false)
  assert.equal(s.msg, '')
  assert.equal(s.reloads, 0) // 不为旧会话刷新
})

test('任务卡: 同会话保存成功才清空输入并刷新', async () => {
  const h = cardHarness()
  h.typeNote('进展')
  const pending = h.act('demo/note', { text: '进展' }, () => h.typeNote(''))
  h.settle({ ok: true })
  await pending
  const s = h.snapshot()
  assert.equal(s.note, '')
  assert.equal(s.reloads, 1)
  assert.equal(s.busy, false)
})

test('任务卡: 失败保留输入并显示错误；同会话连点只发一次', async () => {
  const h = cardHarness()
  h.typeNote('进展')
  const first = h.act('demo/note', { text: '进展' }, () => h.typeNote(''))
  const second = h.act('demo/note', { text: '进展' }, () => h.typeNote(''))
  assert.equal(await second, undefined)
  assert.equal(h.calls.length, 1)
  h.settle({ ok: false, message: '磁盘错误' })
  await first
  const s = h.snapshot()
  assert.equal(s.note, '进展')
  assert.ok(s.msg.includes('磁盘错误'))
})

test('任务卡: 切到 B 后 A 仍在途时，B 可立即操作', async () => {
  const h = cardHarness()
  const pendingA = h.act('demo/note', { text: 'A' }, () => h.typeNote(''))
  h.switchTo('B')
  h.typeNote('B 草稿')
  const pendingB = h.act('demo/note', { text: 'B 草稿' }, () => h.typeNote(''))
  assert.equal(h.calls.length, 2) // B 的动作未被 A 的在途请求阻塞
  h.settle({ ok: true }) // A 先返回
  await pendingA
  assert.equal(h.snapshot().note, 'B 草稿')
  h.settle({ ok: true }) // B 返回
  await pendingB
  assert.equal(h.snapshot().note, '')
  assert.equal(h.snapshot().reloads, 1)
})

test('任务卡: 同会话保存返回前继续输入，成功回调不清空新内容', async () => {
  const h = cardHarness()
  h.typeNote('第一条')
  const pending = h.saveNote('第一条')
  h.typeNote('第二条') // 响应返回前继续输入
  h.settle({ ok: true })
  await pending
  assert.equal(h.snapshot().note, '第二条')
  assert.equal(h.snapshot().reloads, 1) // 本会话正常刷新
})

test('任务卡: 保存期间重新输入相同内容，成功回调保留第二条', async () => {
  const h = cardHarness()
  h.typeNote('相同进展')
  const pending = h.saveNote('相同进展')
  h.typeNote('')
  h.typeNote('相同进展')
  h.settle({ ok: true })
  await pending
  assert.equal(h.snapshot().note, '相同进展')
})

test('任务卡: 保存期间仅修改空白也保留新的输入', async () => {
  const h = cardHarness()
  h.typeNote('进展')
  const pending = h.saveNote('进展')
  h.typeNote('进展 ')
  h.settle({ ok: true })
  await pending
  assert.equal(h.snapshot().note, '进展 ')
})

test('任务卡: 提交内容未变时成功回调正常清空（含首尾空白）', async () => {
  const h = cardHarness()
  h.typeNote('  第一条  ')
  const pending = h.saveNote('第一条')
  h.settle({ ok: true })
  await pending
  assert.equal(h.snapshot().note, '')
})

test('任务卡: A→B→A 后，旧 A 响应不得清空新 A 草稿（纪元守卫）', async () => {
  const h = cardHarness()
  h.typeNote('旧 A 草稿')
  const pendingOldA = h.saveNote('旧 A 草稿') // 令牌 A#0
  h.switchTo('B') // 纪元 1
  h.switchTo('A') // 纪元 2：键又是 A，但访问令牌不同
  h.typeNote('新 A 草稿')
  h.settle({ ok: true }) // 旧 A 响应迟到返回
  await pendingOldA
  const s = h.snapshot()
  assert.equal(s.note, '新 A 草稿') // 核心：不被旧响应清空
  assert.equal(s.msg, '')
  assert.equal(s.reloads, 0) // 不为旧访问刷新
  // 新 A 的保存仍正常工作
  const pendingNewA = h.saveNote('新 A 草稿')
  h.settle({ ok: true })
  await pendingNewA
  assert.equal(h.snapshot().note, '')
  assert.equal(h.snapshot().reloads, 1)
})
