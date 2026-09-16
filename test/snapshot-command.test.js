/**
 * `uniweb snapshot` — the parts this CLI owns: reading its flags, choosing the
 * site, and deciding what happens to site.yml's `preview:`. Capturing and
 * composing belong to @uniweb/snapshot and are tested there.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import {
  DEFAULT_OUTPUT,
  parseSnapshotArgs,
  pickSite,
  previewDecision,
  previewValueFor
} from '../src/commands/snapshot.js'
import { isAuthoredPreview } from '../src/utils/preview.js'

test('flag values are not mistaken for the site name', () => {
  const options = parseSnapshotArgs(['--layout', 'split', 'marketing', '--tone=deep'])
  assert.deepEqual(options.positionals, ['marketing'])
  assert.equal(options.layout, 'split')
  assert.equal(options.tone, 'deep')
})

test('--hide repeats; --size, --scale and --quality become numbers', () => {
  const options = parseSnapshotArgs([
    '--hide', '.cookie-banner',
    '--hide=#chat',
    '--size', '1200x630',
    '--scale', '2',
    '--quality', '90'
  ])
  assert.deepEqual(options.hide, ['.cookie-banner', '#chat'])
  assert.deepEqual(options.canvas, { width: 1200, height: 630 })
  assert.equal(options.scale, 2)
  assert.equal(options.quality, 90)
})

test('boolean flags', () => {
  const options = parseSnapshotArgs(['--dev', '--no-set-preview', '--no-build'])
  assert.equal(options.dev, true)
  assert.equal(options.noSetPreview, true)
  assert.equal(options.noBuild, true)
})

test('a mistyped flag fails, with a suggestion, instead of silently defaulting', () => {
  assert.throws(() => parseSnapshotArgs(['--layot', 'split']), /Unknown flag `--layot`.*`--layout`/)
})

test('bad values fail before anything runs', () => {
  assert.throws(() => parseSnapshotArgs(['--layout']), /needs a value/)
  assert.throws(() => parseSnapshotArgs(['--layout', '--dev']), /needs a value/)
  assert.throws(() => parseSnapshotArgs(['--layout', 'tilt']), /auto, split or device/)
  assert.throws(() => parseSnapshotArgs(['--size', '1600']), /WIDTHxHEIGHT/)
  assert.throws(() => parseSnapshotArgs(['--scale', '3']), /1 or 2/)
  assert.throws(() => parseSnapshotArgs(['--quality', '0']), /1 to 100/)
  assert.throws(() => parseSnapshotArgs(['--dev', '--url', 'http://localhost:5173']), /not both/)
})

test('the global flags are accepted', () => {
  assert.doesNotThrow(() => parseSnapshotArgs(['--non-interactive']))
})

test('the default image lives in public/, so it has a site path', () => {
  const siteDir = join('/work', 'site')
  assert.equal(previewValueFor(siteDir, join(siteDir, DEFAULT_OUTPUT)), '/preview.webp')
  assert.equal(previewValueFor(siteDir, join(siteDir, 'public', 'images', 'card.png')), '/images/card.png')
  assert.equal(previewValueFor(siteDir, join(siteDir, 'preview.webp')), null)
  assert.equal(previewValueFor(siteDir, join('/elsewhere', 'card.webp')), null)
})

test("preview: is written when absent, replaces the app's token, and never an author's address", () => {
  assert.equal(previewDecision(undefined, '/preview.webp'), 'set')
  assert.equal(previewDecision('', '/preview.webp'), 'set')
  assert.equal(previewDecision('/preview.webp', '/preview.webp'), 'unchanged')
  assert.equal(previewDecision('2026-09-10T12:34:56Z', '/preview.webp'), 'replace')
  assert.equal(previewDecision('/images/card.png', '/preview.webp'), 'keep')
  assert.equal(previewDecision('https://example.com/card.png', '/preview.webp'), 'keep')
  // A relative path with no leading `./` is still the author's.
  assert.equal(previewDecision('images/card.png', '/preview.webp'), 'keep')
})

test('isAuthoredPreview recognizes the author, whatever shape the app token takes', () => {
  for (const address of [
    '/images/card.png',
    './card.png',
    '../shared/card.png',
    'images/card.png',
    'card.webp',
    'https://cdn.example.com/card.png'
  ]) {
    assert.equal(isAuthoredPreview(address), true, address)
  }
  for (const token of ['2026-09-10T12:34:56Z', '2026-09-10T12:34:56.123Z', '1757970000', undefined]) {
    assert.equal(isAuthoredPreview(token), false, String(token))
  }
})

test('the site: named, else the one you are in, else the only one', () => {
  const root = join('/work')
  const sites = [
    { name: 'docs', path: 'docs/site' },
    { name: 'marketing', path: 'marketing/site' }
  ]
  assert.equal(pickSite(sites, root, { requested: 'docs', cwd: root }).site.name, 'docs')
  assert.equal(pickSite(sites, root, { requested: 'marketing/site', cwd: root }).site.name, 'marketing')
  assert.equal(pickSite(sites, root, { requested: 'nope', cwd: root }).site, null)
  assert.equal(
    pickSite(sites, root, { cwd: join(root, 'marketing', 'site', 'pages') }).site.name,
    'marketing'
  )
  const fromRoot = pickSite(sites, root, { cwd: root })
  assert.equal(fromRoot.site.name, 'docs')
  assert.equal(fromRoot.ambiguous, true)
  assert.equal(pickSite([sites[1]], root, { cwd: root }).ambiguous, false)
})
