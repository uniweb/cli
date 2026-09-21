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

import { DEFAULT_BACKEND_ORIGIN } from './config.js'
import { normalizeSessionFile, sessionFilePath, loggedInOriginOf } from './session-file.js'

const LOGIN_PATH = '/dev/auth/login'

/** The shared ~/.uniweb credential directory. */
export function getAuthDir() {
  return join(homedir(), '.uniweb')
}

/** Normalize a backend URL to a bare origin (for stamping on the session). */
function normOrigin(u) {
  try {
    // http(s) only — `localhost:8080` parses as a scheme with the origin "null", and a
    // session keyed "null" would answer for nothing.
    const parsed = new URL(u)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : u
  } catch {
    return u
  }
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
  return sessionFilePath()
}

/**
 * ONE SESSION PER BACKEND ORIGIN — the on-disk shape.
 *
 * ⛔ **It was a single flat record until 2026-09-20, and that was a correctness bug,
 * not only a limit.** `ensureRegistryAuth` returned the stored token whenever it was
 * unexpired, WITHOUT checking which origin issued it — so a session for backend A was
 * handed to a request against backend B, where it is rejected. `BackendClient.token()`
 * could only warn after the fact, because with one slot there was nothing better to do.
 *
 * ⭐ Keyed by origin, that whole class goes away: logging into a second backend no
 * longer evicts the first, and "which token?" has an answer instead of a heuristic.
 *
 *   { version: 2, current: "https://uniweb.app",
 *     sessions: { "https://uniweb.app": { token, expiresAt, … }, … } }
 *
 * ⭐ **`current` is the backend the user logged in to most recently** — every login sets
 * it. It is what "the backend you are logged in to" means once there can be several, and
 * the origin ladder reads it (`loggedInOriginOf`, utils/session-file.js). ⛔ It was
 * missing from `fb4907e` until 2026-09-21, and the ladder's copy of this file's shape
 * still read the v1 `origin` field, so for every login made in between, "logged in to X"
 * routed nothing.
 *
 * ⚠️ A v1 flat record is read as one session, keyed by its own `origin` stamp — or by
 * the default backend when it carries none. Nobody is logged out by the upgrade.
 *
 * The shape is read in ONE place, `utils/session-file.js`.
 */

/** The whole file, normalized to v2 shape. Never throws. */
async function readAuthFile() {
  const path = getRegistryAuthPath()
  if (!existsSync(path)) return normalizeSessionFile(null, DEFAULT_BACKEND_ORIGIN)
  try {
    return normalizeSessionFile(JSON.parse(await readFile(path, 'utf8')), DEFAULT_BACKEND_ORIGIN)
  } catch {
    return normalizeSessionFile(null, DEFAULT_BACKEND_ORIGIN)
  }
}

async function writeAuthFile({ version, current, sessions }) {
  await mkdir(getAuthDir(), { recursive: true })
  await writeFile(
    getRegistryAuthPath(),
    JSON.stringify({ version, ...(current ? { current } : {}), sessions }, null, 2)
  )
}

/**
 * The stored session FOR ONE BACKEND, or null. No JWT backfill — the token is
 * opaque, so there are no claims to decode (unlike legacy readAuth()).
 *
 * ⛔ `origin` is required in spirit: calling this without one used to mean "the
 * session", which is the assumption this file exists to remove. It falls back to the
 * default backend rather than throwing, because every caller now passes one and a
 * throw here would turn a stale call site into a crash instead of a wrong answer.
 *
 * @param {string} [origin] - the backend whose session is wanted
 * @returns {Promise<{ token: string, expiresAt?: string, accountId?: number, sessionId?: number, username?: string, handle?: string, uuid?: string, origin: string } | null>}
 */
export async function readRegistryAuth(origin) {
  const key = normOrigin(origin || DEFAULT_BACKEND_ORIGIN)
  const { sessions } = await readAuthFile()
  const found = sessions[key]
  return found && typeof found.token === 'string' ? { ...found, origin: key } : null
}

