/**
 * The dev-server restart notice printed by `uniweb update`.
 *
 * Swapping @uniweb/* under a running dev server produces a uniquely confusing
 * failure: hot reload picks up your source but not a replaced dependency, so
 * the server keeps executing the OLD framework against your NEW project code.
 * Nothing errors. The symptom looks like a bug you just wrote, and the stale
 * process is the last place anyone looks — it cost two separate debugging
 * detours before the hint existed.
 *
 * The notice therefore has to appear whenever node_modules actually changed.
 * It equally has to stay quiet otherwise: `uniweb update` is run routinely and
 * is usually a no-op, and a restart warning on a run that changed nothing is
 * noise that trains people to ignore it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { printSummary } from '../src/commands/update.js'

/**
 * Run printSummary and return everything it wrote to stdout.
 *
 * Hooks process.stdout.write rather than console.log: update.js binds
 * `const log = console.log` at module load, so swapping console.log afterwards
 * would capture nothing. This also exercises the real output path.
 */
function capture(opts) {
  const original = process.stdout.write.bind(process.stdout)
  let out = ''
  process.stdout.write = (chunk, ...rest) => {
    out += typeof chunk === 'string' ? chunk : chunk.toString()
    return true
  }
  try {
    printSummary({ cliVersion: '0.0.0', installPm: 'pnpm', ...opts })
  } finally {
    process.stdout.write = original
  }
  // Strip ANSI so assertions match on text, not colour codes.
  return out.replace(/\x1b\[[0-9;]*m/g, '')
}

const mentionsRestart = (out) => /Restart any running dev server/.test(out)

test('shows the restart notice when packages were installed', () => {
  const out = capture({
    editedPaths: ['package.json', 'site/package.json'],
    depsEdited: true,
    installRan: true,
    agentsResult: 'updated'
  })

  assert.ok(mentionsRestart(out), 'expected the restart notice')
  // The reason matters as much as the instruction — without it the notice reads
  // as boilerplate and gets skipped.
  assert.match(out, /Hot reload picks up your source, not swapped dependencies/)
})

test('stays quiet when nothing changed', () => {
  const out = capture({
    editedPaths: [],
    depsEdited: false,
    installRan: false,
    agentsResult: 'unchanged'
  })

  assert.equal(
    mentionsRestart(out),
    false,
    'a no-op run must not warn about restarting'
  )
})

test('stays quiet when only AGENTS.md was refreshed', () => {
  // --agents-only, or a run where deps were already aligned. node_modules is
  // untouched, so any running dev server is still correct.
  const out = capture({
    editedPaths: [],
    depsEdited: false,
    installRan: false,
    agentsResult: 'updated'
  })

  assert.equal(mentionsRestart(out), false)
})

test('stays quiet when the install was skipped', () => {
  // package.json was edited but never installed, so node_modules still holds
  // what the dev server loaded. The summary already tells them to run the
  // install; the restart belongs after that, not now.
  const out = capture({
    editedPaths: ['package.json'],
    depsEdited: true,
    installRan: false,
    agentsResult: 'skipped'
  })

  assert.equal(mentionsRestart(out), false)
  assert.match(out, /install NOT run/)
})
