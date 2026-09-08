/**
 * The services-request declaration gate.
 *
 * `$services` / `$secrets` ride inside the site-content document, so every push
 * re-sends them — and the backend REPLACES what it is sent, anchoring each row by
 * its natural key. So a re-send overwrites the stored request, which in the consent
 * workflow is a decision the owner made in the app. Under "the file is a request",
 * an unchanged block is not asking for anything, and this gate is what stops the
 * CLI asking on the owner's behalf.
 *
 * ⭐ The tests that matter most are the two DIRECTIONS OF FAILURE, because both are
 * silent in production: withholding a real request loses an owner's edit with
 * nothing said, and declaring an unchanged one overwrites a decision with nothing
 * said. Every case below is one or the other.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  fingerprintDeclaration,
  fingerprintRequest,
  decideDeclaration
} from '../src/backend/service-request.js'

const API_PRO = [{ name: 'api', enabled: true, config: { grade: 'pro' } }]

test('absent and empty are different fingerprints — the distinction is destructive', () => {
  // Absent means "I am not telling you about this"; [] is an explicit clear. If
  // these ever collapse, a project that never declared the key would read as
  // asking to wipe every stored row.
  assert.equal(fingerprintDeclaration(undefined), null)
  assert.equal(fingerprintDeclaration(null), null)
  assert.notEqual(fingerprintDeclaration([]), null)
  assert.notEqual(fingerprintDeclaration([]), fingerprintDeclaration(API_PRO))
})

test('a changed value changes the fingerprint', () => {
  const pro = fingerprintDeclaration(API_PRO)
  const starter = fingerprintDeclaration([
    { name: 'api', enabled: true, config: { grade: 'starter' } }
  ])
  const off = fingerprintDeclaration([
    { name: 'api', enabled: false, config: { grade: 'pro' } }
  ])
  assert.notEqual(pro, starter)
  assert.notEqual(pro, off, 'flipping enabled must be a change — it moves money')
})

test('reordering rows or keys is NOT a change', () => {
  // Moving a line in a YAML file is not a request. If this failed, every
  // reformat would re-send the block and overwrite the stored request.
  const a = fingerprintDeclaration([
    { name: 'api', enabled: true },
    { name: 'search', enabled: false }
  ])
  const b = fingerprintDeclaration([
    { name: 'search', enabled: false },
    { enabled: true, name: 'api' }
  ])
  assert.equal(a, b)
})

test('nested key order does not change the fingerprint either', () => {
  const a = fingerprintDeclaration([{ name: 'api', config: { grade: 'pro', tier: 2 } }])
  const b = fingerprintDeclaration([{ name: 'api', config: { tier: 2, grade: 'pro' } }])
  assert.equal(a, b)
})

test('fingerprintRequest omits keys for undeclared blocks', () => {
  assert.deepEqual(fingerprintRequest({}), {})
  const only = fingerprintRequest({ $services: API_PRO })
  assert.ok(only.servicesRequest)
  assert.ok(!('secretsRequest' in only), 'an undeclared block leaves no trace')
})

// ── the gate ────────────────────────────────────────────────────────────────

test('unchanged since the last publish → do NOT declare', () => {
  // The headline case: owner publishes, hits a 402, changes their mind in the app,
  // then publishes again without touching the file. The CLI must not re-assert.
  const siteYml = { $services: API_PRO }
  const prior = fingerprintRequest(siteYml)
  const d = decideDeclaration(siteYml, prior)
  assert.equal(d.declare, false)
  assert.equal(d.reason, 'unchanged')
})

test('edited since the last publish → declare', () => {
  const prior = fingerprintRequest({ $services: API_PRO })
  const d = decideDeclaration(
    { $services: [{ name: 'api', enabled: true, config: { grade: 'starter' } }] },
    prior
  )
  assert.equal(d.declare, true)
  assert.equal(d.reason, 'changed')
})

test('⛔ no record → DECLARE, because the other failure is silent', () => {
  // A fresh clone, a never-published project, or autoSave: off. Withholding here
  // would drop a real request with nothing said; declaring writes back what is
  // usually already there. Between two silent failures, take the recoverable one.
  const d = decideDeclaration({ $services: API_PRO }, null)
  assert.equal(d.declare, true)
  assert.equal(d.reason, 'no-record')
})

test('a record that predates this gate → declare', () => {
  // deploy.yml written by an older CLI has no fingerprints. That is "no record"
  // for our purposes, not "unchanged" — it must not read as a match.
  const d = decideDeclaration({ $services: API_PRO }, { at: '2026-01-01', host: 'uniweb' })
  assert.equal(d.declare, true)
  assert.equal(d.reason, 'changed')
})

test('file declares nothing → the gate is moot and says so', () => {
  const d = decideDeclaration({ name: 'site' }, { servicesRequest: 'abc' })
  assert.equal(d.declare, true)
  assert.equal(d.reason, 'undeclared', 'not "unchanged" — no comparison happened')
})

test('an explicit clear is a request, and stays one until it is sent', () => {
  // `$services: []` means "drop every stored row". It must declare the first time…
  const first = decideDeclaration({ $services: [] }, null)
  assert.equal(first.declare, true)
  // …and must NOT be re-sent on every later publish.
  const banked = fingerprintRequest({ $services: [] })
  const second = decideDeclaration({ $services: [] }, banked)
  assert.equal(second.declare, false)
})

test('secrets move the gate independently of services', () => {
  const prior = fingerprintRequest({ $services: API_PRO, $secrets: [{ name: 'k' }] })
  const d = decideDeclaration(
    { $services: API_PRO, $secrets: [{ name: 'k', service: 'api' }] },
    prior
  )
  assert.equal(d.declare, true, 'a secrets-only edit must still be sent')
})

test('⛔ the fingerprint leaks no value — it is a hash, and deploy.yml is committed', () => {
  const fp = fingerprintDeclaration([
    { name: 'k', service: 'api', value: 'super-secret-token' }
  ])
  assert.match(fp, /^[0-9a-f]{16}$/)
  assert.ok(!fp.includes('secret'))
  assert.ok(!JSON.stringify(fingerprintRequest({ $secrets: [{ value: 'tok' }] })).includes('tok'))
})
