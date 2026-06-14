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
 *                 flag (`--backend` / `--registry`) > UNIWEB_REGISTER_URL >
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
import { ensureRegistryAuth, fetchMe } from '../utils/registry-auth.js'
import { fetchOrgs as fetchOrgsImpl, createOrg as createOrgImpl } from '../utils/registry-orgs.js'
import { uploadFoundationCode } from '../utils/code-upload.js'

/**
 * Resolve the backend origin: an explicit flag value wins; otherwise defer to
 * the shared origin resolver (env override > saved config > local default). A
 * full URL is reduced to its origin, so callers may pass a whole endpoint URL.
 *
 * One resolver, one place to revisit when we settle the single-origin-input +
 * discovery-handshake decision — kept delegating for now so this stays a pure,
 * behavior-preserving consolidation.
 *
 * @param {string} [flag] - the raw value of --backend / --registry, if supplied
 * @returns {string} a bare origin with no trailing slash
 */
export function resolveBackendOrigin(flag) {
  if (flag) {
    try { return new URL(flag).origin } catch { /* not a URL — fall through */ }
  }
  return getRegistryApiBaseUrl()
}

/**
 * The fallback capability doc when `GET /dev/config` is absent or unreachable
 * (an older backend, or no backend at all). Keeps the client non-breaking: the
 * bases mirror a self-serve dev backend, `assetBase` falls back to the historical
 * production CDN host so published-site asset resolution is unchanged, and
 * `runtime.installed` is empty so runtime resolution requires an explicit pin.
 */
export const DISCOVERY_DEFAULTS = {
  gatewayBase: '/gateway',
  assetBase: 'https://assets.uniweb.app/',
  auth: { loginPath: '/dev/auth/login', required: true },
  delivery: { deploy: true, publish: true, broker: 'self-serve' },
  assets: { supported: false },
  runtime: { installed: [] },
}

