/**
 * Languages asked for that did not go out.
 *
 * ⭐ The publish response carries `locales` — what was actually served — and the
 * CLI wrote it into `deploy.yml` and never compared it to what it sent. So a site
 * live in two of the three languages its author listed reported success and said
 * nothing, which is the exact shape of the failure this whole seam is about: the
 * file and reality disagree, and the terminal is green.
 *
 * ⛔ It is NOT computable from site.yml, which is why the comparison has to use the
 * response: the served set is decided where the publish happens, against the site's
 * own declared set, and a code naming no declared language is ignored rather than
 * refused.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { unservedLanguages } from '../src/commands/publish.js'

test('names what was asked for and not served', () => {
  assert.deepEqual(unservedLanguages(['en', 'fr', 'es'], ['en', 'fr']), ['es'])
  assert.deepEqual(unservedLanguages(['en', 'fr', 'es'], ['en']), ['fr', 'es'])
})

test('says nothing when everything asked for went out', () => {
  assert.deepEqual(unservedLanguages(['en', 'fr'], ['en', 'fr']), [])
  // Order is not a difference — a set was asked for, not a sequence.
  assert.deepEqual(unservedLanguages(['en', 'fr'], ['fr', 'en']), [])
})

test('a site serving MORE than was asked is not reported', () => {
  // A different question, and nobody has it. Inventing a message for it would be
  // machinery for a reason that does not exist.
  assert.deepEqual(unservedLanguages(['en'], ['en', 'fr']), [])
})

test('reports in the order asked, not the order served', () => {
  assert.deepEqual(unservedLanguages(['es', 'fr'], []), ['es', 'fr'])
})

test('⛔ a missing or non-array response says NOTHING — silence beats a false alarm', () => {
  // An older backend that returns no `locales`, or a monolingual site with no
  // languages at all. Reporting "none of your languages went out" there would be
  // alarming and wrong; the honest answer is that we cannot tell.
  assert.deepEqual(unservedLanguages(['en', 'fr'], undefined), [])
  assert.deepEqual(unservedLanguages(['en', 'fr'], null), [])
  assert.deepEqual(unservedLanguages(null, ['en']), [])
  assert.deepEqual(unservedLanguages(undefined, undefined), [])
})
