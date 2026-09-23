/**
 * BackendClient — the single front door to the Uniweb backend.
 *
 * Every CLI verb that talks to the backend (register, push, pull, clone, org,
 * login — and, as the consolidation proceeds, publish/deploy/invite/handoff)
 * goes through one instance of this client instead of hand-rolling
 * `fetch(… Authorization: Bearer …)` against a per-command default origin. It
 * owns the three things that were previously scattered across a dozen files:
 *
 *   1. ORIGIN   — where the backend is. resolveBackendOrigin(): an explicit
 *                 flag (`--backend`) > UNIWEB_REGISTER_URL >
 *                 the local default. Any full URL is reduced to its origin.
 *   2. AUTH     — the opaque session bearer (utils/registry-auth.js). Resolved
 *                 LAZILY on the first authed call, so dry-runs and fully-local
 *                 work never trigger a login.
 *   3. REQUESTS — one request() helper (auth header, query params, body
 *                 content-type) plus a typed method per backend operation.
 *
 * The legacy platform paths (the old per-verb URL resolvers, the separate
 * token-based auth, and the remote/local registry classes) are deliberately
 * NOT represented here — consolidating every verb onto this client is what
 * retires them.
 *
 * During Phase 1 the typed methods delegate to the existing, well-tested
 * helpers (registry-auth.js, registry-orgs.js, code-upload.js); those modules
 * move under backend/ as the consolidation lands, leaving this client as their
 * single home.
 */

import { getRegistryApiBaseUrl } from '../utils/config.js'
import {
  ensureRegistryAuth,
  fetchMe,
  readRegistryAuth,
  isExpired
} from '../utils/registry-auth.js'
import {
  fetchOrgs as fetchOrgsImpl,
  createOrg as createOrgImpl
} from '../utils/registry-orgs.js'
import { uploadFoundationCode } from '../utils/code-upload.js'
import { uploadSiteAssets } from '../utils/asset-upload.js'

/**
 * Resolve the backend a command talks to:
 *
 *   1. UNIWEB_REGISTER_URL env — the override for automation (CI, scripts), one process
 *   2. ⭐ the backend the user is LOGGED IN TO — the one session there is
 *   3. the default backend — ~/.uniweb/config.json `registryApiUrl`, else uniweb.app —
 *      where the command's first request then asks the user to log in
 *
 * ⭐ **That is the whole ladder, for every command** *[Diego, 2026-09-21: "push and pull
 * are also meant to go to the backend you are logged into" · "We do not allow any
 * communication with backend if the user is not logged into a backend. The default
 * backend for login, if not specified, is uniweb.app" · switching "via login to another
 * backend is good, and the only way to switch"]*. Logging in is how a backend is chosen.
 *
 * ⛔ **No `--backend` tier, and no project tier.** The backend verbs had a per-command
 * `--backend` until 2026-09-21 — it predates per-backend sessions, when one session
 * slot made "aim this one command elsewhere" a flag's job; switching is a login now, and
 * a script aims with UNIWEB_REGISTER_URL without touching the machine's login. A
 * project's sync.json and deploy.yml routed commands too, until the same day.
 * `--backend` survives only where it SELECTS rather than routes: `login` (where to log
 * in) and `forget` (which backend's records to remove). `logout` needs none: there is
 * one session.
 *
 * @returns {string} a bare origin with no trailing slash
 */
export function resolveBackendOrigin() {
  return getRegistryApiBaseUrl()
}

