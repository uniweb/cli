/**
 * The publish payment refusal.
 *
 * The backend is the only gate, so what is pinned here is how the CLI READS a
 * refusal — never whether one is warranted. Two properties carry the file:
 *
 *   1. A purchase surface opens only on a reason that NAMES one. Absence,
 *      an unrecognised token, a missing settlement block and a non-problem
 *      body all STOP. That direction is the point: an older CLI showing you a
 *      message is recoverable, an older CLI opening a checkout for something
 *      you cannot buy is not.
 *   2. The settlement URL is opened VERBATIM. Nothing is appended — no
 *      redirect_uri, no state, no wait_token — so the app is never obliged to
 *      know a CLI exists, and the flow does not require the browser and the
 *      CLI to be on the same machine.
 *
 * ⭐ THE ACTIONABLE CASE IS A CONTROL, not a nicety. Every other assertion here
 * is that something does NOT open, and a `readPaymentRefusal` that always
 * returned `stop` would satisfy all of them. The one case that must settle is
 * what makes the rest evidence rather than a tautology.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  readPaymentRefusal,
  reportPaymentRefusal
} from '../src/backend/payment-handoff.js'

const PROBLEM = 'application/problem+json'
const SETTLE_URL = 'https://app.example.test/settle/abc123'

const problemBody = (extra = {}) =>
  JSON.stringify({
    type: 'about:blank',
    title: 'Payment Required',
    status: 402,
    detail: 'this site has no active hosting subscription — subscribe before publishing',
    ...extra
  })

const read = (o) => readPaymentRefusal({ contentType: PROBLEM, status: 402, ...o })

// ── what the CLI may act on ──────────────────────────────────────────────────

test('CONTROL — a recognised reason WITH a settlement block settles, and keeps the url', () => {
  const v = read({
    body: problemBody({
      reason: 'no_subscription',
      settlement: { handle: 'h_1', url: SETTLE_URL }
    })
  })
  assert.equal(v.kind, 'settle')
  assert.equal(v.url, SETTLE_URL)
  assert.equal(v.handle, 'h_1')
  assert.match(v.message, /subscribe before publishing/)
})

// ── everything else stops ────────────────────────────────────────────────────

test('an UNRECOGNISED reason stops — it must never fall through to a purchase', () => {
  // Deliberately invented. It must NOT be replaced with a real backend token:
  // the regression arrives when the BACKEND adds a reason, with no release
  // here, so a token we might later learn to recognise would make this pass
  // for the wrong reason.
  const v = read({
    body: problemBody({
      reason: 'org_seat_limit_reached',
      settlement: { handle: 'h_2', url: SETTLE_URL }
    })
  })
  assert.equal(v.kind, 'stop')
  assert.equal(v.reason, 'org_seat_limit_reached')
  assert.match(v.message, /subscribe before publishing/)
})

test('problem+json with NO reason stops — the card-decline shape', () => {
  // Not every 402 carries a machine token: a declined card is problem+json and
  // deliberately has none. `reason` is NOT implied by the content type.
  const v = read({
    body: JSON.stringify({
      type: 'about:blank',
      title: 'Payment Failed',
      status: 402,
      detail: 'your card was declined'
    })
  })
  assert.equal(v.kind, 'stop')
  assert.equal(v.reason, null)
  assert.equal(v.message, 'your card was declined')
})

test('a recognised reason with NO settlement block stops rather than inventing one', () => {
  const v = read({ body: problemBody({ reason: 'no_subscription' }) })
  assert.equal(v.kind, 'stop')
  assert.equal(v.reason, 'no_subscription')
})

test('body.status is NOT the discriminator — a string status does not become actionable', () => {
  // A problem body carries `status` as the NUMBER 402, while other 402 shapes on
  // the wire carry a STRING there. Same key, two types, neither failing loudly —
  // so nothing here may read `body.status`.
  const v = readPaymentRefusal({
    status: 402,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'billing_consent_required',
      consent: 'tok_x',
      reason: 'no_subscription',
      settlement: { url: SETTLE_URL }
    })
  })
  assert.equal(v.kind, 'stop', 'a plain-json 402 is unrecognised even carrying a known reason')
})

test('a non-JSON 402 stops instead of throwing', () => {
  const v = read({ body: '<html>502 upstream</html>' })
  assert.equal(v.kind, 'stop')
  assert.equal(v.message, null)
})

test('a non-402 is not a payment refusal at all', () => {
  for (const status of [200, 401, 403, 409, 500]) {
    assert.equal(readPaymentRefusal({ status, body: problemBody() }).kind, 'not-payment')
  }
})

// ── the URL is opened verbatim ───────────────────────────────────────────────

const sayStub = () => {
  const lines = []
  const push = (k) => (s) => lines.push(`${k}:${s}`)
  return { lines, ok: push('ok'), info: push('info'), warn: push('warn'), err: push('err'), dim: push('dim') }
}

test('the settlement url is opened VERBATIM — nothing appended', async () => {
  const tty = process.stdin.isTTY
  const ci = process.env.CI
  process.stdin.isTTY = true
  delete process.env.CI
  try {
    const seen = []
    const say = sayStub()
    await reportPaymentRefusal({
      verdict: read({
        body: problemBody({
          reason: 'no_subscription',
          settlement: { handle: 'h_1', url: SETTLE_URL }
        })
      }),
      args: [],
      say,
      open: async (u) => {
        seen.push(u)
        return true
      }
    })
    assert.deepEqual(seen, [SETTLE_URL])
    const [opened] = seen
    assert.ok(!/redirect_uri|state=|wait_token/.test(opened), 'no CLI-shaped params may be appended')
    assert.equal(opened, SETTLE_URL, 'byte-for-byte what the backend handed over')
  } finally {
    process.stdin.isTTY = tty
    if (ci !== undefined) process.env.CI = ci
  }
})

test('a stop never opens a browser', async () => {
  const seen = []
  const say = sayStub()
  await reportPaymentRefusal({
    verdict: read({ body: problemBody({ reason: 'org_seat_limit_reached' }) }),
    args: [],
    say,
    open: async (u) => {
      seen.push(u)
      return true
    }
  })
  assert.deepEqual(seen, [], 'nothing may be opened on a stop')
  assert.ok(say.lines.some((l) => l.startsWith('err:')), 'the user is still told')
})

test('--non-interactive prints the url and opens nothing', async () => {
  const seen = []
  const say = sayStub()
  await reportPaymentRefusal({
    verdict: read({
      body: problemBody({
        reason: 'no_subscription',
        settlement: { handle: 'h_1', url: SETTLE_URL }
      })
    }),
    args: ['--non-interactive'],
    say,
    open: async (u) => {
      seen.push(u)
      return true
    }
  })
  assert.deepEqual(seen, [])
  assert.ok(say.lines.some((l) => l.includes(SETTLE_URL)), 'the url is still shown')
})
