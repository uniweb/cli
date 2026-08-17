/**
 * uploadSiteMedia — resolves a site's site-root media refs under public/, uploads them
 * through the asset lane, and returns the { ref → serveUrl } map the deploy rewrites the
 * entity content with. Mock client; a temp site with a public/ image as the real artifact.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  uploadSiteMedia,
  describeAssetRefusal
} from '../src/backend/site-media.js'

function makeSite() {
  const dir = mkdtempSync(join(tmpdir(), 'uw-media-'))
  mkdirSync(join(dir, 'public', 'images'), { recursive: true })
  writeFileSync(join(dir, 'public', 'images', 'banner.png'), 'PNGDATA')
  return dir
}

test('uploadSiteMedia resolves site-root refs under public/, uploads, returns ref→serveUrl (prefers serve_url)', async () => {
  const dir = makeSite()
  let captured = null
  const client = {
    origin: 'http://x',
    discover: async () => ({ assetBase: '/media-root/' }),
    uploadSiteAssets: async ({ files }) => {
      captured = files
      return {
        failed: [],
        assetsByLocalUrl: {
          '/images/banner.png': {
            id: 'SHA1',
            ext: 'png',
            serveUrl: '/media-root/dist/SHA1/base.png'
          }
        }
      }
    }
  }
  try {
    const { map } = await uploadSiteMedia(client, dir, ['/images/banner.png'])
    // one file uploaded: content-typed, sha256'd, keyed by the original ref
    assert.equal(captured.length, 1)
    assert.equal(captured[0].localUrl, '/images/banner.png')
    assert.equal(captured[0].content_type, 'image/png')
    assert.ok(captured[0].sha256)
    // the map embeds the backend's canonical serve_url
    assert.deepEqual(map, {
      '/images/banner.png': '/media-root/dist/SHA1/base.png'
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadSiteMedia skips (and warns) a ref whose file is missing', async () => {
  const dir = makeSite()
  const warnings = []
  const client = {
    origin: 'http://x',
    discover: async () => ({ assetBase: '/media-root/' }),
    uploadSiteAssets: async ({ files }) => ({
      failed: [],
      assetsByLocalUrl: Object.fromEntries(
        files.map((f) => [
          f.localUrl,
          { id: 'S', ext: 'png', serveUrl: `srv:${f.localUrl}` }
        ])
      )
    })
  }
  try {
    const { map, missing, failed } = await uploadSiteMedia(
      client,
      dir,
      ['/images/banner.png', '/images/missing.png'],
      { warn: (m) => warnings.push(m) }
    )
    assert.deepEqual(Object.keys(map), ['/images/banner.png']) // only the existing file
    assert.ok(
      warnings.some((m) => m.includes('missing.png') && m.includes('not found'))
    )
    // A missing FILE is an authoring mistake, reported apart from a failed upload:
    // callers block a push on `failed`, not on `missing`.
    assert.deepEqual(missing, ['/images/missing.png'])
    assert.deepEqual(failed, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadSiteMedia REFUSES a ref whose plan entry omits serve_url — never composes one', async () => {
  // Until 2026-08-17 this fell back to composing `{assetBase}dist/{id}/base.{ext}`,
  // which defaulted to one hardcoded production host for every deployment the CLI
  // can target. A guessed location is silently wrong; a missing one is visibly
  // missing, so the ref joins `failed` and publish refuses.
  const dir = makeSite()
  const client = {
    origin: 'http://x',
    // Discovery would have supplied a base to compose from — the control: if
    // anything reconstructs, the ref lands in `map` and this test fails.
    discover: async () => ({ assetBase: '/media-root/' }),
    uploadSiteAssets: async () => ({
      failed: [],
      assetsByLocalUrl: { '/images/banner.png': { id: 'SHA9', ext: 'png' } }
    }) // no serveUrl
  }
  try {
    const warnings = []
    const { map, failed } = await uploadSiteMedia(
      client,
      dir,
      ['/images/banner.png'],
      { warn: (m) => warnings.push(m) }
    )
    assert.deepEqual(map, {}, 'must not invent a serve URL')
    assert.equal(failed.length, 1)
    assert.equal(failed[0].path, '/images/banner.png')
    assert.match(failed[0].detail, /serve_url/)
    assert.ok(warnings.some((w) => w.includes('/images/banner.png')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadSiteMedia is a no-op for no refs (never touches the lane)', async () => {
  const client = {
    origin: 'http://x',
    discover: async () => ({ assetBase: '/' }),
    uploadSiteAssets: async () => {
      throw new Error('should not upload')
    }
  }
  assert.deepEqual(await uploadSiteMedia(client, '/tmp', []), {
    map: {},
    ids: {},
    missing: [],
    failed: []
  })
})

test('uploadSiteMedia reports a failed upload separately from a missing file', async () => {
  // The distinction the callers act on: bytes that did not land must block the
  // push/publish, because the content would otherwise ship still naming the local
  // path — a broken image whose only trace is a warning.
  const dir = makeSite()
  const client = {
    origin: 'http://x',
    discover: async () => ({ assetBase: '/media-root/' }),
    uploadSiteAssets: async () => ({
      failed: [
        { path: 'images/banner.png', status: 507, detail: 'over quota' }
      ],
      assetsByLocalUrl: {}
    })
  }
  try {
    const { map, missing, failed } = await uploadSiteMedia(client, dir, [
      '/images/banner.png'
    ])
    assert.deepEqual(map, {})
    assert.deepEqual(missing, [])
    assert.equal(failed.length, 1)
    assert.equal(failed[0].status, 507)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─── describeAssetRefusal ─────────────────────────────────────────────────────
// Replaces the deleted `isStorageRefusal` status regex. Two wording rules here are
// load-bearing (see the JSDoc): a storage refusal must not be sized from what
// transferred, and must never advise removing an image to free quota.

test('describeAssetRefusal returns null for a refusal carrying no problem body', () => {
  // Every refusal shipped TODAY is prose — the typed reasons are agreed but not yet
  // emitted. Null means "fall through to the generic message", so this must degrade.
  assert.equal(
    describeAssetRefusal(new Error('Asset plan failed: HTTP 500 Server Error')),
    null
  )
  assert.equal(
    describeAssetRefusal(Object.assign(new Error('x'), { problem: null })),
    null
  )
  assert.equal(
    describeAssetRefusal(
      Object.assign(new Error('x'), { problem: { detail: 'prose' } })
    ),
    null
  )
  assert.equal(describeAssetRefusal(null), null)
})

test('describeAssetRefusal reports a storage refusal with its numbers', () => {
  const err = Object.assign(new Error('Asset plan failed: HTTP 507'), {
    status: 507,
    problem: {
      reason: 'storage_quota_exceeded',
      used_bytes: 5 * 1024 * 1024 * 1024,
      limit_bytes: 5368709120,
      needed_bytes: 12582912
    }
  })
  const out = describeAssetRefusal(err)
  assert.match(out.headline, /Storage quota reached/)
  assert.match(out.headline, /site owner's workspace/)
  const body = out.notes.join('\n')
  assert.match(body, /Used: 5 GiB/)
  assert.match(body, /Limit: 5 GiB/)
  assert.match(body, /This publish adds: 12 MiB/)
})

test('a storage refusal never advises removing an image, and never sizes itself from what transferred', () => {
  const err = Object.assign(new Error('x'), {
    problem: {
      reason: 'storage_quota_exceeded',
      used_bytes: 1024,
      limit_bytes: 2048,
      needed_bytes: 4096
    }
  })
  const body = describeAssetRefusal(err).notes.join('\n').toLowerCase()
  // Rule 2 — freeing is entity-deletion-granular; the old predicate's "remove or
  // shrink assets, then re-run" is wrong advice under it.
  assert.ok(!/remove or shrink/.test(body))
  assert.ok(/deleting the site or entity/.test(body))
  assert.ok(/removing an image from content does not free it/.test(body))
  // Rule 1 — needed_bytes can be non-zero with ZERO transfers, so the message must
  // not describe "the files being uploaded".
  assert.ok(!/files being uploaded/.test(body))
  // Rule 3 — the allowance is the site OWNER's; "your storage" misdirects every
  // contributor who is not the owner.
  assert.ok(!/your storage/.test(body))
  assert.ok(!/bytes uploaded/.test(body))
})

test('describeAssetRefusal names the offending file for a per-file cap', () => {
  const err = Object.assign(new Error('x'), {
    problem: {
      reason: 'asset_file_too_large',
      path: 'images/huge.png',
      size_bytes: 100 * 1024 * 1024,
      limit_bytes: 64 * 1024 * 1024
    }
  })
  const out = describeAssetRefusal(err)
  assert.match(out.headline, /images\/huge\.png/)
  assert.match(
    out.notes.join('\n'),
    /Size: 100 MiB[\s\S]*Per-file limit: 64 MiB/
  )
})

test('describeAssetRefusal covers the two plan caps and surfaces an unknown reason', () => {
  const big = describeAssetRefusal(
    Object.assign(new Error('x'), {
      problem: {
        reason: 'asset_plan_too_large',
        requested_bytes: 600 * 1024 * 1024,
        limit_bytes: 512 * 1024 * 1024
      }
    })
  )
  assert.match(big.headline, /Too many bytes/)
  assert.match(big.notes.join('\n'), /Per-publish limit: 512 MiB/)

  const many = describeAssetRefusal(
    Object.assign(new Error('x'), {
      problem: { reason: 'asset_plan_too_many_files', files: 2000, limit: 1024 }
    })
  )
  assert.match(many.headline, /Too many asset files/)
  assert.match(
    many.notes.join('\n'),
    /Files: 2000[\s\S]*Per-publish limit: 1024/
  )

  // An unrecognised reason is surfaced, not swallowed — but we invent no advice.
  const odd = describeAssetRefusal(
    Object.assign(new Error('x'), { problem: { reason: 'some_new_reason' } })
  )
  assert.match(odd.headline, /some_new_reason/)
  assert.deepEqual(odd.notes, [])
})

test('a refusal with a missing extra still produces usable lines (no "undefined" at the user)', () => {
  const out = describeAssetRefusal(
    Object.assign(new Error('x'), {
      problem: { reason: 'storage_quota_exceeded' }
    })
  )
  assert.match(out.headline, /Storage quota reached/)
  assert.ok(!out.notes.join('\n').includes('undefined'))
})
