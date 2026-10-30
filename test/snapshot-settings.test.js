/**
 * `site/snapshot.yml` — a site's saved look for `uniweb snapshot`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SETTINGS_FILE,
  SettingsError,
  mergeSettings,
  readSnapshotSettings,
  saveShareSettings,
  saveSnapshotSettings
} from '../src/utils/snapshot-settings.js'

function siteWith(text) {
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-settings-'))
  if (text !== undefined) writeFileSync(join(dir, SETTINGS_FILE), text)
  return dir
}

test('no file means no settings', () => {
  const dir = siteWith()
  try {
    assert.deepEqual(readSnapshotSettings(dir).settings, {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a file is read as written; out is resolved against the site, a single hide becomes a list', () => {
  const dir = siteWith('route: /research\ngap: 48\nstrip: 1:2.5\nhide: "#chat"\nout: public/card.webp\n')
  try {
    assert.deepEqual(readSnapshotSettings(dir).settings, {
      route: '/research',
      gap: 48,
      strip: '1:2.5',
      hide: ['#chat'],
      out: join(dir, 'public', 'card.webp')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unknown setting fails, with a suggestion', () => {
  const dir = siteWith('gapp: 48\n')
  try {
    assert.throws(() => readSnapshotSettings(dir), (err) => err instanceof SettingsError && /`gapp`.*`gap`/.test(err.message))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a file that is not a list of settings fails', () => {
  for (const text of ['gap: [1, 2', '- gap\n- 48\n']) {
    const dir = siteWith(text)
    try {
      assert.throws(() => readSnapshotSettings(dir), SettingsError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('flags win over the file, and a gap or overlap from the flags replaces either', () => {
  assert.deepEqual(mergeSettings({ gap: 48, strip: '1:3', side: 'left' }, { overlap: 70, side: 'right' }), {
    strip: '1:3',
    side: 'right',
    overlap: 70
  })
  assert.deepEqual(mergeSettings({ overlap: 10 }, { strip: 'fit' }), { overlap: 10, strip: 'fit' })
})

test('--save keeps the file and adds this run over it, in a fixed order, and reads back the same', () => {
  const dir = siteWith('# mine\nside: left\ngap: 20\n')
  try {
    const { saved } = saveSnapshotSettings(dir, { overlap: 70, strip: '1:2.5', out: join(dir, 'public', 'og.png') })
    assert.deepEqual(saved, ['overlap', 'strip', 'out'])
    const text = readFileSync(join(dir, SETTINGS_FILE), 'utf8')
    assert.match(text, /^# How `uniweb snapshot` composes/)
    assert.ok(text.indexOf('overlap') < text.indexOf('strip') && text.indexOf('strip') < text.indexOf('side'))
    assert.match(text, /out: public\/og\.png/)
    assert.deepEqual(readSnapshotSettings(dir).settings, {
      overlap: 70,
      strip: '1:2.5',
      side: 'left',
      out: join(dir, 'public', 'og.png')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⛔ a share: block reaches no preview, and paths in it are resolved against the site', () => {
  const dir = siteWith('side: left\nshare:\n  route: /about\n  css: card.css\n  out: public/card.png\n  hide: .chat\n')
  try {
    const { settings, share } = readSnapshotSettings(dir)
    assert.deepEqual(settings, { side: 'left' })
    assert.deepEqual(share, {
      route: '/about',
      css: join(dir, 'card.css'),
      out: join(dir, 'public', 'card.png'),
      hide: ['.chat']
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a file with no share: block reads as it did', () => {
  const dir = siteWith('side: left\n')
  try {
    assert.equal('share' in readSnapshotSettings(dir), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a share: block takes a share image\'s settings and no look, with a suggestion', () => {
  for (const [text, expected] of [
    ['share:\n  gap: 10\n', /unknown setting `gap`/],
    ['share:\n  rout: /about\n', /Did you mean `route`/],
    ['share: yes\n', /should be a list of settings/]
  ]) {
    const dir = siteWith(text)
    try {
      assert.throws(() => readSnapshotSettings(dir), (err) => err instanceof SettingsError && expected.test(err.message))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('⭐ saving a preview\'s look keeps the share: block, and saving a share image keeps the look', () => {
  const dir = siteWith('side: left\nshare:\n  route: /about\n  css: card.css\n')
  try {
    saveSnapshotSettings(dir, { gap: 20 })
    let read = readSnapshotSettings(dir)
    assert.deepEqual(read.settings, { side: 'left', gap: 20 })
    assert.deepEqual(read.share, { route: '/about', css: join(dir, 'card.css') })

    const { saved } = saveShareSettings(dir, { hide: ['.chat'], out: join(dir, 'public', 'card.png') })
    assert.deepEqual(saved, ['hide', 'out'])
    read = readSnapshotSettings(dir)
    assert.deepEqual(read.settings, { side: 'left', gap: 20 })
    assert.deepEqual(read.share, { route: '/about', hide: ['.chat'], css: join(dir, 'card.css'), out: join(dir, 'public', 'card.png') })
    const text = readFileSync(join(dir, SETTINGS_FILE), 'utf8')
    assert.match(text, /css: card\.css/)
    assert.match(text, /out: public\/card\.png/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('saving a share image into a site with no file writes only that block', () => {
  const dir = siteWith()
  try {
    saveShareSettings(dir, { route: '/about' })
    assert.deepEqual(readSnapshotSettings(dir).settings, {})
    assert.deepEqual(readSnapshotSettings(dir).share, { route: '/about' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
