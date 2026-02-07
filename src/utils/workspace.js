/**
 * Workspace Detection Utilities
 *
 * Detects workspace structure (pnpm-workspace.yaml or package.json workspaces)
 * and classifies packages as foundations or sites.
 * Used by commands to auto-detect targets when run from workspace root.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import yaml from 'js-yaml'

/**
 * Check if a directory is a workspace root.
 * Recognizes pnpm-workspace.yaml or package.json with workspaces field.
 * @param {string} dir - Directory to check
 * @returns {boolean}
 */
function hasWorkspaceConfig(dir) {
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return true
  const pkgPath = join(dir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      if (Array.isArray(pkg.workspaces)) return true
    } catch {
      // ignore
    }
  }
  return false
}

/**
 * Find workspace root by looking for pnpm-workspace.yaml or package.json workspaces
 * @param {string} startDir - Directory to start searching from
 * @returns {string|null} - Workspace root path or null
 */
export function findWorkspaceRoot(startDir = process.cwd()) {
  let dir = startDir
  while (dir !== dirname(dir)) {
    if (hasWorkspaceConfig(dir)) {
      return dir
    }
    dir = dirname(dir)
  }
  return null
}

/**
 * Resolve workspace package patterns to actual directories
 * Handles patterns like: "foundation", "site", "foundations/*", "sites/*"
 *
 * @param {string[]} patterns - Array of patterns from pnpm-workspace.yaml
 * @param {string} workspaceRoot - Workspace root directory
 * @returns {string[]} - Array of existing package directories (relative paths)
 */
function resolvePatterns(patterns, workspaceRoot) {
  const packages = []

  for (const pattern of patterns) {
    // Remove quotes if present
    const cleanPattern = pattern.replace(/^["']|["']$/g, '')

    if (cleanPattern.endsWith('/*')) {
      // Glob pattern like "foundations/*" - list subdirectories
      const baseDir = cleanPattern.slice(0, -2)
      const fullPath = join(workspaceRoot, baseDir)

      if (existsSync(fullPath)) {
        try {
          const entries = readdirSync(fullPath, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              packages.push(join(baseDir, entry.name))
            }
          }
        } catch {
          // Ignore read errors
        }
      }
    } else {
      // Direct path like "foundation" or "site"
      const fullPath = join(workspaceRoot, cleanPattern)
      if (existsSync(fullPath)) {
        packages.push(cleanPattern)
      }
    }
  }

  return packages
}

/**
 * Get workspace packages from pnpm-workspace.yaml or package.json workspaces
 * @param {string} workspaceRoot
 * @returns {Promise<string[]>} - Array of package directories (relative paths)
 */
export async function getWorkspacePackages(workspaceRoot) {
  // Try pnpm-workspace.yaml first
  const configPath = join(workspaceRoot, 'pnpm-workspace.yaml')
  if (existsSync(configPath)) {
    const content = await readFile(configPath, 'utf-8')
    const config = yaml.load(content)
    if (config?.packages && Array.isArray(config.packages)) {
      return resolvePatterns(config.packages, workspaceRoot)
    }
  }

  // Fall back to package.json workspaces
  const pkgPath = join(workspaceRoot, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
      if (Array.isArray(pkg.workspaces)) {
        return resolvePatterns(pkg.workspaces, workspaceRoot)
      }
    } catch {
      // ignore
    }
  }

  return []
}

/**
 * Classify a package as foundation, site, or unknown
 *
 * Classification logic:
 * - Site: has @uniweb/runtime in dependencies (checked first, more specific)
 * - Foundation: has @uniweb/build in devDependencies but NOT @uniweb/runtime
 *
 * Note: Sites also have @uniweb/build for the Vite plugin, so we check
 * for @uniweb/runtime first to distinguish them.
 *
 * @param {string} packagePath - Full path to package directory
 * @returns {Promise<'foundation'|'site'|null>}
 */
export async function classifyPackage(packagePath) {
  const pkgJsonPath = join(packagePath, 'package.json')
  if (!existsSync(pkgJsonPath)) return null

  try {
    const pkg = JSON.parse(await readFile(pkgJsonPath, 'utf-8'))

    // Site: has @uniweb/runtime in dependencies (check first - more specific)
    if (pkg.dependencies?.['@uniweb/runtime']) {
      return 'site'
    }
    // Foundation: has @uniweb/build in devDependencies (and not a site)
    if (pkg.devDependencies?.['@uniweb/build']) {
      return 'foundation'
    }
  } catch {
    // Ignore parse errors
  }

  return null
}

/**
 * Find all foundations in workspace
 * @param {string} workspaceRoot
 * @returns {Promise<string[]>} - Array of foundation paths (relative to workspace root)
 */
export async function findFoundations(workspaceRoot) {
  const packages = await getWorkspacePackages(workspaceRoot)
  const foundations = []

  for (const pkg of packages) {
    const fullPath = join(workspaceRoot, pkg)
    if ((await classifyPackage(fullPath)) === 'foundation') {
      foundations.push(pkg)
    }
  }

  return foundations
}

/**
 * Find all sites in workspace
 * @param {string} workspaceRoot
 * @returns {Promise<string[]>} - Array of site paths (relative to workspace root)
 */
export async function findSites(workspaceRoot) {
  const packages = await getWorkspacePackages(workspaceRoot)
  const sites = []

  for (const pkg of packages) {
    const fullPath = join(workspaceRoot, pkg)
    if ((await classifyPackage(fullPath)) === 'site') {
      sites.push(pkg)
    }
  }

  return sites
}

/**
 * Check if current directory is the workspace root
 * @param {string} dir - Directory to check
 * @returns {boolean}
 */
export function isWorkspaceRoot(dir = process.cwd()) {
  return hasWorkspaceConfig(dir)
}

/**
 * Interactive prompt to select from multiple options
 * @param {string} message - Prompt message
 * @param {string[]} choices - Array of choices
 * @returns {Promise<string|null>} - Selected choice or null if cancelled
 */
export async function promptSelect(message, choices) {
  const prompts = (await import('prompts')).default

  const response = await prompts({
    type: 'select',
    name: 'value',
    message,
    choices: choices.map(c => ({ title: c, value: c })),
  })

  return response.value || null
}
