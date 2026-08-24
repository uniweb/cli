/**
 * site-identity — the project's SYNC SCOPE (`site.yml::$backend`) and the guard that
 * refuses to act on a site whose stored identity was minted by a different backend.
 *
 * The guard is the whole reason `$backend` exists, so these tests are mostly about its
 * edges rather than about reading a scalar: an unsynced project must NOT be blocked (a
 * first push is exactly what should happen next), an absent value must read as the
 * default, and the one known false positive must print its own correction.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readSiteIdentity,
  resolveSiteScope,
  recordSiteBackend,
  assertSiteBackendScope,
  normalizeOrigin
} from '../src/utils/site-identity.js'
import { DEFAULT_BACKEND_ORIGIN } from '../src/utils/config.js'

const LOCAL = 'http://localhost:8080'
const dirs = []

function tmpSite(siteYml = 'name: demo\nfoundation: "@acme/f"\n') {
  const d = mkdtempSync(join(tmpdir(), 'uw-identity-'))
  dirs.push(d)
  writeFileSync(join(d, 'site.yml'), siteYml)
  return d
}

test.after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

// ── reading ──────────────────────────────────────────────────────────────────────

test('reads the identity trio, and reports each field independently absent', () => {
  const full = tmpSite('$uuid: U-1\n$org: acme\n$backend: http://localhost:8080\nname: demo\n')
  assert.deepEqual(readSiteIdentity(full), {
    uuid: 'U-1',
    org: 'acme',
    backend: LOCAL
  })

  // Every field is independently optional: unsynced, personally owned, on the default.
  assert.deepEqual(readSiteIdentity(tmpSite()), {
    uuid: null,
    org: null,
    backend: null
  })
})

test('a missing or malformed site.yml reads as nothing recorded, never a throw', () => {
  const gone = mkdtempSync(join(tmpdir(), 'uw-identity-'))
  dirs.push(gone)
  assert.deepEqual(readSiteIdentity(gone), {
    uuid: null,
    org: null,
    backend: null
  })

  // Every caller here is a guard or a default. A malformed site.yml has its own, better
  // error elsewhere; dying inside the guard would replace it with a worse one.
  const junk = tmpSite('name: [unclosed\n')
  assert.deepEqual(readSiteIdentity(junk).uuid, null)
})

test('an absent $backend resolves to the default backend', () => {
  assert.equal(resolveSiteScope(tmpSite()), DEFAULT_BACKEND_ORIGIN)
  assert.equal(resolveSiteScope(tmpSite('$backend: http://localhost:8080\n')), LOCAL)
})

test('a bare URL survives the YAML round trip unquoted, including host:port', () => {
  // `$org` is stored bare precisely because a leading `@` is a reserved YAML indicator.
  // A URL lands on the safe side of the same hazard — its `:` is always followed by `/`
  // or a digit, never a space — but only a test keeps that true.
  for (const origin of [LOCAL, 'https://uniweb.app', 'https://a.b.c:9443']) {
    assert.equal(readSiteIdentity(tmpSite(`$backend: ${origin}\n`)).backend, origin)
  }
})

// ── writing ──────────────────────────────────────────────────────────────────────

test('records a non-default backend and leaves the rest of site.yml alone', async () => {
  const d = tmpSite('# keep me\nname: demo\nfoundation: "@acme/f"\n')
  assert.equal(await recordSiteBackend(d, LOCAL), LOCAL)

  const text = readFileSync(join(d, 'site.yml'), 'utf8')
  assert.match(text, /^\$backend: http:\/\/localhost:8080$/m)
  assert.match(text, /# keep me/) // comments survive — upsert, not a yaml.dump rewrite
  assert.match(text, /foundation: "@acme\/f"/)
  assert.equal(readSiteIdentity(d).backend, LOCAL)
})

test('writes NOTHING for the default backend — the 98% case keeps a clean site.yml', async () => {
  const d = tmpSite()
  const before = readFileSync(join(d, 'site.yml'), 'utf8')
  assert.equal(await recordSiteBackend(d, DEFAULT_BACKEND_ORIGIN), null)
  assert.equal(readFileSync(join(d, 'site.yml'), 'utf8'), before)
})

test('re-recording the same backend does not touch the file', async () => {
  // A push that rewrites site.yml with an identical value dirties `git status` for no
  // reason, and trains people to stop reading that diff.
  const d = tmpSite()
  await recordSiteBackend(d, LOCAL)
  const after = readFileSync(join(d, 'site.yml'), 'utf8')
  assert.equal(await recordSiteBackend(d, LOCAL), null)
  assert.equal(readFileSync(join(d, 'site.yml'), 'utf8'), after)
})

test('an unparseable origin records nothing rather than a broken scalar', async () => {
  const d = tmpSite()
  assert.equal(await recordSiteBackend(d, 'not-a-url'), null)
  assert.equal(readSiteIdentity(d).backend, null)
  assert.equal(normalizeOrigin('not-a-url'), null)
})

// ── the guard ────────────────────────────────────────────────────────────────────

test('does NOT block an unsynced project — a first push is what should happen next', () => {
  // No `$uuid` means nothing is stored, so nothing can be foreign. Checking here would
  // reject the first push of every new site.
  const d = tmpSite('$backend: http://localhost:8080\nname: demo\n')
  assert.equal(assertSiteBackendScope(d, 'https://elsewhere.example').ok, true)
})

test('passes when the recorded backend matches, and when both are the default', () => {
  const bound = tmpSite('$uuid: U-1\n$backend: http://localhost:8080\n')
  assert.equal(assertSiteBackendScope(bound, LOCAL).ok, true)
  // Trailing slashes and full endpoint URLs reduce to the same origin.
  assert.equal(assertSiteBackendScope(bound, 'http://localhost:8080/dev/site').ok, true)

  const onDefault = tmpSite('$uuid: U-1\n')
  assert.equal(assertSiteBackendScope(onDefault, DEFAULT_BACKEND_ORIGIN).ok, true)
})

test('STOPS a synced project pointed at a different backend, naming both ends', () => {
  const d = tmpSite('$uuid: U-1\n$backend: http://localhost:8080\n')
  const r = assertSiteBackendScope(d, 'https://elsewhere.example')
  assert.equal(r.ok, false)
  assert.match(r.message, /http:\/\/localhost:8080/)
  assert.match(r.message, /https:\/\/elsewhere\.example/)

  const hint = r.hint.join('\n')
  // The remedy must lead with the reversible one. Moving the project is destructive and
  // is offered second, exactly as in the 404 branch.
  assert.match(hint, /uniweb login --backend http:\/\/localhost:8080/)
  assert.ok(
    hint.indexOf('uniweb login') < hint.indexOf('clear $uuid'),
    `the reversible remedy must come first:\n${hint}`
  )
})

test('an absent $backend is treated as the default — and says how to correct that', () => {
  // The one known false positive: a project synced to a non-default backend BEFORE
  // `$backend` existed records no scope, so it reads as "default" and gets stopped.
  // Tolerated only because the message carries the one-line fix; assert that it does.
  const legacy = tmpSite('$uuid: U-1\nname: demo\n')
  const r = assertSiteBackendScope(legacy, LOCAL)
  assert.equal(r.ok, false)
  assert.match(r.message, new RegExp(DEFAULT_BACKEND_ORIGIN.replace(/[.]/g, '\\.')))
  assert.match(r.hint.join('\n'), /add\s+\$backend: http:\/\/localhost:8080/)
})

test('a project WITH a recorded backend does not get the correction hint', () => {
  // That hint only makes sense when nothing was recorded. Offering it to a project that
  // already declared its scope would read as "overwrite what you declared".
  const d = tmpSite('$uuid: U-1\n$backend: http://localhost:8080\n')
  const hint = assertSiteBackendScope(d, 'https://elsewhere.example').hint.join('\n')
  assert.doesNotMatch(hint, /add\s+\$backend/)
})
