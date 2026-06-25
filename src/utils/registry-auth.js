/**
 * Registry (new-backend) credential storage + login.
 *
 * SEPARATE from utils/auth.js on purpose. That module is the LEGACY platform
 * auth — browser/social login via `cli-auth.php`, a JWT shared by `publish`
 * and `deploy`, stored in ~/.uniweb/auth.json. This module serves the NEW
 * backend that `uniweb register` talks to:
 *
 *   - non-browser username/password login → POST {apiBase}/dev/auth/login
 *   - the returned bearer is an OPAQUE random token (NOT a JWT — never decode it,
 *     it carries no claims; org memberships come from a separate authed read)
 *   - stored in a register-scoped slot (~/.uniweb/registry-auth.json) so it can
 *     never clobber the legacy token publish/deploy rely on.
 *
 * Token resolution for `register` (the `--token` flag is handled by the caller,
 * ahead of this): UNIWEB_TOKEN env > stored session (unexpired) >
 * UNIWEB_USERNAME/UNIWEB_PASSWORD env (non-interactive) > interactive prompt.
 *
 * Login response shape (agreed with backend, 2026-05-26):
 *   { token, expires_at, account: { uuid, username, handle } }
 *   token + expiry top-level; identity nested under `account` (handle nullable).
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const LOGIN_PATH = '/dev/auth/login'

/** The shared ~/.uniweb credential directory. */
export function getAuthDir() {
  return join(homedir(), '.uniweb')
}

/** True when a stored session's `expiresAt` is in the past (absent → never expires). */
export function isExpired(auth) {
  if (!auth?.expiresAt) return false
  return new Date(auth.expiresAt) < new Date()
}

/**
 * Path to the register-scoped credential file (~/.uniweb/registry-auth.json).
 * Reuses the legacy auth dir (the ~/.uniweb home is shared infrastructure);
 * only the filename differs, keeping the two tokens in separate slots.
 * @returns {string}
 */
export function getRegistryAuthPath() {
  return join(getAuthDir(), 'registry-auth.json')
}

/**
 * Read the stored registry session, or null. No JWT backfill — the token is
 * opaque, so there are no claims to decode (unlike legacy readAuth()).
 * @returns {Promise<{ token: string, expiresAt?: string, accountId?: number, sessionId?: number, username?: string, handle?: string, uuid?: string } | null>}
 */
export async function readRegistryAuth() {
  const path = getRegistryAuthPath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Persist the registry session record.
 * @param {Object} record
 */
export async function writeRegistryAuth(record) {
  await mkdir(getAuthDir(), { recursive: true })
  await writeFile(getRegistryAuthPath(), JSON.stringify(record, null, 2))
}

/**
 * Remove the stored registry session.
 */
export async function clearRegistryAuth() {
  const path = getRegistryAuthPath()
  if (existsSync(path)) await unlink(path)
}

/**
 * Username/password login against the new backend. POSTs to
 * `{apiBase}/dev/auth/login`, reads the opaque token from the JSON body
 * (the HttpOnly cookie the response also sets is ignored on the CLI), and
 * persists it. Throws on non-2xx or a tokenless body.
 *
 * @param {Object} params
 * @param {string} params.apiBase - new-backend origin, e.g. http://localhost:8080
 * @param {string} params.username
 * @param {string} params.password
 * @returns {Promise<Object>} the stored session record (incl. `token`)
 */
export async function loginToRegistry({ apiBase, username, password } = {}) {
  if (!apiBase) throw new Error('loginToRegistry: apiBase is required')
  const url = `${apiBase.replace(/\/$/, '')}${LOGIN_PATH}`

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  } catch (err) {
    throw new Error(`Could not reach the login endpoint at ${url}: ${err.message}`)
  }

  if (!res.ok) {
    let detail = ''
    try { detail = (await res.text()).slice(0, 300) } catch { /* ignore */ }
    const e = new Error(`Login failed: HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`)
    e.status = res.status
    throw e
  }

  const data = await res.json().catch(() => null)
  if (!data?.token) throw new Error('Login succeeded but the response carried no token.')

  // New-backend login body (agreed with backend, 2026-05-26):
  //   { token, expires_at, account: { uuid, username, handle } }
  // token/expires_at stay top-level; identity is nested under `account`. The
  // token is opaque (no claims), and `expires_at` is stored as `expiresAt` so
  // the shared isExpired() works unchanged. Tolerant of the pre-#2 flat body
  // (no `account` key) — token + expiry still resolve, identity is just skipped.
  const account = data.account || {}
  const record = { token: data.token }
  if (data.expires_at) record.expiresAt = data.expires_at
  if (account.uuid) record.uuid = account.uuid
  if (account.username) record.username = account.username
  if (account.handle) record.handle = account.handle

  await writeRegistryAuth(record)
  return record
}

