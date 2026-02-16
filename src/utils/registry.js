/**
 * Local Foundation Registry
 *
 * Manages published foundations in .unicloud/registry/.
 * Same on-disk format as scripts/platform/registry.js, so
 * scripts/platform/serve.js can still serve them.
 *
 * Layout:
 *   .unicloud/
 *     registry/
 *       index.json                  # { "name": { versions: { "1.0.0": { ... } } } }
 *       packages/
 *         name/
 *           1.0.0/
 *             foundation.js
 *             schema.json
 *             assets/...
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
 * '@org/pkg' → '@org__pkg'
 * @param {string} name
 * @returns {string}
 */
function sanitizeName(name) {
  return name.replace(/\//g, '__')
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
    return JSON.parse(await readFile(this.indexPath, 'utf8'))
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
    return !!index[name]?.versions?.[version]
  }

  /**
   * Get all published versions for a package.
   * @param {string} name
   * @returns {Promise<Object>}
   */
  async getVersions(name) {
    const index = await this._readIndex()
    return index[name]?.versions || {}
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
      index[name] = { versions: {} }
    }
    index[name].versions[version] = {
      publishedAt: new Date().toISOString(),
      ...metadata,
    }
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
      return !!index[name]?.versions?.[version]
    } catch {
      return false
    }
  }

  /**
   * Get all published versions for a package.
   * @param {string} name
   * @returns {Promise<Object>}
   */
  async getVersions(name) {
    const index = await this._fetchIndex()
    return index[name]?.versions || {}
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
    const res = await fetch(`${this.apiUrl}/api/foundations/${foundationName}/invites`, {
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
    const res = await fetch(`${this.apiUrl}/api/foundations/${foundationName}/invites`, {
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
    const res = await fetch(`${this.apiUrl}/api/foundations/${foundationName}/invites/${inviteId}`, {
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
    const res = await fetch(`${this.apiUrl}/api/foundations/${foundationName}/invites/${inviteId}/resend`, {
      method: 'POST',
      headers: this._authHeaders(),
    })
    const body = await res.json()
    if (!res.ok) {
      throw Object.assign(new Error(body.error || `Server error (${res.status})`), { statusCode: res.status })
    }
    return body
  }
}
