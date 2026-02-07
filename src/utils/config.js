/**
 * Workspace Config Management
 *
 * Read/write pnpm-workspace.yaml and root package.json.
 * Used by both `create` and `add` commands.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'

/**
 * Read pnpm-workspace.yaml
 * @param {string} rootDir - Workspace root directory
 * @returns {Promise<{packages: string[]}>}
 */
export async function readWorkspaceConfig(rootDir) {
  const configPath = join(rootDir, 'pnpm-workspace.yaml')
  if (!existsSync(configPath)) {
    return { packages: [] }
  }
  const content = await readFile(configPath, 'utf-8')
  const config = yaml.load(content)
  return { packages: config?.packages || [] }
}

/**
 * Write pnpm-workspace.yaml
 * @param {string} rootDir - Workspace root directory
 * @param {{packages: string[]}} config
 */
export async function writeWorkspaceConfig(rootDir, config) {
  const configPath = join(rootDir, 'pnpm-workspace.yaml')
  const content = yaml.dump(config, { flowLevel: -1, quotingType: '"' })
  await writeFile(configPath, content)
}

/**
 * Add a glob pattern to pnpm-workspace.yaml if not already present
 * @param {string} rootDir - Workspace root directory
 * @param {string} glob - Glob pattern to add
 */
export async function addWorkspaceGlob(rootDir, glob) {
  const config = await readWorkspaceConfig(rootDir)
  if (!config.packages.includes(glob)) {
    config.packages.push(glob)
    await writeWorkspaceConfig(rootDir, config)
  }
}

/**
 * Read root package.json
 * @param {string} rootDir - Workspace root directory
 * @returns {Promise<Object>}
 */
export async function readRootPackageJson(rootDir) {
  const pkgPath = join(rootDir, 'package.json')
  if (!existsSync(pkgPath)) {
    return {}
  }
  return JSON.parse(await readFile(pkgPath, 'utf-8'))
}

/**
 * Write root package.json (2-space indent)
 * @param {string} rootDir - Workspace root directory
 * @param {Object} pkg - Package.json object
 */
export async function writeRootPackageJson(rootDir, pkg) {
  const pkgPath = join(rootDir, 'package.json')
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

/**
 * Compute root scripts based on discovered sites
 * @param {Array<{name: string, path: string}>} sites - Discovered sites
 * @returns {Object} Scripts object for package.json
 */
export function computeRootScripts(sites) {
  const scripts = {
    build: 'uniweb build',
  }

  if (sites.length === 0) {
    return scripts
  }

  if (sites.length === 1) {
    scripts.dev = `pnpm --filter ${sites[0].name} dev`
    scripts.preview = `pnpm --filter ${sites[0].name} preview`
  } else {
    // First site gets unqualified dev/preview
    scripts.dev = `pnpm --filter ${sites[0].name} dev`
    scripts.preview = `pnpm --filter ${sites[0].name} preview`

    // Subsequent sites get qualified dev:{name}/preview:{name}
    for (let i = 1; i < sites.length; i++) {
      scripts[`dev:${sites[i].name}`] = `pnpm --filter ${sites[i].name} dev`
      scripts[`preview:${sites[i].name}`] = `pnpm --filter ${sites[i].name} preview`
    }
  }

  return scripts
}

/**
 * Update root scripts after adding a new site
 * @param {string} rootDir - Workspace root directory
 * @param {Array<{name: string, path: string}>} sites - All sites (including new one)
 */
export async function updateRootScripts(rootDir, sites) {
  const pkg = await readRootPackageJson(rootDir)
  const newScripts = computeRootScripts(sites)

  // If we're adding a second site, rename existing dev/preview to dev:{firstName}
  if (sites.length === 2 && pkg.scripts?.dev) {
    const firstName = sites[0].name
    // Only rename if the existing dev matches the first site
    if (pkg.scripts.dev === `pnpm --filter ${firstName} dev`) {
      pkg.scripts[`dev:${firstName}`] = pkg.scripts.dev
      pkg.scripts[`preview:${firstName}`] = pkg.scripts.preview
    }
  }

  pkg.scripts = { ...pkg.scripts, ...newScripts }
  await writeRootPackageJson(rootDir, pkg)
}

/**
 * Discover foundations in the workspace
 * @param {string} rootDir - Workspace root directory
 * @returns {Promise<Array<{name: string, path: string}>>}
 */
export async function discoverFoundations(rootDir) {
  const { packages } = await readWorkspaceConfig(rootDir)
  const foundations = []

  for (const pattern of packages) {
    const dirs = await resolveGlob(rootDir, pattern)
    for (const dir of dirs) {
      const pkgPath = join(rootDir, dir, 'package.json')
      if (!existsSync(pkgPath)) continue
      try {
        const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
        // Foundation: has @uniweb/build in devDeps but NOT @uniweb/runtime in deps
        if (pkg.devDependencies?.['@uniweb/build'] && !pkg.dependencies?.['@uniweb/runtime']) {
          foundations.push({ name: pkg.name, path: dir })
        }
      } catch {
        // skip
      }
    }
  }

  return foundations
}

/**
 * Discover sites in the workspace
 * @param {string} rootDir - Workspace root directory
 * @returns {Promise<Array<{name: string, path: string}>>}
 */
export async function discoverSites(rootDir) {
  const { packages } = await readWorkspaceConfig(rootDir)
  const sites = []

  for (const pattern of packages) {
    const dirs = await resolveGlob(rootDir, pattern)
    for (const dir of dirs) {
      const pkgPath = join(rootDir, dir, 'package.json')
      if (!existsSync(pkgPath)) continue
      try {
        const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
        // Site: has @uniweb/runtime in deps
        if (pkg.dependencies?.['@uniweb/runtime']) {
          sites.push({ name: pkg.name, path: dir })
        }
      } catch {
        // skip
      }
    }
  }

  return sites
}

// Resolve a workspace glob pattern to actual directories
async function resolveGlob(rootDir, pattern) {
  const clean = pattern.replace(/^["']|["']$/g, '')

  if (clean.endsWith('/*')) {
    // Pattern like "foundations/*" - list subdirectories
    const baseDir = clean.slice(0, -2)
    const fullPath = join(rootDir, baseDir)
    if (!existsSync(fullPath)) return []
    try {
      const { readdirSync } = await import('node:fs')
      const entries = readdirSync(fullPath, { withFileTypes: true })
      return entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => join(baseDir, e.name))
    } catch {
      return []
    }
  }

  if (clean.startsWith('*/')) {
    // Pattern like "*/foundation" - find subdirs with this child
    const suffix = clean.slice(2)
    const { readdirSync } = await import('node:fs')
    try {
      const entries = readdirSync(rootDir, { withFileTypes: true })
      return entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .filter(e => existsSync(join(rootDir, e.name, suffix)))
        .map(e => join(e.name, suffix))
    } catch {
      return []
    }
  }

  // Direct path like "foundation" or "site"
  if (existsSync(join(rootDir, clean))) {
    return [clean]
  }

  return []
}
