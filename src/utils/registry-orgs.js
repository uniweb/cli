/**
 * New-backend org operations for the publish-scope bootstrap — used by
 * `uniweb register`'s scope resolution and the `uniweb org` command.
 *
 * One resource (Bearer auth, the CLI's /dev lane); the verb selects the op:
 *
 *   GET  /dev/orgs → {
 *     account_handle: string|null,     // the caller's account handle
 *     personal_org_exists: bool,       // does @<account_handle> exist as an org
 *     orgs: [{ handle, is_primary }]   // memberships, primary first;
 *   }                                  // handle-less units filtered server-side
 *
 *   POST /dev/orgs { handle } → { handle, uuid, is_primary }
 *
 * The PERSONAL org needs no flag: handles live in ONE global namespace across
 * accounts + orgs and only the owner can create the org matching their account
 * handle — so `org.handle === account_handle` is a sound derivation, and the
 * lazy personal claim is just a create. Org creation requires NO second factor
 * on any lane (the 2FA gate lives at escalation points, not here).
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
  return String(scope || '').replace(/^@/, '').replace(/\/.*$/, '')
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
 * @returns {Promise<{account_handle: string|null, personal_org_exists: boolean, orgs: Array<{handle: string, is_primary: boolean}>}>}
 */
export async function fetchOrgs({ apiBase, token }) {
  const res = await fetch(`${apiBase.replace(/\/$/, '')}${ORGS_PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Could not list your orgs: HTTP ${res.status} ${res.statusText}`)
  const data = await res.json().catch(() => null)
  return {
    account_handle: data?.account_handle ?? null,
    personal_org_exists: data?.personal_org_exists === true,
    orgs: Array.isArray(data?.orgs) ? data.orgs : [],
  }
}

/** Back-compat alias: the membership rows only. */
export async function listOrgs(opts) {
  return (await fetchOrgs(opts)).orgs
}

/**
 * Create an org (the lazy personal claim is exactly this create — the
 * owner-exception admits `handle === account_handle` for the owner).
 * @returns {Promise<{handle: string, uuid?: string, is_primary?: boolean}>}
 */
