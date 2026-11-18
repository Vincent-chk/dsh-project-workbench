import assert from 'node:assert/strict'
import test from 'node:test'
import { loadOpenWikiSkill } from '../core/skill.js'

test('embedded OpenWiki skill strips frontmatter and stays model-only', async () => {
  const skill = await loadOpenWikiSkill()
  assert.equal(skill.name, 'openwiki')
  assert.equal(skill.provider, 'project-workbench')
  assert.equal(skill.invocation.modelInvocable, true)
  assert.equal(skill.invocation.userInvocable, false)
  assert.match(skill.content, /^# OpenWiki/)
  assert.doesNotMatch(skill.content, /^---/)
  assert.match(skill.content, /openwiki_begin/)
  assert.match(skill.content, /openwiki_finish/)
})
