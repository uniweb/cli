/**
 * New-backend org operations for the publish-scope bootstrap — used by
 * `uniweb register`'s scope resolution and the `uniweb org` command.
 *
 * One resource (Bearer auth, new backend); the verb selects the operation:
 *   GET  /dev/orgs            → [{ handle, is_primary }] (your orgs, primary first)
 *   POST /dev/orgs { handle }  → { handle, uuid, is_primary }  (creator becomes a
 *                                member, primary iff their first)
 *
 * Handle grammar + reserved scopes are validated client-side for a clean prompt;
 * the server is the backstop (409 taken-or-reserved, 422 bad grammar).
 */

const ORGS_PATH = '/dev/orgs'

// Reserved registry scopes a dev cannot own — the system + standard namespaces
// (uwx-format scope model). Grammatically valid, so the server returns 409
// "taken" for these; we block them earlier for a clearer message.
const RESERVED_HANDLES = new Set(['uniweb', 'std'])

// Handle grammar (backend): lowercase alphanumerics + internal hyphens, 3–39 chars,
// no leading/trailing hyphen. The server is authoritative on reserved names (409).
const HANDLE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
const HANDLE_MIN = 3
const HANDLE_MAX = 39

/** Strip a leading `@` and any `/suffix`, returning the bare handle segment. */
export function bareHandle(scope) {
  return String(scope || '').replace(/^@/, '').replace(/\/.*$/, '')
}

/**
 * Validate a handle client-side. Returns an error string, or null when valid.
 * Accepts an optional leading `@` (stripped before checking).
 */
export function validateHandle(handle) {
  const h = bareHandle(handle)
  if (!h) return 'A handle is required.'
  if (h.length < HANDLE_MIN || h.length > HANDLE_MAX) return `Handle must be ${HANDLE_MIN}–${HANDLE_MAX} characters.`
  if (!HANDLE_RE.test(h)) return 'Use lowercase letters, digits, and internal hyphens only (e.g. acme-co).'
  if (RESERVED_HANDLES.has(h)) return `@${h} is reserved.`
  return null
}

/**
 * List the authenticated account's org memberships (primary first).
 * @returns {Promise<Array<{handle: string, is_primary: boolean}>>}
 */
export async function listOrgs({ apiBase, token }) {
  const res = await fetch(`${apiBase.replace(/\/$/, '')}${ORGS_PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Could not list your orgs: HTTP ${res.status} ${res.statusText}`)
  const data = await res.json().catch(() => null)
  return Array.isArray(data) ? data : []
}

/**
 * Create an org. The creating account becomes a member (primary iff it's their
 * first), so it's immediately publishable.
 * @returns {Promise<{handle: string, uuid?: string, is_primary?: boolean}>}
 */
export async function createOrg({ apiBase, token, handle }) {
  const h = bareHandle(handle)
  const res = await fetch(`${apiBase.replace(/\/$/, '')}${ORGS_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ handle: h }),
  })
  if (res.status === 409) {
    const e = new Error(`@${h} is already taken (or reserved). Pick another.`)
    e.status = 409
    throw e
  }
  if (res.status === 422) {
    const e = new Error(`@${h} is not a valid handle.`)
    e.status = 422
    throw e
  }
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.text()).slice(0, 200) } catch { /* ignore */ }
    const e = new Error(`Could not create @${h}: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`)
    e.status = res.status
    throw e
  }
  return res.json()
}

/**
 * Derive the publish scope from login membership when none was supplied:
 *   1 org  → use it (confirm once)
 *   0 orgs → offer to create one (proposes the account handle when set, else
 *            prompts — never username-derived; cold-start per handle-origin (ii))
 *   N orgs → pick
 * Returns the chosen bare handle (no `@`), or null if cancelled. Persists
 * nothing — the caller records it. Bails in non-interactive mode.
 *
 * @param {Object} p
 * @param {string} p.apiBase
 * @param {string} p.token
 * @param {string|null} [p.accountHandle] - the account's handle (may be null)
 * @param {string[]} [p.args] - argv slice; checked for --non-interactive
 * @returns {Promise<string|null>}
 */
export async function deriveScope({ apiBase, token, accountHandle = null, args = [] }) {
  const orgs = await listOrgs({ apiBase, token })
  const { isNonInteractive } = await import('./interactive.js')
  const nonInteractive = isNonInteractive(args)

  if (orgs.length === 1) {
    const h = orgs[0].handle
    if (nonInteractive) {
      console.log(`Publishing under your org \x1b[1m@${h}\x1b[0m.`)
      return h
    }
    const prompts = (await import('prompts')).default
    const { ok } = await prompts({
      type: 'confirm', name: 'ok', message: `Publish under your org @${h}?`, initial: true,
    }, { onCancel: () => { console.log('\nCancelled.'); process.exit(0) } })
    if (!ok) {
      console.log('Pass --scope @org, or create another with `uniweb org create <handle>`.')
      return null
    }
    return h
  }

  if (orgs.length > 1) {
    if (nonInteractive) {
      const primary = orgs.find((u) => u.is_primary) || orgs[0]
      console.log(`Multiple orgs; using primary \x1b[1m@${primary.handle}\x1b[0m (non-interactive).`)
      return primary.handle
    }
    const prompts = (await import('prompts')).default
    const { choice } = await prompts({
      type: 'select',
      name: 'choice',
      message: 'Publish under which org?',
      choices: orgs.map((u) => ({ title: `@${u.handle}${u.is_primary ? ' (primary)' : ''}`, value: u.handle })),
    }, { onCancel: () => { console.log('\nCancelled.'); process.exit(0) } })
    return choice || null
  }

  // 0 orgs → offer to create.
  if (nonInteractive) {
    console.error('\x1b[31m✗\x1b[0m You have no org to publish under. Create one with `uniweb org create <handle>`, or pass --scope @org.')
    process.exit(1)
  }
  return offerCreateOrg({ apiBase, token, accountHandle })
}

/**
 * Cold-start: prompt for a handle (pre-filled with the account handle when it's
 * set + valid — never the username), create the org, return its handle.
 * @returns {Promise<string|null>}
 */
export async function offerCreateOrg({ apiBase, token, accountHandle = null }) {
  const prompts = (await import('prompts')).default
  const suggested = accountHandle && !validateHandle(accountHandle) ? bareHandle(accountHandle) : ''

  console.log("You don't have an org yet — let's create one (it becomes your publish scope).")
  const { handle } = await prompts({
    type: 'text',
    name: 'handle',
    message: 'Org handle (e.g. acme):',
    initial: suggested,
    validate: (v) => validateHandle(v) || true,
  }, { onCancel: () => { console.log('\nCancelled.'); process.exit(0) } })
  if (!handle) return null

  try {
    const org = await createOrg({ apiBase, token, handle })
    console.log(`\x1b[32m✓\x1b[0m Created \x1b[1m@${org.handle}\x1b[0m — you're a member${org.is_primary ? ' (primary)' : ''}.`)
    return org.handle
  } catch (err) {
    console.error(`\x1b[31m✗\x1b[0m ${err.message}`)
    return null
  }
}
