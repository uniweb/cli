/**
 * The backend verbs go to the backend the user is logged in to.
 *
 * [Diego, 2026-09-21] — "publish should publish to the backend the user logged in to" ·
 * "push and pull are also meant to go to the backend you are logged into" · "We do not
 * allow any communication with backend if the user is not logged into a backend. The
 * default backend for login, if not specified, is uniweb.app".
 *
 * Logging in is how a backend is chosen. A project's own record of where it synced
 * routes nothing: logged in nowhere, a command resolves to the default backend and asks
 * for that login before it sends anything. A deploy.yml target stays an explicit
 * destination: `uniweb deploy` with a uniweb target goes where the target says. And when
 * a command lands on a backend where the project has no site while it has one
 * elsewhere, it says so — a push there creates a second site.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'

const A = 'http://a.test'
const B = 'http://b.test'
const C = 'http://c.test'
const DEFAULT = 'https://uniweb.app'

const sessions = (...origins) =>
  Object.fromEntries(origins.map((o) => [o, { token: `t-${o}` }]))

// ─── publish goes there ───────────────────────────────────────────────────────

function project(backends, { deployYml } = {}) {
  const dir = join(tmp('uw-li-'), 'site')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'site.yml'), "name: T\nfoundation: 'https://example.test/foundation/entry.js'\n")
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  writeFileSync(join(dir, 'sync.json'), JSON.stringify({ version: 1, backends }))
  if (deployYml) writeFileSync(join(dir, 'deploy.yml'), deployYml)
  return dir
}
const site = (uuid) => ({ site: { uuid } })
const plain = (out) => out.replace(/\x1b\[[0-9;]*m/g, '')
const backendLine = (out) => (plain(out).match(/Backend\s*:\s*(\S+)/) || [])[1]

const verbs = async () => ({
  publish: (await import('../src/commands/publish.js')).publish,
  push: (await import('../src/commands/push.js')).push,
  pull: (await import('../src/commands/pull.js')).pull,
  deploy: (await import('../src/commands/deploy.js')).deploy
})
const ELSEWHERE = /This project's site is on http:\/\/a\.test — not on http:\/\/b\.test, where this \w+ goes/

test('⭐ publish, push and pull go to the backend you are logged in to', { timeout: 30_000 }, async () => {
  const { publish, push, pull } = await verbs()
  const dir = project({ [A]: site('SITE-A'), [B]: site('SITE-B') })
  const loggedInB = { version: 2, current: B, sessions: sessions(B) }

  const pub = await runVerb(dir, publish, ['--dry-run'], { session: loggedInB })
  assert.equal(backendLine(pub.output), B, pub.output)

  const psh = await runVerb(dir, push, ['--dry-run'], { session: loggedInB })
  assert.match(plain(psh.output), /would \S+ content at http:\/\/b\.test/, psh.output)
  assert.doesNotMatch(plain(psh.output), /not on http:\/\/b\.test/, 'the site IS on B: no heads-up')

  const pll = await runVerb(dir, pull, ['--dry-run', '--force'], { session: loggedInB })
  assert.match(plain(pll.output), /would pull content from http:\/\/b\.test/, pll.output)
})

test('⭐ following the login to a backend with no site for this project is said out loud', { timeout: 30_000 }, async () => {
  const { publish, push, pull } = await verbs()
  const dir = project({ [A]: site('SITE-A') })
  const loggedInB = { version: 2, current: B, sessions: sessions(B) }

  const psh = await runVerb(dir, push, ['--dry-run', '--personal'], { session: loggedInB })
  assert.match(plain(psh.output), ELSEWHERE, psh.output)
  assert.match(plain(psh.output), /It creates a new site there/)

  const pub = await runVerb(dir, publish, ['--dry-run', '--personal'], { session: loggedInB })
  assert.match(plain(pub.output), ELSEWHERE, pub.output)
  assert.equal(backendLine(pub.output), B)

  const pll = await runVerb(dir, pull, ['--force'], { session: loggedInB })
  assert.match(plain(pll.output), /Nothing to pull — this project has no site on http:\/\/b\.test\./, pll.output)
  assert.match(plain(pll.output), /Its site is on http:\/\/a\.test/)

  // A backend a script AIMED is a decision already: no heads-up (control)
  const aimed = await runVerb(dir, push, ['--dry-run', '--personal'], {
    session: loggedInB,
    env: { UNIWEB_REGISTER_URL: B }
  })
  assert.doesNotMatch(plain(aimed.output), ELSEWHERE, aimed.output)
})

test('UNIWEB_REGISTER_URL outranks the login — the one override, for automation', { timeout: 30_000 }, async () => {
  const { publish } = await verbs()
  const dir = project({ [A]: site('SITE-A') })
  const res = await runVerb(dir, publish, ['--dry-run'], {
    session: { version: 2, current: B, sessions: sessions(B) },
    env: { UNIWEB_REGISTER_URL: A }
  })
  assert.equal(backendLine(res.output), A, res.output)
})

test('several backends on record: the login decides, for every verb', { timeout: 30_000 }, async () => {
  const { publish, push } = await verbs()
  const dir = project({ [A]: site('SITE-A'), [C]: site('SITE-C') })
  const loggedInC = { version: 2, current: C, sessions: sessions(C) }

  const pub = await runVerb(dir, publish, ['--dry-run'], { session: loggedInC })
  assert.equal(backendLine(pub.output), C, pub.output)

  const psh = await runVerb(dir, push, ['--dry-run'], { session: loggedInC })
  assert.match(plain(psh.output), /would \S+ content at http:\/\/c\.test/, psh.output)
})

test('⭐ logged in nowhere: the DEFAULT backend — never the project\'s record', { timeout: 30_000 }, async () => {
  // [Diego, 2026-09-21] — "the default backend for login, if not specified, is uniweb.app".
  // A project synced only with A still resolves to the default: its record routes nothing.
  const { publish, push } = await verbs()
  const dir = project({ [A]: site('SITE-A') })

  const pub = await runVerb(dir, publish, ['--dry-run'])
  assert.equal(backendLine(pub.output), DEFAULT, pub.output)

  const psh = await runVerb(dir, push, ['--dry-run', '--personal'])
  assert.match(plain(psh.output), /would \S+ content at https:\/\/uniweb\.app/, psh.output)
})

test('⛔ logged in nowhere, nothing is sent — the command asks for the login instead', { timeout: 30_000 }, async () => {
  // [Diego, 2026-09-21] — "We do not allow any communication with backend if the user is
  // not logged into a backend." Without a terminal the ask is a refusal.
  const { push } = await verbs()
  const res = await runVerb(project({}), push, ['--personal'])
  assert.equal(res.requests, 0, 'no request reached any backend')
  assert.match(plain(res.output), /Not logged in/, res.output)
})

test('⭐ `uniweb deploy` follows the login too — a uniweb target\'s backend: routes nothing', { timeout: 30_000 }, async () => {
  // [Diego, 2026-09-21] — "`deploy` follows the login like everything else ...
  // `--host=uniweb` requires a login, and that determines the target uniweb backend."
  const { deploy } = await verbs()
  const dir = project(
    { [A]: site('SITE-A'), [B]: site('SITE-B') },
    { deployYml: `default: staging\ntargets:\n  staging:\n    host: uniweb\n    backend: ${A}\n` }
  )
  const loggedInB = { session: { version: 2, current: B, sessions: sessions(B) } }

  // Bare: the default target names A, the login says B → B, and it says so.
  const bare = await runVerb(dir, deploy, ['--dry-run', '--no-validate'], loggedInB)
  assert.equal(backendLine(bare.output), B, bare.output)
  assert.match(plain(bare.output), /default target 'staging' is on http:\/\/a\.test; publishing to http:\/\/b\.test/)

  // Named: `--target staging` is a destination the user TYPED — contradicting it is refused.
  const named = await runVerb(dir, deploy, ['--dry-run', '--no-validate', '--target', 'staging'], loggedInB)
  assert.match(plain(named.output), /Target 'staging' is on http:\/\/a\.test, but this would publish to http:\/\/b\.test/, named.output)
  assert.match(plain(named.output), /uniweb login --backend http:\/\/a\.test/)
  assert.equal(backendLine(named.output), undefined, 'publish never started')
  assert.equal(named.requests, 0)

  // Logged in where the target is: it goes, with nothing to say.
  const there = await runVerb(dir, deploy, ['--dry-run', '--no-validate', '--target', 'staging'], {
    session: { version: 2, current: A, sessions: sessions(A) }
  })
  assert.equal(backendLine(there.output), A, there.output)
  assert.doesNotMatch(plain(there.output), /is on http/)
})
