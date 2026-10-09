/**
 * Package Name Validation
 *
 * Validates package names for the `add` command — rejects reserved names
 * and detects collisions with existing workspace packages.
 */

import { discoverFoundations, discoverSites } from './discover.js'

/**
 * Names that must not be used as package names.
 * - JS module keywords: default, undefined, null, true, false
 * - Node/filesystem: node_modules, package
 * - Common build-output directories: dist, build (would shadow `dist/` /
 *   `build/` references)
 *
 * Note: `src` is NOT reserved. A foundation in `src/` whose package name is
 * also `src` is the default scaffold pattern — folder name and package name
 * match. Multi-foundation co-located workspaces still use suffixes
 * (`<project>-src`) because pnpm requires workspace-unique package names;
 * that's a real constraint, not aesthetic.
 */
const RESERVED_NAMES = new Set([
  'default',
  'undefined',
  'null',
  'true',
  'false',
  'node_modules',
  'package',
  'dist',
  'build'
])

/**
 * Validate a package name.
 * @param {string} name
 * @param {Set<string>} [existingNames] - Names already in the workspace
 * @returns {string|true} true if valid, or an error message string
 */
export function validatePackageName(name, existingNames) {
  if (!name) return 'Name is required'
  if (!/^[a-z0-9-]+$/.test(name))
    return 'Use lowercase letters, numbers, and hyphens'
  if (RESERVED_NAMES.has(name))
    return `"${name}" is a reserved name — choose a different one`
  if (existingNames?.has(name))
    return `"${name}" already exists in this workspace`
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

  // An extension is a foundation that declares `extension: true`, so the
  // discovery above already has it, wherever its folder is. (A second scan of
  // `extensions/*` stood here until 2026-10-08, when extensions stopped being
  // placed there by default.)
  for (const f of foundations) names.add(f.name)
  for (const s of sites) names.add(s.name)

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
