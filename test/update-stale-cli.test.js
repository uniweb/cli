/**
 * `uniweb update`: the stale-CLI notice, and the collapsed dep survey.
 *
 * Both exist because of one real report. A project pinned to CLI v0.13.5 ran
 * `pnpm uniweb update` against a workspace two releases behind and was told
 * "no new versions available" — correctly, since `update` aligns a project to
 * the matrix of the CLI that runs it, and that CLI was self-consistent. The
 * output gave no way to see the real problem:
 *
 *   1. Six rows of `0.9.37 → 0.9.37  aligned` — identity mappings that say
 *      nothing, and the bulk of the screen on the command's most common
 *      outcome.
 *   2. The run ended on two green ticks, which read as "all good" when the
 *      ticks were measured against a stale reference point.
 *   3. The project-local path never checked whether a newer CLI existed, so
 *      its advice was unconditional boilerplate. The GLOBAL path did check —
 *      and index.js gates the general notifier on `if (global)` too, so the
 *      project-local run got no staleness signal from anywhere. The path that
 *      most needs the check (the version is pinned by the project, so the
 *      user cannot act on what they cannot see) was the one path without it.
 *
 * These are the assertions that keep that from silently coming back. The
 * failure mode is not a crash — it is a confident green measured against the
 * wrong reference point, which no amount of passing tests would surface.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { printStaleCliNotice, printSurvey } from '../src/commands/update.js'

/**
 * Capture stdout for one call. Hooks process.stdout.write rather than
 * console.log because update.js binds `const log = console.log` at module
 * load — swapping console.log afterwards would capture nothing.
 */
function capture(fn) {
  const original = process.stdout.write.bind(process.stdout)
  let out = ''
  process.stdout.write = (chunk) => {
    out += typeof chunk === 'string' ? chunk : chunk.toString()
    return true
  }
  try {
    fn()
  } finally {
    process.stdout.write = original
  }
  // Strip ANSI so assertions match on text, not colour codes.
  return out.replace(/\x1b\[[0-9;]*m/g, '')
}

const row = (
  name,
  status,
  relDir = 'site',
  current = '1.0.0',
  target = '1.0.0'
) => ({
  relDir,
  section: 'dependencies',
  name,
  current,
  target,
  status
})

// ── The stale-CLI notice ────────────────────────────────────────────

test('project-local run warns when a newer CLI exists', () => {
  const out = capture(() =>
    printStaleCliNotice({
      cliVersion: '0.13.5',
      latest: '0.13.7',
      isNpx: false,
      isGlobal: false,
      globalPm: null
    })
  )

  assert.match(out, /A newer uniweb is available/)
  assert.match(out, /v0\.13\.5/)
  assert.match(out, /v0\.13\.7/)
  // The remedy must be the one that works from a project-local install: the
  // version is pinned by package.json, so a global install is irrelevant.
  assert.match(out, /npx uniweb@latest update/)
  // And it must say the remedy is self-healing — otherwise the reader assumes
  // they land back here next release and the advice looks like a treadmill.
  assert.match(out, /updates the pin too/)
})

test('project-local run stays silent when the CLI is current', () => {
  const out = capture(() =>
    printStaleCliNotice({
      cliVersion: '0.13.7',
      latest: '0.13.7',
      isNpx: false,
      isGlobal: false,
      globalPm: null
    })
  )
  assert.equal(out, '', 'a current CLI must print nothing')
})

test('a CLI ahead of the registry stays silent', () => {
  // Local dev runs unpublished versions constantly; a "newer available"
  // notice pointing backwards would be noise on every run.
  const out = capture(() =>
    printStaleCliNotice({
      cliVersion: '0.14.0',
      latest: '0.13.7',
      isNpx: false,
      isGlobal: false,
      globalPm: null
    })
  )
  assert.equal(out, '')
})

test('an unknown latest version stays silent', () => {
  // Offline, or a cache miss on a non-TTY run. Absence of evidence is not
  // evidence of staleness — say nothing rather than guess.
  const out = capture(() =>
    printStaleCliNotice({
      cliVersion: '0.13.5',
      latest: null,
      isNpx: false,
      isGlobal: false,
      globalPm: null
    })
  )
  assert.equal(out, '')
})

test('npx runs stay silent — the version was chosen on the command line', () => {
  const out = capture(() =>
    printStaleCliNotice({
      cliVersion: '0.13.5',
      latest: '0.13.7',
      isNpx: true,
      isGlobal: false,
      globalPm: null
    })
  )
  assert.equal(out, '')
})

test('global run points at the global update command, not just npx', () => {
  const out = capture(() =>
    printStaleCliNotice({
      cliVersion: '0.13.5',
      latest: '0.13.7',
      isNpx: false,
      isGlobal: true,
      globalPm: 'npm'
    })
  )
  assert.match(out, /A newer uniweb is available/)
  assert.match(
    out,
    /-g uniweb/,
    'a global install should be told to update itself'
  )
})

// ── The collapsed survey ────────────────────────────────────────────

test('aligned deps do not print a row', () => {
  const report = {
    rows: [row('@uniweb/core', 'aligned'), row('@uniweb/kit', 'aligned')],
    anyDrift: false,
    anyAhead: false
  }
  const out = capture(() => printSurvey(report, '0.13.5', '0.13.5'))

  assert.equal(
    /aligned/.test(out),
    false,
    'identity mappings must not be listed'
  )
  assert.equal(/@uniweb\/core/.test(out), false)
  // The header block still reports what is running and what the doc is stamped at.
  assert.match(out, /uniweb CLI:\s+v0\.13\.5/)
  assert.match(out, /AGENTS\.md stamp:\s+v0\.13\.5/)
})

test('deps needing attention still print, with aligned ones counted', () => {
  const report = {
    rows: [
      row('@uniweb/core', 'behind', 'src', '0.7.29', '0.7.31'),
      row('@uniweb/kit', 'aligned'),
      row('@uniweb/build', 'aligned')
    ],
    anyDrift: true,
    anyAhead: false
  }
  const out = capture(() => printSurvey(report, '0.13.7', '0.13.7'))

  assert.match(out, /@uniweb\/core/, 'the behind dep must be listed')
  assert.match(out, /0\.7\.29.*0\.7\.31/)
  assert.equal(/@uniweb\/kit/.test(out), false, 'aligned deps stay collapsed')
  assert.match(out, /2 others already aligned/)
})

test('--verbose restores the full table', () => {
  const report = {
    rows: [row('@uniweb/core', 'aligned'), row('@uniweb/kit', 'aligned')],
    anyDrift: false,
    anyAhead: false
  }
  const out = capture(() =>
    printSurvey(report, '0.13.5', '0.13.5', { verbose: true })
  )

  assert.match(out, /@uniweb\/core/)
  assert.match(out, /@uniweb\/kit/)
  assert.match(out, /aligned/)
})

test('an empty workspace still says so', () => {
  const out = capture(() =>
    printSurvey({ rows: [], anyDrift: false, anyAhead: false }, '0.13.5', null)
  )
  assert.match(out, /No @uniweb\/\* deps found/)
})
