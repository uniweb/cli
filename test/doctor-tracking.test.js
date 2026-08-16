/**
 * `uniweb doctor` — the `tracking:` block.
 *
 * Every mistake in this block fails the same way: the value is carried to the
 * host as opaque data, nothing downstream rejects it, and the result is an
 * **absence at a visitor's browser** — which is also exactly what a site that
 * configured nothing looks like. No error, no console message, nothing to grep.
 *
 * ⭐ That is the whole argument for checking it here: `doctor` is the only
 * moment in the chain where the person who can fix it is looking at it.
 *
 * The suppressions matter as much as the warnings. A check that fires on correct
 * configuration is how everyone learns to ignore the checker — so the shorthand
 * string, and the documented `consent: none` opt-out, must both stay silent.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkTrackingBlock } from '../src/commands/doctor.js'

/** @returns {string[]} the ids of every issue raised for this block */
function idsFor(tracking) {
  const issues = []
  checkTrackingBlock({ siteName: 'site', siteYml: { tracking }, issues })
  return issues.map((i) => i.id)
}

test('says nothing about a correctly configured block', () => {
  assert.deepEqual(idsFor(undefined), [])
  // The documented shorthand: an endpoint and no options. Nothing to be wrong.
  assert.deepEqual(idsFor('https://collector.example.com/events'), [])
  assert.deepEqual(idsFor({ endpoint: '/collect', consent: 'required' }), [])
  assert.deepEqual(idsFor({ scripts: ['https://vendor.example.com/tag.js'] }), [])
  assert.deepEqual(idsFor({ scripts: [{ src: '/js/local.js' }], debug: true }), [])
})

test('flags a key that is carried and never read', () => {
  assert.deepEqual(idsFor({ endpoint: '/collect', consnet: 'required' }), [
    'tracking-unknown-key'
  ])
})

test('flags a block that is neither a string nor a map', () => {
  assert.deepEqual(idsFor(['https://collector.example.com/events']), ['tracking-not-an-object'])
  assert.deepEqual(idsFor(42), ['tracking-not-an-object'])
})

test('flags a consent value that reads as an attempt but leaves the gate OFF', () => {
  // `consentRequired` is an exact === 'required'. Each of these sends
  // immediately, which is the opposite of what the author asked for.
  for (const value of ['Required', 'require', true, 'yes', 'on']) {
    assert.deepEqual(
      idsFor({ endpoint: '/collect', consent: value }),
      ['tracking-consent-not-required'],
      `expected a warning for consent: ${JSON.stringify(value)}`
    )
  }
})

test('flags a BLANK consent key — YAML reads it as null and the gate is off', () => {
  // `consent:` with nothing after it is the easiest version of this mistake to
  // make and the hardest to see, because the key is visibly present.
  assert.deepEqual(idsFor({ endpoint: '/collect', consent: null }), [
    'tracking-consent-not-required'
  ])
})

test('stays silent on `consent: none`, which is a documented opt-out', () => {
  // Not "anything that is not required": `none` is how a site overrides a gate
  // its HOST declared, under the per-key tier fill. Warning on it would warn
  // about correct code.
  assert.deepEqual(idsFor({ endpoint: '/collect', consent: 'none' }), [])
  assert.deepEqual(idsFor({ endpoint: '/collect', consent: false }), [])
})

test('flags a script entry that can yield no URL', () => {
  // The loader drops these without a sound. Covers the `{ provider, id }` shape
  // too, which resolves to nothing on a lane with no projection to expand it.
  assert.deepEqual(idsFor({ scripts: ['https://ok.example.com/x.js', { nope: 1 }] }), [
    'tracking-script-without-url'
  ])
  assert.deepEqual(idsFor({ scripts: [''] }), ['tracking-script-without-url'])
  assert.deepEqual(idsFor({ scripts: [{ provider: 'google-tag', id: 'GTM-XXXXXXX' }] }), [
    'tracking-script-without-url'
  ])
})

test('reports every independent problem in one pass', () => {
  // Not first-match-wins: an author fixing one and re-running should not
  // discover the next one only then.
  assert.deepEqual(idsFor({ consnet: 1, consent: 'Required', scripts: [{ nope: 1 }] }), [
    'tracking-unknown-key',
    'tracking-consent-not-required',
    'tracking-script-without-url'
  ])
})