/**
 * Persist one backend's session, and make it CURRENT — the backend the user is now
 * logged in to. The record's own `origin` is the key, so every login path keeps
 * stamping it exactly as before.
 * @param {Object} record - must carry `origin` and `token`
 */
export async function writeRegistryAuth(record) {
  const key = normOrigin(record?.origin || DEFAULT_BACKEND_ORIGIN)
  const { origin: _drop, ...rest } = record || {}
  const file = await readAuthFile()
  file.sessions[key] = rest
  // Every caller is a login, so this is the backend the user just logged in to.
  file.current = key
  await writeAuthFile(file)
}

/**
 * Make a stored session CURRENT without logging in again — for `uniweb login --backend X`
 * when a session for X already exists. Naming a backend is choosing it.
 *
 * @param {string} origin
 * @returns {Promise<boolean>} whether that backend has a stored session
 */
export async function markCurrentSession(origin) {
  const key = normOrigin(origin || DEFAULT_BACKEND_ORIGIN)
  const file = await readAuthFile()
  if (!file.sessions[key]) return false
  if (file.current !== key) {
    file.current = key
    await writeAuthFile(file)
  }
  return true
}

/**
 * Every stored session, newest-agnostic, as `[{ origin, … }]`. Feeds the login
 * default and the logout report — both of which have to say WHICH backends the
 * machine knows about, a question the flat file could not answer.
 * @returns {Promise<Array<{ origin: string, token: string, expiresAt?: string }>>}
 */
export async function listRegistrySessions() {
  const { sessions } = await readAuthFile()
  return Object.entries(sessions)
    .filter(([, v]) => v && typeof v.token === 'string')
    .map(([origin, v]) => ({ ...v, origin }))
}

/**
 * Remove ONE backend's session, or every one when `origin` is omitted.
 *
 * ⚠️ The no-argument form still clears everything, which is what `uniweb logout`
 * has always done — but it is now a deliberate "all", not the only thing expressible.
 *
 * @param {string} [origin]
 * @returns {Promise<string[]>} the origins actually cleared
 */