/**
 * The fallback capability doc for when `GET /dev/config` was not asked for (no
 * credential in hand) or did not answer. Keeps the client non-breaking.
 *
 * ⭐ **It is EMPTY, and that is the accurate shape.** The CLI reads exactly one leaf of
 * that document — `delivery.siteSubscriptionRequired` — and its absence is meaningful:
 * unknown reads falsy, and the caller stays silent rather than claiming a deployment
 * does or does not charge. Every other key that used to sit here had no reader.
 *
 * ⛔ **Do not restore a key "for completeness".** A default for a field nothing reads is
 * a reader waiting to happen, and it is how this file came to describe a client that
 * discovered its backend's gateway base, asset base and login path — none of which was
 * ever true. The removals, and why each was not merely unused but wrong:
 *
 *   `gatewayBase`  sat here UNREAD until 2026-07-29. A serve location is read from the
 *                  response that carries it (an upload plan's `serve_base`, an asset
 *                  entry's `serve_url`, a payload's `config.base`) — never from a
 *                  handshake, which cannot know a per-response answer.
 *   `assetBase`    until 2026-08-17: one production host, hardcoded, applied to every
 *                  deployment the CLI can be pointed at. Read only to compose an asset
 *                  URL the plan already returns verbatim. Reader and composer both gone.
 *   `runtime`      until 2026-08-22. A backend does not hold runtimes — a version comes
 *                  from a CDN — so there is no installed set to report. What a site gets
 *                  follows from its foundation's floor (`info.runtime`, at register).
 *   `auth`         `loginPath` was never read: the login path is a constant in
 *                  `utils/registry-auth.js`, and the ORIGIN comes from the resolution
 *                  ladder, so the CLI is never told where to log in — it is born knowing.
 *   `delivery`     `deploy` and `broker` had no reader. `publish` had one, but it could
 *                  never refuse: the backend sent a literal true for every deployment,
 *                  so the gate read a constant. Removed on both sides 2026-08-30.
 *   `assets`       `supported` had no reader; the asset lane reports its own capability
 *                  through the upload plan it returns.
 */
export const DISCOVERY_DEFAULTS = {}

/**
 * The header a request names its WORKSPACE with — the unit it works in.
 *
 * ⭐ `@<handle>`, the `@` required: a bare value is read as a unit's uuid — the spelling
 * for a workspace with no handle — so the two can never be mistaken for each other.
 * Every `/dev` route accepts it; the client names it on the site routes, the ones that
 * work in a workspace (`namesWorkspace`). ⛔ It replaced `?as_org=` (2026-09-23), which
 * only routes that declared it accepted — the rest answered `400`.
 */
export const WORKSPACE_HEADER = 'x-uniweb-workspace'

/**
 * Whether a request works IN a workspace — a site route, `/dev/site…`.
 *
 * Only those name one. Every `/dev` route accepts the header, but registration reads
 * none (the `@scope` in the name decides, membership-gated), `/dev/assets` reads none
 * (a charge lands on the entity's own workspace), and auth, orgs and config are about
 * the account. Naming the site's workspace there would be harmless and meaningless —
 * and a workspace that is refused (`400`/`403`) would then fail a registration that
 * never involved it.
 *
 * @param {string} path - leading-slash path
 * @returns {boolean}
 */
export function namesWorkspace(path) {
  return /^\/dev\/site(\/|$)/.test(String(path))
}

/**
 * A workspace as it may be written — `@acme`, `acme`, `@acme/…` — as the header's
 * `@acme`; null for none (the personal workspace, which a request names by omission).
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function workspaceHandle(value) {
  const h =
    typeof value === 'string' ? value.trim().replace(/^@/, '').replace(/\/.*$/, '') : ''
  return h ? `@${h}` : null
}

const UNIT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A workspace as the header names it — `@handle`, or a unit's bare uuid when the unit
 * has no handle — or null for none.
 *
 * ⚠️ A bare value is taken for a uuid only when it is shaped like one, and our own
 * handle grammar admits uuid-shaped handles (3–39 lowercase letters, digits, hyphens).
 * So a HANDLE reaches this already dressed — `--org` through `workspaceHandle`, a
 * record through `readSiteWorkspace` — and a bare uuid here is a unit.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function workspaceHeader(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const v = value.trim()
  return !v.startsWith('@') && UNIT_UUID.test(v) ? v : workspaceHandle(v)
}

/**
 * The request named its workspace EXPLICITLY — `--org`, `--personal`, a choice made at
 * create — and the backend works on the site from another.
 *
 * ⛔ Stopping is the point. It is the mismatch check [Diego, 2026-09-22: "there is no org
 * mismatch when the site is set for an org and the user tries a different one"], and it
 * is the backend's `409` that decides it, never a handle comparison here: a site in
 * `@acme/labs` is legitimately worked on from `@acme`. Adopting the answer would override
 * a choice the user made.
 */
