// What a publish that went through tells the person, in the backend's own sentences. `publish`
// cannot be driven to its report in-process (see live-address.test.js), so the relay is read off
// the source and the sentences are tested here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { publishSentences } from '../src/commands/publish.js'

test('⭐ what it changed, then what it did not change and the person should know', () => {
  const result = { applied: ['Site Search is on.'], notes: ['This deployment does not serve it yet.'] }
  assert.deepEqual(publishSentences(result), ['Site Search is on.', 'This deployment does not serve it yet.'])
})

test('notes reach the person with nothing changed', () => {
  assert.deepEqual(publishSentences({ notes: ['This deployment does not serve it yet.'] }), ['This deployment does not serve it yet.'])
})

test('CONTROL — nothing to say: absent lists, and anything that is not a sentence', () => {
  assert.deepEqual(publishSentences({}), [])
  assert.deepEqual(publishSentences(null), [])
  assert.deepEqual(publishSentences({ applied: 'not a list', notes: ['', 7, null] }), [])
})

test('publish says them', () => {
  const src = readFileSync(new URL('../src/commands/publish.js', import.meta.url), 'utf8')
  assert.match(src, /for \(const line of publishSentences\(result\)\) say\.info\(line\)/)
})
