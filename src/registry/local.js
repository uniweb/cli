/**
 * LocalRegistry — stores published foundations in .unicloud/registry/
 *
 * Layout:
 *   .unicloud/registry/
 *     index.json                          # { "effects": { versions: { "0.1.0": { ... } } } }
 *     packages/
 *       effects/
 *         0.1.0/
 *           foundation.js
 *           schema.json
 *           assets/...
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { getRegistryDir, sanitizeName } from './paths.js'

export class LocalRegistry {
  constructor(startDir) {
    this.registryDir = getRegistryDir(startDir)
    this.indexPath = join(this.registryDir, 'index.json')
    this.packagesDir = join(this.registryDir, 'packages')
  }

  /**
   * Read the registry index, or return empty object if none exists.
   */
  async _readIndex() {
    if (!existsSync(this.indexPath)) return {}
    return JSON.parse(await readFile(this.indexPath, 'utf8'))
  }

  /**
   * Write the registry index.
   */
  async _writeIndex(index) {
    await mkdir(this.registryDir, { recursive: true })
    await writeFile(this.indexPath, JSON.stringify(index, null, 2))
  }

  /**
   * Check if a specific name@version exists.
   */
  async exists(name, version) {
    const index = await this._readIndex()
    return !!index[name]?.versions?.[version]
  }

  /**
   * Get all versions for a package name.
   */
  async getVersions(name) {
    const index = await this._readIndex()
    return index[name]?.versions || {}
  }

  /**
   * Publish a foundation dist/ to the registry.
   *
   * @param {string} name - Package name (from schema.json _self.name)
   * @param {string} version - Version string
   * @param {string} distDir - Absolute path to the foundation's dist/ directory
   * @param {object} metadata - Extra metadata to store in the index
   */
  async publish(name, version, distDir, metadata = {}) {
    const safeName = sanitizeName(name)
    const destDir = join(this.packagesDir, safeName, version)

    // Copy dist/ contents to registry
    await mkdir(destDir, { recursive: true })
    await cp(distDir, destDir, { recursive: true })

    // Update index
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
   * Get the filesystem path to a stored package version.
   */
  getPackagePath(name, version) {
    return join(this.packagesDir, sanitizeName(name), version)
  }
}