export class WorkspaceMismatchError extends Error {
  /**
   * @param {{ named: string|null, answer: string|null }} p - the workspace the request
   *   named, and the one the backend named (`@handle`, null for personal)
   */
  constructor({ named, answer }) {
    const where = (w) =>
      !w ? 'your personal workspace' : w.startsWith('@') ? w : `the unit ${w}`
    const flag = named ? '--org' : '--personal'
    super(
      `The backend works on this site from ${where(answer)}, not ${where(named)} ` +
        `(${named ? `--org ${named}` : flag}). ` +
        // `--org` takes a handle; a unit without one is reached by naming nothing.
        (answer?.startsWith('@') ? `Pass --org ${answer}, or drop ${flag}.` : `Drop ${flag}.`)
    )
    this.name = 'WorkspaceMismatchError'
    this.status = 409
    this.named = named
    this.answer = answer
  }
}

/**
 * The line to print when a request THREW rather than answered.
 *
 * A `WorkspaceMismatchError` is the backend's answer, not a transport failure, so it is
 * printed as itself: "Could not reach the backend" in front of it would send the user
 * to check their network over a choice they made on the command line.
 *
 * @param {unknown} err
 * @param {string} origin
 * @returns {string}
 */
export function describeRequestError(err, origin) {
  if (err instanceof WorkspaceMismatchError) return err.message
  return `Could not reach the backend at ${origin}: ${err?.message ?? err}`
}

/**
 * The sentence a refusal carries — a problem document's `detail`, else its `title`, else
 * the start of a prose body — or null. Consumes the body. For the surfaces that would
 * otherwise print a status line alone, so a refusal the backend explains is shown as it
 * is: a deployment with one workspace answers a request naming another with a plain
 * `409 Conflict` whose `detail` names the one there is.
 *
 * @param {Response} res
 * @returns {Promise<string|null>}
 */
export async function refusalDetail(res) {
  let body = ''
  try {
    body = await res.text()
  } catch {
    return null
  }
  try {
    const problem = JSON.parse(body)
    const line = problem?.detail || problem?.title
    return typeof line === 'string' && line ? line : null
  } catch {
    return body ? body.slice(0, 300) : null
  }
}