/**
 * Ensure a usable new-backend bearer for `register`. Resolution order:
 *   UNIWEB_TOKEN env > stored unexpired session > UNIWEB_USERNAME/PASSWORD env
 *   (non-interactive) > interactive username/password prompt.
 *
 * In non-interactive mode with no token/env creds, bails with an actionable
 * error instead of hanging on a prompt (mirrors ensureAuth's CI guard).
 *
 * @param {Object} options
 * @param {string} options.apiBase - new-backend origin (e.g. http://localhost:8080)
 * @param {string} [options.command] - command needing auth (for messaging)
 * @param {string[]} [options.args] - argv slice; checked for --non-interactive
 * @returns {Promise<string>} bearer token
 */
export async function ensureRegistryAuth({ apiBase, command = 'This command', args = [] } = {}) {
  if (process.env.UNIWEB_TOKEN) return process.env.UNIWEB_TOKEN

  const stored = await readRegistryAuth()
  if (stored?.token && !isExpired(stored)) return stored.token

  // Non-interactive login from env (CI / agents) before any prompt.
  const envUser = process.env.UNIWEB_USERNAME
  const envPass = process.env.UNIWEB_PASSWORD
  if (envUser && envPass) {
    const record = await loginToRegistry({ apiBase, username: envUser, password: envPass })
    return record.token
  }

  const { isNonInteractive, getCliPrefix } = await import('./interactive.js')
  if (isNonInteractive(args)) {
    const prefix = getCliPrefix()
    const reason = stored && isExpired(stored) ? 'Session expired.' : 'Not logged in.'
    console.error(`\x1b[31m✗\x1b[0m ${reason} ${command} requires a Uniweb account, and the CLI is non-interactive (CI / no TTY / --non-interactive).`)
    console.error('  Options:')
    console.error(`    • Set UNIWEB_TOKEN to a bearer token.`)
    console.error(`    • Set UNIWEB_USERNAME + UNIWEB_PASSWORD to log in non-interactively.`)
    console.error(`    • Run \`${prefix} login\` interactively first, then re-run.`)
    process.exit(1)
  }

  if (stored && isExpired(stored)) {
    console.log(`\x1b[33mSession expired.\x1b[0m ${command} requires a Uniweb account.\n`)
  } else {
    console.log(`${command} requires a Uniweb account.\n`)
  }

  // Interactive: hand off to the multi-method login picker, reuse its session.
  const record = await runRegistryLogin({ apiBase, args })
  if (!record?.token) process.exit(1)
  return record.token
}

// The browser/OAuth flow is wired below (loginViaBrowser: a loopback redirect
// against the backend's /dev/auth/cli/authorize, token-in-redirect). Kept
// gated until that endpoint is live on the backend — flip to true then, and the
// picker offers Browser/social as the default (and `--browser` works).
const BROWSER_AVAILABLE = false

/**
 * GET /dev/auth/me with a bearer → the account object ({ uuid, username,
 * handle }), or throws. Used to verify + identify a pasted token.
 */
