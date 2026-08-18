/**
 * uploadDataFiles — the successor to the data ball: each `dist/data/**` file
 * uploaded as its own asset, returning the `{ relpath → serve URL }` map that
 * rides as `info.data`.
 *
 * The properties worth pinning are the ones that were argued rather than
 * assumed: ONE plan call (the file cap counts a plan, so splitting would evade
 * it rather than respect it), real relpaths on the plan instead of a
 * bookkeeping name, serve URLs READ rather than composed, and an absent
 * serve_url failing the publish instead of inventing a location.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uploadDataFiles } from '../src/backend/data-files.js'

/** A client that records what it was asked to upload and answers plausibly. */
function stubClient({ serveUrlFor = (p) => `/gateway/asset/dist/${p}/base.json`, omit = [] } = {}) {
  const calls = []
  return {
    calls,
    async uploadSiteAssets({ files, siteUuid }) {
      calls.push({ files, siteUuid })
      const assetsByLocalUrl = {}
      for (const f of files) {
        if (omit.includes(f.path)) continue
        assetsByLocalUrl[f.localUrl] = { id: 'x', ext: 'json', serveUrl: serveUrlFor(f.path) }
      }
      return { failed: [], assetsByLocalUrl }
    }
  }
}

const BALL = {
  data: {
    'articles.json': [{ slug: 'a' }],
    'articles/design-tips.json': { slug: 'design-tips', body: 'x' }
  }
}

test('nothing to deliver → null, and the lane is never called', async () => {
  for (const empty of [null, undefined, { data: {} }]) {
    const client = stubClient()
    assert.equal(await uploadDataFiles(client, empty), null)
    assert.equal(client.calls.length, 0, 'must not open a plan for zero files')
  }
})

test('ONE plan call for the whole set, not one per file', async () => {
  // Load-bearing: both backend caps are per REQUEST with no cumulative
  // accounting, so splitting across plans would evade the cap rather than
  // respect it. If a set ever exceeds it, the refusal is the correct outcome.
  const client = stubClient()
  await uploadDataFiles(client, BALL, { siteUuid: 'site-1' })

  assert.equal(client.calls.length, 1)
  assert.equal(client.calls[0].files.length, 2)
  assert.equal(client.calls[0].siteUuid, 'site-1', 'owner must ride, or the bytes are unbilled')
})

test('the plan carries REAL relpaths, not a bookkeeping name', async () => {
  const client = stubClient()
  await uploadDataFiles(client, BALL)

  const paths = client.calls[0].files.map((f) => f.path).sort()
  assert.deepEqual(paths, ['data/articles.json', 'data/articles/design-tips.json'])
  // The ball's placeholder must not survive into the successor.
  assert.ok(!paths.some((p) => p.includes('base.json')))
})

test('each file rides as JSON bytes with its own sha256', async () => {
  const client = stubClient()
  await uploadDataFiles(client, BALL)

  const [a, b] = client.calls[0].files
  for (const f of [a, b]) {
    assert.equal(f.content_type, 'application/json')
    assert.ok(Buffer.isBuffer(f.bytes), 'in-memory payload, no file on disk')
    assert.equal(f.size, f.bytes.length)
    assert.match(f.sha256, /^[0-9a-f]{64}$/)
  }
  assert.notEqual(a.sha256, b.sha256, 'different content must address differently')
  // The bytes must be the record itself — a consumer serves them verbatim.
  assert.deepEqual(JSON.parse(a.bytes.toString()), BALL.data[a.path.replace('data/', '')])
})

test('the map is keyed by RELPATH and its values are read verbatim', async () => {
  // Origin-relative included: where a host serves an object is its own
  // business, and composing one couples us to a layout that is not ours.
  const client = stubClient({ serveUrlFor: (p) => `/srv/${p}?v=1` })
  const map = await uploadDataFiles(client, BALL)

  assert.deepEqual(map, {
    'articles.json': '/srv/data/articles.json?v=1',
    'articles/design-tips.json': '/srv/data/articles/design-tips.json?v=1'
  })
  for (const v of Object.values(map)) assert.ok(!v.startsWith('http'), 'must not absolutize')
})

test('an absent serve_url FAILS the publish rather than inventing a location', async () => {
  const client = stubClient({ omit: ['data/articles.json'] })
  await assert.rejects(
    () => uploadDataFiles(client, BALL),
    /no serve_url for data\/articles\.json/,
    'an unaddressable file must stop the publish, not ship a URL nobody claimed'
  )
})

test('a failed upload surfaces the transport status', async () => {
  const client = {
    async uploadSiteAssets() {
      return { failed: [{ status: 413, detail: 'too large' }], assetsByLocalUrl: {} }
    }
  }
  await assert.rejects(() => uploadDataFiles(client, BALL), /HTTP 413/)
})
