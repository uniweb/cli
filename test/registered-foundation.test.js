/**
 * The registered foundation a clone keeps — read once through the site, kept under `.uniweb/`.
 *
 * A site whose foundation is a catalog ref has no build of it in the project; the section types'
 * `data:` of its registered version are what type a query named for a data key. The CLI reads the
 * version from the backend and keeps it, and the build, the push and the pull read the kept copy.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRegisteredFoundation } from '@uniweb/build/uwx'
import { ensureRegisteredFoundation } from '../src/backend/site-sync.js'

const REF = '@acme/fnd@1.0.0'
const REPLY = { schema: { _self: {}, Team: { data: { team: '@acme/member' } } }, module_url: 'https://cdn.test/entry.js' }

const clientAnswering = (reply) => {
  const client = { origin: 'http://backend.test', asked: [] }
  client.readRegisteredFoundation = async (site, ref) => {
    client.asked.push([site, ref])
    return reply
  }
  return client
}

test('reads the version through the site once, and keeps it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'registered-fnd-'))
  try {
    const client = clientAnswering(REPLY)
    assert.deepEqual(await ensureRegisteredFoundation({ client, siteDir: dir, siteUuid: 'SITE', ref: REF }), REPLY)
    assert.deepEqual(client.asked, [['SITE', REF]])
    assert.deepEqual(readRegisteredFoundation(dir, REF), REPLY)
    // A registered version never changes: a kept copy is not read again.
    await ensureRegisteredFoundation({ client, siteDir: dir, siteUuid: 'SITE', ref: REF })
    assert.equal(client.asked.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CONTROL — a local foundation, an unknown site or a failed read keeps nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'registered-fnd-'))
  try {
    const client = clientAnswering(REPLY)
    assert.equal(await ensureRegisteredFoundation({ client, siteDir: dir, siteUuid: 'SITE', ref: 'src' }), null)
    assert.equal(await ensureRegisteredFoundation({ client, siteDir: dir, siteUuid: null, ref: REF }), null)
    assert.equal(client.asked.length, 0)
    assert.equal(await ensureRegisteredFoundation({ client: clientAnswering(null), siteDir: dir, siteUuid: 'SITE', ref: REF }), null)
    assert.equal(existsSync(join(dir, '.uniweb')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
