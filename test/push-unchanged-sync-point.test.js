/**
 * A push that finds nothing to send keeps the commit it was made from as the sync point.
 *
 * "Nothing to push" says the backend holds what this commit sends — so the commit is a
 * state the backend's content descends from, as the one an ordinary push is made from is
 * (`holdUnchangedPush`, backend/site-sync.js). ⛔ Until 2026-10-17 it kept nothing: a
 * paragraph re-wrapped and committed (a plain newline is a space, so the push sends
 * nothing) was merged on the next pull from the commit before it, and conflicted with an
 * author's words typed into it since.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmp, runVerb } from './helpers/run-verb.js'

const A = 'http://dev.test'
const LOGGED_IN_A = {
  session: { version: 2, current: A, sessions: { [A]: { token: 't' } } },
  env: { UNIWEB_WORKSPACE: 'personal' },
  // The two requests a push of a new site makes: the deployment's config, and the create.
  respond: (url) => {
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/dev/config')) return json({})
    if (url.includes('/dev/site/content'))
      return json({ siteContentUuid: 'SITE-1', report: { finalized: [{ index: 0, uuid: 'SITE-1', changed: true, version: 'V1' }] } })
  }
}

// ⛔ Git, hermetic: no global or system config reaches these repositories.
const scratch = tmp('uw-unchanged-git-')
process.env.GIT_CONFIG_GLOBAL = join(scratch, 'gitconfig')
writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = t\n\temail = t@t\n')
process.env.GIT_CONFIG_NOSYSTEM = '1'

// A project under git, its site pushed once: the push created the site and kept its commit.
async function pushedOnce() {
  const { push } = await import('../src/commands/push.js')
  const ws = tmp('uw-unchanged-')
  const git = (...a) => execFileSync('git', a, { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const site = join(ws, 'site')
  mkdirSync(join(site, 'pages', 'home'), { recursive: true })
  writeFileSync(join(ws, '.gitignore'), '.uniweb\nnode_modules\n')
  writeFileSync(join(site, 'site.yml'), "name: T\nfoundation: '@a/base@1.0.0'\n")
  writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  writeFileSync(join(site, 'pages', 'home', 'hero.md'), '# Hello\n\nJoin thousands of teams already shipping faster.\n')
  git('init', '-q')
  git('add', '-A')
  git('commit', '-qm', 'create')
  const res = await runVerb(site, push, [], LOGGED_IN_A)
  assert.equal(res.exitCode, 0, res.output)
  git('add', '-A')
  git('commit', '-qm', 'the site, recorded') // sync.json, as the push asks
  return { push, site, git }
}

const syncPointOf = async (site) => (await import('../src/utils/sync-point.js')).readSyncPoint(site, A)
const REWRAPPED = '# Hello\n\nJoin thousands of teams\nalready shipping faster.\n'

test('⛔ a push that finds nothing to send keeps the commit it was made from — the base the next pull merges from', { timeout: 60_000 }, async () => {
  const { push, site, git } = await pushedOnce()
  writeFileSync(join(site, 'pages', 'home', 'hero.md'), REWRAPPED)
  git('commit', '-qam', 're-wrap')
  const res = await runVerb(site, push, [], LOGGED_IN_A)
  assert.equal(res.exitCode, 0, res.output)
  assert.match(res.output, /Nothing to push/)
  assert.equal(await syncPointOf(site), git('rev-parse', 'HEAD'), 'the commit the backend holds was not kept')
})

test('CONTROL — with the re-wrap not committed, HEAD is not what was compared, and the sync point stays', { timeout: 60_000 }, async () => {
  const { push, site, git } = await pushedOnce()
  const before = await syncPointOf(site)
  writeFileSync(join(site, 'pages', 'home', 'hero.md'), REWRAPPED)
  const res = await runVerb(site, push, [], LOGGED_IN_A)
  assert.equal(res.exitCode, 0, res.output)
  assert.match(res.output, /Nothing to push/)
  assert.equal(await syncPointOf(site), before)
  assert.notEqual(before, null)
  assert.ok(git('status', '--porcelain').includes('hero.md'))
})
