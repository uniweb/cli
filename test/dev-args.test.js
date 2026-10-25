/**
 * `uniweb dev`'s arguments — a flag's value is never the site's name, and an unknown flag is
 * refused rather than read as one (2026-10-25).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readDevArgs } from '../src/commands/dev.js'
import { checkFlags } from '../src/utils/flag-guard.js'

test('`--port 5199` is a port, not a site named 5199', () => {
  assert.deepEqual(readDevArgs(['--port', '5199']), { site: null, port: 5199, status: false, stop: false })
  assert.equal(readDevArgs(['--port=5199']).port, 5199)
})

test('the site, by name or by --site, beside a flag that takes a value', () => {
  assert.equal(readDevArgs(['--port', '5199', 'docs']).site, 'docs')
  assert.equal(readDevArgs(['--site', 'docs', '--port', '5199']).site, 'docs')
  assert.equal(readDevArgs(['--org', '@acme']).site, null)
})

test('a port that is not one is refused', () => {
  for (const args of [['--port'], ['--port', 'abc'], ['--port', '70000'], ['--port', '0']]) {
    assert.match(readDevArgs(args).error, /takes a port number/, args.join(' '))
  }
})

test('--status and --stop, one at a time', () => {
  assert.equal(readDevArgs(['--status']).status, true)
  assert.equal(readDevArgs(['--stop']).stop, true)
  assert.match(readDevArgs(['--status', '--stop']).error, /pass one/)
})

test('an unknown flag is refused, by name — the flags it does take are not', () => {
  assert.match(checkFlags('dev', ['--open']).message, /Unknown flag `--open` for `uniweb dev`/)
  assert.equal(checkFlags('dev', ['--port', '5199', '--site', 'docs', '--status']), null)
  assert.equal(checkFlags('dev', ['--org', '@acme', '--personal']), null)
})