export class BackendClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.origin] - explicit origin (wins over the ladder; tests and
   *        internal callers — no command takes one from the user)
   * @param {string} [opts.token] - explicit bearer (wins over env + stored session)
   * @param {() => Promise<string>} [opts.getToken] - injected bearer resolver (tests, or
   *        callers with their own auth); used when no explicit token/env is present
   * @param {string[]} [opts.args] - argv slice (checked for --non-interactive in auth)
   * @param {string} [opts.command] - label for the login prompt ('Pushing', 'Registering', …)
   * @param {typeof fetch} [opts.fetchImpl] - injectable fetch (tests)
   */
  constructor({
    origin,
    token,
    getToken,
    args = [],
    command = 'This command',
    fetchImpl
  } = {}) {
    this.origin = (
      origin || resolveBackendOrigin()
    ).replace(/\/+$/, '')
    this._token = token || process.env.UNIWEB_TOKEN || null
    this._getToken = getToken || null
    this._args = args
    this._command = command
    this._fetch = fetchImpl || ((url, init) => globalThis.fetch(url, init))
    this._discovery = null
    this._workspace = null
    this._workspaceExplicit = false
    this._onWorkspaceAdopted = null
  }

  /** The workspace this client's requests name — `@handle`, or null (none named). */
  get workspace() {
    return this._workspace
  }

  /**
   * Name the workspace every request from here on works in (`x-uniweb-workspace`).
   *
   * @param {string|null} value - `@acme` / `acme`, a handle-less unit's uuid, or null to
   *   name none (`workspaceHeader`)
   * @param {object} [opts]
   * @param {boolean} [opts.explicit=false] - the user named it (`--org`, `--personal`,
   *   the create picker). A `409 wrong_workspace` then STOPS the command
   *   (`WorkspaceMismatchError`) instead of adopting the backend's answer.
   * @param {(handle: string|null) => void|Promise<void>} [opts.onAdopted] - called when a
   *   request that named nothing, or a stale workspace, adopts the one the backend named;
   *   the caller records it (sync.json) and says so
   * @returns {this}
   */
  setWorkspace(value, { explicit = false, onAdopted = null } = {}) {
    this._workspace = workspaceHeader(value)
    this._workspaceExplicit = Boolean(explicit)
    this._onWorkspaceAdopted = onAdopted || null
    return this
  }

  /**
   * The session bearer, resolved lazily and memoized. Order: an explicit `token`
   * (constructor — tests and internal callers; no command takes one from the user) /
   * UNIWEB_TOKEN > the stored session > interactive login (ensureRegistryAuth).
   * @returns {Promise<string>}
   */
  async token() {
    if (this._token) return this._token
    if (this._getToken) {
      this._token = await this._getToken()
      return this._token
    }
    // ⛔ NO ORIGIN-MISMATCH GUARD HERE, AND DO NOT RE-ADD ONE (removed 2026-09-20).
    // It existed because the session store held ONE record: a session for another
    // backend was the only session, so it was about to be sent here and rejected, and a
    // warning was the best available move. Sessions are keyed by origin now
    // (utils/registry-auth.js), so being logged into another backend is just a fact
    // about another backend — `ensureRegistryAuth` below finds this origin's session or
    // asks for one. Warning about the other would be noise about nothing.
    this._token = await ensureRegistryAuth({
      apiBase: this.origin,
      command: this._command,
      args: this._args
    })
    return this._token
  }

  /**
   * Low-level request against the backend. Adds the bearer (unless auth:false),
   * applies query params, and infers a content-type from the body when unset
   * (string → application/json, Buffer/Uint8Array → application/zip). Returns
   * the raw Response so callers branch on status themselves (409 resume,
   * 404 → null, 401/403 messaging, …) — except a `409 wrong_workspace`, which is
   * answered here: adopted and retried once when the workspace was not named, and
   * thrown as `WorkspaceMismatchError` when it was (see the body).
   *
   * @param {string} path - leading-slash path, e.g. '/dev/site/content'
   * @param {object} [opts]
   * @param {string} [opts.method='GET']
   * @param {*} [opts.body]
   * @param {Record<string,string>} [opts.headers]
   * @param {Record<string,string|number|undefined>} [opts.query]
   * @param {boolean} [opts.auth=true]
   * @returns {Promise<Response>}
   */
  async request(path, opts = {}) {
    const res = await this._send(path, opts)
    if (res?.status !== 409) return res

    // ⭐ THE WORKSPACE A REQUEST NAMES IS CHECKED BY THE BACKEND, NOT HERE. A request that
    // names the wrong one for an existing site is refused with `409 wrong_workspace`,
    // naming a workspace the caller CAN open that contains the site — its own unit, or a
    // parent the caller belongs to. Two answers, and which one depends on the user:
    //   - they named it (`--org`, `--personal`) → stop and say so: the mismatch check;
    //   - they named nothing, or a stale one → adopt the backend's answer, let the caller
    //     record it, and retry ONCE.
    // ⛔ No handle comparison anywhere: a site in `@acme/labs` is worked on from `@acme`.
    const problem =
      typeof res.clone === 'function' ? await res.clone().json().catch(() => null) : null
    if (problem?.reason !== 'wrong_workspace') return res
    const where = problem.workspace || {}
    // A unit with no handle is named by its uuid, bare — the header takes either.
    const answer = where.handle
      ? workspaceHandle(where.handle)
      : typeof where.unit_uuid === 'string' && where.unit_uuid
        ? where.unit_uuid
        : null
    // Naming what the backend names and still refused: nothing to adopt, or to report
    // as a mismatch. The caller reads the 409 like any other.
    if (answer === this._workspace) return res
    if (this._workspaceExplicit) {
      throw new WorkspaceMismatchError({ named: this._workspace, answer })
    }
    this._workspace = answer
    if (this._onWorkspaceAdopted) await this._onWorkspaceAdopted(answer)
    return this._send(path, opts)
  }

  /** One request, as `request` documents it — naming the client's workspace on a site route. */
  async _send(path, { method = 'GET', body, headers = {}, query, auth = true } = {}) {
    const url = new URL(path, this.origin)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v != null) url.searchParams.set(k, String(v))
      }
    }
    const h = { ...headers }
    if (auth) h.Authorization = `Bearer ${await this.token()}`
    if (this._workspace && namesWorkspace(path)) h[WORKSPACE_HEADER] = this._workspace
    if (body != null && h['Content-Type'] == null) {
      if (typeof body === 'string') h['Content-Type'] = 'application/json'
      else if (body instanceof Uint8Array || Buffer.isBuffer(body))
        h['Content-Type'] = 'application/zip'
    }
    return this._fetch(url.href, { method, headers: h, body })
  }

  // ── Discovery ─────────────────────────────────────────────────────────────────

  /**
   * The session bearer IF one can be had without asking — an explicit `token`, the
   * UNIWEB_TOKEN env var, or a stored unexpired session. Never prompts, never logs in, returns null
   * instead. `token()` is the one that may block; this is for calls that want to be
   * authenticated when possible but must not *cause* an authentication.
   * @returns {Promise<string|null>}
   */
  async _tokenIfAvailable() {
    if (this._token) return this._token
    // ⛔ The injected resolver must be honoured here too, not just in `token()`.
    // `pull` and `clone` pass one (`deps.getToken`), so skipping it would treat a caller
    // that supplies its own auth as unauthenticated — and, worse, fall through to the
    // machine's stored session, quietly using a DIFFERENT credential than the caller
    // asked for. A throwing resolver is "no token", never a failed command.
    if (this._getToken) {
      try {
        return (await this._getToken()) || null
      } catch {
        return null
      }
    }
    try {
      const stored = await readRegistryAuth(this.origin)
      if (stored?.token && !isExpired(stored)) return stored.token
    } catch {
      /* advisory — a missing or unreadable session is simply "no token" */
    }
    return null
  }

  /**
   * GET /dev/config — the capability/handshake document. Lazy + cached for the client's
   * lifetime; a missing route, a 401, or any transport/parse error falls back to
   * DISCOVERY_DEFAULTS, so this can never be the reason a command fails.
   *
   * ⭐ **Authenticated, or not sent at all.** `/dev/*` is the CLI's lane and the CLI is
   * an authenticated client, so this attaches the bearer when it has one and **makes no
   * request when it does not** — which keeps that true by construction rather than by
   * ordering luck, and makes the route moving behind auth a no-op here.
   *
   * ⚠️ It uses `_tokenIfAvailable()` and never `token()`, deliberately: **discovery must
   * never be the thing that triggers a login.** A capability probe that opens a password
   * prompt would be a worse defect than the anonymous call it replaced.
   *
   * ⛔ **Most of this document is deliberately not read.** `gatewayBase` and `assetBase`
   * were dropped because a serve location is read from the response that carries it
   * (`serve_base`, `serve_url`, `config.base`), never from a handshake; `auth.loginPath`
   * is not read either — the login path is a hardcoded constant
   * (`utils/registry-auth.js`). What is actually consumed is ONE leaf —
   * `delivery.siteSubscriptionRequired` — and nothing else. Do not add a reader for the
   * rest: each one would be a second place a backend's layout is pinned.
   *
   * @returns {Promise<object>}
   */
  async discover() {
    if (this._discovery) return this._discovery
    const bearer = await this._tokenIfAvailable()

    // ⛔ NO CREDENTIAL ⇒ NO REQUEST. This is the rule made structural rather than
    // incidental: apart from the login routes themselves, the CLI does not touch
    // `/dev/*` without a bearer. The defaults are the honest answer here — we do not
    // know this backend's capabilities and are not entitled to ask yet — and every
    // caller already treats them as non-breaking, so nothing downstream changes.
    if (!bearer) {
      this._discovery = { ...DISCOVERY_DEFAULTS }
      return this._discovery
    }

    try {
      const res = await this.request('/dev/config', {
        auth: false,
        headers: { Authorization: `Bearer ${bearer}` }
      })
      this._discovery = res.ok ? await res.json() : { ...DISCOVERY_DEFAULTS }
    } catch {
      this._discovery = { ...DISCOVERY_DEFAULTS }
    }
    return this._discovery
  }

  // ── Identity ────────────────────────────────────────────────────────────────

  /** GET /dev/auth/me → the account object ({ uuid, username, handle }) or null. */
  async whoami() {
    return fetchMe({ apiBase: this.origin, token: await this.token() })
  }

  // ── Registry: foundations + data schemas ──────────────────────────────────────

  /**
   * POST /dev/registry/register — submit a names-only .uwx document (a
   * foundation schema + the data schemas it renders, or a standalone schemas
   * package). Returns the raw Response (register branches on a 409 "already
   * registered" to resume code delivery).
   * @param {string} uwxJson - the serialized .uwx (a JSON string)
   * @returns {Promise<Response>}
   */
  async register(uwxJson) {
    return this.request('/dev/registry/register', {
      method: 'POST',
      body: uwxJson
    })
  }

  /**
   * Deliver a built foundation's dist/ code (plan → PUT-per-file → verify).
   * Thin pass-through to utils/code-upload.js with this client's origin + token.
   * @param {object} opts - { name, version, distDir, files?, onProgress? }
   */
  async uploadFoundationCode(opts) {
    return uploadFoundationCode({
      apiBase: this.origin,
      token: await this.token(),
      ...opts
    })
  }

  /**
   * GET /dev/registry/data-schemas/{scope}/{name} — a Model declaration, or
   * null on 404 (the caller then says "register it first"). Accepts `@scope/name`
   * and bare `name`.
   * @param {string} modelName
   * @returns {Promise<object|null>}
   */
  async readDataSchema(modelName) {
    const res = await this.request(dataSchemaPath(modelName))
    if (res.status === 404) return null
    if (!res.ok)
      throw new Error(
        `Model-read ${modelName} failed: HTTP ${res.status} ${res.statusText}`
      )
    return res.json()
  }

  /**
   * GET /dev/registry/{scope}/{name} → the latest registered foundation version
   * + its content digest, or null on 404 / any failure (callers degrade).
   *
   * The bare `{scope}/{name}` path resolves the latest foundation version (the
   * data-schema sibling is `/dev/registry/data-schemas/{scope}/{name}`). The
   * backend returns `version` (+ schema ids); we normalize it to `latest_version`
   * for callers and tolerate either key. `digest` is the framework-computed
   * fingerprint the backend stores OPAQUE and echoes here (null when the version
   * carries none) — the freshness signal for publish/status (shipping-model.md
   * §4.1). A bare/unscoped name → null (only `@org/name` can be looked up).
   * @param {string} scopedName
   * @returns {Promise<{ latest_version: string|null, digest: string|null }|null>}
   */
  async readFoundationLatest(scopedName) {
    const m = /^@([^/]+)\/([^@/]+)/.exec(String(scopedName || ''))
    if (!m) return null
    try {
      const res = await this.request(
        `/dev/registry/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`
      )
      if (!res.ok) return null
      const body = await res.json().catch(() => null)
      if (!body) return null
      // The read returns `version`; callers use `latest_version`. Tolerate both.
      return {
        ...body,
        latest_version: body.latest_version ?? body.version ?? null
      }
    } catch {
      return null
    }
  }

  // ── Orgs ──────────────────────────────────────────────────────────────────────

  /** GET /dev/orgs → { account_handle, orgs[] }. */
  async fetchOrgs() {
    return fetchOrgsImpl({ apiBase: this.origin, token: await this.token() })
  }

  /** POST /dev/orgs { handle } → { handle, uuid, is_primary }. Throws with the server's detail on 409/422. */
  async createOrg(handle) {
    return createOrgImpl({
      apiBase: this.origin,
      token: await this.token(),
      handle
    })
  }

  // ── Site sync (push / pull) ─────────────────────────────────────────────────────

  /**
   * POST /dev/site — CREATE an EMPTY site and return its site-content uuid.
   *
   * The uuid exists before any content or asset does, which is the whole point:
   * uploaded bytes are metered against an owning entity and freed by deleting it,
   * so an upload with no site to charge is billed and can never be reclaimed.
   * Creating the site first is what makes a failed first publish leave a clearable
   * empty site instead of unfreeable bytes.
   *
   * A thin re-projection of the same op the app's blank-site create uses, so the
   * two lanes cannot drift. Adoption of `foundation` is best-effort — an
   * unreleased ref leaves the resolved ref null and the site still exists — but
   * the field itself is required and cannot be blank.
   *
   * NOT idempotent: two calls mint two sites (a name is not a unique key, by
   * design). Callers must guard on the site's uuid for this backend (sync.json) and
   * write the result back immediately — see `ensureSiteExists`.
   *
   * The owner is the workspace the client names (`setWorkspace`) — the create is where
   * that choice is made, once.
   *
   * @param {{ name: string, foundation: string }} opts
   * @returns {Promise<Response>} `{ site_content_uuid }`
   */
  async createSite({ name, foundation } = {}) {
    return this.request('/dev/site', {
      method: 'POST',
      // Both fields are REQUIRED: `info.name` is `required: true` on the model
      // (and is a plain string — an identity label, never a `{lang: …}` map, since
      // a localized value can vanish under locale projection and a name must always
      // render), and a site must resolve to a foundation. Adoption of the ref is
      // best-effort on the backend, but the field itself cannot be blank — so send
      // whatever the site declares and let the backend judge it.
      body: JSON.stringify({ name, foundation })
    })
  }

  /** POST /dev/site/content — CREATE a site from its content lane (.uwx zip). */
  async createSiteContent(buffer) {
    return this.request('/dev/site/content', {
      method: 'POST',
      body: buffer,
      query: PUSH_QUERY
    })
  }

  /** POST /dev/site/content/push/{uuid} — UPDATE the content lane by site uuid (.uwx zip). */
  async updateSiteContent(uuid, buffer) {
    return this.request(`/dev/site/content/push/${encodeURIComponent(uuid)}`, {
      method: 'POST',
      body: buffer,
      query: PUSH_QUERY
    })
  }

  /** POST /dev/site/folder/push/{uuid} — push the folder lane, keyed by the site uuid (.uwx zip). */
  async pushFolder(uuid, buffer) {
    return this.request(`/dev/site/folder/push/${encodeURIComponent(uuid)}`, {
      method: 'POST',
      body: buffer,
      query: PUSH_QUERY
    })
  }

  /**
   * GET /dev/site/content/pull/{uuid} — the content lane document. Pass the
   * last-seen ETag (opaque) to make it conditional: a match returns 304 (empty body).
   */
  async pullSiteContent(uuid, { etag } = {}) {
    return this.request(`/dev/site/content/pull/${encodeURIComponent(uuid)}`, {
      headers: etag ? { 'If-None-Match': etag } : {}
    })
  }

  /** GET /dev/site/folder/pull/{uuid} — the folder lane (folder + record documents). */
  async pullFolder(uuid, { etag } = {}) {
    return this.request(`/dev/site/folder/pull/${encodeURIComponent(uuid)}`, {
      headers: etag ? { 'If-None-Match': etag } : {}
    })
  }

  // ── Delivery: deploy + site publish ─────────────────────────────────────────────

  /**
   * POST /dev/deploy — dumb, file-built delivery. Body is the deploy payload (the
   * runtime-init JSON `build-site-data.js` produces — foundation, theme,
   * languages, locales, optional dataFiles/searchFiles) plus an optional
   * `site_uuid`. First deploy of a never-synced site omits it → the backend mints
   * a uuid and returns it for write-back to deploy.yml; later deploys resend it so
   * the site's published URL stays stable. Returns the raw Response so the caller
   * messages its own errors and reads `{ site_uuid, url, locales }` on 200.
   * @param {object} payload - the deploy payload (universal currency)
   * @param {object} [opts]
   * @param {string} [opts.siteUuid] - a previously-minted delivery uuid
   * @returns {Promise<Response>}
   */
  async deploy(payload, { siteUuid } = {}) {
    const body = siteUuid ? { ...payload, site_uuid: siteUuid } : payload
    return this.request('/dev/deploy', {
      method: 'POST',
      body: JSON.stringify(body)
    })
  }

  /**
   * POST /dev/site/publish/{uuid} — CMS-publish a synced site (make its CURRENT
   * backend state live; it does NOT push local files). `{uuid}` is the site-content
   * uuid on this backend (sync.json); a never-synced site 404s (sync first, or use deploy).
   * Languages, when present, go in the body; absent → no body. Returns the raw
   * Response ({ deploy_uuid, url, published_folder_uuid, status } on 200).
   *
   * ⛔ Sends NOTHING about a runtime. A `?runtime=<version>` param rode here until
   * 2026-08-22, carrying a `site.yml::runtime` pin — a vestigial prop [Diego]: no
   * template ever set it, no public doc described it, and the backend may already
   * have been ignoring it. A site is codeless and has no basis for naming a
   * runtime; the binding party is the FOUNDATION, whose floor travels as
   * `info.runtime` at register. Do not reintroduce the param.
   * @param {string} uuid - the site-content uuid
   * @param {object} [opts]
   * @param {string[]} [opts.languages]
   * @returns {Promise<Response>}
   */
  async publishSite(uuid, { languages } = {}) {
    return this.request(`/dev/site/publish/${encodeURIComponent(uuid)}`, {
      method: 'POST',
      ...(languages ? { body: JSON.stringify({ languages }) } : {})
    })
  }

  /**
   * POST /dev/site/unpublish/{uuid} — drop the published-folder gate so the host
   * stops serving the site's dynamic content. Returns the raw Response ({ was_published }).
   * @param {string} uuid - the site-content uuid
   * @returns {Promise<Response>}
   */
  async unpublishSite(uuid) {
    return this.request(`/dev/site/unpublish/${encodeURIComponent(uuid)}`, {
      method: 'POST'
    })
  }

  /**
   * GET /dev/site/status/{uuid} → the site's publish lifecycle (Contract 3,
   * shipped backend-side — collab backend↔framework):
   *   { published: boolean, last_pushed_at?: string, last_published_at?: string, draft_dirty?: boolean }
   * `draft_dirty` = never-published, or the synced draft changed since the last
   * publish ("pushed but not published").
   *
   * ⭐ **The backend also serves a LIVE-SITE record here, and nothing in this CLI reads
   * it yet** (shipped 2026-08-29; documented here so it is not lost twice):
   *
   *   last_published_url · last_published_foundation · last_published_extensions
   *   last_published_runtime · last_published_runtime_floor · last_published_runtime_resolution
   *
   * Three things about it that a reader will otherwise get wrong:
   *
   * ⛔ `runtime_resolution` is `resolved` or `pinned:<reason>` (`operator` / `unknown_floor` /
   *    `no_foundations`). **A pin is a first-class answer, not a failure** — most sites are pinned
   *    at any moment, and an "old" runtime still satisfies the site's floor. Never surface
   *    `pinned:*` as an error state.
   * ⛔ `extensions` is there because a site's code surface is the primary foundation **plus N
   *    extensions**; reading the primary alone describes a site nobody has.
   * ⛔ `last_*` is deliberate on every one. `unpublish` LEAVES the URL populated (the static site
   *    may still be reachable), so beside `published: bool` a bare `published_url` would read as a
   *    liveness claim and be wrong exactly when it matters. And **nothing back-fills** — a site
   *    published before this reports them absent, which means "published before we recorded it",
   *    never "has no foundation".
   *
   * The path is VERB-FIRST (`status/{uuid}`)
   * to match the lane (`publish/{uuid}`, `content/push/{uuid}`, `folder/pull/{uuid}`),
   * not the `{uuid}/status` the shipping-verbs §8 sketch assumed. null on
   * 404 (unknown/not-yours) / 401 / any failure — `status --remote` degrades to local.
   * @param {string} uuid - the site-content uuid
   * @returns {Promise<object|null>}
   */
  async siteStatus(uuid) {
    try {
      const res = await this.request(
        `/dev/site/status/${encodeURIComponent(uuid)}`
      )
      if (res.status === 409) {
        // A refusal about the workspace — e.g. a deployment with one workspace, naming
        // it — is an answer to report, not an absent status.
        const refused = new Error((await refusalDetail(res)) || 'HTTP 409 Conflict')
        refused.status = 409
        throw refused
      }
      return res.ok ? await res.json().catch(() => null) : null
    } catch (err) {
      // A mismatch or a refusal is an answer, not an absent status.
      if (err instanceof WorkspaceMismatchError || err?.status === 409) throw err
      return null
    }
  }

  /**
   * Deliver a site's processed assets (plan → PUT-per-file) to the backend's
   * content-addressed store. Thin pass-through to utils/asset-upload.js with this
   * client's origin + token; returns the `localUrl → { id, ext, serveUrl }` rewrite
   * map the deploy step reads `serveUrl` from verbatim (never composing one).
   * @param {object} opts - { distDir, files?, onProgress? }
   */
  async uploadSiteAssets(opts) {
    return uploadSiteAssets({
      apiBase: this.origin,
      token: await this.token(),
      ...opts
    })
  }

}

/** `@scope/name` → /dev/registry/data-schemas/{scope}/{name}; a bare name → …/{name}. */
export function dataSchemaPath(modelName) {
  const m = /^@([^/]+)\/(.+)$/.exec(modelName)
  if (m)
    return `/dev/registry/data-schemas/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`
  return `/dev/registry/data-schemas/${encodeURIComponent(modelName)}`
}

/**
 * The shared push query: last-push-wins. ⛔ No `as_org` — the workspace rides the
 * `x-uniweb-workspace` header on every site request (`BackendClient.setWorkspace`),
 * since 2026-09-23.
 */
const PUSH_QUERY = { collision: 'force' }
