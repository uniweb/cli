/**
 * ⛔ **HUMAN OUTPUT IN THIS FILE GOES TO STDERR, NEVER STDOUT.**
 *
 * `stdout` is the CLI's DATA channel. `uniweb register --json` promises a single
 * parseable JSON line there, and `register` diverts its own output accordingly —
 * but it calls into this module, which wrote prose to stdout directly, so the
 * promise broke for any caller that piped it.
 *
 * ⭐ Measured by the `flows` lane at `uniweb@0.37.1`: two stray lines ahead of
 * the JSON on the cold path — down from ~35 before the delegated builder's
 * stdout was redirected to fd 2, which is why the two defects share one symptom
 * and only one of them was fixed. Every line here is prose, a prompt, or a
 * cancellation notice; none of it is anything a machine reads. On stderr it is
 * equally visible to a human and invisible to a pipe.
 *
 * ⚖️ This is not a `--json` special case. A utility that cannot see the flag
 * should not be choosing the stream at all — which is exactly how it got the
 * choice wrong. `cli/test/porcelain-stdout.test.js` walks `register`'s import
 * graph and fails on a new `console.log`.
 */
/**
 * New-backend org operations for the publish-scope bootstrap — used by
 * `uniweb register`'s scope resolution and the `uniweb org` command.
 *
 * One resource (Bearer auth, the CLI's /dev lane); the verb selects the op:
 *
 *   GET  /dev/orgs → {
 *     account_handle: string|null,     // the caller's account handle
 *     orgs: [{ handle, is_primary }]   // memberships, primary first;
 *   }                                  // handle-less units filtered server-side
 *
 *   POST /dev/orgs { handle } → { handle, uuid, is_primary }
 *
 * ⭐ A SCOPE IS A NAMESPACE, NOT AN ORG (2026-09-23). `@<account handle>` is the
 * account's own scope and needs no org; an org's scope is published into by its
 * members. Handles live in ONE global namespace across accounts and orgs, so an org
 * needs a handle of its own — a backend refuses an org named after an account, its
 * owner's included. ⛔ Until 2026-09-23 the CLI created a "personal org" `@jane` for
 * account `jane` to have a scope at all; `personal_org_exists` served that and is no
 * longer read. Org creation requires NO second factor on any lane (the 2FA gate lives
 * at escalation points, not here).
 *
 * Failure shapes (branch on STATUS; details are human display, not contract):
 * 422 = handle grammar; 409 = taken / reserved / belongs to another account
 * (one status, server detail says which). Reserved names are SERVER-curated —
 * deliberately not replicated here; the 409 detail carries the answer.
 *
 * Handle grammar (pre-validated for a fast prompt): lowercase alphanumerics +
 * hyphens, 3–39 chars, no leading/trailing hyphen (consecutive hyphens are
 * allowed).
 */

const ORGS_PATH = '/dev/orgs'

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,37}[a-z0-9]$/

/** Strip a leading `@` and any `/suffix`, returning the bare handle segment. */
export function bareHandle(scope) {
  return String(scope || '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
}

/**
 * A publish scope in the one form the registry names things by — `@acme` — from any
 * spelling `--scope` or a schemas-only package's `package.json::uniweb.scope` may carry
 * it in (`@acme`, `acme`, `@acme/…`). Null when there is no handle in it. (A
 * foundation's scope is part of its name, `@acme/marketing`, and needs no reading.)
 *
 * ⛔ Every name built from a scope goes through this. The `.uwx` assembly
 * (`@uniweb/build`'s `buildRegistryPackage`) has always accepted `acme` as well as
 * `@acme`, so a name composed from the RAW value disagreed with the one it registered:
 * until 2026-09-21 `register --scope std` registered `@std/src` and then asked to
 * deliver code for `std/src`, which the registry refuses (a scoped name is `@org/name`).
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function publishScope(value) {
  const handle = bareHandle(value)
  return handle ? `@${handle}` : null
}

/**
 * Validate a handle's GRAMMAR client-side (reserved names are the server's
 * call — a 409 carries the verdict). Returns an error string, or null.
 */
export function validateHandle(handle) {
  const h = bareHandle(handle)
  if (!h) return 'A handle is required.'
  if (!HANDLE_RE.test(h)) {
    return 'Use 3–39 lowercase letters, digits, and hyphens (no leading/trailing hyphen).'
  }
  return null
}

/**
 * The picker read: memberships + the caller's account handle + whether the
 * personal org already exists.
 * @returns {Promise<{account_handle: string|null, orgs: Array<{handle: string, is_primary: boolean}>}>}
 */
export async function fetchOrgs({ apiBase, token }) {
  const res = await fetch(`${apiBase.replace(/\/$/, '')}${ORGS_PATH}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok)
    throw new Error(
      `Could not list your orgs: HTTP ${res.status} ${res.statusText}`
    )
  const data = await res.json().catch(() => null)
  return {
    account_handle: data?.account_handle ?? null,
    orgs: Array.isArray(data?.orgs) ? data.orgs : []
  }
}

/** Back-compat alias: the membership rows only. */
export async function listOrgs(opts) {
  return (await fetchOrgs(opts)).orgs
}

/**
 * Create an org. Its handle must be its own: a backend refuses an account's handle,
 * your own included — your personal scope needs no org.
 * @returns {Promise<{handle: string, uuid?: string, is_primary?: boolean}>}
 */
export async function createOrg({ apiBase, token, handle }) {
  const h = bareHandle(handle)
  const res = await fetch(`${apiBase.replace(/\/$/, '')}${ORGS_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ handle: h })
  })
  if (res.ok) return res.json()

  // Surface the server's human detail — a 409 distinguishes taken vs
  // reserved vs belongs-to-another-account; a 422 names the grammar rule.
  let detail = ''
  try {
    const body = await res.json()
    detail = body?.detail || ''
  } catch {
    /* non-JSON body — keep the generic line */
  }
  const fallback =
    res.status === 409
      ? `@${h} is not available.`
      : res.status === 422
        ? `@${h} is not a valid handle.`
        : `Could not create @${h}: HTTP ${res.status}`
  const e = new Error(detail || fallback)
  e.status = res.status
  throw e
}

