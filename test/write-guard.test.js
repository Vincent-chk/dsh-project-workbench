// Stage-1 V-4: .project write guard decisions (pure). Real-tool verification
// happens on the live Host; these cases pin the parameter shapes per rc.3.
import test from 'node:test'
import assert from 'node:assert/strict'
import { projectWriteDenial, taskReadDenial, isProtectedPath, commandWritesProject, PROJECT_DENIAL, TASK_READ_DENIAL } from '../core/write-guard.js'

const CWD = '/demo/ws'

test('V-4 write/edit: file_path protected inside .project, .local and engineering files allowed', () => {
  assert.equal(projectWriteDenial('write', { file_path: '/demo/ws/.project/project.md', content: 'x' }, CWD), PROJECT_DENIAL)
  assert.equal(projectWriteDenial('edit', { file_path: '/demo/ws/.project/requirements/r/issues/i.md' }, CWD), PROJECT_DENIAL)
  assert.equal(projectWriteDenial('write', { file_path: '.project/project.md' }, CWD), PROJECT_DENIAL) // relative to session cwd
  assert.equal(projectWriteDenial('write', { file_path: '/demo/ws/.project/.local/links/s.json' }, CWD), undefined)
  assert.equal(projectWriteDenial('edit', { file_path: '/demo/ws/src/a.js' }, CWD), undefined)
  assert.equal(projectWriteDenial('write', { file_path: '/other/ws/.project/project.md' }, CWD), undefined) // another root
})

test('V-4 apply_patch: every source/target path checked, multi-file patch rejected before execution', () => {
  const clean = '*** Begin Patch\n*** Add File: src/a.js\n+x\n*** Update File: src/b.js\n@@\n-y\n+z\n*** End Patch'
  assert.equal(projectWriteDenial('apply_patch', { input: clean }, CWD), undefined)
  for (const marker of ['*** Add File: .project/x.md', '*** Update File: .project/project.md', '*** Delete File: .project/project.md', '*** Move to: .project/moved.md']) {
    const input = `*** Begin Patch\n*** Add File: src/a.js\n+x\n${marker}\n*** End Patch`
    assert.equal(projectWriteDenial('apply_patch', { input }, CWD), PROJECT_DENIAL, marker)
  }
  // .local targets stay allowed (runtime data)
  assert.equal(projectWriteDenial('apply_patch', { input: '*** Begin Patch\n*** Add File: .project/.local/x.json\n+{}\n*** End Patch' }, CWD), undefined)
})

test('V-4 str_replace_editor: view reads pass, protected create/str_replace/insert rejected', () => {
  assert.equal(projectWriteDenial('str_replace_editor', { command: 'view', path: '.project/project.md' }, CWD), undefined)
  for (const command of ['create', 'str_replace', 'insert']) {
    assert.equal(projectWriteDenial('str_replace_editor', { command, path: '.project/project.md' }, CWD), PROJECT_DENIAL, command)
    assert.equal(projectWriteDenial('str_replace_editor', { command, path: 'src/a.js' }, CWD), undefined, command)
  }
})

test('V-4 bash/pwsh: full command text, explicit .project writes rejected, reads allowed', () => {
  const denied = [
    'echo x > .project/project.md',
    'echo x >> .project/project.md',
    'echo x>.project/project.md',
    'sed -i "s/a/b/" .project/project.md',
    'mv a.txt .project/a.txt',
    'cp a.txt .project/a.txt',
    'rm -rf .project/requirements',
    'git checkout -- .project/project.md',
    'git restore .project',
    'node -e "require(\'fs\').writeFileSync(\'.project/x\',\'1\')"',
    'python3 -c "open(\'.project/x\',\'w\').write(\'1\')"',
    'tee .project/project.md <<< x',
  ]
  for (const command of denied) {
    assert.equal(projectWriteDenial('bash', { command }, CWD), PROJECT_DENIAL, command)
    assert.equal(projectWriteDenial('pwsh', { command }, CWD), PROJECT_DENIAL, `pwsh: ${command}`)
  }
  const allowed = [
    'cat .project/project.md',
    'ls .project/requirements',
    'grep -r status .project',
    'node --test demo.test.mjs',
    'cat .project/project.md > /tmp/out.txt', // read of .project, write elsewhere
    'echo ".project is protected"',
  ]
  for (const command of allowed) {
    assert.equal(projectWriteDenial('bash', { command }, CWD), undefined, command)
  }
})

test('linked-task read guard blocks cross-workspace paths but allows project work', () => {
  assert.equal(taskReadDenial('read', { file_path: '/demo/other/README.md' }, CWD), TASK_READ_DENIAL)
  assert.equal(taskReadDenial('glob', { path: '../other' }, CWD), TASK_READ_DENIAL)
  assert.equal(taskReadDenial('grep', { path: '/demo/ws/src' }, CWD), undefined)
  assert.equal(taskReadDenial('read', { file_path: 'demo.test.mjs' }, CWD), undefined)
  assert.equal(taskReadDenial('bash', { command: 'ls ../.. && ls ../../B/同名验收项目 2>/dev/null || echo "(B 目录不可见或不存在)"' }, CWD), TASK_READ_DENIAL)
  for (const command of ['node --test demo.test.mjs', 'ls src', 'cat demo.mjs', 'cd src && ls ..']) {
    assert.equal(taskReadDenial('bash', { command }, CWD), undefined, command)
  }
  assert.equal(taskReadDenial('bash', { command: 'cat /demo/other/README.md' }, CWD), TASK_READ_DENIAL)
  assert.equal(taskReadDenial('bash', { command: 'cd .. && ls B' }, CWD), TASK_READ_DENIAL)
})

test('V-4 helpers: protection boundary and heuristic limits', () => {
  assert.equal(isProtectedPath('/demo/ws/.project', CWD), true)
  assert.equal(isProtectedPath('/demo/ws/.projectish/a', CWD), false)
  assert.equal(isProtectedPath('/demo/ws/.project/.local', CWD), false)
  assert.equal(isProtectedPath('/demo/ws/.project/.local/x', CWD), false)
  assert.equal(commandWritesProject('node script.js', CWD), false) // heuristic: no .project in text
})