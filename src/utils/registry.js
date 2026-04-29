/**
 * Local Foundation Registry
 *
 * Manages published foundations in .unicloud/registry/. The on-disk
 * shape mirrors uniweb-edge's registry index (versions as an array of
 * { version, ... } objects, plus top-level namespace and latest) so
 * `--local` exercises the same data shape that ships in production.
 *
 * Layout:
 *   .unicloud/
 *     registry/
 *       index.json                  # see "Index format" below
 *       packages/
 *         name/
 *           1.0.0/
 *             foundation.js
 *             schema.json
 *             assets/...
 *
 * Index format:
 *   {
 *     "@ns/name": {
 *       namespace: "ns",
 *       versions: [
 *         { version: "1.0.0", publishedAt, publishedBy, ... },
 *         ...
 *       ],
 *       latest: "1.0.0"
 *     }
 *   }
 *
 *   Legacy entries (versions as an object keyed by version) are migrated
 *   to this shape on read. The next write persists the new shape.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile, readdir, mkdir, cp } from 'node:fs/promises'
import { join, dirname, relative } from 'node:path'

import { findWorkspaceRoot } from './workspace.js'

/**
 * Get the .unicloud/registry/ directory path.
 * Looks for workspace root first; falls back to cwd.
 * @param {string} [startDir]
 * @returns {string}
 */
export function getRegistryDir(startDir = process.cwd()) {
  const root = findWorkspaceRoot(startDir)
  const base = root || startDir
  return join(base, '.unicloud', 'registry')
}

/**
 * Sanitize a package name for filesystem use.
 * '@org/pkg' → 'org/pkg'
 * @param {string} name
 * @returns {string}
 */
function sanitizeName(name) {
  // Strip leading @ for directory structure: @org/name → org/name
  return name.startsWith('@') ? name.slice(1) : name
}

/**
 * Parse the namespace out of a scoped package name. '@org/pkg' → 'org';
 * unscoped → ''.
 * @param {string} name
 * @returns {string}
 */
function parseNamespace(name) {
  const m = /^@([a-z0-9_-]+)\//.exec(name)
  return m ? m[1] : ''
}

/**
 * Migrate a legacy index entry (versions as object, no namespace/latest)
 * to the current shape (versions as array, namespace + latest at top).
 * Mutates and returns the entry.
 */
function normalizeEntry(name, entry) {
  if (!entry) return entry
  if (entry.versions && !Array.isArray(entry.versions) && typeof entry.versions === 'object') {
    entry.versions = Object.entries(entry.versions).map(([version, data]) => ({
      version,
      ...data,
    }))
  }
  if (!Array.isArray(entry.versions)) entry.versions = []
  if (!entry.namespace) entry.namespace = parseNamespace(name)
  if (!entry.latest && entry.versions.length > 0) {
    entry.latest = entry.versions[entry.versions.length - 1].version
  }
  return entry
}

/**
 * Local registry — stores published foundations in .unicloud/registry/
 */
export class LocalRegistry {
  constructor(startDir) {
    this.registryDir = getRegistryDir(startDir)
    this.indexPath = join(this.registryDir, 'index.json')
    this.packagesDir = join(this.registryDir, 'packages')
  }

  async _readIndex() {
    if (!existsSync(this.indexPath)) return {}
    const raw = JSON.parse(await readFile(this.indexPath, 'utf8'))
    for (const name of Object.keys(raw)) {
      normalizeEntry(name, raw[name])
    }
    return raw
  }

  async _writeIndex(index) {
    await mkdir(this.registryDir, { recursive: true })
    await writeFile(this.indexPath, JSON.stringify(index, null, 2))
  }

  /**
   * Check if a specific version exists.
   * @param {string} name
   * @param {string} version
   * @returns {Promise<boolean>}
   */
  async exists(name, version) {
    const index = await this._readIndex()
    const versions = index[name]?.versions
    if (!Array.isArray(versions)) return false
    return versions.some(v => v.version === version)
  }

  /**
   * Get all published versions for a package as an array of
   * `{ version, publishedAt, ... }` entries (matches uniweb-edge).
   * @param {string} name
   * @returns {Promise<Array>}
   */
  async getVersions(name) {
    const index = await this._readIndex()
    return index[name]?.versions || []
  }