export async function clearRegistryAuth(origin) {
  const path = getRegistryAuthPath()
  if (!existsSync(path)) return []
  if (!origin) {
    const had = Object.keys((await readAuthFile()).sessions)
    await unlink(path)
    return had
  }
  const key = normOrigin(origin)
  const file = await readAuthFile()
  if (!file.sessions[key]) return []
  delete file.sessions[key]
  // Logged out of the current backend ⇒ nothing is current; a single remaining session
  // still answers on its own (loggedInOriginOf).
  if (file.current === key) file.current = null
  if (Object.keys(file.sessions).length === 0) await unlink(path)
  else await writeAuthFile(file)
  return [key]
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
      body: JSON.stringify({ username, password })
    })
  } catch (err) {
    throw new Error(
      `Could not reach the login endpoint at ${url}: ${err.message}`
    )
  }

  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 300)
    } catch {
      /* ignore */
    }
    const e = new Error(
      `Login failed: HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`
    )
    e.status = res.status
    throw e
  }

  const data = await res.json().catch(() => null)
  if (!data?.token)
    throw new Error('Login succeeded but the response carried no token.')

  // New-backend login body (agreed with backend, 2026-05-26):
  //   { token, expires_at, account: { uuid, username, handle } }
  // token/expires_at stay top-level; identity is nested under `account`. The
  // token is opaque (no claims), and `expires_at` is stored as `expiresAt` so
  // the shared isExpired() works unchanged. Tolerant of the pre-#2 flat body
  // (no `account` key) — token + expiry still resolve, identity is just skipped.
  const account = data.account || {}
  const record = { token: data.token, origin: normOrigin(apiBase) }
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
export async function ensureRegistryAuth({
  apiBase,
  command = 'This command',
  args = []
} = {}) {
  if (process.env.UNIWEB_TOKEN) return process.env.UNIWEB_TOKEN

  // ⛔ THE SESSION MUST BE THE ONE ISSUED FOR `apiBase`. Until 2026-09-20 this read
  // "the" session and returned its token whenever it was unexpired — so a bearer minted
  // by backend A was sent to backend B, which rejects it. The store is keyed by origin
  // now, so asking for the right one is the same single read.
  const stored = await readRegistryAuth(apiBase)
  if (stored?.token && !isExpired(stored)) return stored.token

  // Non-interactive login from env (CI / agents) before any prompt.
  const envUser = process.env.UNIWEB_USERNAME
  const envPass = process.env.UNIWEB_PASSWORD
  if (envUser && envPass) {
    const record = await loginToRegistry({
      apiBase,
      username: envUser,
      password: envPass
    })
    return record.token
  }

  const { isNonInteractive, getCliPrefix } = await import('./interactive.js')
  if (isNonInteractive(args)) {
    const prefix = getCliPrefix()
    const reason =
      stored && isExpired(stored) ? 'Session expired.' : 'Not logged in.'
    console.error(
      `\x1b[31m✗\x1b[0m ${reason} ${command} requires a Uniweb account, and the CLI is non-interactive (CI / no TTY / --non-interactive).`
    )
    console.error('  Options:')
    console.error(`    • Set UNIWEB_TOKEN to a bearer token.`)
    console.error(
      `    • Set UNIWEB_USERNAME + UNIWEB_PASSWORD to log in non-interactively.`
    )
    console.error(
      `    • Run \`${prefix} login\` interactively first, then re-run.`
    )
    process.exit(1)
  }

  if (stored && isExpired(stored)) {
    console.error(
      `\x1b[33mSession expired.\x1b[0m ${command} requires a Uniweb account.\n`
    )
  } else {
    console.error(`${command} requires a Uniweb account.\n`)
  }

  // Interactive: hand off to the multi-method login picker, reuse its session.
  const record = await runRegistryLogin({ apiBase, args })
  if (!record?.token) process.exit(1)
  return record.token
}


/**
 * GET /dev/auth/me with a bearer → the account object ({ uuid, username,
 * handle }), or throws. Used to verify + identify a pasted token.
 */
