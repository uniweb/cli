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
  flagsFor,
  libraryOptions,
  parseSnapshotArgs,
  pickSite,
  previewDecision,
  previewValueFor
} from '../src/commands/snapshot.js'
import { isAuthoredPreview } from '../src/utils/preview.js'

test('flag values are not mistaken for the site name', () => {
  const { positionals, settings } = parseSnapshotArgs(['--layout', 'split', 'marketing', '--tone=deep'])
  assert.deepEqual(positionals, ['marketing'])
  assert.equal(settings.layout, 'split')
  assert.equal(settings.tone, 'deep')
})

test('look flags become settings; numbers are numbers, --hide repeats, --out is absolute', () => {
  const { settings } = parseSnapshotArgs(
    ['--gap', '24', '--strip', '1:2.5', '--side=left', '--frame', 'plain', '--hide', '.cookie-banner', '--hide=#chat',
      '--size', '1200x630', '--scale', '2', '--quality', '90', '--out', 'card.png'],
    '/work/site'
  )
  assert.deepEqual(settings, {
    gap: 24,
    strip: '1:2.5',
    side: 'left',
    frame: 'plain',
    hide: ['.cookie-banner', '#chat'],
    size: '1200x630',
    scale: 2,
    quality: 90,
    out: join('/work/site', 'card.png')
  })
})

test('run flags are kept apart from the settings', () => {
  const { settings, control } = parseSnapshotArgs(['--dev', '--no-set-preview', '--no-build', '--compare', '--site', 'docs'])
  assert.deepEqual(settings, {})
  assert.deepEqual(control, { dev: true, noSetPreview: true, noBuild: true, compare: true, site: 'docs' })
  assert.equal(parseSnapshotArgs(['--save']).control.save, true)
})

test('a mistyped flag fails, with a suggestion, instead of silently defaulting', () => {
  assert.throws(() => parseSnapshotArgs(['--layot', 'split']), /Unknown flag `--layot`.*`--layout`/)
  assert.throws(() => parseSnapshotArgs(['--overlpa', '10']), /`--overlap`/)
})

test('malformed values fail before anything runs', () => {
  assert.throws(() => parseSnapshotArgs(['--layout']), /needs a value/)
  assert.throws(() => parseSnapshotArgs(['--layout', '--dev']), /needs a value/)
  assert.throws(() => parseSnapshotArgs(['--gap', 'wide']), /needs a number/)
  assert.throws(() => parseSnapshotArgs(['--gap', '10', '--overlap', '5']), /not both/)
  assert.throws(() => parseSnapshotArgs(['--dev', '--url', 'http://localhost:5173']), /not both/)
  assert.throws(() => parseSnapshotArgs(['--compare', '--save']), /--save/)
})

test('the global flags are accepted', () => {
  assert.doesNotThrow(() => parseSnapshotArgs(['--non-interactive']))
})

test('settings become package options: size is a canvas, out is the output', () => {
  assert.deepEqual(libraryOptions({ size: '1200x630', out: '/x/card.png', scale: '2', gap: 48 }), {
    gap: 48,
    canvas: { width: 1200, height: 630 },
    scale: 2,
    output: '/x/card.png'
  })
  assert.throws(() => libraryOptions({ size: '1600' }), /WIDTHxHEIGHT/)
})

test('a variant is captioned with the flags that give it', () => {
  assert.equal(flagsFor({}), 'current')
  assert.equal(flagsFor({ gap: undefined, overlap: 70 }), '--overlap 70')
  assert.equal(flagsFor({ strip: '1:2.5' }), '--strip 1:2.5')
  assert.equal(flagsFor({ layout: 'device' }), '--layout device')
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
