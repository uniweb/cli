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

test('⛔ `--backend` is refused on the backend verbs — saying where the backend comes from', () => {
  // Retired 2026-09-21: every backend verb goes to the backend you are logged in to.
  // Refused rather than ignored — ignored, the command would run against wherever you
  // happen to be logged in while you believed you had named another backend.
  for (const verb of ['push', 'publish', 'pull', 'clone', 'register', 'status', 'refresh', 'sync']) {
    const bad = checkFlags(verb, ['--backend', 'http://localhost:8080'])
    assert.equal(bad?.flag, '--backend', verb)
    assert.match(bad.message, /backend you are logged in to/, verb)
    assert.match(bad.message, /uniweb login --backend <url>/, verb)
  }
  assert.equal(checkFlags('push', ['--backend=http://x'])?.flag, '--backend', 'the = form too')
  assert.equal(checkFlags('forget', ['--backend', 'http://localhost:8080']), null, 'forget SELECTS with it')
})

test('⛔ `--token` is refused on the backend verbs — saying how to sign in instead', () => {
  // Retired 2026-09-21 with `--backend`: a per-command bearer carried no backend, so it
  // went wherever the login pointed. `uniweb login --token` ties a token to its backend.
  for (const verb of ['push', 'publish', 'pull', 'clone', 'register', 'status', 'refresh', 'sync']) {
    const bad = checkFlags(verb, ['--token', 'abc'])
    assert.equal(bad?.flag, '--token', verb)
    assert.match(bad.message, /uniweb login --backend <url> --token <bearer>/, verb)
    assert.match(bad.message, /UNIWEB_TOKEN/, verb)
  }
  assert.equal(checkFlags('push', ['--token=abc'])?.flag, '--token', 'the = form too')
})

test('a mistyped flag is caught, with a suggestion', () => {
  const bad = checkFlags('push', ['--forcee'])
  assert.equal(bad.flag, '--forcee')
  assert.equal(bad.suggestion, '--force')
})

test('the message names the verb and points at its help', () => {
  const bad = checkFlags('pull', ['--nope'])
  assert.match(bad.message, /uniweb pull --help/)
})

// ─── false positives — the expensive failure ──────────────────────────────────

test('a realistic invocation of every guarded verb passes', () => {
  const real = {
    push: ['--org', '@acme', '--yes', '--force'],
    publish: ['--yes', '--no-validate', '--dry-run', '--personal'],
    pull: ['--merge', '--no-prune', '--content-only'],
    clone: ['abc-uuid', '--path', './site', '--project', 'p'],
    register: ['--scope', '@acme', '-o', 'out.uwx', '--json'],
    status: ['--remote', '--json'],
    forget: ['--backend', 'http://localhost:9999'],
    refresh: ['--no-git', '--no-validate'],
    sync: ['--no-git', '--force', '--yes']
  }
  for (const [verb, args] of Object.entries(real)) {
    assert.equal(checkFlags(verb, args), null, `${verb} rejected a valid call`)
  }
  // `forget` has two forms and the table holds one call per verb.
  assert.equal(checkFlags('forget', ['--all']), null, 'forget rejected --all')
  // The name claims EVERY guarded verb; make it a claim the test can keep. A verb
  // added to VERB_FLAGS without a case here would otherwise pass by absence.
  assert.deepEqual(
    Object.keys(VERB_FLAGS).filter((v) => !(v in real)),
    [],
    'a guarded verb has no realistic-invocation case here'
  )
})

// ─── the delegating verbs ─────────────────────────────────────────────────────

test('a mistyped flag is caught on refresh, before the delegated pull runs', () => {
  // The hazard: refresh builds its delegated `pull --merge` itself, so a flag it does
  // not know would be dropped on the floor while the user believes it applied.
  const bad = checkFlags('refresh', ['--no-gti'])
  assert.equal(bad.flag, '--no-gti')
  assert.equal(bad.suggestion, '--no-git')
})

test('a mistyped flag is caught on sync, before EITHER half runs', () => {
  const bad = checkFlags('sync', ['--no-gti'])
  assert.equal(bad.flag, '--no-gti')
  assert.equal(bad.suggestion, '--no-git')
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
  assert.equal(checkFlags('push', ['--org', '@a-b-c']), null)
  // POSIX end-of-flags: nothing after it is scanned.
  assert.equal(checkFlags('push', ['--', '--whatever']), null)
  // A lone `-` is a value (stdin), not a flag.
  assert.equal(checkFlags('push', ['-']), null)
})

test('--flag=value is checked on the name half', () => {
  assert.equal(checkFlags('push', ['--org=@acme']), null)
  assert.equal(checkFlags('push', ['--orgs=@acme']).flag, '--orgs')
})

test('an unguarded verb is left alone', () => {
  assert.equal(checkFlags('dev', ['--anything']), null)
})

// ─── --org, and the retired --as-org ──────────────────────────────────────────

test('--org is the one spelling', () => {
  assert.equal(checkFlags('publish', ['--org', '@acme']), null)
  assert.equal(readOrgFlag(['--org', '@acme']), '@acme')
  assert.equal(readOrgFlag([]), undefined)
})

test('⛔ `--as-org` is refused wherever `--org` is taken — and names `--org`', () => {
  // Retired 2026-09-23 with the `?as_org=` it mirrored. Refused rather than ignored:
  // ignored, a push would name no workspace while the user believed they had named one.
  for (const verb of ['push', 'publish', 'pull', 'clone', 'status', 'refresh', 'sync']) {
    const bad = checkFlags(verb, ['--as-org', '@acme'])
    assert.equal(bad?.flag, '--as-org', verb)
    assert.equal(bad.suggestion, '--org', verb)
    assert.match(bad.message, /--as-org` is retired — use `--org @org`/, verb)
  }
  assert.equal(readOrgFlag(['--as-org', '@acme']), undefined, 'and nothing reads it')
})

// ─── the primitives ───────────────────────────────────────────────────────────

test('findUnknownFlags dedupes and preserves order', () => {
  assert.deepEqual(findUnknownFlags(['--b', '--a', '--b'], []), ['--b', '--a'])
})

test('didYouMean suggests a near miss and declines a far one', () => {
  assert.equal(didYouMean('--forcee', ['--force', '--backend']), '--force')
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
