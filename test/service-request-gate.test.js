/**
 * The requests a push or publish carries — the services `site.yml` asks for, and the
 * language selection.
 *
 * The services are stated by the producer (`statedServices`, tested in
 * `@uniweb/build`) and decided per service by the backend; all this step does for them
 * is say what the file asks that will not be sent as written (`announceServices`).
 * ⛔ Until 2026-10-07 this file ran the CLI's own per-service check (`settleServices`),
 * row by row of kb/framework/reference/site-services-request.md §4.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fingerprintDeclaration,
  reconcile,
  bankLanguages,
  announceServices,
  recordsNotAsked
} from '../src/backend/service-request.js'
import { unreadableServices } from '@uniweb/build/uwx'

// ── fingerprints and the language selection ────────────────────────────────

test('absent and empty are different fingerprints', () => {
  assert.equal(fingerprintDeclaration(undefined), null)
  assert.equal(fingerprintDeclaration(null), null)
  assert.notEqual(fingerprintDeclaration([]), null)
  assert.notEqual(fingerprintDeclaration([]), fingerprintDeclaration(['en']))
})

test('reordering entries or keys is not a change', () => {
  assert.equal(fingerprintDeclaration(['en', 'fr']), fingerprintDeclaration(['fr', 'en']))
  assert.equal(
    fingerprintDeclaration([{ a: 1, b: { c: 2, d: 3 } }]),
    fingerprintDeclaration([{ b: { d: 3, c: 2 }, a: 1 }])
  )
})

test('⛔ the fingerprint leaks no value — it is a hash, and deploy.yml is committed', () => {
  const fp = fingerprintDeclaration(['super-secret-token'])
  assert.match(fp, /^[0-9a-f]{16}$/)
  assert.ok(!fp.includes('secret'))
})

test('publishLanguages is banked, so a later edit reads as intentional', () => {
  const banked = bankLanguages({ publishLanguages: ['en', 'fr'] })
  assert.ok(banked.publishLanguagesRequest, 'the selection must be banked at all')
  assert.equal(reconcile(['en', 'fr'], ['en', 'fr'], banked.publishLanguagesRequest).action, 'none')
  // The owner adds one → a real ask, and this one moves the price.
  assert.equal(reconcile(['en', 'fr', 'es'], ['en', 'fr'], banked.publishLanguagesRequest).action, 'send')
  // CONTROL — with no base the same edit cannot be told from the status quo.
  assert.equal(reconcile(['en', 'fr', 'es'], ['en', 'fr'], undefined).action, 'conflict')
})

test('the site moved and the file did not → adopt, not send', () => {
  const banked = bankLanguages({ publishLanguages: ['en', 'fr'] })
  assert.equal(reconcile(['en', 'fr'], ['en'], banked.publishLanguagesRequest).action, 'adopt')
})

test('a file that declares no selection asks nothing — never a conflict', () => {
  assert.equal(reconcile(undefined, [], null).action, 'none')
  assert.equal(reconcile(undefined, ['en'], null).action, 'adopt')
  assert.deepEqual(bankLanguages({}), {})
})

// ── the services ────────────────────────────────────────────────────────────

const announce = (services, supports = null) => {
  const said = []
  announceServices({ siteYml: { name: 'Acme', services }, say: { warn: (m) => said.push(m) }, supports })
  return said.join('\n')
}

test('a file that asks nothing says nothing', () => {
  assert.equal(announce(undefined), '')
  assert.equal(announce({ search: true, backend: { grade: 'pro' } }), '')
})

test('⛔ a value it cannot read is left to the package build, which stops on it — nothing is said first', () => {
  // What this step would say, read past such an entry, is wrong: `search: yes` was an address,
  // and "site.yml turns on `search`" was said while the host's search was asked off (F14).
  assert.equal(announce({ search: 'yes' }, []), '')
  assert.equal(announce({ submit: 3, search: true }, ['search', 'submit']), '')
  assert.match(unreadableServices({ submit: 3 })[0], /`services\.submit` is true, false, an address, or a map/)
  // ⛔ A renamed service is one of them: `api` is the `backend` service since 2026-10-07.
  assert.equal(announce({ api: true }, ['backend']), '')
  assert.match(unreadableServices({ api: true })[0], /`services\.api` is now `services\.backend`/)
})

test("⭐ a `backend` address is said: it asks the host to leave its own off", () => {
  assert.match(announce({ backend: 'https://own.example' }), /asks your host to leave its own `backend` off/)
})

test('⛔ a credential is said — it is never sent', () => {
  assert.match(announce({ assistant: { apiKey: 'sk-1' } }), /a credential is never sent/)
})

// ── the foundation informs, never decides ───────────────────────────────────

test("a foundation that declares nothing says nothing — absent is unknown, not none", () => {
  assert.equal(announce({ search: true }, null), '')
})

test('a service the file turns on that the foundation does not render is said', () => {
  assert.match(announce({ search: true, submit: 'https://forms.example' }, []), /turns on `search`, `submit`, which your foundation does not say it renders/)
})

test('⭐ a service the foundation renders that the file does not mention is said — off by default', () => {
  assert.match(announce({}, ['search', 'backend']), /Your foundation renders `search`, `backend`, which site\.yml does not ask for/)
  // An explicit `false` is a decision: nothing to say.
  assert.equal(announce({ search: false, backend: false }, ['search', 'backend']), '')
})

test('`tracking` and `records` are in neither warning', () => {
  assert.equal(announce({ tracking: true }, ['records']), '')
})

test('⭐ publish says when the pages show records and `records` is not asked for', () => {
  assert.match(recordsNotAsked({ siteYml: {}, shown: ['articles'] }), /show records from `articles`.*`records: true`/)
  assert.match(recordsNotAsked({ siteYml: { services: { records: false } }, shown: ['articles'] }), /records/)
  assert.equal(recordsNotAsked({ siteYml: { services: { records: true } }, shown: ['articles'] }), null)
  // No page shows a record with a schema — schema-less sets ship as files: nothing to say.
  assert.equal(recordsNotAsked({ siteYml: {}, shown: [] }), null)
})
