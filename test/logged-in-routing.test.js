/**
 * The backend verbs go to the backend the user is logged in to.
 *
 * [Diego, 2026-09-21] — "publish should publish to the backend the user logged in to" ·
 * "push and pull are also meant to go to the backend you are logged into".
 *
 * Logging in is how a backend is chosen, so the login outranks the project's own record
 * of where it synced, for push, pull and publish alike. The project decides only when
 * nobody is logged in. A deploy.yml target stays an explicit destination: `uniweb deploy`
 * with a uniweb target goes where the target says. And when following the login lands
 * on a backend where the project has no site while it has one elsewhere, the verb says
 * so — a push there creates a second site.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'

const A = 'http://a.test'
const B = 'http://b.test'
const C = 'http://c.test'

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
const ELSEWHERE = /This project's site is on http:\/\/a\.test — not on http:\/\/b\.test, the backend you are logged in to/

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
  assert.match(plain(psh.output), /This push creates a new site there/)

  const pub = await runVerb(dir, publish, ['--dry-run', '--personal'], { session: loggedInB })
  assert.match(plain(pub.output), ELSEWHERE, pub.output)
  assert.equal(backendLine(pub.output), B)

  const pll = await runVerb(dir, pull, ['--force'], { session: loggedInB })
  assert.match(plain(pll.output), /Nothing to pull — this project has no site on http:\/\/b\.test, the backend you are logged in to/, pll.output)
  assert.match(plain(pll.output), /Its site is on http:\/\/a\.test/)

  // A backend the user NAMED is a decision already: no heads-up (control)
  const named = await runVerb(dir, push, ['--dry-run', '--personal', '--backend', B], { session: loggedInB })
  assert.doesNotMatch(plain(named.output), ELSEWHERE, named.output)
})

test('--backend still outranks the login', { timeout: 30_000 }, async () => {
  const { publish } = await verbs()
  const dir = project({ [A]: site('SITE-A') })
  const res = await runVerb(dir, publish, ['--dry-run', '--backend', A], {
    session: { version: 2, current: B, sessions: sessions(B) }
  })
  assert.equal(backendLine(res.output), A, res.output)
})

test('with several backends on record, being logged in is the answer — for every verb', { timeout: 30_000 }, async () => {
  const { publish, push } = await verbs()
  const dir = project({ [A]: site('SITE-A'), [C]: site('SITE-C') })
  const loggedInC = { version: 2, current: C, sessions: sessions(C) }

  const loggedIn = await runVerb(dir, publish, ['--dry-run'], { session: loggedInC })
  assert.doesNotMatch(loggedIn.output, /synced with 2 backends/, loggedIn.output)
  assert.equal(backendLine(loggedIn.output), C, loggedIn.output)

  const psh = await runVerb(dir, push, ['--dry-run'], { session: loggedInC })
  assert.doesNotMatch(psh.output, /synced with 2 backends/, psh.output)
  assert.match(plain(psh.output), /would \S+ content at http:\/\/c\.test/, psh.output)

  const nobody = await runVerb(dir, publish, ['--dry-run'])
  assert.equal(nobody.exitCode, 2, nobody.output)
  assert.match(nobody.output, /synced with 2 backends/)
  assert.match(nobody.output, /uniweb login --backend <url>/, 'the refusal offers the login')
  assert.equal(nobody.requests, 0)
})

test('logged in nowhere: the project decides, and the login that follows goes there', { timeout: 30_000 }, async () => {
  const { publish } = await verbs()
  const res = await runVerb(project({ [A]: site('SITE-A') }), publish, ['--dry-run'])
  assert.equal(backendLine(res.output), A, res.output)
})

test('`uniweb deploy` with a uniweb target goes where the TARGET says, whoever is logged in', { timeout: 30_000 }, async () => {
  const { deploy } = await verbs()
  const dir = project(
    { [A]: site('SITE-A') },
    { deployYml: `default: staging\ntargets:\n  staging:\n    host: uniweb\n    backend: ${A}\n` }
  )
  const res = await runVerb(dir, deploy, ['--dry-run', '--no-validate'], {
    session: { version: 2, current: B, sessions: sessions(B) }
  })
  assert.equal(backendLine(res.output), A, res.output)
})
