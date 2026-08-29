/**
 * The schema-less report — the message an author actually acts on.
 *
 * This replaced a prose warning (`"… — not synced"`, printed dim among
 * everything else) that was misleading in the expensive direction: the data IS
 * delivered, as static files. An author read it as "my data did not upload", or
 * skimmed it. Neither reading says what was given up or how to get it back.
 *
 * So the assertions here are about CONTENT, not formatting: does the line tell
 * an author what happened, what it costs, and what to do.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportSchemalessQueries } from '../src/utils/schemaless-report.js'

function capture(schemaless) {
  const warn = []
  const dim = []
  reportSchemalessQueries(schemaless, {
    warn: (m) => warn.push(m),
    dim: (m) => dim.push(m)
  })
  return { warn, dim, all: [...warn, ...dim].join('\n') }
}

test('silent when every collection resolved a schema', () => {
  for (const empty of [[], null, undefined]) {
    const { warn, dim } = capture(empty)
    assert.deepEqual(warn, [], 'must not warn when there is nothing to report')
    assert.deepEqual(dim, [])
  }
})

test('the headline is WARN level and names the collections', () => {
  const { warn } = capture([{ name: 'notes', model: '@/note' }])
  assert.equal(warn.length, 1, 'exactly one headline, so it cannot be skimmed past')
  assert.match(warn[0], /notes/)
})

test('it says what happened, not what did not happen', () => {
  const { all } = capture([{ name: 'notes', model: '@/note' }])
  // The old message said "not synced", which reads as "did not upload".
  assert.doesNotMatch(all, /not synced/i)
  assert.match(all, /static files/i, 'must say where the data actually went')
})

test('it states the cost and the remedy', () => {
  const { all } = capture([{ name: 'notes', model: '@/note' }])
  assert.match(all, /queries/i)
  assert.match(all, /editor/i)
  assert.match(all, /republish/i)
  assert.match(all, /schema/i, 'must name the way out')
})

test('it carries the model name the convention looked for', () => {
  // ⭐ Load-bearing: the convention SINGULARIZES, so collection `notes` resolves
  // `@/note`. An author told only "no data schema" would declare `@/notes` and
  // still not resolve. A bare collection name cannot carry that.
  const { all } = capture([{ name: 'notes', model: '@/note' }])
  assert.match(all, /notes → @\/note/)
})

test('plural agreement, so the headline never reads as broken english', () => {
  const one = capture([{ name: 'a', model: '@/a' }])
  const two = capture([{ name: 'a', model: '@/a' }, { name: 'b', model: '@/b' }])
  assert.match(one.warn[0], /1 query /)
  assert.match(two.warn[0], /2 queries /)
  assert.match(two.warn[0], /a, b/)
})

test('survives an entry with no model rather than printing undefined', () => {
  const { all } = capture([{ name: 'notes' }])
  assert.doesNotMatch(all, /undefined/)
})