export class BackendClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.origin] - explicit origin (wins over originFlag/env)
   * @param {string} [opts.originFlag] - raw --backend/--registry value to resolve
   * @param {string} [opts.token] - explicit bearer (wins over env + stored session)
   * @param {() => Promise<string>} [opts.getToken] - injected bearer resolver (tests, or
   *        callers with their own auth); used when no explicit token/env is present
   * @param {string[]} [opts.args] - argv slice (checked for --non-interactive in auth)
   * @param {string} [opts.command] - label for the login prompt ('Pushing', 'Registering', …)
   * @param {typeof fetch} [opts.fetchImpl] - injectable fetch (tests)
   */
  constructor({ origin, originFlag, token, getToken, args = [], command = 'This command', fetchImpl } = {}) {
    this.origin = (origin || resolveBackendOrigin(originFlag)).replace(/\/+$/, '')
    this._token = token || process.env.UNIWEB_TOKEN || null
    this._getToken = getToken || null
    this._args = args
    this._command = command
    this._fetch = fetchImpl || ((url, init) => globalThis.fetch(url, init))
    this._discovery = null
  }

  /**
   * The session bearer, resolved lazily and memoized. Order (matching the
   * standalone verbs): explicit --token / UNIWEB_TOKEN (constructor) > stored
   * session > interactive login (ensureRegistryAuth).
   * @returns {Promise<string>}
   */
  async token() {
    if (this._token) return this._token
    if (this._getToken) {
      this._token = await this._getToken()
      return this._token
    }
    this._token = await ensureRegistryAuth({ apiBase: this.origin, command: this._command, args: this._args })
    return this._token
  }

  /**
   * Low-level request against the backend. Adds the bearer (unless auth:false),
   * applies query params, and infers a content-type from the body when unset
   * (string → application/json, Buffer/Uint8Array → application/zip). Returns
   * the raw Response so callers branch on status themselves (409 resume,
   * 404 → null, 401/403 messaging, …).
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
  async request(path, { method = 'GET', body, headers = {}, query, auth = true } = {}) {
    const url = new URL(path, this.origin)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v != null) url.searchParams.set(k, String(v))
      }
    }
    const h = { ...headers }
    if (auth) h.Authorization = `Bearer ${await this.token()}`
    if (body != null && h['Content-Type'] == null) {
      if (typeof body === 'string') h['Content-Type'] = 'application/json'
      else if (body instanceof Uint8Array || Buffer.isBuffer(body)) h['Content-Type'] = 'application/zip'
    }
    return this._fetch(url.href, { method, headers: h, body })
  }

  // ── Discovery ─────────────────────────────────────────────────────────────────

  /**
   * GET /dev/config — the anonymous capability/handshake document. The one route
   * that answers before login (`auth: false`). Lazy + cached for the client's
   * lifetime; a missing route or any transport/parse error falls back to
   * DISCOVERY_DEFAULTS (non-breaking — an older backend still works). Lets the
   * CLI hardcode nothing about a backend but its origin and discover the rest:
   * `gatewayBase`/`assetBase` (serve/asset roots — relative ⇒ relative-to-origin),
   * `auth`, `delivery` (deploy/publish? broker), `assets` (lane built yet?),
   * `runtime.installed` (the default-runtime source replacing the old /runtime/latest).
   * @returns {Promise<object>}
   */
  async discover() {
    if (this._discovery) return this._discovery
    try {
      const res = await this.request('/dev/config', { auth: false })
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
    return this.request('/dev/registry/register', { method: 'POST', body: uwxJson })
  }

  /**
   * Deliver a built foundation's dist/ code (plan → PUT-per-file → verify).
   * Thin pass-through to utils/code-upload.js with this client's origin + token.
   * @param {object} opts - { name, version, distDir, files?, onProgress? }
   */
  async uploadFoundationCode(opts) {
    return uploadFoundationCode({ apiBase: this.origin, token: await this.token(), ...opts })
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
    if (!res.ok) throw new Error(`Model-read ${modelName} failed: HTTP ${res.status} ${res.statusText}`)
    return res.json()
  }

  // ── Orgs ──────────────────────────────────────────────────────────────────────

  /** GET /dev/orgs → { account_handle, personal_org_exists, orgs[] }. */
  async fetchOrgs() {
    return fetchOrgsImpl({ apiBase: this.origin, token: await this.token() })
  }

  /** POST /dev/orgs { handle } → { handle, uuid, is_primary }. Throws with the server's detail on 409/422. */
  async createOrg(handle) {
    return createOrgImpl({ apiBase: this.origin, token: await this.token(), handle })
  }

  // ── Site sync (push / pull) ─────────────────────────────────────────────────────

  /** POST /dev/site/content — CREATE a site from its content lane (.uwx zip). */
  async createSiteContent(buffer, { asOrg } = {}) {
    return this.request('/dev/site/content', { method: 'POST', body: buffer, query: pushQuery(asOrg) })
  }

  /** POST /dev/site/content/push/{uuid} — UPDATE the content lane by site uuid (.uwx zip). */
  async updateSiteContent(uuid, buffer, { asOrg } = {}) {
    return this.request(`/dev/site/content/push/${encodeURIComponent(uuid)}`, {
      method: 'POST', body: buffer, query: pushQuery(asOrg),
    })
  }

  /** POST /dev/site/folder/push/{uuid} — push the folder lane, keyed by the site uuid (.uwx zip). */
  async pushFolder(uuid, buffer, { asOrg } = {}) {
    return this.request(`/dev/site/folder/push/${encodeURIComponent(uuid)}`, {
      method: 'POST', body: buffer, query: pushQuery(asOrg),
    })
  }

  /** GET /dev/site/content/pull/{uuid} — the content lane document. */
  async pullSiteContent(uuid) {
    return this.request(`/dev/site/content/pull/${encodeURIComponent(uuid)}`)
  }

  /** GET /dev/site/folder/pull/{uuid} — the folder lane (folder + record documents). */
  async pullFolder(uuid) {
    return this.request(`/dev/site/folder/pull/${encodeURIComponent(uuid)}`)
  }

  // ── Delivery: deploy + site publish ─────────────────────────────────────────────

  /**
   * POST /dev/deploy — dumb, file-built delivery. Body is the deploy payload (the
   * runtime-init JSON `build-site-data.js` produces — foundation, runtimeVersion,
   * theme, languages, locales, optional dataFiles/searchFiles) plus an optional
   * `site_uuid`. First deploy of a never-synced site omits it → the backend mints
   * a uuid and returns it for write-back to deploy.yml; later deploys resend it so
   * `/gateway/site/{uuid}/` stays stable. Returns the raw Response so the caller
   * messages its own errors and reads `{ site_uuid, url, locales }` on 200.
   * @param {object} payload - the deploy payload (universal currency)
   * @param {object} [opts]
   * @param {string} [opts.siteUuid] - a previously-minted delivery uuid
   * @returns {Promise<Response>}
   */
  async deploy(payload, { siteUuid } = {}) {
    const body = siteUuid ? { ...payload, site_uuid: siteUuid } : payload
    return this.request('/dev/deploy', { method: 'POST', body: JSON.stringify(body) })
  }

  /**
   * POST /dev/site/publish/{uuid} — CMS-publish a synced site (make its CURRENT
   * backend state live; it does NOT push local files). `{uuid}` is the site-content
   * uuid (`site.yml::$uuid`); a never-synced site 404s (sync first, or use deploy).
   * The CLI knows the runtime from its build; the body carries it snake-cased per
   * the route contract. Returns the raw Response ({ deploy_uuid, url,
   * published_folder_uuid, status } on 200).
   * @param {string} uuid - the site-content uuid
   * @param {object} opts
   * @param {string} opts.runtimeVersion
   * @param {string[]} [opts.languages]
   * @returns {Promise<Response>}
   */
  async publishSite(uuid, { runtimeVersion, languages } = {}) {
    // Runtime rides as a query param (?runtime=<version>) per the shipped /dev
    // route (D3, "request-carried"), NOT the body. Languages, when present, go in
    // the body; absent → no body (the route only requires the runtime).
    return this.request(`/dev/site/publish/${encodeURIComponent(uuid)}`, {
      method: 'POST',
      query: { runtime: runtimeVersion },
      ...(languages ? { body: JSON.stringify({ languages }) } : {}),
    })
  }

  /**
   * POST /dev/site/unpublish/{uuid} — drop the published-folder gate so /gateway
   * stops serving the site's dynamic content. Returns the raw Response ({ was_published }).
   * @param {string} uuid - the site-content uuid
   * @returns {Promise<Response>}
   */
  async unpublishSite(uuid) {
    return this.request(`/dev/site/unpublish/${encodeURIComponent(uuid)}`, { method: 'POST' })
  }
}

/** `@scope/name` → /dev/registry/data-schemas/{scope}/{name}; a bare name → …/{name}. */
export function dataSchemaPath(modelName) {
  const m = /^@([^/]+)\/(.+)$/.exec(modelName)
  if (m) return `/dev/registry/data-schemas/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`
  return `/dev/registry/data-schemas/${encodeURIComponent(modelName)}`
}

/** The shared push query: last-push-wins, plus an optional acting-org. */
function pushQuery(asOrg) {
  return { collision: 'force', ...(asOrg ? { as_org: asOrg } : {}) }
}
