/**
 * A copied project is noticed before its push goes out.
 *
 * `cp -r sites/a sites/b` gives b the original's sync.json, so b holds a's site on
 * every backend a synced with, and b's first push updates a's site. The signal is
 * exact: two directories in ONE workspace naming the same site on the same backend
 * — every create mints a new site, so only a copy produces that.
 *
 * First the detection (who counts as a copy, and who must not — above all a
 * teammate's clone, which is the same project and holds the same site legitimately).
 * Then the verbs: push and publish refuse with ZERO requests, and stop refusing once
 * `uniweb forget --all` has run in the copy.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, cpSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { findSiteCopies } from '../src/utils/site-copies.js'
import { tmp, runVerb } from './helpers/run-verb.js'

const A = 'http://dev.test'
const B = 'https://uniweb.app'

/** A site holding SITE-1 on A, in `dir`. */
function site(dir, backends = { [A]: { site: { uuid: 'SITE-1' } } }) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'site.yml'), "name: T\nfoundation: '@a/base'\n")
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  writeFileSync(join(dir, 'sync.json'), JSON.stringify({ version: 1, backends }))
  return dir
}

/** A workspace root with the standard layout. */
function workspace() {
  const root = tmp('uw-ws-')
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'sites/*'\n  - site\n")
  return root
}

// ─── detection ────────────────────────────────────────────────────────────────

test('⭐ a copy beside its original is found — from either side', () => {
  const root = workspace()
  const a = site(join(root, 'sites', 'a'))
  const b = join(root, 'sites', 'b')
  cpSync(a, b, { recursive: true })

  assert.deepEqual(findSiteCopies(a, A), [b])
  assert.deepEqual(findSiteCopies(b, A), [a])
  assert.deepEqual(findSiteCopies(b, `${A}/dev/site/x`), [a], 'a whole endpoint URL names the same backend')
})

test('⛔ a teammate\'s clone is NOT a copy — another checkout is the same project', () => {
  const one = workspace()
  const two = workspace()
  const a = site(join(one, 'site'))
  site(join(two, 'site'))
  assert.deepEqual(findSiteCopies(a, A), [])
})

test('the same uuid on a DIFFERENT backend is not the same site', () => {
  const root = workspace()
  const a = site(join(root, 'sites', 'a'))
  site(join(root, 'sites', 'b'), { [B]: { site: { uuid: 'SITE-1' } } })
  assert.deepEqual(findSiteCopies(a, A), [])
})

test('nothing to protect before a first push — no identity, no check', () => {
  const root = workspace()
  const a = site(join(root, 'sites', 'a'), {})
  cpSync(a, join(root, 'sites', 'b'), { recursive: true })
  assert.deepEqual(findSiteCopies(a, A), [])
})

test('a copy dropped at the workspace root, or beside a deeply nested site, is found', () => {
  const root = workspace()
  const a = site(join(root, 'sites', 'a'))
  const atRoot = join(root, 'a-copy')
  cpSync(a, atRoot, { recursive: true })
  assert.deepEqual(findSiteCopies(a, A), [atRoot])

  const deep = site(join(root, 'apps', 'x', 'site'), { [A]: { site: { uuid: 'SITE-DEEP' } } })
  const deepCopy = join(root, 'apps', 'x', 'site-copy')
  cpSync(deep, deepCopy, { recursive: true })
  assert.deepEqual(findSiteCopies(deep, A), [deepCopy], 'below the two-level scan: found as a sibling')
})

test('a symlink to the site is the site, and node_modules / dot-dirs are never scanned', () => {
  const root = workspace()
  const a = site(join(root, 'sites', 'a'))
  symlinkSync(a, join(root, 'sites', 'current'))
  site(join(root, 'node_modules', 'pkg'))
  site(join(root, '.sandbox', 'x'))
  assert.deepEqual(findSiteCopies(a, A), [])
})

test('outside any workspace there is nothing to compare against', () => {
  const loose = tmp('uw-loose-')
  const a = site(join(loose, 'a'))
  cpSync(a, join(loose, 'b'), { recursive: true })
  assert.deepEqual(findSiteCopies(a, A), [], 'a copy here is byte-for-byte a clone')
})

// ─── the verbs ────────────────────────────────────────────────────────────────

const HEADLINE = /Another project in this workspace holds the same site/
// Every verb goes to the backend you are logged in to: the test user is logged in to A.
const LOGGED_IN_A = { session: { version: 2, current: A, sessions: { [A]: { token: 't' } } } }

test('⭐ push refuses from the copy AND from the original, before any request', { timeout: 30_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const root = workspace()
  const a = site(join(root, 'sites', 'a'))
  const b = join(root, 'sites', 'b')
  cpSync(a, b, { recursive: true })

  for (const dir of [b, a]) {
    const res = await runVerb(dir, push, [], LOGGED_IN_A)
    assert.equal(res.exitCode, 1, res.output)
    assert.match(res.output, HEADLINE)
    assert.match(res.output, /uniweb forget --all/)
    assert.equal(res.requests, 0, 'refused before anything was sent')
  }
})

test('publish refuses the same way', { timeout: 30_000 }, async () => {
  const { publish } = await import('../src/commands/publish.js')
  const root = workspace()
  const a = site(join(root, 'sites', 'a'))
  const b = join(root, 'sites', 'b')
  cpSync(a, b, { recursive: true })

  const res = await runVerb(b, publish, [], LOGGED_IN_A)
  assert.equal(res.exitCode, 1, res.output)
  assert.match(res.output, HEADLINE)
  assert.equal(res.requests, 0)
})

test('after `uniweb forget --all` in the copy, neither side is refused (control)', { timeout: 30_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const { forget } = await import('../src/commands/forget.js')
  const root = workspace()
  const a = site(join(root, 'sites', 'a'))
  const b = join(root, 'sites', 'b')
  cpSync(a, b, { recursive: true })

  assert.match((await runVerb(b, push, [], LOGGED_IN_A)).output, HEADLINE, 'refused first')
  assert.equal((await runVerb(b, forget, ['--all'])).exitCode, 0)

  // Past the check, each push reaches the wire. The network is stubbed to fail, so a
  // counted request is the proof the check let it through. `--personal` answers the
  // owner question the copy's create asks; the original's site exists and asks none.
  for (const [dir, extra] of [[b, ['--personal']], [a, []]]) {
    const res = await runVerb(dir, push, ['--token', 'test', ...extra], LOGGED_IN_A)
    assert.doesNotMatch(res.output, HEADLINE, res.output)
    assert.ok(res.requests > 0, `${dir} should reach the wire:\n${res.output}`)
  }
})

test('`-o` is a local emit and reaches no backend — never refused', { timeout: 30_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const root = workspace()
  const a = site(join(root, 'sites', 'a'))
  cpSync(a, join(root, 'sites', 'b'), { recursive: true })
  const res = await runVerb(a, push, ['-o', join(root, 'out.uwx')], LOGGED_IN_A)
  assert.doesNotMatch(res.output, HEADLINE)
})
