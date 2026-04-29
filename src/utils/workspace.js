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

// `classifyPackage` from @uniweb/build is loaded lazily — this module
// is statically imported by index.js (for `findWorkspaceRoot`), and a
// top-level @uniweb/build import would crash `npx uniweb@latest create`
// before any command runs (the npx scratch dir has only the CLI's
// declared deps; @uniweb/build comes from a project's node_modules).
let _classifyPackageSync = null
async function getClassifier() {
  if (!_classifyPackageSync) {
    const mod = await import('@uniweb/build')
    _classifyPackageSync = mod.classifyPackage
  }
  return _classifyPackageSync
}

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
 * Classify a package as foundation, site, or unknown.
 *
 * Re-exports the canonical (sync) classifier from @uniweb/build, kept
 * async-shaped here so existing call sites continue to work without an
 * await-removal sweep. New code should import directly from @uniweb/build.
 *
 * @param {string} packagePath - Full path to package directory
 * @returns {Promise<'foundation'|'site'|null>}
 */
export async function classifyPackage(packagePath) {
  const classify = await getClassifier()
  return classify(packagePath)
}

/**
 * Find all foundations in workspace
 * @param {string} workspaceRoot
 * @returns {Promise<string[]>} - Array of foundation paths (relative to workspace root)
 */
export async function findFoundations(workspaceRoot) {
  const [packages, classify] = await Promise.all([
    getWorkspacePackages(workspaceRoot),
    getClassifier(),
  ])
  return packages.filter(pkg => classify(join(workspaceRoot, pkg)) === 'foundation')
}

/**
 * Find all sites in workspace
 * @param {string} workspaceRoot
 * @returns {Promise<string[]>} - Array of site paths (relative to workspace root)
 */
export async function findSites(workspaceRoot) {
  const [packages, classify] = await Promise.all([
    getWorkspacePackages(workspaceRoot),
    getClassifier(),
  ])
  return packages.filter(pkg => classify(join(workspaceRoot, pkg)) === 'site')
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
