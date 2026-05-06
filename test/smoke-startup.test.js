/**
 * CLI startup smoke test
 *
 * Asserts that the CLI's always-on entry points — `--version` and `--help`
 * — run cleanly when none of the CLI's optional peer dependencies are
 * resolvable. This is the literal repro of the user-facing failure mode:
 *
 *   $ npm i -g uniweb && uniweb --version
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@uniweb/build' …
 *
 * The test stubs out optional peers via a Node loader (see
 * `no-optional-peers-loader.mjs`) so it works regardless of what
 * `node_modules` happen to be on disk. If anything in the startup graph
 * statically imports `@uniweb/build` (or any other optional peer), this
 * test fails — catching the next regression structurally rather than
 * relying on a code reviewer to remember the convention.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI_ENTRY = join(__dirname, '..', 'src', 'index.js')
const LOADER = join(__dirname, 'no-optional-peers-loader.mjs')

function runCliWithoutOptionalPeers(...args) {
  return spawnSync(
    process.execPath,
    ['--experimental-loader', LOADER, '--no-warnings', CLI_ENTRY, ...args],
    { encoding: 'utf8' },
  )
}

test('--version runs without optional peers', () => {
  const r = runCliWithoutOptionalPeers('--version')
  assert.equal(
    r.status,
    0,
    `exit ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  )
  assert.match(r.stdout, /uniweb \d+\.\d+\.\d+/)
})

test('--help runs without optional peers', () => {
  const r = runCliWithoutOptionalPeers('--help')
  assert.equal(
    r.status,
    0,
    `exit ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  )
  assert.match(r.stdout, /Uniweb CLI/)
  assert.match(r.stdout, /Usage:/)
})
