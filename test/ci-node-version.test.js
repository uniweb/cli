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

test('the default pnpm major does not impose a newer toolchain than projects use', () => {
  // The framework's own monorepo pins pnpm@10.30.0 and templates declare no
  // packageManager at all. Defaulting CI to a newer major than that means CI
  // exercises a toolchain nobody develops against — which is precisely how
  // both production failures above were introduced.
  assert.equal(PNPM_VERSION, '10')
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