export async function fetchMe({ apiBase, token }) {
  const res = await fetch(`${apiBase.replace(/\/$/, '')}/dev/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const e = new Error(`token check failed: HTTP ${res.status} ${res.statusText}`)
    e.status = res.status
    throw e
  }
  const data = await res.json().catch(() => null)
  return data?.account || null
}

// Username/password — prompts unless UNIWEB_USERNAME/PASSWORD are set.
async function loginViaPassword({ apiBase, nonInteractive }) {
  let username = process.env.UNIWEB_USERNAME
  let password = process.env.UNIWEB_PASSWORD
  if (!username || !password) {
    if (nonInteractive) {
      throw new Error('username/password login needs a terminal — set UNIWEB_USERNAME + UNIWEB_PASSWORD (or UNIWEB_TOKEN).')
    }
    const prompts = (await import('prompts')).default
    const resp = await prompts([
      { type: 'text', name: 'username', message: 'Username:', validate: (v) => (v ? true : 'Username is required') },
      { type: 'password', name: 'password', message: 'Password:', validate: (v) => (v ? true : 'Password is required') },
    ], { onCancel: () => { console.log('\nLogin cancelled.'); process.exit(0) } })
    username = resp.username
    password = resp.password
    if (!username || !password) process.exit(1)
  }
  return loginToRegistry({ apiBase, username, password })
}

// Paste a token — verified + identified via /me before it's stored.
async function loginViaTokenPaste({ apiBase, nonInteractive }) {
  if (nonInteractive) {
    throw new Error('token paste needs a terminal — set UNIWEB_TOKEN instead.')
  }
  const prompts = (await import('prompts')).default
  const { token } = await prompts({
    type: 'password', name: 'token', message: 'Paste your token:', validate: (v) => (v ? true : 'Token is required'),
  }, { onCancel: () => { console.log('\nLogin cancelled.'); process.exit(0) } })
  if (!token) process.exit(1)
  const account = await fetchMe({ apiBase, token }) // throws if the token is invalid
  const record = { token }
  if (account?.uuid) record.uuid = account.uuid
  if (account?.username) record.username = account.username
  if (account?.handle) record.handle = account.handle
  await writeRegistryAuth(record)
  return record
}

// Open a URL in the default browser. Returns whether it launched.
async function openBrowser(url) {
  try {
    const { exec } = await import('node:child_process')
    const cmd = process.platform === 'darwin' ? `open "${url}"`
      : process.platform === 'win32' ? `start "" "${url}"`
        : `xdg-open "${url}"`
    return await new Promise((resolve) => exec(cmd, (err) => resolve(!err)))
  } catch {
    return false
  }
}

/**
 * One-shot browser loopback — the reusable primitive behind both `uniweb login`
 * (token-in-redirect) and `uniweb publish`'s payment handoff (done-signal).
 *
 * Hosts a one-shot `127.0.0.1` server on an ephemeral port, opens the browser to
 * a URL built from that port, and resolves once the browser is redirected back
 * to `/callback`. The value never leaves browser→localhost. Provider-agnostic:
 * the CALLER supplies the URL to open (given the loopback redirect URI) and a
 * validator that inspects the callback query — so the same tested server serves
 * any "open a page, wait for it to come back" flow.
 *
 * @param {object} o
 * @param {(redirectUri: string) => string} o.buildUrl - the URL to open, given the loopback /callback URI
 * @param {(params: URLSearchParams) => ({ value: any } | { error: string })} o.validate
 *        - inspect the callback query; return `{ value }` to succeed or `{ error }` to fail
 * @param {number} [o.timeoutMs=120000]
 * @param {string} [o.openingLabel] - the "opening…" line
 * @param {string} [o.waitingLabel] - the "waiting…" line
 * @param {string} [o.okTitle='Done'] - success page heading
 * @param {string} [o.errTitle='Something went wrong'] - failure page heading
 * @returns {Promise<any>} the validated `value`
 * @throws on validation error, timeout, or a loopback server error
 */
export async function awaitBrowserCallback({
  buildUrl,
  validate,
  timeoutMs = 120000,
  openingLabel = 'Opening your browser…',
  waitingLabel,
  okTitle = 'Done',
  errTitle = 'Something went wrong',
} = {}) {
  const result = await new Promise((resolve) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      if (u.pathname !== '/callback') { res.writeHead(404); res.end('Not found'); return }
      const verdict = validate(u.searchParams) || { error: 'no result from the callback.' }
      const failed = !!verdict.error
      res.writeHead(failed ? 400 : 200, { 'Content-Type': 'text/html' })
      res.end(`<!doctype html><html><body style="font-family:system-ui,sans-serif;text-align:center;padding:60px">`
        + `<h2 style="color:${failed ? '#dc2626' : '#16a34a'}">${failed ? errTitle : okTitle}</h2>`
        + `<p>You can close this tab and return to your terminal.</p></body></html>`)
      cleanup()
      resolve(failed ? { error: verdict.error } : { value: verdict.value })
    })
    let timer
    function cleanup() { clearTimeout(timer); server.close() }
    server.on('error', (e) => resolve({ error: `loopback server error: ${e.message}` }))
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address()
      const redirectUri = `http://127.0.0.1:${port}/callback`
      const url = buildUrl(redirectUri)
      console.log(`\x1b[36m→\x1b[0m ${openingLabel}`)
      console.log(`  \x1b[2m${url}\x1b[0m`)
      const opened = await openBrowser(url)
      if (!opened) console.log('\x1b[33m⚠\x1b[0m Could not open a browser automatically — open the URL above.')
      console.log(`\x1b[2m${waitingLabel || `Waiting (${Math.round(timeoutMs / 1000)}s)…`}\x1b[0m`)
    })
    timer = setTimeout(() => { server.close(); resolve({ error: `timed out (${Math.round(timeoutMs / 1000)}s).` }) }, timeoutMs)
  })
  if (result.error) throw new Error(result.error)
  return result.value
}

