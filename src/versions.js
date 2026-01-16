/**
 * Version resolution utility
 *
 * Reads package versions from the CLI's own dependencies to ensure
 * generated projects use compatible versions.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Cache for resolved versions
let resolvedVersions = null

/**
 * Get the CLI's own package.json
 */
function getCliPackageJson() {
  const packagePath = join(__dirname, '..', 'package.json')
  return JSON.parse(readFileSync(packagePath, 'utf8'))
}

/**
 * Extract version number from version spec (e.g., "^0.1.4" -> "0.1.4")
 */
function extractVersion(spec) {
  if (!spec) return null
  // Remove ^, ~, >=, etc. prefixes
  return spec.replace(/^[\^~>=<]+/, '')
}

/**
 * Resolve a version spec to an npm-compatible version
 * Handles workspace:* and other pnpm-specific protocols
 *
 * @param {string} spec - Version spec (e.g., "workspace:*", "^0.1.0")
 * @param {string} fallback - Fallback version if spec is not resolvable
 * @returns {string} npm-compatible version spec
 */
function resolveVersionSpec(spec, fallback) {
  if (!spec) return fallback
  // workspace:* is pnpm-specific, use fallback for npm compatibility
  if (spec.startsWith('workspace:')) return fallback
  return spec
}

/**
 * Get resolved versions for @uniweb/* packages
 *
 * Returns versions that should be used in generated projects,
 * based on the CLI's own dependencies.
 *
 * Note: In development (pnpm workspace), versions may be "workspace:*"
 * which we convert to npm-compatible fallback versions.
 *
 * @returns {Object} Map of package names to version specs
 */
export function getResolvedVersions() {
  if (resolvedVersions) return resolvedVersions

  const pkg = getCliPackageJson()
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }

  resolvedVersions = {
    // Direct CLI dependencies - use fallbacks for workspace:* versions
    '@uniweb/build': resolveVersionSpec(deps['@uniweb/build'], '^0.1.4'),
    '@uniweb/templates': resolveVersionSpec(deps['@uniweb/templates'], '^0.1.6'),

    // These come from @uniweb/build's dependencies, use compatible versions
    '@uniweb/runtime': '^0.1.0',
    '@uniweb/core': '^0.1.0',

    // CLI itself (use current version)
    'uniweb': `^${pkg.version}`,
  }

  return resolvedVersions
}

/**
 * Get a specific package version
 *
 * @param {string} packageName - Package name (e.g., "@uniweb/build")
 * @returns {string} Version spec (e.g., "^0.1.4")
 */
export function getVersion(packageName) {
  const versions = getResolvedVersions()
  return versions[packageName] || null
}

/**
 * Get all versions as a flat object for template data
 *
 * @returns {Object} Versions keyed by simplified names
 */
export function getVersionsForTemplates() {
  const versions = getResolvedVersions()

  return {
    // Full package names
    ...versions,

    // Simplified names for templates (e.g., {{versions.build}})
    build: versions['@uniweb/build'],
    runtime: versions['@uniweb/runtime'],
    core: versions['@uniweb/core'],
    templates: versions['@uniweb/templates'],
    cli: versions['uniweb'],
  }
}

/**
 * Update @uniweb/* versions in a package.json object
 *
 * @param {Object} pkg - Package.json object
 * @returns {Object} Updated package.json object
 */
export function updatePackageVersions(pkg) {
  const versions = getResolvedVersions()

  const updateDeps = (deps) => {
    if (!deps) return deps
    const updated = { ...deps }
    for (const [name, version] of Object.entries(updated)) {
      if (name.startsWith('@uniweb/') || name === 'uniweb') {
        if (versions[name]) {
          updated[name] = versions[name]
        }
      }
    }
    return updated
  }

  return {
    ...pkg,
    dependencies: updateDeps(pkg.dependencies),
    devDependencies: updateDeps(pkg.devDependencies),
    peerDependencies: updateDeps(pkg.peerDependencies),
  }
}
