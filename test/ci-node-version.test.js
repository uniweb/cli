/**
 * The scaffolded CI toolchain must match the project's own.
 *
 * Two failures on a real GitHub Actions run drove this, both caused by CI
 * pinning a newer pnpm major than the project uses:
 *
 *   1. pnpm 11 + Node 20 → `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`.
 *      pnpm 11 declares engines.node >=22.13; the CI node major came from
 *      the project's engines.node, and the workspace template declares
 *      >=20.19, so every scaffolded pnpm project got an uninstallable
 *      workflow.
 *   2. pnpm 11 refuses dependencies published in the last 24h, and changed
 *      build-script approval so `onlyBuiltDependencies` no longer suffices
 *      (`ERR_PNPM_IGNORED_BUILDS`) — which breaks any project using sharp.
 *
 * Neither is reachable from a local build; both need a real runner.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveCiNodeVersion,
  resolveCiPnpmVersion,
  PNPM_VERSION,
  PNPM_MIN_NODE,
} from '../src/versions.js'

test("the project's packageManager field decides the CI pnpm major", () => {
  assert.equal(resolveCiPnpmVersion({ packageManager: 'pnpm@10.30.0' }), '10')
  assert.equal(resolveCiPnpmVersion({ packageManager: 'pnpm@11.15.1' }), '11')
  // Corepack allows a hash suffix.
  assert.equal(resolveCiPnpmVersion({ packageManager: 'pnpm@10.30.0+sha512.abc' }), '10')
})

test('an undeclared or non-pnpm packageManager falls back to the default major', () => {
  assert.equal(resolveCiPnpmVersion({}), PNPM_VERSION)
  assert.equal(resolveCiPnpmVersion(null), PNPM_VERSION)
  assert.equal(resolveCiPnpmVersion({ packageManager: 'yarn@4.0.0' }), PNPM_VERSION)
})

test('the default pnpm major tracks the current stable release', () => {
  // `pnpm@latest` is 11.x, so `npm i -g pnpm` gives a developer 11 and CI
  // should run what they run. This was briefly 10 while pnpm 11 could not
  // install a Uniweb project at all — the workspace template now emits
  // `allowBuilds` alongside `onlyBuiltDependencies`, so both majors work.
  //
  // Revisit when pnpm 12 goes stable: check its release notes for
  // install-time policy changes (11 added build-approval renaming and a
  // 24h minimum release age, both of which broke generated CI) and add its
  // engines.node to PNPM_MIN_NODE in the same commit.
  assert.equal(PNPM_VERSION, '11')
  assert.equal(PNPM_MIN_NODE['11'], 22, 'pnpm 11 declares engines.node >=22.13')
})

test('node floor follows the resolved pnpm major', () => {
  // pnpm 11 cannot start on Node 20 — the exact CI failure.
  assert.equal(resolveCiNodeVersion('>=20.19', 'pnpm', '11'), '22')
  // pnpm 10 runs on Node 18+, so the project's own floor stands.
  assert.equal(resolveCiNodeVersion('>=20.19', 'pnpm', '10'), '20')
  assert.equal(resolveCiNodeVersion(null, 'pnpm', '10'), '20')
})

test("a project's higher floor is respected, never clamped down", () => {
  assert.equal(resolveCiNodeVersion('>=24', 'pnpm', '11'), '24')
  assert.equal(resolveCiNodeVersion('>=24', 'pnpm', '10'), '24')
})

test('npm and yarn keep the project floor — no pnpm minimum applies', () => {
  assert.equal(resolveCiNodeVersion('>=20.19', 'npm'), '20')
  assert.equal(resolveCiNodeVersion('>=20.19', 'yarn'), '20')
  assert.equal(resolveCiNodeVersion(null, 'npm'), '20')
})

test('every supported pnpm major declares a node floor', () => {
  // Bumping PNPM_VERSION without adding its engines.node here would
  // silently reintroduce the node:sqlite class of failure.
  assert.ok(
    PNPM_MIN_NODE[PNPM_VERSION] !== undefined,
    `PNPM_VERSION is ${PNPM_VERSION} but PNPM_MIN_NODE has no entry for it — ` +
    `run \`npm view pnpm@${PNPM_VERSION} engines\` and add it.`
  )
})

test("@uniweb/build's fallback pnpm major agrees with the CLI's", async () => {
  // The two constants live in different packages — @uniweb/build cannot
  // import the CLI's (the dependency runs the other way), so the value is
  // duplicated. It drifted twice in one week: stale at '11' while the CLI
  // said '10', then stale at '10' when the CLI moved back to '11'.
  //
  // Generate a workflow WITHOUT passing a version, so the build package's
  // own fallback is what lands, and compare it to the CLI's authority.
  const { getAdapter } = await import('@uniweb/build/hosts')
  const result = await getAdapter('github-pages').initCi({
    site: { name: 'acme', path: 'site' },
    packageManager: 'pnpm',
    // pnpmVersion deliberately omitted → exercises the fallback
  })
  const emitted = result.files[0].content.match(/pnpm\/action-setup[\s\S]*?version: (\d+)/)?.[1]
  assert.equal(
    emitted, PNPM_VERSION,
    `@uniweb/build falls back to pnpm ${emitted} but the CLI resolves ${PNPM_VERSION} — ` +
    'update FALLBACK_PNPM_VERSION in build/src/hosts/ci-workflow.js to match.'
  )
})
