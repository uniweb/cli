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
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises'
import { join, dirname } from 'node:path'

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