// Browser / social — loopback OAuth against the backend's /dev/auth/authorize.
// The CLI hosts a one-shot 127.0.0.1 server (awaitBrowserCallback), opens the
// browser to authorize, and the backend (after the Google dance) 302s back to
// the loopback with the token (or an error). state is a CSRF nonce echoed back
// and verified. The token never leaves browser→localhost. Gated by
// BROWSER_AVAILABLE until the endpoint is live.
async function loginViaBrowser({ apiBase }) {
  if (!BROWSER_AVAILABLE) {
    throw new Error('browser/social login for the new backend isn’t available yet — use --password or --token-paste.')
  }
  const base = apiBase.replace(/\/$/, '')
  const state = randomBytes(16).toString('hex')

  const token = await awaitBrowserCallback({
    buildUrl: (redirectUri) =>
      `${base}/dev/auth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
    validate: (params) => {
      if (params.get('error')) return { error: params.get('error') }
      if (params.get('state') !== state) return { error: 'state mismatch — please try again.' }
      const tok = params.get('token')
      if (!tok) return { error: 'no token returned by the callback.' }
      return { value: tok }
    },
    openingLabel: 'Opening your browser to sign in…',
    waitingLabel: 'Waiting for sign-in to complete (120s)…',
    okTitle: 'Login successful',
    errTitle: 'Login failed',
  })

  let account = null
  try { account = await fetchMe({ apiBase, token }) } catch { /* identity optional; token is valid */ }
  const record = { token }
  if (account?.uuid) record.uuid = account.uuid
  if (account?.username) record.username = account.username
  if (account?.handle) record.handle = account.handle
  await writeRegistryAuth(record)
  return record
}

/**
 * `uniweb login` against the new backend — a multi-method picker:
 *   browser/social (default, once available) · username+password · paste a token.
 * Force a method with --browser / --password / --token-paste (skips the menu).
 * No TTY → no menu; falls back to the non-browser path (env UNIWEB_USERNAME/
 * PASSWORD; UNIWEB_TOKEN is handled earlier by ensureRegistryAuth).
 *
 * @param {Object} o
 * @param {string} o.apiBase - new-backend origin
 * @param {string[]} [o.args] - argv slice (force flags + --non-interactive)
 * @returns {Promise<Object|undefined>} the stored session record
 */
export async function runRegistryLogin({ apiBase, args = [] } = {}) {
  const existing = await readRegistryAuth()
  if (existing?.token && !isExpired(existing)) {
    const who = existing.username || existing.handle || (existing.uuid ? `account ${existing.uuid}` : '')
    console.log(`Already logged in${who ? ` as \x1b[1m${who}\x1b[0m` : ''}${apiBase ? ` (${apiBase})` : ''}.`)
    console.log('\x1b[2mContinuing will replace the existing session.\x1b[0m\n')
  }

  const { isNonInteractive } = await import('./interactive.js')
  const nonInteractive = isNonInteractive(args)

  // `--token <bearer>` seeds + verifies a session non-interactively (verified
  // against /dev/auth/me before it's stored, so an invalid token fails loudly
  // instead of poisoning the session file). Distinct from the per-command
  // `--token` (ephemeral, never stored) and from UNIWEB_TOKEN env.
  const { readFlagValue } = await import('./args.js')
  const tokenFlag = readFlagValue(args, '--token')
  if (tokenFlag) {
    let account
    try {
      account = await fetchMe({ apiBase, token: tokenFlag })
    } catch (err) {
      console.error(`\x1b[31m✗\x1b[0m Token rejected by ${apiBase}: ${err.message}`)
      process.exit(1)
    }
    const record = { token: tokenFlag }
    if (account?.uuid) record.uuid = account.uuid
    if (account?.username) record.username = account.username
    if (account?.handle) record.handle = account.handle
    await writeRegistryAuth(record)
    console.log(`\x1b[32m✓\x1b[0m Logged in${account?.username ? ` as \x1b[1m${account.username}\x1b[0m` : ''}${apiBase ? ` (${apiBase})` : ''}`)
    return record
  }

  let method = args.includes('--browser') ? 'browser'
    : args.includes('--password') ? 'password'
    : args.includes('--token-paste') ? 'token-paste'
    : null

  if (!method) {
    if (nonInteractive) {
      if (process.env.UNIWEB_USERNAME && process.env.UNIWEB_PASSWORD) {
        method = 'password'
      } else {
        console.error('\x1b[31m✗\x1b[0m Cannot log in non-interactively without a method.')
        console.error('  Set UNIWEB_USERNAME + UNIWEB_PASSWORD, set UNIWEB_TOKEN, or run `uniweb login` in a terminal.')
        console.error('  Or force one: --password / --token-paste.')
        process.exit(1)
      }
    } else {
      const prompts = (await import('prompts')).default
      const choices = []
      if (BROWSER_AVAILABLE) choices.push({ title: 'Browser / social (Google, etc.)', value: 'browser' })
      choices.push({ title: 'Username and password', value: 'password' })
      choices.push({ title: 'Paste a token', value: 'token-paste' })
      const { picked } = await prompts({
        type: 'select', name: 'picked', message: 'How do you want to log in?', choices,
      }, { onCancel: () => { console.log('\nLogin cancelled.'); process.exit(0) } })
      if (!picked) process.exit(0)
      method = picked
    }
  }

  let record
  try {
    if (method === 'browser') record = await loginViaBrowser({ apiBase })
    else if (method === 'token-paste') record = await loginViaTokenPaste({ apiBase, nonInteractive })
    else record = await loginViaPassword({ apiBase, nonInteractive })
  } catch (err) {
    console.error(`\x1b[31m✗\x1b[0m ${err.message}`)
    process.exit(1)
  }

  if (record?.token) {
    console.log(`\x1b[32m✓\x1b[0m Logged in${record.username ? ` as \x1b[1m${record.username}\x1b[0m` : ''}${apiBase ? ` (${apiBase})` : ''}`)
  }
  return record
}
