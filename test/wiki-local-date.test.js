import assert from 'node:assert/strict'
import test from 'node:test'
import { wikiLocalDate } from '../client-src/pages/wiki-source.js'

test('wiki completion date follows the local day across UTC boundaries', () => {
  const original = process.env.TZ
  try {
    process.env.TZ = 'Asia/Shanghai'
    assert.equal(wikiLocalDate('2026-11-16T17:13:00.000Z'), '2026-11-17')
    process.env.TZ = 'America/Los_Angeles'
    assert.equal(wikiLocalDate('2026-11-17T02:00:00.000Z'), '2026-11-16')
    // A date without a time or timezone is already a calendar date.
    assert.equal(wikiLocalDate('2026-11-17'), '2026-11-17')
    assert.equal(wikiLocalDate('2026-02-30'), '')
    assert.equal(wikiLocalDate('invalid'), '')
    assert.equal(wikiLocalDate({ updatedAt: '2026-11-17' }), '')
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
})
