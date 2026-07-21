/**
 * CI Node version must satisfy the pinned package manager.
 *
 * Found on a live GitHub Actions run (2026-07-21): the scaffolded GitHub
 * Pages workflow paired `pnpm 11` with `node-version: '20'` and died at the
 * install step with
 *
 *   Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite
 *
 * pnpm 11 declares `engines.node: >=22.13` and imports `node:sqlite`, which
 * does not exist before Node 22. The CI node major came from the project's
 * `engines.node`, and the workspace template declares `>=20.19` — so EVERY
 * scaffolded pnpm project got a workflow that could not install, before the
 * build was even attempted. Local testing could not catch it: the failure is
 * in the runner's toolchain setup, not in anything the CLI runs locally.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCiNodeVersion, PNPM_VERSION, PNPM_MIN_NODE_MAJOR } from '../src/versions.js'

test('pnpm floors the CI node version at what that pnpm major requires', () => {
  // The exact combination that failed in CI.
  assert.equal(resolveCiNodeVersion('>=20.19', 'pnpm'), '22')
  assert.equal(resolveCiNodeVersion(null, 'pnpm'), '22')
  assert.equal(resolveCiNodeVersion('>=18', 'pnpm'), '22')
})

test("a project's higher floor is respected, not clamped down to the minimum", () => {
  // engines.node is a lower bound on what the project needs; running CI on
  // a newer Node than the package manager's minimum is correct.
  assert.equal(resolveCiNodeVersion('>=24', 'pnpm'), '24')
  assert.equal(resolveCiNodeVersion('>=22.13', 'pnpm'), '22')
})

test('npm and yarn keep the project floor — the pnpm minimum does not apply', () => {
  assert.equal(resolveCiNodeVersion('>=20.19', 'npm'), '20')
  assert.equal(resolveCiNodeVersion('>=20.19', 'yarn'), '20')
  assert.equal(resolveCiNodeVersion(null, 'npm'), '20')
})

test('PNPM_MIN_NODE_MAJOR is kept in sync with PNPM_VERSION', () => {
  // Guard rail rather than a real assertion: bumping the pnpm major without
  // revisiting the node floor reintroduces the exact CI failure above.
  // pnpm 11 → node >=22.13. If PNPM_VERSION moves, re-check pnpm's engines
  // field and update PNPM_MIN_NODE_MAJOR in the same commit.
  const knownMinimums = { '11': 22 }
  const expected = knownMinimums[PNPM_VERSION]
  assert.ok(
    expected !== undefined,
    `PNPM_VERSION is now ${PNPM_VERSION}; look up its engines.node ` +
    `(npm view pnpm@${PNPM_VERSION} engines) and add it to knownMinimums here.`
  )
  assert.equal(PNPM_MIN_NODE_MAJOR, expected)
})
