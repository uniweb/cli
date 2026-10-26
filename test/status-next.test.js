/**
 * `uniweb status`'s next steps, followed from the top, work: each step's precondition is met
 * by the ones above it (`src/utils/status-next.js`).
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planNext } from '../src/utils/status-next.js'

const step = (name, command, why = name, extra = {}) => ({ step: name, command, why, ...extra })

test('⭐ the order: sign in, settle, take what others did, push, share, go live, update, doctor', () => {
  const next = planNext([
    step('doctor', 'npx uniweb doctor'),
    step('publish', 'npx uniweb publish', 'go live', { ask: true }),
    step('update', 'npx uniweb@latest update', 'update', { latest: true }),
    step('gitpush', 'git push', 'share', { ask: true }),
    step('push', 'npx uniweb push'),
    step('pull', 'npx uniweb pull'),
    step('merge', 'git commit'),
    step('conflicts', null, 'settle'),
    step('login', 'npx uniweb login --browser --personal')
  ])
  assert.deepEqual(
    next.map((s) => s.command),
    [
      'npx uniweb login --browser --personal',
      null,
      'git commit',
      'npx uniweb pull',
      'npx uniweb push',
      'git push',
      'npx uniweb publish',
      'npx uniweb@latest update',
      'npx uniweb doctor'
    ]
  )
})

// A commit of the project's other files comes after a merge's own commit and before `git pull`,
// which refuses over an uncommitted change to a file a teammate changed too — and before `git
// push`, which shares only commits.
test('a commit of what else changed: after the merge, before taking or sharing commits', () => {
  const next = planNext([
    step('gitpush', 'git push', 'share', { ask: true }),
    step('refresh', 'npx uniweb refresh', 'take'),
    step('commit', null, 'commit the 2 other files here', { ask: true }),
    step('merge', 'git commit', 'finish the merge')
  ])
  assert.deepEqual(
    next.map((s) => s.why),
    ['finish the merge', 'commit the 2 other files here', 'take', 'share']
  )
})

test('refresh takes the place of a pull, and says both', () => {
  const next = planNext([step('pull', 'npx uniweb pull', 'take the 2 changes made on the backend'), step('refresh', 'npx uniweb refresh', "take your teammates' commits")])
  assert.deepEqual(next, [
    { command: 'npx uniweb refresh', why: "take your teammates' commits, and take the 2 changes made on the backend", ask: false }
  ])
})

test("a newer release's update replaces the project's own", () => {
  const next = planNext([
    step('update', 'npx uniweb update', 'align'),
    step('update', 'npx uniweb@latest update', 'update', { latest: true })
  ])
  assert.deepEqual(next.map((s) => s.command), ['npx uniweb@latest update'])
})

test('control: without a newer release, the project\'s own update stays', () => {
  assert.deepEqual(planNext([step('update', 'npx uniweb update', 'align')]).map((s) => s.command), ['npx uniweb update'])
})

test('a step is listed once, and a step with no command keeps its why', () => {
  const next = planNext([step('push', 'npx uniweb push', 'a'), step('push', 'npx uniweb push', 'b'), step('conflicts', null, 'settle 2 files')])
  assert.deepEqual(next, [
    { command: null, why: 'settle 2 files', ask: false },
    { command: 'npx uniweb push', why: 'a', ask: false }
  ])
})

test('the person decides what is marked to ask', () => {
  const [publish] = planNext([step('publish', 'npx uniweb publish', 'go live', { ask: true })])
  assert.equal(publish.ask, true)
})