export async function fetchMe({ apiBase, token }) {
  const res = await fetch(`${apiBase.replace(/\/$/, '')}/dev/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) {
    const e = new Error(
      `token check failed: HTTP ${res.status} ${res.statusText}`
    )
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
      throw new Error(
        'username/password login needs a terminal — set UNIWEB_USERNAME + UNIWEB_PASSWORD (or UNIWEB_TOKEN).'
      )
    }
    const prompts = (await import('prompts')).default
    const resp = await prompts(
      [
        {
          type: 'text',
          name: 'username',
          message: 'Username:',
          validate: (v) => (v ? true : 'Username is required')
        },
        {
          type: 'password',
          name: 'password',
          message: 'Password:',
          validate: (v) => (v ? true : 'Password is required')
        }
      ],
      {
        onCancel: () => {
          console.error('\nLogin cancelled.')
          process.exit(0)
        }
      }
    )
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
  const { token } = await prompts(
    {
      type: 'password',
      name: 'token',
      message: 'Paste your token:',
      validate: (v) => (v ? true : 'Token is required')
    },
    {
      onCancel: () => {
        console.error('\nLogin cancelled.')
        process.exit(0)
      }
    }
  )
  if (!token) process.exit(1)
  const account = await fetchMe({ apiBase, token }) // throws if the token is invalid
  const record = { token, origin: normOrigin(apiBase) }
  if (account?.uuid) record.uuid = account.uuid
  if (account?.username) record.username = account.username
  if (account?.handle) record.handle = account.handle
  await writeRegistryAuth(record)
  return record
}

// Open a URL in the default browser. Returns whether it launched.
// Exported for the publish payment refusal, which opens the backend's
// settlement URL VERBATIM and needs no loopback (backend/payment-handoff.js).
export async function openBrowser(url) {
  // ⛔ THE URL ARRIVES OVER THE NETWORK — a backend hands it to us and we open it.
  //
  // This built a SHELL STRING (`open "${url}"`) and interpolated that value into
  // it. A `"` in the URL closes the quoted argument and everything after it is
  // shell: one crafted or corrupted response, and the rest runs as the user. It
  // was on the login path before it was on the publish path.
  //
  // ⇒ Two changes, and neither is about payment:
  //   1. `execFile` with the URL as an ARGUMENT — no shell, so no quoting to get
  //      wrong and nothing to escape.
  //   2. Only `http:` / `https:` are opened. `file:`, `javascript:` and the rest
  //      are not places a person goes, and refusing them costs nothing real.
  //      (The caller checks too; a safety rule that only holds at one call site
  //      is one refactor from being gone.)
  if (!/^https?:\/\//i.test(String(url || ''))) return false
  try {
    const { execFile } = await import('node:child_process')
    // `start` is a cmd.exe builtin rather than an executable, so Windows keeps a
    // shell — but through `cmd /c` with the URL as its own argv entry, which is
    // what removes the interpolation. The empty string is `start`'s title slot.
    const [cmd, args] =
      process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', url]]
          : ['xdg-open', [url]]
    return await new Promise((resolve) =>
      execFile(cmd, args, (err) => resolve(!err))
    )
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
  errTitle = 'Something went wrong'
} = {}) {
  const result = await new Promise((resolve) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      if (u.pathname !== '/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      const verdict = validate(u.searchParams) || {
        error: 'no result from the callback.'
      }
      const failed = !!verdict.error
      res.writeHead(failed ? 400 : 200, { 'Content-Type': 'text/html' })
      res.end(
        `<!doctype html><html><body style="font-family:system-ui,sans-serif;text-align:center;padding:60px">` +
          `<h2 style="color:${failed ? '#dc2626' : '#16a34a'}">${failed ? errTitle : okTitle}</h2>` +
          `<p>You can close this tab and return to your terminal.</p></body></html>`
      )
      cleanup()
      resolve(failed ? { error: verdict.error } : { value: verdict.value })
    })
    let timer
    function cleanup() {
      clearTimeout(timer)
      server.close()
    }
    server.on('error', (e) =>
      resolve({ error: `loopback server error: ${e.message}` })
    )
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address()
      const redirectUri = `http://127.0.0.1:${port}/callback`
      const url = buildUrl(redirectUri)
      console.error(`\x1b[36m→\x1b[0m ${openingLabel}`)
      console.error(`  \x1b[2m${url}\x1b[0m`)
      const opened = await openBrowser(url)
      if (!opened)
        console.error(
          '\x1b[33m⚠\x1b[0m Could not open a browser automatically — open the URL above.'
        )
      console.error(
        `\x1b[2m${waitingLabel || `Waiting (${Math.round(timeoutMs / 1000)}s)…`}\x1b[0m`
      )
    })
    timer = setTimeout(() => {
      server.close()
      resolve({ error: `timed out (${Math.round(timeoutMs / 1000)}s).` })
    }, timeoutMs)
  })
  if (result.error) throw new Error(result.error)
  return result.value
}

