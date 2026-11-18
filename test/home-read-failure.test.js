import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { initProject } from '../core/store.js'
import { dispatch } from '../core/rpc.js'
import { homeSummaryIncomplete } from '../client-src/shell/nav-state.js'
import { makeRoot } from './util.js'

test('home marks partial reads incomplete until the missing requirement is repaired', async t => {
  const root = await makeRoot(t)
  await initProject(root)
  const summary = async () => {
    const response = await dispatch('home/summary', { root }, new AbortController().signal)
    assert.equal(response.ok, true)
    return response.data
  }
  assert.equal(homeSummaryIncomplete(await summary()), false)

  // The directory exists, but its requirement cannot be read. The backend can
  // still return the remaining project; its apparent zero counts are partial.
  const broken = join(root, '.project', 'requirements', 'req-20261116-000001')
  await mkdir(broken)
  const incomplete = await summary()
  assert.ok(incomplete.diagnostics.some(d => d.code === 'READ_FAILED'))
  assert.equal(incomplete.counts.reviewing, 0)
  assert.equal(homeSummaryIncomplete(incomplete), true)

  // After repair, retry makes the actual empty-project totals usable again.
  await rm(broken, { recursive: true })
  assert.equal(homeSummaryIncomplete(await summary()), false)
  assert.equal(homeSummaryIncomplete({ diagnostics: [{ code: 'BAD_TIMESTAMP' }] }), false)
  // A later request failure also makes previously loaded counts stale. Keep
  // their reminders available, but do not show those counts as current.
  assert.equal(homeSummaryIncomplete(await summary(), { code: 'READ_FAILED' }), true)
})
