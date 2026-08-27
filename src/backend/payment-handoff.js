/**
 * Payment refusal — what `uniweb publish` does when the backend says a site
 * cannot go live until it is paid for.
 *
 * THE BACKEND IS THE ONLY GATE. It evaluates on every publish, on every
 * backend, whatever that deployment is configured to require — a backend with
 * subscriptions switched off simply never refuses. The CLI holds no opinion about whether a
 * backend charges and must never form one: it attempts the publish and reads
 * the answer.
 *
 * ⛔ THERE IS NO PRE-FLIGHT, AND ADDING ONE BACK IS A REGRESSION. A
 * `GET …/can-go-live` probe used to run before go-live; it called a route no
 * backend serves, and it folded every failure — 404 included — into
 * "proceed". A check that answers "fine" when it cannot reach the server is not
 * a check, and it made the CLI assume a posture it has no business assuming. A
 * pre-flight also cannot be authoritative: the backend re-evaluates at publish
 * time regardless, so a second asker is a second producer of one decision.
 *
 * WHAT THE CLI KNOWS ABOUT PAYMENT: nothing. It opens whatever settlement URL
 * the backend hands it, VERBATIM — provider-agnostic, and route-agnostic. The
 * app drives the provider and settles with the backend.
 *
 * ⛔ AND IT APPENDS NOTHING TO THAT URL. The old handoff added
 * `redirect_uri=http://127.0.0.1:<port>/callback`, `state` and `wait_token`,
 * then waited on a loopback for the app to redirect back. Two reasons it is
 * gone: it obliged the web app to know a CLI exists and honour a callback, and
 * a loopback callback requires the browser and the CLI
 * on the SAME MACHINE, so over SSH or in a container it hung for its full
 * timeout and then reported "payment was not completed", which was false.
 */

/** Reasons the CLI knows how to act on. An ALLOWLIST, never an inventory. */
const ACTIONABLE_REASONS = new Set(['no_subscription'])

/**
 * Read a `402` from the publish call and decide what the CLI does. Pure — no
 * network, no browser, no process exit — so the decision is testable on its own.
 *
 * ⛔ THE RULE, and it is a property of the wire rather than a CLI preference:
 * NEVER route to a purchase surface from the ABSENCE of a recognised token. A
 * purchase surface is opened by a `reason` that NAMES one; everything else
 * surfaces the backend's own sentence and stops. Degrading that way means an
 * older CLI shows you the message — annoying, honest, recoverable. Degrading
 * the other way sends someone to a checkout for something they cannot buy.
 *
 * ⛔ Do NOT turn `ACTIONABLE_REASONS` into "every reason the backend has". The
 * set is open by design and a stale copy here fails in the worst direction; an
 * allowlist is safe precisely because what it misses lands on `stop`.
 * ⛔ Do NOT parse `detail` — it is deliberately not asserted word-for-word, and
 * `reason` exists to do the job parsing it would.
 *
 * NOTE ON `reason`'s PRESENCE: it is NOT guaranteed by the content type. A 402
 * naming a condition the caller can act on carries one; nothing guarantees it
 * in general — a declined card is `problem+json` and deliberately carries none,
 * because there is no machine decision for a client to make about it. This reads `reason` when it is there and needs
 * no invariant, which is why that correction cost this branch nothing.
 *
 * @param {object} o
 * @param {number} o.status - the HTTP status
 * @param {string} [o.contentType] - the response's content-type header
 * @param {string} [o.body] - the raw response body
 * @returns {{ kind: 'not-payment' }
 *          | { kind: 'settle', url: string, handle: string|null, reason: string, message: string|null }
 *          | { kind: 'stop', reason: string|null, message: string|null }}
 */
export function readPaymentRefusal({ status, contentType = '', body = '' } = {}) {
  if (status !== 402) return { kind: 'not-payment' }

  let problem = null
  try {
    problem = JSON.parse(body)
  } catch {
    /* a non-JSON 402 is simply unrecognised — it falls to `stop` below */
  }
  if (!problem || typeof problem !== 'object') {
    return { kind: 'stop', reason: null, message: null }
  }

  // The human sentence, in the backend's own words. `detail` is the 7807
  // member; `title` is the fallback when a body carries no detail.
  const message =
    (typeof problem.detail === 'string' && problem.detail) ||
    (typeof problem.title === 'string' && problem.title) ||
    null

  // `status` is NOT a discriminator: the backend's problem bodies carry it as
  // the NUMBER 402 while at least one hand-built 402 elsewhere on their wire
  // carries a STRING. Same key, two types, neither failing loudly — so this
  // reads `reason` and the content type instead, and never `body.status`.
  const isProblem = String(contentType).includes('application/problem+json')
  const reason =
    isProblem && typeof problem.reason === 'string' && problem.reason
      ? problem.reason
      : null

  if (!reason || !ACTIONABLE_REASONS.has(reason)) {
    return { kind: 'stop', reason, message }
  }

  // Actionable — but only if the backend actually handed over somewhere to go.
  // A recognised reason with no settlement block is a backend that has not
  // built that half yet: still a stop, and still with its own sentence.
  const s = problem.settlement
  const url = s && typeof s.url === 'string' && s.url ? s.url : null
  if (!url) return { kind: 'stop', reason, message }

  return {
    kind: 'settle',
    url,
    handle: s && typeof s.handle === 'string' && s.handle ? s.handle : null,
    reason,
    message
  }
}

/**
 * Report a payment refusal to the user, and open the settlement page when the
 * backend supplied one.
 *
 * ⛔ Returns rather than exits — the caller owns the exit code, and a refusal
 * is not a crash: the content is already synced as a draft, so re-running
 * after paying is the recovery.
 *
 * @param {object} o
 * @param {ReturnType<typeof readPaymentRefusal>} o.verdict
 * @param {string[]} o.args - argv slice (for --non-interactive detection)
 * @param {object} o.say - { ok, info, warn, err, dim } reporters
 * @param {(url: string) => Promise<boolean>} [o.open] - injected for tests
 * @returns {Promise<{ opened: boolean }>}
 */
export async function reportPaymentRefusal({ verdict, args = [], say, open }) {
  // The backend's own sentence is the HEADLINE when there is one. A generic
  // lead would be wrong as often as right — "payment is required" does not
  // describe a declined card — and `detail` is written for this reader.
  say.err(verdict.message || 'This site cannot go live until it is paid for.')

  if (verdict.kind !== 'settle') {
    // The push completed before go-live, so the content is safely stored.
    say.dim('The site is synced as a draft; nothing was made live.')
    return { opened: false }
  }

  const { isNonInteractive } = await import('../utils/interactive.js')
  if (isNonInteractive(args)) {
    say.dim(`Complete it in a browser, then re-run \`uniweb publish\`:`)
    say.dim(`  ${verdict.url}`)
    return { opened: false }
  }

  const openBrowser = open || (await import('../utils/registry-auth.js')).openBrowser
  say.info('Opening your browser to complete it…')
  say.dim(`  ${verdict.url}`)
  // VERBATIM. Nothing is appended — see the header.
  const opened = await openBrowser(verdict.url)
  if (!opened) {
    say.warn('Could not open a browser automatically — open the URL above.')
  }
  say.dim('Once payment is complete, re-run `uniweb publish`.')
  return { opened }
}