  /**
   * Publish a foundation to the local registry.
   * Copies the dist directory and updates the index.
   * @param {string} name
   * @param {string} version
   * @param {string} distDir - Path to the foundation's dist/ directory
   * @param {Object} [metadata] - Additional metadata (publishedBy, etc.)
   */
  async publish(name, version, distDir, metadata = {}) {
    const safeName = sanitizeName(name)
    const destDir = join(this.packagesDir, safeName, version)

    await mkdir(destDir, { recursive: true })
    await cp(distDir, destDir, { recursive: true })

    const index = await this._readIndex()
    if (!index[name]) {
      index[name] = {
        namespace: parseNamespace(name),
        versions: [],
        latest: null,
      }
    }

    const versionEntry = {
      version,
      publishedAt: new Date().toISOString(),
      ...metadata,
    }
    const existingIdx = index[name].versions.findIndex(v => v.version === version)
    if (existingIdx >= 0) {
      index[name].versions[existingIdx] = versionEntry
    } else {
      index[name].versions.push(versionEntry)
    }
    index[name].latest = version

    await this._writeIndex(index)
  }

  /**
   * Get the filesystem path for a published package version.
   * @param {string} name
   * @param {string} version
   * @returns {string}
   */
  getPackagePath(name, version) {
    return join(this.packagesDir, sanitizeName(name), version)
  }
}

/**
 * Create a local registry instance.
 * @param {string} [startDir]
 * @returns {LocalRegistry}
 */
export function createLocalRegistry(startDir) {
  return new LocalRegistry(startDir)
}

/**
 * Remote registry — publishes foundations to a cloud server via HTTP.
 */
export class RemoteRegistry {
  /**
   * @param {string} apiUrl - Registry server URL (e.g. "http://localhost:4001")
   * @param {string} [token] - Bearer token for authentication
   */
  constructor(apiUrl, token) {
    this.apiUrl = apiUrl.replace(/\/$/, '')
    this.token = token
  }

  /**
   * Fetch the registry index from the server.
   * @returns {Promise<Object>}
   */
  async _fetchIndex() {
    const res = await fetch(`${this.apiUrl}/`)
    if (!res.ok) throw new Error(`Registry request failed: ${res.status}`)
    return res.json()
  }

  /**
   * Check if a specific version exists on the remote.
   * @param {string} name
   * @param {string} version
   * @returns {Promise<boolean>}
   */
  async exists(name, version) {
    try {
      const index = await this._fetchIndex()
      const versions = index[name]?.versions
      if (!Array.isArray(versions)) return false
      return versions.some(v => v.version === version)
    } catch {
      return false
    }
  }

  /**
   * Get all published versions for a package as an array of
   * `{ version, publishedAt, ... }` entries.
   * @param {string} name
   * @returns {Promise<Array>}
   */
  async getVersions(name) {
    const index = await this._fetchIndex()
    return index[name]?.versions || []
  }

  /**
   * Publish a foundation to the remote registry.
   * Reads files from distDir, encodes as base64, and POSTs to the server.
   *
   * @param {string} name
   * @param {string} version
   * @param {string} distDir - Path to the foundation's dist/ directory
   * @param {Object} [metadata] - Additional metadata
   * @returns {Promise<{ name: string, version: string, filesCount: number }>}
   */
  async publish(name, version, distDir, metadata = {}) {
    // Walk distDir recursively and encode files as base64
    const files = {}
    const entries = await readdir(distDir, { withFileTypes: true, recursive: true })

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const fullPath = join(entry.parentPath || entry.path, entry.name)
      const relPath = relative(distDir, fullPath)
      const content = await readFile(fullPath)
      files[relPath] = content.toString('base64')
    }

    const { editAccess, ...restMetadata } = metadata
    const payload = { name, version, files, metadata: restMetadata }
    if (editAccess) {
      payload.editAccess = editAccess
    }

