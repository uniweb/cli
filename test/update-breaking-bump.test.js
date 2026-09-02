/**
 * `update` telling a breaking crossing from an ordinary one.
 *
 * ## Why this needed a test rather than a colour
 *
 * Until 2026-09-02 `update` printed every lagging dep as `behind`, in one
 * colour, whatever the distance — so `@uniweb/core ^0.14.1 → ^0.16.0` (two
 * releases a consumer must act on) and `@uniweb/kit ^0.15.0 → ^0.15.2` (a
 * patch) were the same sentence. `--yes` applied both without a word.
 *
 * That mattered because of what the minor slot MEANS here: `publish.js` derives
 * a bump from a package's own commits and gives minor to a breaking marker and
 * nothing else, so in 0.x the minor slot is the entire channel for "you must
 * act." `update` is also the command `AGENTS.md` ships into every scaffold and
 * tells people — and agents — to run. The one signal the version scheme exists
 * to send was being discarded by the tool built to consume it.
 *
 * The `flows` lane crossed `@uniweb/core ^0.14.1 → ^0.15.0` this way, found out
 * from a changelog afterwards, and said so.
 *
 * ⭐ The properties worth pinning are the classification and the ASYMMETRY: a
 * 0.x minor is breaking, a 1.x minor is not, and a patch never is. A check that
 * called everything breaking would be as useless as one that called nothing.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bumpClass, isBreakingBump } from '../src/utils/dep-survey.js'

test('bumpClass names the slot that moved, through a range prefix', () => {
  assert.equal(bumpClass('^0.14.1', '0.16.0'), 'minor')
  assert.equal(bumpClass('^0.15.0', '0.15.2'), 'patch')
  assert.equal(bumpClass('^1.2.4', '2.0.0'), 'major')
  assert.equal(bumpClass('^0.16.0', '1.0.0'), 'major')
  assert.equal(bumpClass('^0.32.0', '0.32.0'), 'none')
  // `~`, `>=` and a bare version are all specs we meet in the wild.
  assert.equal(bumpClass('~0.14.1', '0.15.0'), 'minor')
  assert.equal(bumpClass('0.14.1', '0.14.9'), 'patch')
})

test('⭐ a 0.x minor is breaking; a 1.x minor is not', () => {
  // The whole asymmetry. npm agrees, which is what makes it more than our own
  // convention: `^0.14.1` admits 0.14.x and refuses 0.15.0, while `^1.2.4`
  // admits 1.3.0 — so the range itself already treats the 0.x minor as a wall.
  assert.equal(isBreakingBump('^0.14.1', '0.15.0'), true)
  assert.equal(isBreakingBump('^1.2.4', '1.3.0'), false)
})

test('a major is breaking on either side of 1.0', () => {
  assert.equal(isBreakingBump('^1.2.4', '2.0.0'), true)
  // The crossing every 0.x package here makes exactly once, and the one worth
  // being asked about: nothing in the matrix has reached it yet.
  assert.equal(isBreakingBump('^0.16.0', '1.0.0'), true)
})

test('⛔ a patch is never breaking, and neither is standing still', () => {
  // A signal that fires on an ordinary upgrade is one people learn to ignore,
  // which costs more than the signal is worth.
  assert.equal(isBreakingBump('^0.15.0', '0.15.2'), false)
  assert.equal(isBreakingBump('^1.2.4', '1.2.9'), false)
  assert.equal(isBreakingBump('^0.32.0', '0.32.0'), false)
})

test('an AHEAD dep is not classified as a crossing', () => {
  // `bump`/`breaking` are set only for status 'behind' (see surveyWorkspaceDeps).
  // A project pinning something newer than the CLI's matrix is a real state —
  // it is what `--verbose` calls "ahead of CLI" — and it is not an upgrade.
  assert.equal(bumpClass('^0.17.0', '0.16.0'), 'minor')
  // The classifier answers about DISTANCE; the survey decides relevance. This
  // asserts the split, so a future caller does not read `bumpClass` alone as
  // "should I warn".
  assert.equal(isBreakingBump('^0.17.0', '0.16.0'), true)
})