export async function createOrg({ apiBase, token, handle }) {
  const h = bareHandle(handle)
  const res = await fetch(`${apiBase.replace(/\/$/, '')}${ORGS_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ handle: h }),
  })
  if (res.ok) return res.json()

  // Surface the server's human detail — a 409 distinguishes taken vs
  // reserved vs belongs-to-another-account; a 422 names the grammar rule.
  let detail = ''
  try {
    const body = await res.json()
    detail = body?.detail || ''
  } catch { /* non-JSON body — keep the generic line */ }
  const fallback =
    res.status === 409 ? `@${h} is not available.`
    : res.status === 422 ? `@${h} is not a valid handle.`
    : `Could not create @${h}: HTTP ${res.status}`
  const e = new Error(detail || fallback)
  e.status = res.status
  throw e
}

/**
 * Derive the publish scope from login membership when none was supplied:
 *   ≥1 org → confirm (1) or pick (N), personal org labeled + first
 *   0 orgs → the first-publish picker (personal default, lazily claimed)
 * Returns the chosen bare handle (no `@`), or null if cancelled. Persists
 * nothing — the caller records it. Bails in non-interactive mode.
 *
 * @param {Object} p
 * @param {string} p.apiBase
 * @param {string} p.token
 * @param {string|null} [p.accountHandle] - fallback only; the server's
 *   account_handle from the orgs read is authoritative
 * @param {string[]} [p.args] - argv slice; checked for --non-interactive
 * @returns {Promise<string|null>}
 */
export async function deriveScope({ apiBase, token, accountHandle = null, args = [] }) {
  const envelope = await fetchOrgs({ apiBase, token })
  const { orgs } = envelope
  const personal = envelope.account_handle || (accountHandle ? bareHandle(accountHandle) : null)
  const personalOrgExists = envelope.personal_org_exists
  const { isNonInteractive } = await import('./interactive.js')
  const nonInteractive = isNonInteractive(args)
  const isPersonal = (h) => personal && h === personal

  if (orgs.length === 1) {
    const h = orgs[0].handle
    const label = isPersonal(h) ? `your personal org @${h}` : `your org @${h}`
    if (nonInteractive) {
      console.log(`Publishing under ${label.replace(`@${h}`, `\x1b[1m@${h}\x1b[0m`)}.`)
      return h
    }
    const prompts = (await import('prompts')).default
    const { ok } = await prompts({
      type: 'confirm', name: 'ok', message: `Publish under ${label}?`, initial: true,
    }, { onCancel: () => { console.log('\nCancelled.'); process.exit(0) } })
    if (!ok) {
      console.log('Pass --scope @org, or create another with `uniweb org create <handle>`.')
      return null
    }
    return h
  }

  if (orgs.length > 1) {
    // Personal org first; the rest in server order (primary-first).
    const ordered = [...orgs].sort((a, b) => (isPersonal(b.handle) ? 1 : 0) - (isPersonal(a.handle) ? 1 : 0))
    if (nonInteractive) {
      const pick = ordered.find((u) => isPersonal(u.handle)) || orgs.find((u) => u.is_primary) || orgs[0]
      console.log(`Multiple orgs; using \x1b[1m@${pick.handle}\x1b[0m (non-interactive).`)
      return pick.handle
    }
    const prompts = (await import('prompts')).default
    const { choice } = await prompts({
      type: 'select',
      name: 'choice',
      message: 'Publish under which org?',
      choices: ordered.map((u) => ({
        title: `@${u.handle}${isPersonal(u.handle) ? ' — your personal org' : u.is_primary ? ' (primary)' : ''}`,
        value: u.handle,
      })),
      initial: 0,
    }, { onCancel: () => { console.log('\nCancelled.'); process.exit(0) } })
    return choice || null
  }

  // 0 orgs → the first-publish picker.
  if (nonInteractive) {
    console.error('\x1b[31m✗\x1b[0m You have no org to publish under. Create one with `uniweb org create <handle>`, or pass --scope @org.')
    process.exit(1)
  }
  return offerCreateOrg({ apiBase, token, accountHandle: personal, personalOrgExists })
}

/**
 * Cold-start (0 orgs) — the first-publish org choice. Every account handle
 * is a reserved, ready-to-go org handle (globally unique across accounts +
 * orgs; only the owner can claim it), so the default is one keystroke:
 *
 *   ? Publish under which org?
 *   ❯ @jane — your personal org (created on first publish)
 *     A new organization…
 *
 * The personal org is materialized LAZILY here — at first publish, never at
 * signup. Two guards:
 *  - no account handle (Service/System accounts — real signups always mint
 *    one) → a crisp pointer instead of a prompt;
 *  - the personal org exists but the caller is no longer a member
 *    (created-then-left) → the lazy claim would 409; don't offer it.
 * Returns the chosen bare handle, or null if cancelled/failed.
 */
export async function offerCreateOrg({ apiBase, token, accountHandle = null, personalOrgExists = false }) {
  const prompts = (await import('prompts')).default
  const personal = accountHandle && !validateHandle(accountHandle) ? bareHandle(accountHandle) : null

  if (!personal) {
    console.error(
      '\x1b[31m✗\x1b[0m This account has no handle (service accounts don\'t get one), so there is no ready-to-go org.\n' +
      '  Log in with a personal account or set a handle in the app — or pass --scope @org / `uniweb org create <handle>`.'
    )
    return null
  }

  const canClaimPersonal = !personalOrgExists
  const choices = [
    ...(canClaimPersonal
      ? [{ title: `@${personal} — your personal org (created on first publish)`, value: personal }]
      : []),
    { title: 'A new organization…', value: ':new' },
  ]
  if (!canClaimPersonal) {
    console.log(`\x1b[2m@${personal} exists but you're not a member of it — ask its admin, or create another org.\x1b[0m`)
  }

  const { choice } = await prompts({
    type: 'select',
    name: 'choice',
    message: 'Publish under which org?',
    choices,
    initial: 0,
  }, { onCancel: () => { console.log('\nCancelled.'); process.exit(0) } })
  if (!choice) return null

  let handle = choice
  if (choice === ':new') {
    const answer = await prompts({
      type: 'text',
      name: 'handle',
      message: 'Org handle (e.g. acme):',
      validate: (v) => validateHandle(v) || true,
    }, { onCancel: () => { console.log('\nCancelled.'); process.exit(0) } })
    if (!answer.handle) return null
    handle = answer.handle
  }

  try {
    const org = await createOrg({ apiBase, token, handle })
    console.log(`\x1b[32m✓\x1b[0m Created \x1b[1m@${org.handle}\x1b[0m — you're a member${org.is_primary ? ' (primary)' : ''}.`)
    return org.handle
  } catch (err) {
    console.error(`\x1b[31m✗\x1b[0m ${err.message}`)
    return null
  }
}
