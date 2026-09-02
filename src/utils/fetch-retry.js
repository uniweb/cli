/**
 * `fetch` with bounded retry and a timeout. **The one implementation.**
 *
 * ## Why this file exists
 *
 * There were three, byte-identical apart from a timeout constant — one each in
 * `templates/fetchers/{npm,release,github}.js` — and **none of them was reachable
 * from the code that needed it most.** The three upload paths (`code-upload`,
 * `asset-upload`, `site-data-upload`) had no retry at all, so a single
 * connection-level failure on any one file failed the whole `register` / `push`
 * / `publish` after every other file had already gone up.
 *
 * ⭐ **Measured by the `flows` lane, 2026-09-02:** roughly one red per full suite
 * run, landing on a *different flow each time* and passing on re-run every time —
 * the signature of an unretried transient, with the network as the variable
 * rather than any flow. Their symptom was recorded as "not diagnosed, may be the
 * manor, the CDN, or the connection"; it was none of those. It was us.
 *
 * ## ⚠️ What a retry does NOT do
 *
 * It masks whatever drops the connection. That is the right trade for a genuine
 * transient and the wrong one for a systematic fault: if the failure rate ever
 * climbs, a retry turns a fast red into a slow one and hides the cause. **Do not
 * read a green run as evidence the network is healthy.**
 *
 * ## Retrying a PUT is safe HERE, and not in general
 *
 * These uploads are idempotent by construction — the same bytes to the same
 * target, with an `x-uniweb-sha256` integrity guard the far side verifies. That
 * is why `retryOnStatus` is **opt-in** rather than the default: a caller has to
 * assert its own idempotence, because this helper cannot know it.
 */

const DEFAULT_RETRIES = 3
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_BACKOFF_MS = 10_000

/** Exponential backoff, capped. Attempt is 1-based. */
const backoffMs = (attempt) => Math.min(1000 * Math.pow(2, attempt), MAX_BACKOFF_MS)

/**
 * @param {string|URL} url
 * @param {RequestInit} [options] - passed to `fetch`; `signal` is supplied here.
 * @param {Object} [config]
 * @param {number} [config.retries=3] - total attempts, not extra ones.
 * @param {number} [config.timeoutMs=30000] - per ATTEMPT, not for the whole call.
 *   ⚠️ For an upload this bounds the time to send a whole body, so a large file
 *   on a slow link needs a generous value — too short and a legitimately slow
 *   upload is aborted and then retried, which is worse than no timeout at all.
 * @param {(status: number) => boolean} [config.retryOnStatus] - opt-in. Without
 *   it only a THROWN fetch is retried (a connection-level failure, which is what
 *   surfaces as `status: 0` in the upload paths). A caller passing this asserts
 *   its request is safe to repeat.
 * @param {(info: {attempt: number, of: number, reason: string, delayMs: number}) => void} [config.onRetry]
 *   Called before each wait. ⭐ Worth passing: a retry that no one can see turns
 *   a visible failure into an invisible slowdown, which is its own defect.
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, config = {}) {
  const {
    retries = DEFAULT_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryOnStatus = null,
    onRetry = null,
  } = config

  let lastErr = null

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: options.signal ?? AbortSignal.timeout(timeoutMs),
      })

      if (attempt < retries && retryOnStatus && retryOnStatus(res.status)) {
        const delayMs = backoffMs(attempt)
        onRetry?.({ attempt, of: retries, reason: `HTTP ${res.status}`, delayMs })
        await new Promise((r) => setTimeout(r, delayMs))
        continue
      }

      return res
    } catch (err) {
      lastErr = err
      // The last attempt throws to the caller, which keeps this a drop-in for
      // the three template fetchers whose contract was "throws like fetch".
      if (attempt === retries) throw err
      const delayMs = backoffMs(attempt)
      onRetry?.({ attempt, of: retries, reason: err.message, delayMs })
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  /* c8 ignore next 2 -- unreachable: the loop returns or throws on the last attempt */
  throw lastErr
}

/**
 * The statuses worth repeating an idempotent request for: a server that failed
 * to answer this time, or asked us to slow down.
 *
 * ⛔ Never a 4xx other than 429 — a rejection does not improve on repetition,
 * and retrying one turns a clear error into a delayed clear error.
 *
 * @param {number} status
 * @returns {boolean}
 */
export const isTransientStatus = (status) => status === 429 || status >= 500
