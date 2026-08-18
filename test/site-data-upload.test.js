/**
 * The static-data passthrough lane: plan once, PUT per file, return NO map.
 *
 * The properties worth pinning are the ones that were argued rather than
 * assumed — each cost a round in channel `backend-framework-35b8`:
 *
 *   - `{site}` is a PATH segment, not a body field (the asset lane was the
 *     wrong precedent: it is global, this is per-site);
 *   - `path` is the SERVING tail, which is why no map exists;
 *   - one plan for the set, because the file cap counts a plan;
 *   - a presigned PUT must NOT carry the bearer;
 *   - a file the plan did not answer for FAILS rather than being guessed at.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uploadSiteData } from '../src/utils/site-data-upload.js'

const BALL = {
  data: {
    'articles.json': [{ slug: 'a' }],
    'articles/design-tips.json': { slug: 'design-tips', body: 'x' }
  }
}

/** Records every request, answers a plan in the ratified shape. */
function stubFetch({ mode = 'presigned', serveBase = null, omit = [], planStatus = 200 } = {}) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    calls.push({ url: u, init })
    if (u.includes('/dev/site/data-uploads/')) {
      if (planStatus !== 200) {
        return { ok: false, status: planStatus, text: async () => 'nope' }
      }
      const body = JSON.parse(init.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          mode,
          expires_in: mode === 'presigned' ? 900 : null,
          serve_base: serveBase,
          uploads: body.files
            .filter((f) => !omit.includes(f.path))
            .map((f) => ({
              path: f.path,
              method: 'PUT',
              url: mode === 'presigned' ? `https://storage.test/${f.path}?sig=x` : `/dev/blob/${f.path}`,
              headers: { 'x-plan': '1' }
            }))
        })
      }
    }
    return { ok: true, status: 200 }
  }
  return calls
}

const ARGS = { apiBase: 'http://backend.test', token: 'TKN', siteUuid: 'site-1' }

test('no files → no plan call at all', async () => {
  const calls = stubFetch()
  for (const ball of [null, undefined, { data: {} }]) {
    const r = await uploadSiteData({ ...ARGS, ball })
    assert.equal(r.mode, 'none')
    assert.deepEqual(r.uploaded, [])
  }
  assert.equal(calls.length, 0)
})

test('the site is a PATH segment and the body carries only files', async () => {
  const calls = stubFetch()
  await uploadSiteData({ ...ARGS, ball: BALL })

  const plan = calls[0]
  assert.equal(plan.url, 'http://backend.test/dev/site/data-uploads/site-1')
  const body = JSON.parse(plan.init.body)
  assert.deepEqual(Object.keys(body), ['files'], 'no entity/site field in the body')
  assert.equal(body.files.length, 2)
})

test('ONE plan for the whole set, then one PUT per file', async () => {
  const calls = stubFetch()
  await uploadSiteData({ ...ARGS, ball: BALL })

  const plans = calls.filter((c) => c.url.includes('/data-uploads/'))
  assert.equal(plans.length, 1, 'splitting across plans would evade the file cap, not respect it')
  assert.equal(calls.length - plans.length, 2)
})

test('paths are the tail RELATIVE TO THE DATA ROOT — no `data/` prefix', async () => {
  // ⚠️ The prefix would be invisible if wrong: the plan succeeds, the PUT
  // succeeds, and only a visitor's fetch 404s. `serve_base` already ends in
  // `/data/` and the runtime asks `{base}/data/{name}.json`, so a `data/`
  // prefix here stores one level too deep and serves where nothing looks.
  const calls = stubFetch()
  const r = await uploadSiteData({ ...ARGS, ball: BALL })

  const paths = JSON.parse(calls[0].init.body).files.map((f) => f.path).sort()
  assert.deepEqual(paths, ['articles.json', 'articles/design-tips.json'])
  assert.ok(!paths.some((p) => p.startsWith('data/')), 'serve_base already carries it')
  assert.deepEqual(r.uploaded.sort(), paths)
  // The point of the lane: the file is at its serving path, so nothing records it.
  assert.ok(!('map' in r), 'this lane returns no map, by design')
})

test('a presigned PUT must NOT carry the bearer', async () => {
  const calls = stubFetch({ mode: 'presigned' })
  await uploadSiteData({ ...ARGS, ball: BALL })

  for (const put of calls.filter((c) => c.init.method === 'PUT')) {
    assert.ok(put.url.startsWith('https://storage.test/'), 'absolute storage URL')
    assert.equal(put.init.headers.Authorization, undefined,
      'a foreign bearer can break signed-request validation')
    assert.equal(put.init.headers['x-plan'], '1', 'plan headers must survive')
  }
})

test('a direct PUT DOES carry the bearer, and resolves against the origin', async () => {
  const calls = stubFetch({ mode: 'direct', serveBase: '/gateway/site/site-1/data/' })
  const r = await uploadSiteData({ ...ARGS, ball: BALL })

  for (const put of calls.filter((c) => c.init.method === 'PUT')) {
    assert.ok(put.url.startsWith('http://backend.test/dev/blob/'), 'relative → origin')
    assert.equal(put.init.headers.Authorization, 'Bearer TKN')
  }
  assert.equal(r.serveBase, '/gateway/site/site-1/data/')
})

test('a file the plan did not answer for FAILS rather than being guessed at', async () => {
  stubFetch({ omit: ['articles.json'] })
  const r = await uploadSiteData({ ...ARGS, ball: BALL })

  assert.deepEqual(r.uploaded, ['articles/design-tips.json'])
  assert.equal(r.failed.length, 1)
  assert.match(r.failed[0].detail, /no upload target/)
})

test('a rejected plan throws with the status', async () => {
  stubFetch({ planStatus: 404 })
  await assert.rejects(() => uploadSiteData({ ...ARGS, ball: BALL }), /HTTP 404/)
})
