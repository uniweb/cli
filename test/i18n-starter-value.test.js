import { test } from 'node:test'
import assert from 'node:assert/strict'
import { starterValue } from '../src/commands/i18n.js'

// What `uniweb i18n init` hands a translator for one unit of the manifest.
test('a unit with markup starts with it — the links and emphasis a translator must keep', () => {
  assert.equal(starterValue({ source: 'See our guide', markup: 'See our [guide](/guide)' }), 'See our [guide](/guide)')
})

test('a plain unit starts with its words', () => {
  assert.equal(starterValue({ source: 'Welcome back' }), 'Welcome back')
})

test('⭐ a unit whose places disagree on markup starts with its words — a heading here, a link there', () => {
  // One value serves both: the heading takes the words as they are, the link takes them as its
  // label. Seeded with the link, the heading would become one.
  assert.equal(starterValue({ source: 'Faculty of Science', markup: '[Faculty of Science](/)', markupVaries: true }), 'Faculty of Science')
})
