/**
 * The types a mapping names (`typesNamedBy`, `backend/library-types.js`): what a registry needs
 * registered before it takes the mapping — its `model`, its reverse `follow` lines', and the same in
 * each of a `set`'s `parts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { typesNamedBy } from '../src/backend/library-types.js'

test('a list mapping names its model and its reverse follow lines', () => {
  assert.deepEqual(
    typesNamedBy({ model: '@acme/a', follow: [{ q: { field: 'x' } }, { k: { model: '@acme/b', field: 'y' } }] }),
    ['@acme/a', '@acme/b'],
  )
})

test("a set names each part's model and its part's reverse follow lines", () => {
  assert.deepEqual(
    typesNamedBy({
      model: '@acme/course',
      shape: 'set',
      parts: [
        { id: 'course', model: '@acme/course', root: true },
        { id: 'lesson', model: '@acme/lesson', follow: [{ k: { model: '@acme/quiz', field: 'y' } }] },
      ],
    }),
    ['@acme/course', '@acme/course', '@acme/lesson', '@acme/quiz'],
  )
})

test('nothing for a non-map', () => {
  assert.deepEqual(typesNamedBy(null), [])
})
