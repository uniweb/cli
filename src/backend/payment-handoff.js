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
 * `can-go-live` probe used to run before go-live, and it folded every failure —
 * 404 included — into "proceed". A check that answers "fine" when it cannot
 * reach the server is not a check, and it made the CLI assume a posture it has no
 * business assuming. A pre-flight also cannot be authoritative: the backend
 * re-evaluates at publish time regardless, so a second asker is a second producer
 * of one decision — which is the reason that would stand even if the probe had
 * worked.
 *
 * ⚠️ **THIS COMMENT USED TO SAY THE PROBE "called a route no backend serves".
 * That was FALSE, corrected 2026-09-12.** What it called was
 * `/dev/site/{uuid}/can-go-live` — and the 404 came from the PATH being wrong,
 * not from the capability being absent. So the probe never worked at any version
 * that shipped it, and every failure was swallowed by the fold above, which is
 * exactly why nobody noticed.
 *
 * ⭐ Kept as a warning about the SHAPE of the old justification, not just the
 * fact: a correct rule was resting on a claim about another system that this
 * repo cannot see, and the claim was wrong. The rule survives because its real
 * reasons are local — the fold, and the second-producer argument. **If you find
 * yourself defending a rule here with an assertion about what a server does,
 * check it or drop it.**
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

/**
 * ⛔ THE DOOR IS THE URL, NOT THE REASON — and this replaced a reason allowlist.
 *
 * The rule the allowlist served is right and survives: **never route to a purchase
 * surface from the ABSENCE of a recognised token.** But the hazard it guarded was
 * INFERRING a door from silence, and when the backend NAMES a URL there is no
 * inference left — an explicit remedy is the affirmative signal the allowlist was
 * standing in for.
 *
 * ⚠️ Keeping it had turned into the opposite failure. The reason set is open by
 * design ("includes"), so every new one — `pending_request` today — fell through to
 * `stop` and the owner was shown a sentence **with no link**, for a door the
 * backend had handed us. A stale allowlist now fails by WITHHOLDING help.
 *
 * ⇒ What remains is a shape rule, not a vocabulary one: open exactly what you were
 * handed, when it is an absolute http(s) URL, or say exactly what you were told.
 */
const OPENABLE = /^https?:\/\//i

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

  // ⛔ ONLY A `problem+json` BODY CARRIES A DOOR, and this gate is NOT the reason
  // allowlist that used to sit here — it is the other, narrower protection that
  // was tangled up with it.
  //
  // The backend's refusals wear `application/problem+json` and say so as a stable
  // guarantee. A plain `application/json` 402 is some other shape from some other
  // part of the wire — and one of those carries `status` as a STRING where a
  // problem body carries the number, so the two are not distinguishable by their
  // fields. Reading a URL out of a body that never promised this envelope is how
  // a `settle` gets synthesised from something that is not a refusal at all.
  if (!isProblem) return { kind: 'stop', reason, message }

  // The door, if one was handed over. `remedy_url` is the current spelling — ONE
  // key for every reason, which is what lets a reason we have never heard of still
  // reach its remedy.
  //
  // ⚖️ `settlement.url` is the older shape and is still read, as a DEFENSIVE
  // read and nothing more.
  //
  // ⛔ **This comment used to justify it as "what a backend that has not moved yet
  // still serves". That is unverified and probably false** — corrected 2026-09-12,
  // after the backend searched its whole tree and reported serving neither this
  // nor `remedy_url` on any route. ⇒ Keep the read (it costs nothing and a door
  // withheld is worse than a door read twice); do not repeat the claim about who
  // serves it. The current contract is `remedy_url`, one key for every reason.
  const legacy = problem.settlement
  const candidate =
    (typeof problem.remedy_url === 'string' && problem.remedy_url) ||
    (legacy && typeof legacy.url === 'string' && legacy.url) ||
    null

  // ⛔ ONLY AN ABSOLUTE http(s) URL IS OPENED, and this is a safety rule rather
  // than a compatibility one. The value arrives over the network and is handed to
  // the platform's URL opener; a `file:` or a `javascript:` URL is not a place a
  // person goes. Refusing them costs a legitimate backend nothing.
  const url = candidate && OPENABLE.test(candidate) ? candidate : null
  if (!url) return { kind: 'stop', reason, message }

  return {
    kind: 'settle',
    url,
    handle:
      legacy && typeof legacy.handle === 'string' && legacy.handle
        ? legacy.handle
        : null,
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
  say.err(verdict.message || 'This site cannot go live yet.')

  if (verdict.kind !== 'settle') {
    // The push completed before go-live, so the content is safely stored.
    say.dim('The site is synced as a draft; nothing was made live.')
    return { opened: false }
  }

  const { isNonInteractive } = await import('../utils/interactive.js')
  if (isNonInteractive(args)) {
    say.dim(`Finish this in a browser, then re-run \`uniweb publish\`:`)
    say.dim(`  ${verdict.url}`)
    return { opened: false }
  }

  const openBrowser = open || (await import('../utils/registry-auth.js')).openBrowser
  // ⛔ Reason-agnostic wording. The backend's own `detail` above carries the
  // specifics; a lead sentence naming payment would be wrong the moment a refusal
  // is a quota or an unverified domain — and the reason set is open by design.
  say.info('Opening your browser to finish this…')
  say.dim(`  ${verdict.url}`)
  // VERBATIM. Nothing is appended — see the header.
  const opened = await openBrowser(verdict.url)
  if (!opened) {
    say.warn('Could not open a browser automatically — open the URL above.')
  }
  say.dim('Once that is done, re-run `uniweb publish`.')
  return { opened }
}