// Browser / social — the backend's CLI delegation flow. The CLI never speaks to
// an identity provider and holds no client id, secret or provider knowledge: it
// opens ONE url (the backend's), catches a one-time code on a loopback, and
// trades that code for a bearer. Whatever methods the backend's own sign-in page
// offers — password, Google, Microsoft, anything added later — the CLI gains with
// no change here, because it never learns which one was used.
//
// Three legs, all verified against a live backend rather than read:
//
//   GET  {base}/dev/auth/authorize?callback=<loopback>&state=<nonce>
//          no session → 302 {hub}/login?returnTo=…   (the ordinary sign-in page)
//          session    → 302 <callback>?state=<ours>&code=<one-time>
//   POST {base}/dev/auth/token  {code}  → { token, expires_at, account }
//
// ⛔ `callback` IS THE PARAMETER NAME, not `redirect_uri` — the backend serves
// this route and rejects the other spelling with a 400. ⛔ AND THE CALLBACK
// CARRIES A `code`, NEVER A TOKEN: the bearer is born on the POST, server-to-CLI,
// so it never touches the browser, the URL bar, history or a proxy log. Both were
// wrong here for three months — this code was written against an anticipated
// shape five days before the backend shipped, and being gated meant nothing could
// contradict it.
//
// ⛔ The loopback MUST be a v4 literal. `awaitBrowserCallback` binds 127.0.0.1
// explicitly and composes `http://127.0.0.1:<port>/callback`; the backend's
// validator accepts `http://` only, host exactly `127.0.0.1` or `localhost`, and
// refuses `[::1]` and any `user@host` (that last guard stops
// `http://127.0.0.1:1@evil.com/cb` from walking off with the code). Do not
// "modernise" the bind to `::`.
async function loginViaBrowser({ apiBase }) {
  const base = apiBase.replace(/\/$/, '')
  const state = randomBytes(16).toString('hex')

  // Leg 1+2 — open the backend's authorize url, catch the one-time code.
  const code = await awaitBrowserCallback({
    buildUrl: (callback) =>
      `${base}/dev/auth/authorize?callback=${encodeURIComponent(callback)}&state=${state}`,
    validate: (params) => {
      if (params.get('error')) return { error: params.get('error') }
      // Check `state` BEFORE reading anything else: it is the only thing that
      // ties this callback to the request we made.
      if (params.get('state') !== state)
        return { error: 'state mismatch — please try again.' }
      const code = params.get('code')
      if (!code) return { error: 'no code returned by the callback.' }
      return { value: code }
    },
    openingLabel: 'Opening your browser to sign in…',
    waitingLabel: 'Waiting for sign-in to complete (5 min)…',
    // A person is signing in at an identity provider, not clicking one button:
    // a first-time Google or Microsoft login can carry a consent screen, an
    // account chooser and 2FA. The default 120s expires mid-flow and reports a
    // TIMEOUT, which reads as "the CLI is broken" rather than "you were slow".
    // Same reasoning, and the same value, as the publish payment handoff.
    timeoutMs: 5 * 60 * 1000,
    okTitle: 'Login successful',
    errTitle: 'Login failed'
  })

  // Leg 3 — trade the code for a bearer. Anonymous: the code IS the credential,
  // and it is single-use, so a replay gets a 400 rather than a second session.
  const res = await fetch(`${base}/dev/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.token) {
    const detail = payload?.detail || payload?.title || `HTTP ${res.status}`
    throw new Error(`could not complete sign-in: ${detail}`)
  }

  // The token response already carries the account, so no second round trip.
  // `fetchMe` remains the fallback for a backend that answers without one.
  let account = payload.account || null
  if (!account) {
    try {
      account = await fetchMe({ apiBase, token: payload.token })
    } catch {
      /* identity is optional; the bearer is valid either way */
    }
  }

  const record = { token: payload.token, origin: normOrigin(apiBase) }
  if (payload.expires_at) record.expiresAt = payload.expires_at
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
  // For THIS backend. It read "the" session and printed `apiBase` beside it, so on a
  // machine logged into another backend it announced "Already logged in … (this origin)"
  // about a session belonging to a different one — and then offered to replace it.
  const { isNonInteractive } = await import('./interactive.js')
  const nonInteractive = isNonInteractive(args)

  const existing = await readRegistryAuth(apiBase)
  if (existing?.token && !isExpired(existing)) {
    const who =
      existing.username ||
      existing.handle ||
      (existing.uuid ? `account ${existing.uuid}` : '')
    const forced =
      args.includes('--token') ||
      args.includes('--browser') ||
      args.includes('--password') ||
      args.includes('--token-paste')
    if (!forced) {
      // ⭐ SWITCHING IS A LOGIN, AND A LOGIN IS HOW YOU SWITCH *[Diego, 2026-09-21:
      // switching "via login to another backend is good, and the only way to switch"]*.
      // A valid session for this backend exists, so naming it IS the switch: make it
      // current and stop. Logging in again is behind a method flag. ⛔ Until 2026-09-21
      // this went on to the method picker, so a switch meant cancelling a prompt.
      const key = normOrigin(apiBase)
      const wasCurrent = loggedInOriginOf(await readAuthFile()) === key
      await markCurrentSession(apiBase)
      console.error(
        `\x1b[32m✓\x1b[0m ${wasCurrent ? 'Already on' : 'Switched to'} ${key}${who ? ` — logged in as \x1b[1m${who}\x1b[0m` : ''}.`
      )
      console.error(
        '\x1b[2mTo log in again there, name a method: --password, --browser, --token-paste or --token <bearer>.\x1b[0m'
      )
      return { ...existing, origin: key }
    }
    console.error(
      `Already logged in${who ? ` as \x1b[1m${who}\x1b[0m` : ''}${apiBase ? ` (${apiBase})` : ''} — logging in again replaces that session.\n`
    )
  }

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
      console.error(
        `\x1b[31m✗\x1b[0m Token rejected by ${apiBase}: ${err.message}`
      )
      process.exit(1)
    }
    const record = { token: tokenFlag, origin: normOrigin(apiBase) }
    if (account?.uuid) record.uuid = account.uuid
    if (account?.username) record.username = account.username
    if (account?.handle) record.handle = account.handle
    await writeRegistryAuth(record)
    console.error(
      `\x1b[32m✓\x1b[0m Logged in${account?.username ? ` as \x1b[1m${account.username}\x1b[0m` : ''}${apiBase ? ` (${apiBase})` : ''}`
    )
    return record
  }

  let method = args.includes('--browser')
    ? 'browser'
    : args.includes('--password')
      ? 'password'
      : args.includes('--token-paste')
        ? 'token-paste'
        : null

  if (!method) {
    if (nonInteractive) {
      if (process.env.UNIWEB_USERNAME && process.env.UNIWEB_PASSWORD) {
        method = 'password'
      } else {
        console.error(
          '\x1b[31m✗\x1b[0m Cannot log in non-interactively without a method.'
        )
        console.error(
          '  Set UNIWEB_USERNAME + UNIWEB_PASSWORD, set UNIWEB_TOKEN, or run `uniweb login` in a terminal.'
        )
        console.error('  Or force one: --password / --token-paste.')
        process.exit(1)
      }
    } else {
      const prompts = (await import('prompts')).default
      const choices = []
      choices.push({
        title: 'Browser / social (Google, Microsoft, …)',
        value: 'browser'
      })
      choices.push({ title: 'Username and password', value: 'password' })
      choices.push({ title: 'Paste a token', value: 'token-paste' })
      const { picked } = await prompts(
        {
          type: 'select',
          name: 'picked',
          message: 'How do you want to log in?',
          choices
        },
        {
          onCancel: () => {
            console.error('\nLogin cancelled.')
            process.exit(0)
          }
        }
      )
      if (!picked) process.exit(0)
      method = picked
    }
  }

  let record
  try {
    if (method === 'browser') record = await loginViaBrowser({ apiBase })
    else if (method === 'token-paste')
      record = await loginViaTokenPaste({ apiBase, nonInteractive })
    else record = await loginViaPassword({ apiBase, nonInteractive })
  } catch (err) {
    console.error(`\x1b[31m✗\x1b[0m ${err.message}`)
    process.exit(1)
  }

  if (record?.token) {
    console.error(
      `\x1b[32m✓\x1b[0m Logged in${record.username ? ` as \x1b[1m${record.username}\x1b[0m` : ''}${apiBase ? ` (${apiBase})` : ''}`
    )
  }
  return record
}
