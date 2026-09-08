/**
 * The publish payment refusal.
 *
 * The backend is the only gate, so what is pinned here is how the CLI READS a
 * refusal — never whether one is warranted. Two properties carry the file:
 *
 *   1. A door opens only when the backend NAMED one, in a `problem+json` body,
 *      as an absolute http(s) URL. No URL, a non-problem body, or a target of
 *      any other scheme all STOP. That direction is still the point: an older
 *      CLI showing you a message is recoverable, an older CLI opening something
 *      nobody pointed it at is not.
 *      ⚠️ It used to require a RECOGNISED REASON too. That was the wrong
 *      instrument — the reason set is open, so the allowlist withheld the door
 *      for every reason added after it was written, which is the same silent
 *      failure pointed backwards. See the reversed test below.
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

test('an UNRECOGNISED reason WITH a door opens it — the door is the signal', () => {
  // ⚠️ THIS ASSERTION WAS THE OPPOSITE UNTIL 2026-09-08, and the reversal is
  // deliberate rather than a relaxation. The rule it enforced — never route to a
  // purchase surface from the ABSENCE of a recognised token — is intact and tested
  // below; what changed is that a reason allowlist was the wrong instrument for it.
  //
  // The hazard was INFERRING a door from silence. A backend that NAMES a URL has
  // inferred nothing: `remedy_url` is minted per refusal and points at the screen
  // that backend chose for THIS refusal, so it cannot be "a checkout for something
  // you cannot buy" — it is wherever this particular refusal is resolved.
  //
  // ⛔ And the allowlist had inverted into the failure it was meant to prevent.
  // The reason set is open by design, so `pending_request` — the backend's ONE
  // reason for everything that needs the app — fell through to `stop`, and owners
  // were shown a sentence with no link for a door they had been handed. A stale
  // allowlist fails by WITHHOLDING help, silently, and only for the reasons that
  // did not exist when it was written.
  //
  // Still deliberately invented, for the original reason: a real token might later
  // be recognised and make this pass for the wrong one.
  const v = read({
    body: problemBody({
      reason: 'org_seat_limit_reached',
      remedy_url: SETTLE_URL
    })
  })
  assert.equal(v.kind, 'settle')
  assert.equal(v.url, SETTLE_URL)
  assert.equal(v.reason, 'org_seat_limit_reached')
  assert.match(v.message, /subscribe before publishing/)
})

test('an unrecognised reason with NO door still stops — the rule that survived', () => {
  // The protection the allowlist was standing in for, stated directly: nothing
  // opens unless the backend named somewhere to go.
  const v = read({ body: problemBody({ reason: 'org_seat_limit_reached' }) })
  assert.equal(v.kind, 'stop')
  assert.equal(v.reason, 'org_seat_limit_reached')
})

test('a door that is not an http(s) URL is refused', () => {
  // The value arrives over the network and is handed to the platform's URL opener.
  // A `file:`/`javascript:` target is not a place a person goes.
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', '/relative/path', '']) {
    const v = read({ body: problemBody({ reason: 'pending_request', remedy_url: bad }) })
    assert.equal(v.kind, 'stop', `must not open ${JSON.stringify(bad)}`)
  }
})

test("the backend's current reason reaches its door", () => {
  // The live case the allowlist was breaking. Not a hypothetical: this is the one
  // reason the backend serves for everything that needs the app.
  const v = read({
    body: problemBody({ reason: 'pending_request', remedy_url: SETTLE_URL })
  })
  assert.equal(v.kind, 'settle')
  assert.equal(v.url, SETTLE_URL)
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
