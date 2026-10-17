/**
 * A push never sends a file in conflict (`unsettledFiles`, backend/site-sync.js).
 *
 * Where git marks a file under the site unmerged — a merge stopped on it, or uncommitted work
 * a merge could not put back — the file holds markers, and a push would hand them to every
 * author editing the site. ⛔ Until 2026-10-17 nothing checked: measured against a real
 * backend on 1.8.0, a pull whose stash could not be put back exited 0, and the push after it
 * put the markers in front of the author, as text in their section.
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
  env: { UNIWEB_WORKSPACE: 'personal' }
}
const REFUSED = /Not pushed — 1 file\(s\) here are in conflict/

// ⛔ Git, hermetic: no global or system config reaches these repositories.
const scratch = tmp('uw-unsettled-git-')
process.env.GIT_CONFIG_GLOBAL = join(scratch, 'gitconfig')
writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = t\n\temail = t@t\n')
process.env.GIT_CONFIG_NOSYSTEM = '1'

// A site bound on A, holding the versions of what it took and the commit they describe, whose
// hero section a merge has left in conflict.
function inConflict() {
  const ws = tmp('uw-unsettled-')
  const git = (...a) => execFileSync('git', a, { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const site = join(ws, 'site')
  const hero = join(site, 'pages', 'home', 'hero.md')
  mkdirSync(join(site, 'pages', 'home'), { recursive: true })
  writeFileSync(join(ws, '.gitignore'), '.uniweb\nnode_modules\n')
  writeFileSync(join(site, 'site.yml'), "name: T\nfoundation: '@a/base@1.0.0'\n")
  writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  writeFileSync(join(site, 'sync.json'), JSON.stringify({ version: 1, backends: { [A]: { site: { uuid: 'SITE-1' } } } }))
  writeFileSync(hero, '# Hello\n\nWelcome.\n')
  git('init', '-q')
  git('add', '-A')
  git('commit', '-qm', 'the site')
  mkdirSync(join(site, '.uniweb'), { recursive: true })
  writeFileSync(
    join(site, '.uniweb', 'backend-cache.json'),
    JSON.stringify({ version: 1, backends: { [A]: { baseVersions: { 'SITE-1': 'V1' }, syncPoint: git('rev-parse', 'HEAD') } } })
  )
  git('checkout', '-qb', 'theirs')
  writeFileSync(hero, '# Hello\n\nWelcome, theirs.\n')
  git('commit', '-qam', 'theirs')
  git('checkout', '-q', '-')
  writeFileSync(hero, '# Hello\n\nWelcome, mine.\n')
  git('commit', '-qam', 'mine')
  assert.throws(() => git('merge', 'theirs'), 'the merge was meant to conflict')
  return { site, hero, git }
}

test('⛔ a push with a file of the site in conflict reaches the backend for nothing — `--force` included', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const { site } = inConflict()
  for (const args of [[], ['--force']]) {
    const res = await runVerb(site, push, args, LOGGED_IN_A)
    assert.equal(res.exitCode, 1, res.output)
    assert.match(res.output, REFUSED)
    assert.equal(res.requests, 0, `refused after reaching the backend:\n${res.urls.join('\n')}`)
  }
})

test('⛔ so does a publish', { timeout: 60_000 }, async () => {
  const { publish } = await import('../src/commands/publish.js')
  const { site } = inConflict()
  const res = await runVerb(site, publish, ['--force'], LOGGED_IN_A)
  assert.equal(res.exitCode, 1, res.output)
  assert.match(res.output, REFUSED)
  assert.equal(res.requests, 0, `refused after reaching the backend:\n${res.urls.join('\n')}`)
})

test('CONTROL — settled and added, the file is no longer in conflict, and the push goes on to the backend', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const { site, hero, git } = inConflict()
  writeFileSync(hero, '# Hello\n\nWelcome, both.\n')
  git('add', '--', hero)
  const res = await runVerb(site, push, ['--force'], LOGGED_IN_A)
  assert.doesNotMatch(res.output, REFUSED)
  assert.ok(res.requests > 0, `nothing reached the backend, so the refusal was never what stopped it:\n${res.output}`)
})
