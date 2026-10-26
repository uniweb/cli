/**
 * A dry run names the workspace the command would work in.
 *
 * `publish` and `push` work in one workspace (`backend/workspace.js`): a site they create
 * is created there, and a site the backend keeps in another stops them. A dry run resolved
 * that workspace and never said which it was, so the one thing a preview is for — what
 * the real command will do — left out where it would do it. It resolves offline: a flag,
 * `UNIWEB_WORKSPACE`, or the login's choice; with none of those it says what the command
 * does instead. And when sync.json records the site as created in another workspace, it
 * says so before the backend has to refuse.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'

const B = 'http://b.test'

/** A project with a site on B, recorded as created in `org` (bare, as sync.json holds it). */
function project({ uuid = 'SITE-B', org } = {}) {
  const dir = join(tmp('uw-ws-'), 'site')
  mkdirSync(join(dir, '.uniweb'), { recursive: true })
  writeFileSync(join(dir, 'site.yml'), "name: T\nfoundation: 'https://example.test/foundation/entry.js'\n")
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  const site = uuid ? { uuid, ...(org ? { org } : {}) } : undefined
  writeFileSync(join(dir, 'sync.json'), JSON.stringify({ version: 1, backends: site ? { [B]: { site } } : {} }))
  if (uuid) {
    writeFileSync(
      join(dir, '.uniweb', 'backend-cache.json'),
      JSON.stringify({ version: 1, backends: { [B]: { baseVersions: { [uuid]: 'V1' } } } })
    )
  }
  return dir
}
const session = (workspace) => ({
  version: 2,
  current: B,
  sessions: { [B]: { token: 't', ...(workspace ? { workspace } : {}) } }
})
const plain = (out) => out.replace(/\x1b\[[0-9;]*m/g, '')
const workspaceLine = (out) => (plain(out).match(/Workspace\s*:\s*(.+)/) || [])[1]?.trim()

const verbs = async () => ({
  publish: (await import('../src/commands/publish.js')).publish,
  push: (await import('../src/commands/push.js')).push
})

test("⭐ publish --dry-run names the workspace: the login's, a flag's, UNIWEB_WORKSPACE's", { timeout: 30_000 }, async () => {
  const { publish } = await verbs()
  const dir = project({ org: 'acme' })

  const login = await runVerb(dir, publish, ['--dry-run'], { session: session('@acme') })
  assert.equal(login.exitCode, 0, login.output)
  assert.equal(workspaceLine(login.output), '@acme (your login)', login.output)
  assert.equal(login.requests, 0, 'a preview sends nothing')

  const flag = await runVerb(dir, publish, ['--dry-run', '--org', '@acme'], { session: session('@beta') })
  assert.equal(workspaceLine(flag.output), '@acme (named on this command)', flag.output)

  const unit = await runVerb(dir, publish, ['--dry-run', '--org', '@studio:acme'], { session: session('@acme') })
  assert.match(workspaceLine(unit.output), /^@studio:acme \(named on this command\)/, unit.output)

  const env = await runVerb(dir, publish, ['--dry-run'], {
    env: { UNIWEB_SERVER: B, UNIWEB_TOKEN: 't', UNIWEB_WORKSPACE: '@acme' }
  })
  assert.equal(workspaceLine(env.output), '@acme (UNIWEB_WORKSPACE)', env.output)
})

test('publish --dry-run names the personal workspace, and says when none is chosen', { timeout: 30_000 }, async () => {
  const { publish } = await verbs()
  const dir = project({ uuid: null })

  const personal = await runVerb(dir, publish, ['--dry-run', '--personal'], { session: session('@acme') })
  assert.equal(workspaceLine(personal.output), 'your personal workspace (named on this command)', personal.output)

  // A session from before workspaces chose none: which one the publish settles on takes the
  // backend, so the preview says what the publish does, and asks nothing.
  const none = await runVerb(dir, publish, ['--dry-run'], { session: session(null) })
  assert.equal(none.exitCode, 0, none.output)
  assert.match(workspaceLine(none.output), /^none chosen at login — the publish works in your personal workspace if you belong to no organization or project/, none.output)
  assert.equal(none.requests, 0, 'a preview sends nothing')
})

test('⭐ a site sync.json records in another workspace is warned of — and not when it is the same', { timeout: 30_000 }, async () => {
  const { publish, push } = await verbs()
  const dir = project({ org: 'proximify:diego' })
  const WARNING = /sync\.json records this site as created in @proximify:diego\. If the backend still keeps it there, it stops this (publish|push): add --org @proximify:diego to work in it\./

  const elsewhere = await runVerb(dir, publish, ['--dry-run'], { session: session('@macrini') })
  assert.equal(workspaceLine(elsewhere.output), '@macrini (your login)', elsewhere.output)
  assert.match(plain(elsewhere.output), WARNING, elsewhere.output)

  const personal = await runVerb(dir, publish, ['--dry-run', '--personal'], { session: session('@proximify:diego') })
  assert.match(plain(personal.output), WARNING, personal.output)

  // Control: the same workspace — no warning.
  const same = await runVerb(dir, publish, ['--dry-run'], { session: session('@proximify:diego') })
  assert.equal(workspaceLine(same.output), '@proximify:diego (your login)', same.output)
  assert.doesNotMatch(plain(same.output), /sync\.json records/, same.output)

  // And push says the same.
  const psh = await runVerb(dir, push, ['--dry-run'], { session: session('@macrini') })
  assert.equal(psh.exitCode, 0, psh.output)
  assert.equal(workspaceLine(psh.output), '@macrini (your login)', psh.output)
  assert.match(plain(psh.output), WARNING, psh.output)
  assert.equal(psh.requests, 0, 'a preview sends nothing')

  const pshSame = await runVerb(dir, push, ['--dry-run'], { session: session('@proximify:diego') })
  assert.doesNotMatch(plain(pshSame.output), /sync\.json records/, pshSame.output)
})
