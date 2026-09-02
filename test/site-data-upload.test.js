/**
 * The static-data passthrough lane: plan once, PUT per file, return NO map.
 *
 * The properties worth pinning are the ones that were argued rather than
 * assumed — each cost a round with the backend lane:
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
import {
  uploadSiteData,
  describeDataRefusal
} from '../src/utils/site-data-upload.js'

const BALL = {
  data: {
    'articles.json': [{ slug: 'a' }],
    'articles/design-tips.json': { slug: 'design-tips', body: 'x' }
  }
}

/** Records every request, answers a plan in the ratified shape. */
function stubFetch({
  mode = 'presigned',
  serveBase = null,
  omit = [],
  planStatus = 200
} = {}) {
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
              url:
                mode === 'presigned'
                  ? `https://storage.test/${f.path}?sig=x`
                  : `/dev/blob/${f.path}`,
              headers: { 'x-plan': '1' }
            }))
        })
      }
    }
    return { ok: true, status: 200 }
  }
  return calls
}

const ARGS = {
  apiBase: 'http://backend.test',
  token: 'TKN',
  siteUuid: 'site-1'
}

// ⛔ INVERTED 2026-09-01. This test asserted `no files → no plan call at all`,
// and it was pinning the defect rather than the contract: it made the *absence*
// of a request the specified behaviour for an empty set, which is exactly what
// left "the user deleted their last collection" unsayable on a lane the backend
// reconciles against. The test was green for as long as the bug existed, because
// the bug was what it described.
//
// ⭐ Kept, inverted, rather than deleted — the old expectation is the useful part
// of the record. Channel backend-framework-82f2.
test('no files → a plan call carrying an EMPTY manifest', async () => {
  const calls = stubFetch()
  for (const ball of [null, undefined, { data: {} }]) {
    const r = await uploadSiteData({ ...ARGS, ball })
    assert.deepEqual(r.uploaded, [])
    assert.deepEqual(r.failed, [])
  }
  assert.equal(
    calls.length,
    3,
    'one plan per publish, including the empty ones'
  )
  for (const c of calls)
    assert.deepEqual(
      JSON.parse(c.init.body).files,
      [],
      'present and empty — the statement "there are none"'
    )
})

test('the site is a PATH segment and the body carries only files', async () => {
  const calls = stubFetch()
  await uploadSiteData({ ...ARGS, ball: BALL })

  const plan = calls[0]
  assert.equal(plan.url, 'http://backend.test/dev/site/data-uploads/site-1')
  const body = JSON.parse(plan.init.body)
  assert.deepEqual(
    Object.keys(body),
    ['files'],
    'no entity/site field in the body'
  )
  assert.equal(body.files.length, 2)
})

test('ONE plan for the whole set, then one PUT per file', async () => {
  const calls = stubFetch()
  await uploadSiteData({ ...ARGS, ball: BALL })

  const plans = calls.filter((c) => c.url.includes('/data-uploads/'))
  assert.equal(
    plans.length,
    1,
    'splitting across plans would evade the file cap, not respect it'
  )
  assert.equal(calls.length - plans.length, 2)
})

test('paths are the tail RELATIVE TO THE DATA ROOT — no `data/` prefix', async () => {
  // ⚠️ The prefix would be invisible if wrong: the plan succeeds, the PUT
  // succeeds, and only a visitor's fetch 404s. `serve_base` already ends in
  // `/data/` and the runtime asks `{base}/data/{name}.json`, so a `data/`
  // prefix here stores one level too deep and serves where nothing looks.
  const calls = stubFetch()
  const r = await uploadSiteData({ ...ARGS, ball: BALL })

  const paths = JSON.parse(calls[0].init.body)
    .files.map((f) => f.path)
    .sort()
  assert.deepEqual(paths, ['articles.json', 'articles/design-tips.json'])
  assert.ok(
    !paths.some((p) => p.startsWith('data/')),
    'serve_base already carries it'
  )
  assert.deepEqual(r.uploaded.sort(), paths)
  // The point of the lane: the file is at its serving path, so nothing records it.
  assert.ok(!('map' in r), 'this lane returns no map, by design')
})

test('a presigned PUT must NOT carry the bearer', async () => {
  const calls = stubFetch({ mode: 'presigned' })
  await uploadSiteData({ ...ARGS, ball: BALL })

  for (const put of calls.filter((c) => c.init.method === 'PUT')) {
    assert.ok(
      put.url.startsWith('https://storage.test/'),
      'absolute storage URL'
    )
    assert.equal(
      put.init.headers.Authorization,
      undefined,
      'a foreign bearer can break signed-request validation'
    )
    assert.equal(put.init.headers['x-plan'], '1', 'plan headers must survive')
  }
})