/**
 * The scope to register under, from the login, when none was named — a bare handle,
 * or null when none was chosen. Persists nothing; the caller records it (in the
 * foundation's name, or a schemas-only package's `package.json`).
 *
 * ⭐ A SCOPE IS A NAMESPACE (2026-09-23): your account's own, `@<handle>`, needs no org.
 *
 *   no org              → your personal scope — said, never asked, in CI too
 *   orgs                → pick: your personal scope first, then each org;
 *                         non-interactive, your personal scope, said
 *   no account handle   → (a service account) its one org, said; several are asked,
 *                         or refused in CI; none is a pointer to `--scope`
 *
 * ⛔ Until 2026-09-23 a login with no org was offered a "personal org" `@jane`, created
 * on the spot — a scope was taken to need an org — and refused in CI.
 *
 * An org named after the account — a personal org made before then — is the same
 * `@jane`, and is listed once, as your personal scope.
 *
 * @param {Object} p
 * @param {string} p.apiBase
 * @param {string} p.token
 * @param {string|null} [p.accountHandle] - fallback only; the server's
 *   account_handle from the orgs read is authoritative
 * @param {string[]} [p.args] - argv slice; checked for --non-interactive
 * @returns {Promise<string|null>}
 */
export async function deriveScope({
  apiBase,
  token,
  accountHandle = null,
  args = []
}) {
  const envelope = await fetchOrgs({ apiBase, token })
  const handle = bareHandle(envelope.account_handle || accountHandle || '')
  const personal = handle && !validateHandle(handle) ? handle : null
  const orgs = envelope.orgs.filter((o) => o.handle !== personal)
  const { isNonInteractive } = await import('./interactive.js')
  const nonInteractive = isNonInteractive(args)
  const bold = (h) => `\x1b[1m@${h}\x1b[0m`

  if (personal && !orgs.length) {
    console.error(`Registering under your personal scope ${bold(personal)}.`)
    return personal
  }
  if (!personal && orgs.length <= 1) {
    if (orgs.length === 1) {
      console.error(`Registering under your org ${bold(orgs[0].handle)}.`)
      return orgs[0].handle
    }
    console.error(
      "\x1b[31m✗\x1b[0m This account has no handle (service accounts don't get one), so it has no personal scope, and it belongs to no org.\n" +
        '  Pass --scope @org, or create one with `uniweb org create <handle>`.'
    )
    return null
  }

  if (nonInteractive) {
    if (!personal) {
      console.error(
        '\x1b[31m✗\x1b[0m This account belongs to several orgs and has no personal scope. Pass --scope @org.'
      )
      return null
    }
    console.error(
      `Registering under your personal scope ${bold(personal)} (non-interactive). Pass --scope @org for an org.`
    )
    return personal
  }
  const prompts = (await import('prompts')).default
  const { choice } = await prompts(
    {
      type: 'select',
      name: 'choice',
      message: 'Register under which scope?',
      choices: [
        ...(personal
          ? [{ title: `@${personal} — your personal scope`, value: personal }]
          : []),
        ...orgs.map((o) => ({
          title: `@${o.handle}${o.is_primary ? ' (primary org)' : ' (org)'}`,
          value: o.handle
        }))
      ],
      initial: 0
    },
    {
      onCancel: () => {
        console.error('\nCancelled.')
        process.exit(0)
      }
    }
  )
  return choice || null
}