    const headers = { 'Content-Type': 'application/json' }
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const res = await fetch(`${this.apiUrl}/foundations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    const body = await res.json()

    if (!res.ok) {
      if (res.status === 409) {
        throw Object.assign(new Error(body.error || `${name}@${version} already exists`), { code: 'CONFLICT' })
      }
      if (res.status === 401) {
        throw Object.assign(new Error(body.error || 'Unauthorized'), { code: 'UNAUTHORIZED' })
      }
      throw new Error(body.error || `Server error (${res.status})`)
    }

    return body
  }

  /**
   * Common fetch helper with auth headers.
   * @param {string} url
   * @param {Object} [options]
   * @returns {Promise<Response>}
   */
  _authHeaders() {
    const headers = { 'Content-Type': 'application/json' }
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }
    return headers
  }

  /**
   * Create a foundation invite.
   * @param {string} foundationName
   * @param {Object} payload - { email, majorVersion, maxUses?, expiresInDays? }
   * @returns {Promise<Object>}
   */
  async createInvite(foundationName, payload) {
    const res = await fetch(`${this.apiUrl}/api/foundations/${encodeURIComponent(foundationName)}/invites`, {
      method: 'POST',
      headers: this._authHeaders(),
      body: JSON.stringify(payload),
    })
    const body = await res.json()
    if (!res.ok) {
      throw Object.assign(new Error(body.error || `Server error (${res.status})`), { statusCode: res.status })
    }
    return body
  }

  /**
   * List invites for a foundation.
   * @param {string} foundationName
   * @returns {Promise<Array>}
   */
  async listInvites(foundationName) {
    const res = await fetch(`${this.apiUrl}/api/foundations/${encodeURIComponent(foundationName)}/invites`, {
      headers: this._authHeaders(),
    })
    const body = await res.json()
    if (!res.ok) {
      throw Object.assign(new Error(body.error || `Server error (${res.status})`), { statusCode: res.status })
    }
    return body.invites || []
  }

  /**
   * Revoke a foundation invite.
   * @param {string} foundationName
   * @param {string} inviteId
   * @returns {Promise<Object>}
   */
  async revokeInvite(foundationName, inviteId) {
    const res = await fetch(`${this.apiUrl}/api/foundations/${encodeURIComponent(foundationName)}/invites/${inviteId}`, {
      method: 'DELETE',
      headers: this._authHeaders(),
    })
    const body = await res.json()
    if (!res.ok) {
      throw Object.assign(new Error(body.error || `Server error (${res.status})`), { statusCode: res.status })
    }
    return body
  }

  /**
   * Resend a foundation invite.
   * @param {string} foundationName
   * @param {string} inviteId
   * @returns {Promise<Object>}
   */
  async resendInvite(foundationName, inviteId) {
    const res = await fetch(`${this.apiUrl}/api/foundations/${encodeURIComponent(foundationName)}/invites/${inviteId}/resend`, {
      method: 'POST',
      headers: this._authHeaders(),
    })
    const body = await res.json()
    if (!res.ok) {
      throw Object.assign(new Error(body.error || `Server error (${res.status})`), { statusCode: res.status })
    }
    return body
  }

  /**
   * Create a site record on Unicloud.
   * @param {string} siteId
   * @param {Object} options
   * @param {Object} options.foundation - { name }
   * @returns {Promise<Object>}
   */
  async createSite(siteId, { foundation }) {
    const res = await fetch(`${this.apiUrl}/api/sites`, {
      method: 'POST',
      headers: this._authHeaders(),
      body: JSON.stringify({ siteId, foundation }),
    })
    const body = await res.json()
    if (!res.ok) {
      throw Object.assign(new Error(body.error || `Server error (${res.status})`), { statusCode: res.status })
    }
    return body
  }

  /**
   * Transfer site ownership.
   * @param {string} siteId
   * @param {string} newOwner - Email of the new owner
   * @returns {Promise<Object>}
   */
  async transferSiteOwnership(siteId, newOwner) {
    const res = await fetch(`${this.apiUrl}/api/sites/${siteId}/owner`, {
      method: 'PATCH',
      headers: this._authHeaders(),
      body: JSON.stringify({ newOwner }),
    })
    const body = await res.json()
    if (!res.ok) {
      throw Object.assign(new Error(body.error || `Server error (${res.status})`), { statusCode: res.status })
    }
    return body
  }
}