test('a direct PUT DOES carry the bearer, and resolves against the origin', async () => {
  const calls = stubFetch({
    mode: 'direct',
    serveBase: '/gateway/site/site-1/data/'
  })
  const r = await uploadSiteData({ ...ARGS, ball: BALL })

  for (const put of calls.filter((c) => c.init.method === 'PUT')) {
    assert.ok(
      put.url.startsWith('http://backend.test/dev/blob/'),
      'relative → origin'
    )
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
  await assert.rejects(
    () => uploadSiteData({ ...ARGS, ball: BALL }),
    /HTTP 404/
  )
})

// ─── an empty set is a STATEMENT, not a silence ──────────────────────────────
// The backend reconciles a site's data usage against this manifest: whatever is
// not in it is gone. So a plan carrying zero files says "this site now serves no
// data files" and frees the rest — while NO REQUEST says nothing at all, and is
// indistinguishable from a publish that never ran.
//
// ⛔ Until 2026-09-01 this lane returned early on an empty set and `publish.js`
// guarded the call with `if (ball)`, so deleting your LAST schema-less collection
// — the one operation the reconcile exists to make free — was the single thing
// that could not be expressed. The site kept paying until it was deleted, with no
// error and no warning at either end.
//
// Agreed both sides in channel backend-framework-82f2; their route accepts an
// empty `files` array as of that exchange (it was a 400 before).

test('an EMPTY ball still posts a manifest — silence and "none" are different', async () => {
  const seen = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('/data-uploads/')) {
      seen.push(JSON.parse(opts.body))
      return {
        ok: true,
        status: 200,
        json: async () => ({ mode: 'direct', uploads: [] })
      }
    }
    return { ok: true, status: 200 }
  }
  try {
    for (const ball of [{ data: {} }, null]) {
      seen.length = 0
      const r = await uploadSiteData({
        apiBase: 'http://localhost:8080',
        token: 't',
        siteUuid: 'SITE-1',
        ball
      })
      assert.equal(
        seen.length,
        1,
        `no plan was posted for ball=${JSON.stringify(ball)}`
      )
      assert.deepEqual(
        seen[0].files,
        [],
        'the manifest must be present and empty — not absent, not omitted'
      )
      assert.deepEqual(r.uploaded, [])
      assert.deepEqual(r.failed, [])
    }
  } finally {
    globalThis.fetch = realFetch
  }
})

test('the empty manifest goes to the same per-site route as a full one', async () => {
  // CONTROL for the test above: an empty plan that posted to the wrong place, or
  // without the site segment, would reconcile the wrong site — or none.
  const urls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    return {
      ok: true,
      status: 200,
      json: async () => ({ mode: 'direct', uploads: [] })
    }
  }
  try {
    await uploadSiteData({
      apiBase: 'http://localhost:8080',
      token: 't',
      siteUuid: 'SITE-1',
      ball: { data: {} }
    })
    assert.deepEqual(urls, [
      'http://localhost:8080/dev/site/data-uploads/SITE-1'
    ])
  } finally {
    globalThis.fetch = realFetch
  }
})

// ─── the THIRD door's refusal: typed, not a JSON dump ────────────────────────
// `/dev/assets` and `POST /dev/site` both describe a typed refusal; this lane
// threw prose with the problem document inlined until 2026-09-01, so a `507`
// here printed raw JSON at the user. Backend confirmed a quota refusal is now
// possible on this route (channel backend-framework-82f2), in the same shape.

const QUOTA_507 = JSON.stringify({
  status: 507,
  title: 'Insufficient Storage',
  detail: "this upload would exceed the workspace's storage allowance",
  reason: 'storage_quota_exceeded',
  used_bytes: 1073741824,
  limit_bytes: 1073741824,
  needed_bytes: 5242880
})

/** Stub whose PLAN call fails with the given status/body. */
function stubPlanFailure(status, body) {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/data-uploads/'))
      return {
        ok: false,
        status,
        statusText: 'Insufficient Storage',
        text: async () => body
      }
    return { ok: true, status: 200 }
  }
}

test('a plan refusal carries status + the PARSED problem on the thrown error', async () => {
  const realFetch = globalThis.fetch
  stubPlanFailure(507, QUOTA_507)
  try {
    const err = await uploadSiteData({ ...ARGS, ball: BALL }).then(
      () => null,
      (e) => e
    )
    assert.ok(err, 'the plan failure must throw')
    assert.equal(err.status, 507)
    assert.equal(err.problem.reason, 'storage_quota_exceeded')
    assert.equal(err.problem.needed_bytes, 5242880)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a prose (non-JSON) refusal leaves problem null rather than throwing twice', async () => {
  const realFetch = globalThis.fetch
  stubPlanFailure(500, '<html>nginx</html>')
  try {
    const err = await uploadSiteData({ ...ARGS, ball: BALL }).then(
      () => null,
      (e) => e
    )
    assert.equal(err.problem, null)
    assert.match(err.message, /HTTP 500/)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('describeDataRefusal accounts for a quota refusal with the numbers', () => {
  const r = describeDataRefusal({ problem: JSON.parse(QUOTA_507) })
  assert.match(r.headline, /Storage quota reached/i)
  assert.match(r.headline, /record data/i)
  const body = r.notes.join('\n')
  assert.match(body, /Used: 1 GiB/)
  assert.match(body, /Limit: 1 GiB/)
  assert.match(body, /This publish adds: 5 MiB/)
  // ⭐ The advice that DIVERGES from the asset lane, and the reason this is its
  // own describer: here the manifest is complete every publish, so removing a
  // collection really does stop it counting. On the asset lane it would be false.
  assert.match(body, /removing/i)
  assert.match(body, /re-publishing/i)
})

test("⛔ it does NOT give the asset lane's advice — that would be false here", () => {
  const r = describeDataRefusal({ problem: JSON.parse(QUOTA_507) })
  const body = r.notes.join('\n')
  assert.doesNotMatch(
    body,
    /does not free|frees nothing/i,
    'the asset lane says editing content frees nothing; on this lane it does'
  )
})

test('an untyped refusal returns null so the caller falls through', () => {
  assert.equal(describeDataRefusal({ problem: null }), null)
  assert.equal(describeDataRefusal({}), null)
  assert.equal(
    describeDataRefusal({ problem: { detail: 'no reason key' } }),
    null
  )
})

test('an unrecognised reason is named rather than dumped', () => {
  const r = describeDataRefusal({
    problem: { reason: 'data_plan_too_many_files', detail: 'limit is 1024' }
  })
  assert.match(r.headline, /data_plan_too_many_files/)
  assert.match(r.notes.join('\n'), /limit is 1024/)
})
