/**
 * Payment handoff — the one piece of `uniweb publish` that's three-way
 * (framework + backend + the `uniweb.app` web app). Design: payment-handoff-plan.md.
 *
 * The intent: `uniweb publish` on an unpaid (or newly-charged) site should just
 * handle it — open a browser to `uniweb.app`, let the user pay, and continue.
 * An already-paid site never opens a browser.
 *
 * The framework's ENTIRE payment knowledge is "open this URL, wait for done" —
 * PROVIDER-AGNOSTIC. The CLI opens whatever `checkout_url` the backend hands it;
 * the app drives the provider (Stripe or anything else) and settles with the
 * backend. We reuse `awaitBrowserCallback` (the same loopback `uniweb login`
 * uses) for the open + wait.
 *
 * DEGRADES: when the backend exposes no can-go-live route (404 / any failure),
 * `canGoLive` returns null and we PROCEED — so publish ships before the payment
 * route lands (same posture as `status --remote` on a missing endpoint). Live
 * acceptance is the three-way test.
 */

import { randomBytes } from 'node:crypto'

import { awaitBrowserCallback } from '../utils/registry-auth.js'
import { isNonInteractive } from '../utils/interactive.js'

// Append query params to a backend-supplied URL without disturbing its own.
function withParams(url, params) {
  const u = new URL(url)
  for (const [k, v] of Object.entries(params)) {
    if (v != null) u.searchParams.set(k, String(v))
  }
  return u.toString()
}

/**
 * Settle payment for a site before go-live, if the backend says it's needed.
 *
 * @param {object} o
 * @param {import('./client.js').BackendClient} o.client
 * @param {string|null} o.uuid - the site-content uuid (null before the first push mints it)
 * @param {string[]} o.args
 * @param {object} o.say - { ok, info, warn, err, dim } reporters
 * @param {boolean} [o.dryRun]
 * @returns {Promise<{ proceed: boolean }>} proceed:false → the caller aborts go-live.
 */
export async function settlePaymentIfNeeded({ client, uuid, args, say, dryRun = false }) {
  // No uuid yet (a first publish mints it on push) → nothing to check here; the
  // post-push go-live is the moment the backend gates on payment.
  if (!uuid) return { proceed: true }

  // Dry-run reports the intent WITHOUT touching the network — the can-go-live
  // read is auth-gated and must not force a login on a dry-run.
  if (dryRun) {
    say.dim(`Payment     : would check whether go-live needs payment for ${uuid}`)
    return { proceed: true }
  }

  const verdict = await client.canGoLive(uuid)
  // Degrade (no route) or already-paid → proceed.
  if (!verdict || verdict.ok || !verdict.payment_required) return { proceed: true }

  const checkoutUrl = verdict.checkout_url
  if (!checkoutUrl) {
    say.warn('The backend reports payment is required but returned no checkout URL — proceeding.')
    return { proceed: true }
  }

  if (dryRun) {
    say.dim(`Payment     : required — would open ${checkoutUrl}`)
    return { proceed: true }
  }

  if (isNonInteractive(args)) {
    say.err('Payment is required to publish this site, and the CLI is non-interactive.')
    say.dim(`Complete it in a browser, then re-run: ${checkoutUrl}`)
    return { proceed: false }
  }

  // The CSRF nonce the app echoes back on the done-signal redirect. The
  // wait_token (when present) lets the app correlate the session backend-side.
  const state = randomBytes(16).toString('hex')
  say.info('Payment required — completing it in your browser…')
  try {
    await awaitBrowserCallback({
      buildUrl: (redirectUri) =>
        withParams(checkoutUrl, { redirect_uri: redirectUri, state, wait_token: verdict.wait_token }),
      validate: (params) => {
        if (params.get('error')) return { error: params.get('error') }
        if (params.get('state') !== state) return { error: 'state mismatch — please retry.' }
        return { value: true } // ok=1 / any non-error return = the app settled with the backend
      },
      openingLabel: 'Opening uniweb.app to complete payment…',
      waitingLabel: 'Waiting for payment to complete (5 min)…',
      timeoutMs: 5 * 60 * 1000,
      okTitle: 'Payment complete',
      errTitle: 'Payment failed',
    })
  } catch (err) {
    say.err(`Payment was not completed: ${err.message}`)
    say.dim('Re-run `uniweb publish` once payment is done.')
    return { proceed: false }
  }
  say.ok('Payment complete.')
  return { proceed: true }
}
