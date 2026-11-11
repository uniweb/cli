/**
 * ⭐ A CHANGED `blueprint.yml` NEVER REACHES A BACKEND ALREADY STARTED FROM THE SITE, and the CLI says
 * so (`src/backend/blueprint-reach.js`): by one rule, read off the site's status.
 *
 *   - no `backend_state` key: a backend older than the field, which says nothing — nothing is said,
 *     and it is never read as `null`;
 *   - `null`: the file is how the site's next backend begins — nothing is said;
 *   - any other value, one a backend names later included: a backend was started, and a change to
 *     the file doesn't reach it — said, without promising that the file founds another.
 *
 * "Changed" is what a push sends against what the site held before it, compared as a pull compares
 * them: keys in any order.
 *
 * Run: `node --test test/blueprint-reach.test.js`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp } from './helpers/run-verb.js'
import { backendStarted, sendsBlueprint, sentBlueprintNote, blueprintCheck } from '../src/backend/blueprint-reach.js'

const BLUEPRINT = { signup: 'invite_only', access: { '@acme/track': { all: { members: 'read' } }, '@acme/attendance': { add: 'open' } } }
const rows = (blueprint) => [{ name: 'google', config: { id: 'G-1' } }, { name: 'backend', config: { grade: 'small', ...(blueprint ? { blueprint } : {}) } }]
const statusOf = (backend_state, held = BLUEPRINT) => ({ published: true, services: rows(held), backend_state })
const CHANGED = { ...BLUEPRINT, signup: 'open' }
const STARTED = /^blueprint\.yml is how a backend started from this site begins, and this site's backend has started: /

test('the rule: no key says nothing, `null` is not started, any other value is', () => {
  assert.equal(backendStarted(null), null, 'no status read')
  assert.equal(backendStarted({ published: true }), null, 'a backend older than the field')
  assert.equal(backendStarted({ backend_state: null }), false)
  for (const state of ['requested', 'provisioning', 'active', 'failed', 'suspended', 'decommissioning', 'deleted']) {
    assert.equal(backendStarted({ backend_state: state }), true, state)
  }
  assert.equal(backendStarted({ backend_state: 'hibernating' }), true, 'a state a backend names later reads as started')
})

test('⭐ a push that sends a changed blueprint to a site whose backend has started says so', () => {
  const lines = sentBlueprintNote({ status: statusOf('active'), sent: rows(CHANGED) })
  assert.ok(lines, 'said')
  assert.match(lines[0], STARTED)
  assert.match(lines[0], /the change just sent doesn't reach it\.$/)
  assert.match(lines[1], /the site's owner changes in the backend's administration/)
})

test('CONTROL — the same push to a site whose backend has not started says nothing: the file is how it will begin', () => {
  assert.equal(sentBlueprintNote({ status: statusOf(null), sent: rows(CHANGED) }), null)
})

test('⛔ a status with no `backend_state` is never read as `null` — and says nothing either way', () => {
  const { backend_state, ...older } = statusOf('active')
  assert.equal(sentBlueprintNote({ status: older, sent: rows(CHANGED) }), null)
  assert.equal(sentBlueprintNote({ status: null, sent: rows(CHANGED) }), null, 'no status read at all')
})

test('a blueprint the site already holds is no change, whatever order its keys come back in', () => {
  // Measured 2026-11-10 on a local backend: the stored blueprint came back `access` first.
  const reordered = Object.fromEntries(Object.entries(BLUEPRINT).reverse())
  assert.notDeepEqual(Object.keys(reordered), Object.keys(BLUEPRINT), 'CONTROL — the order differs')
  assert.equal(sentBlueprintNote({ status: statusOf('active', reordered), sent: rows(BLUEPRINT) }), null)
})

test('a blueprint sent to a started backend whose site held none is a change too', () => {
  assert.ok(sentBlueprintNote({ status: statusOf('active', null), sent: rows(BLUEPRINT) }))
})

test('a push that sends no blueprint, or no site content, says nothing', () => {
  assert.equal(sendsBlueprint(rows(null)), false)
  assert.equal(sendsBlueprint(null), false)
  assert.equal(sendsBlueprint([{ name: 'backend' }]), false)
  assert.equal(sendsBlueprint(rows(BLUEPRINT)), true)
  assert.equal(sentBlueprintNote({ status: statusOf('active'), sent: rows(null) }), null)
  assert.equal(sentBlueprintNote({ status: statusOf('active'), sent: null }), null)
})

test('⛔ a destroyed backend: the same sentence, and no promise that the file founds another', () => {
  // A publish starts a backend only where the state reads `null`, so one that was destroyed is not
  // started again by it.
  for (const state of ['decommissioning', 'deleted', 'hibernating']) {
    const lines = sentBlueprintNote({ status: statusOf(state), sent: rows(CHANGED) })
    assert.match(lines[0], STARTED, state)
    assert.doesNotMatch(lines.join(' '), /\bnext\b|\bnew backend\b|\bwill\b|publish again|founds?\b|\bonce it runs\b/i, state)
  }
})

/** A site with `blueprint.yml`, on a URL foundation (no scope: an `@/x` would go as written). */
function siteWith(blueprintYml) {
  const dir = join(tmp('uw-blueprint-reach-'), 'site')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'site.yml'), "name: T\nfoundation: 'https://example.test/foundation/entry.js'\nservices:\n  backend: true\n")
  if (blueprintYml !== null) writeFileSync(join(dir, 'blueprint.yml'), blueprintYml)
  return dir
}
const FILE = "signup: invite_only\naccess:\n  '@acme/track': { all: { members: read } }\n  '@acme/attendance': { add: open }\n"

test('⭐ status: a file the site holds, behind a started backend — said, as a fact', async () => {
  const check = await blueprintCheck({ siteDir: siteWith(FILE), status: statusOf('active') })
  assert.equal(check.id, 'hosting.blueprint')
  assert.equal(check.state, 'ok')
  assert.match(check.summary, STARTED)
  assert.match(check.summary, /a change to the file doesn't reach it\.$/)
  assert.deepEqual(check.detail, { backend_state: 'active', differs: false })
})

test('⭐ status: a file that says something else than the site holds — attention, and where it is changed instead', async () => {
  const check = await blueprintCheck({ siteDir: siteWith(FILE.replace('invite_only', 'open')), status: statusOf('provisioning') })
  assert.equal(check.state, 'attention')
  assert.match(check.summary, STARTED)
  assert.match(check.summary, /the file here differs from what the site holds, and a push of it doesn't reach that backend\.$/)
  assert.match(check.lines[0], /the site's owner changes in the backend's administration/)
  assert.deepEqual(check.detail, { backend_state: 'provisioning', differs: true })
})

test('status says nothing with no file, no started backend, a backend that does not say, or a file a push would refuse', async () => {
  assert.equal(await blueprintCheck({ siteDir: siteWith(null), status: statusOf('active') }), null, 'no file')
  assert.equal(await blueprintCheck({ siteDir: siteWith(FILE), status: statusOf(null) }), null, 'not started')
  const { backend_state, ...older } = statusOf('active')
  assert.equal(await blueprintCheck({ siteDir: siteWith(FILE), status: older }), null, 'no key')
  assert.equal(await blueprintCheck({ siteDir: siteWith(FILE), status: null }), null, 'no status')
  assert.equal(await blueprintCheck({ siteDir: siteWith("access:\n  @/x: {}\n"), status: statusOf('active') }), null, 'unreadable')
})
