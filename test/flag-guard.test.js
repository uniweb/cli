/**
 * flag-guard — rejecting unrecognized flags on the backend verbs.
 *
 * The risk runs BOTH ways and the tests are weighted accordingly: a missed flag
 * lets a typo through (the old behaviour, no worse), but a wrong rejection breaks
 * an invocation that works today. So most of these assert that real commands still
 * pass, and the flag sets are checked against the parser rather than the help text.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkFlags, VERB_FLAGS } from '../src/utils/flag-guard.js'
import {
  findUnknownFlags,
  didYouMean,
  readOrgFlag
} from '../src/utils/args.js'

// ─── the hazard this exists for ───────────────────────────────────────────────

test('a mistyped --backend is caught, not silently ignored', () => {
  // Untouched, this resolves to the session origin / saved config / uniweb.app —
  // so a command aimed at localhost can publish to production.
  const bad = checkFlags('publish', ['--backed', 'http://localhost:8080'])
  assert.ok(bad, 'must not pass through')
  assert.equal(bad.flag, '--backed')
  assert.equal(bad.suggestion, '--backend')
  assert.match(bad.message, /Did you mean `--backend`\?/)
})

test('a mistyped --token is caught', () => {
  const bad = checkFlags('push', ['--tokne', 'abc'])
  assert.equal(bad.suggestion, '--token')
})

test('the message names the verb and points at its help', () => {
  const bad = checkFlags('pull', ['--nope'])
  assert.match(bad.message, /uniweb pull --help/)
})

// ─── false positives — the expensive failure ──────────────────────────────────

test('a realistic invocation of every guarded verb passes', () => {
  const real = {
    push: ['--as-org', '@acme', '--backend', 'http://localhost:8080', '--force'],
    publish: ['--yes', '--no-validate', '--dry-run', '--token', 'x'],
    pull: ['--merge', '--no-prune', '--content-only'],
    clone: ['abc-uuid', '--path', './site', '--project', 'p'],
    register: ['--scope', '@acme', '-o', 'out.uwx', '--json'],
    status: ['--remote', '--json'],
    refresh: ['--no-git', '--backend', 'http://localhost:8080'],
    sync: ['--no-git', '--force', '--backend', 'http://localhost:8080']
  }
  for (const [verb, args] of Object.entries(real)) {
    assert.equal(checkFlags(verb, args), null, `${verb} rejected a valid call`)
  }
  // The name claims EVERY guarded verb; make it a claim the test can keep. A verb
  // added to VERB_FLAGS without a case here would otherwise pass by absence.
  assert.deepEqual(
    Object.keys(VERB_FLAGS).filter((v) => !(v in real)),
    [],
    'a guarded verb has no realistic-invocation case here'
  )
})

// ─── the delegating verbs ─────────────────────────────────────────────────────

test('a mistyped --backend is caught on refresh, before the delegated pull runs', () => {
  // The hazard this closes: `--backed` never matches `collectPassthrough`, so it is
  // not forwarded — and the delegated `pull --merge` then ran against whatever the
  // origin ladder resolved (the session origin, or https://uniweb.app) while the
  // user believed they had named a backend. Silent, and read-only only by luck.
  const bad = checkFlags('refresh', ['--backed', 'http://localhost:8080'])
  assert.equal(bad.flag, '--backed')
  assert.equal(bad.suggestion, '--backend')
})

test('a mistyped --backend is caught on sync, before EITHER half runs', () => {
  const bad = checkFlags('sync', ['--backed', 'http://localhost:8080'])
  assert.equal(bad.flag, '--backed')
  assert.equal(bad.suggestion, '--backend')
})

test('sync accepts what only ONE of its halves accepts', () => {
  // The composite's real risk is the opposite of a missed typo: each half's set is
  // a strict subset of sync's, so a guard applied per-half rejects a documented
  // invocation. Both of these are in sync.js's usage block.
  assert.equal(checkFlags('sync', ['--no-git']), null) // refresh's
  assert.equal(checkFlags('sync', ['--force']), null) // push's
  assert.equal(checkFlags('sync', ['--all']), null) // push's
})

test('refresh REJECTS pull-only flags it cannot forward', () => {
  // refresh constructs the delegated argv itself — `pull --merge` plus exactly
  // three passthroughs — so pull's own flags are unreachable from a refresh argv.
  // `--force` matters most: refresh is read-only by design, and to pull the word
  // means "discard my local work". Accepting it would imply a capability it has
  // never had. (`uniweb sync --force` is unaffected — see the union test.)
  assert.equal(checkFlags('refresh', ['--force']).flag, '--force')
  assert.equal(checkFlags('refresh', ['--merge']).flag, '--merge')
  assert.equal(checkFlags('refresh', ['--no-delete']).flag, '--no-delete')
})

test('flags consumed by HELPERS are accepted — the trap this nearly hit', () => {
  // `--no-validate` is read in utils/conformance.js and `--yes` in
  // backend/foundation-bring-along.js; neither appears in publish.js. Grepping the
  // command's own source would have produced a list that breaks both.
  assert.equal(checkFlags('publish', ['--no-validate']), null)
  assert.equal(checkFlags('publish', ['--yes']), null)
  assert.equal(checkFlags('push', ['--no-validate']), null)
})

test('globals are accepted everywhere', () => {
  for (const verb of Object.keys(VERB_FLAGS)) {
    assert.equal(checkFlags(verb, ['--non-interactive']), null, verb)
    assert.equal(checkFlags(verb, ['--help']), null, verb)
  }
})

test('positionals, values, and `--` are not mistaken for flags', () => {
  assert.equal(checkFlags('clone', ['0198f2-uuid']), null)
  // A value that merely contains dashes is a value.
  assert.equal(checkFlags('push', ['--as-org', '@a-b-c']), null)
  // POSIX end-of-flags: nothing after it is scanned.
  assert.equal(checkFlags('push', ['--', '--whatever']), null)
  // A lone `-` is a value (stdin), not a flag.
  assert.equal(checkFlags('push', ['-']), null)
})

test('--flag=value is checked on the name half', () => {
  assert.equal(checkFlags('push', ['--as-org=@acme']), null)
  assert.equal(checkFlags('push', ['--as-orgs=@acme']).flag, '--as-orgs')
})

test('an unguarded verb is left alone', () => {
  assert.equal(checkFlags('dev', ['--anything']), null)
})

// ─── the alias ────────────────────────────────────────────────────────────────

test('--org is accepted and means --as-org', () => {
  assert.equal(checkFlags('publish', ['--org', '@acme']), null)
  assert.equal(readOrgFlag(['--org', '@acme']), '@acme')
  assert.equal(readOrgFlag(['--as-org', '@acme']), '@acme')
  assert.equal(readOrgFlag([]), undefined)
})

test('a valueless --org falls through rather than shadowing --as-org', () => {
  assert.equal(readOrgFlag(['--org', '--as-org', '@acme']), '@acme')
})

// ─── the primitives ───────────────────────────────────────────────────────────

test('findUnknownFlags dedupes and preserves order', () => {
  assert.deepEqual(findUnknownFlags(['--b', '--a', '--b'], []), ['--b', '--a'])
})

test('didYouMean suggests a near miss and declines a far one', () => {
  assert.equal(didYouMean('--as-orgs', ['--as-org', '--backend']), '--as-org')
  assert.equal(didYouMean('--zzzzzzzz', ['--backend', '--token']), null)
})

test('a distant typo gets NO suggestion, and that is deliberate', () => {
  // Nothing in pull's set is within the length-scaled threshold of this, so no
  // suggestion is offered. A confident wrong suggestion sends the user to fix the
  // wrong thing; the message still names the verb's --help, so nobody is stranded.
  const bad = checkFlags('pull', ['--frobnicate'])
  assert.equal(bad.suggestion, null)
  assert.doesNotMatch(bad.message, /Did you mean/)
  assert.match(bad.message, /--help/)
})

test('a near miss of a newly-inherited flag is still suggested', () => {
  // `--org` reaches pull through the owner resolver, so `--orgz` resolves to it.
  assert.equal(checkFlags('pull', ['--orgz']).suggestion, '--org')
})
