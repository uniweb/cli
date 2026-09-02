/**
 * `fetchWithRetry` — the one retry, and what it deliberately will not do.
 *
 * ## Why it exists
 *
 * Three byte-identical private copies lived in `templates/fetchers/`, and none
 * was reachable from the three upload paths, which had no retry at all. A single
 * connection-level failure on one file failed a whole `register` / `push` /
 * `publish` after every other file had gone up.
 *
 * The `flows` lane measured the consequence (2026-09-02): about one red per full
 * suite run, on a DIFFERENT flow each time, passing on re-run every time. They
 * had recorded it as "may be the manor, the CDN, or the connection". It was
 * none of those; `HTTP 0` is our own sentinel for a thrown fetch, so nothing on
 * the far side ever saw the request.
 *
 * ## The properties worth pinning
 *
 * A retry that retries everything is a bug generator: it turns a clear 4xx into
 * a delayed clear 4xx, and repeats non-idempotent requests. So the asymmetry —
 * what is retried and what is emphatically not — is most of what these assert.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { fetchWithRetry, isTransientStatus } from '../src/utils/fetch-retry.js'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** A fetch that plays the given script: Error instances throw, numbers are statuses. */
function scripted(...script) {
  let i = 0
  const calls = []
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts })
    const step = script[Math.min(i++, script.length - 1)]
    if (step instanceof Error) throw step
    return new Response('body', { status: step })
  }
  return calls
}

// Backoff is real time; keep every scripted failure count small so the suite
// stays fast. One retry costs ~2s, which is why nothing here scripts three.
const FAST = { retries: 2, timeoutMs: 5000 }

test('a thrown fetch is retried and can succeed', async () => {
  const calls = scripted(new Error('fetch failed'), 200)
  const res = await fetchWithRetry('https://x.test/a', {}, FAST)
  assert.equal(res.status, 200)
  assert.equal(calls.length, 2, 'should have made a second attempt')
})

test('the last attempt throws, so callers keep fetch-like semantics', async () => {
  // The three template fetchers were written against "throws like fetch";
  // swallowing here would silently change their contract.
  scripted(new Error('fetch failed'))
  await assert.rejects(() => fetchWithRetry('https://x.test/b', {}, FAST), /fetch failed/)
})

test('⛔ a 4xx is NOT retried, even with retryOnStatus on', async () => {
  // A rejection does not improve on repetition. Retrying one only delays a
  // clear error and doubles the load that produced it.
  const calls = scripted(404, 200)
  const res = await fetchWithRetry('https://x.test/c', {}, {
    ...FAST,
    retryOnStatus: isTransientStatus,
  })
  assert.equal(res.status, 404)
  assert.equal(calls.length, 1, '404 must not be retried')
})

test('⛔ a 5xx is NOT retried unless the caller opts in', async () => {
  // Opt-in because this helper cannot know whether the caller's request is safe
  // to repeat. The uploads assert their own idempotence; the template fetchers
  // do not need to.
  const calls = scripted(503, 200)
  const res = await fetchWithRetry('https://x.test/d', {}, FAST)
  assert.equal(res.status, 503)
  assert.equal(calls.length, 1, 'no status retry without retryOnStatus')
})

test('a 5xx IS retried when the caller opts in', async () => {
  const calls = scripted(503, 200)
  const res = await fetchWithRetry('https://x.test/e', {}, {
    ...FAST,
    retryOnStatus: isTransientStatus,
  })
  assert.equal(res.status, 200)
  assert.equal(calls.length, 2)
})

test('a retried status returns the LAST response rather than throwing', async () => {
  // Exhausting retries on a status is not an exception — the caller still gets a
  // Response and its own error handling reports the status, as before.
  const calls = scripted(503)
  const res = await fetchWithRetry('https://x.test/f', {}, {
    ...FAST,
    retryOnStatus: isTransientStatus,
  })
  assert.equal(res.status, 503)
  assert.equal(calls.length, 2)
})

test('onRetry reports each wait, so a retry is never invisible', async () => {
  // A retry nobody can see converts a visible failure into an unexplained
  // slowdown, which is its own defect.
  const seen = []
  scripted(new Error('fetch failed'), 200)
  await fetchWithRetry('https://x.test/g', {}, {
    ...FAST,
    onRetry: (info) => seen.push(info),
  })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].attempt, 1)
  assert.equal(seen[0].of, 2)
  assert.match(seen[0].reason, /fetch failed/)
  assert.ok(seen[0].delayMs > 0)
})

test("a caller's own signal is respected rather than overwritten", async () => {
  // An upload passing its own AbortController must keep it; silently replacing
  // it with a timeout would make cancellation stop working.
  const ac = new AbortController()
  const calls = scripted(200)
  await fetchWithRetry('https://x.test/h', { signal: ac.signal }, FAST)
  assert.equal(calls[0].opts.signal, ac.signal)
})

test('isTransientStatus draws the line at 429 and 5xx', () => {
  assert.equal(isTransientStatus(429), true)
  assert.equal(isTransientStatus(500), true)
  assert.equal(isTransientStatus(503), true)
  assert.equal(isTransientStatus(400), false)
  assert.equal(isTransientStatus(403), false)
  assert.equal(isTransientStatus(404), false)
  assert.equal(isTransientStatus(200), false)
})
