/**
 * Package Name Validation
 *
 * Validates package names for the `add` command — rejects reserved names
 * and detects collisions with existing workspace packages.
 */

import { discoverFoundations, discoverSites, readWorkspaceConfig, resolveGlob } from './config.js'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Names that must not be used as package names.
 * - JS module keywords: default, undefined, null, true, false
 * - Node/filesystem: node_modules, package
 * - Common directory names that would cause confusion: src, dist, build
 */
const RESERVED_NAMES = new Set([
  'default', 'undefined', 'null', 'true', 'false',
  'node_modules', 'package',
  'src', 'dist', 'build',
])

/**
 * Validate a package name.
 * @param {string} name
 * @param {Set<string>} [existingNames] - Names already in the workspace
 * @returns {string|true} true if valid, or an error message string
 */
export function validatePackageName(name, existingNames) {
  if (!name) return 'Name is required'
  if (!/^[a-z0-9-]+$/.test(name)) return 'Use lowercase letters, numbers, and hyphens'
  if (RESERVED_NAMES.has(name)) return `"${name}" is a reserved name — choose a different one`
  if (existingNames?.has(name)) return `"${name}" already exists in this workspace`
  return true
}

/**
 * Discover all package names in the workspace (foundations + sites + extensions).
 * @param {string} rootDir - Workspace root directory
 * @returns {Promise<Set<string>>}
 */
export async function getExistingPackageNames(rootDir) {
  const names = new Set()

  // Foundations and sites via existing discovery
  const foundations = await discoverFoundations(rootDir)
  const sites = await discoverSites(rootDir)

  for (const f of foundations) names.add(f.name)
  for (const s of sites) names.add(s.name)

  // Extensions (foundations with @uniweb/runtime absent — already captured above)
  // Also scan extensions/* if it exists
  const extensionsDir = join(rootDir, 'extensions')
  if (existsSync(extensionsDir)) {
    const dirs = await resolveGlob(rootDir, 'extensions/*')
    for (const dir of dirs) {
      const pkgPath = join(rootDir, dir, 'package.json')
      if (!existsSync(pkgPath)) continue
      try {
        const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
        if (pkg.name) names.add(pkg.name)
      } catch {
        // skip
      }
    }
  }

  return names
}

/**
 * Resolve a unique name by appending a suffix if there's a collision.
 * @param {string} name - Proposed name
 * @param {string} suffix - Suffix to append (e.g., '-site', '-foundation')
 * @param {Set<string>} existingNames
 * @returns {string} The resolved unique name
 */
export function resolveUniqueName(name, suffix, existingNames) {
  if (!existingNames.has(name)) return name
  const suffixed = `${name}${suffix}`
  if (!existingNames.has(suffixed)) return suffixed
  // Unlikely: both name and name-suffix taken — append number
  for (let i = 2; i < 100; i++) {
    const numbered = `${name}${suffix}-${i}`
    if (!existingNames.has(numbered)) return numbered
  }
  return suffixed // give up
}
