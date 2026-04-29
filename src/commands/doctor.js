/**
 * uniweb doctor - Diagnose project configuration issues
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve, basename, dirname, relative } from 'node:path'
import yaml from 'js-yaml'
import { resolveFoundationSrcPath, classifyPackage, isExtensionPackage as buildIsExtensionPackage } from '@uniweb/build'
import { getCliVersion } from '../versions.js'
import { readAgentsVersion } from '../utils/agents-stamp.js'
import { discoverFoundations, discoverSites } from '../utils/config.js'
import { findWorkspaceRoot } from '../utils/workspace.js'

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m'
}

const success = (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`)
const warn = (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`)
const error = (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`)
const info = (msg) => console.log(`${colors.blue}→${colors.reset} ${msg}`)
const log = console.log

/**
 * Check if a directory is a site
 */
function isSite(dir) {
  // Use the canonical classifier; also accept legacy `site.yaml`
  // (the classifier only recognizes `.yml` and `.document.yml`).
  return classifyPackage(dir) === 'site' || existsSync(join(dir, 'site.yaml'))
}

/**
 * Check if a directory is a foundation
 */
function isFoundation(dir) {
  return classifyPackage(dir) === 'foundation'
}

/**
 * Load the foundation's authored declarations file (main.js or legacy
 * foundation.js) and return a minimal summary used by the doctor.
 * Returns null if no declarations file is found.
 */
function loadFoundationJs(dir) {
  const srcDir = resolveFoundationSrcPath(dir)
  for (const name of ['main.js', 'foundation.js']) {
    const filePath = join(srcDir, name)
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf8')
        return { extension: /extension\s*:\s*true/.test(content) }
      } catch {
        return null
      }
    }
  }
  return null
}

/**
 * Load built schema.json from a directory
 */
function loadSchemaJson(dir) {
  const schemaPath = join(dir, 'dist', 'schema.json')
  if (!existsSync(schemaPath)) return null
  try {
    return JSON.parse(readFileSync(schemaPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Check if a foundation is an extension (via schema.json or foundation.js)
 */
function isExtensionPackage(dir) {
  return buildIsExtensionPackage(dir)
}

/**
 * Load package.json from a directory
 */
function loadPackageJson(dir) {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Load site.yml from a directory
 */
function loadSiteYml(dir) {
  const ymlPath = join(dir, 'site.yml')
  const yamlPath = join(dir, 'site.yaml')
  const configPath = existsSync(ymlPath) ? ymlPath : existsSync(yamlPath) ? yamlPath : null
  if (!configPath) return null
  try {
    return yaml.load(readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Main doctor command
 */
export async function doctor(args = []) {
  log('')
  log(`${colors.blue}${colors.bright}Uniweb Doctor${colors.reset}`)
  log(`${colors.dim}Checking project configuration...${colors.reset}`)

  const projectDir = resolve(process.cwd())

  // Find workspace root via the canonical primitive (recognizes
  // pnpm-workspace.yaml or package.json::workspaces).
  const workspaceDir = findWorkspaceRoot(projectDir)

  if (!workspaceDir) {
    error('Not in a Uniweb workspace')
    log(`${colors.dim}Run this command from your project root or a site/foundation directory.${colors.reset}`)
    process.exit(1)
  }

  log('')
  info(`Workspace: ${workspaceDir}`)

  // Workspace manifest sync — keep `pnpm-workspace.yaml::packages` and
  // `package.json::workspaces` aligned. The CLI writes both on every
  // mutation (see addWorkspaceGlob in utils/config.js), but a user who
  // manually edits one can introduce drift. Drift breaks projects that
  // switch package managers (pnpm-workspace.yaml is pnpm-only;
  // package.json::workspaces is what npm and yarn read).
  const issues = []
  const ymlPath = join(workspaceDir, 'pnpm-workspace.yaml')
  if (existsSync(ymlPath)) {
    let ymlPackages = []
    try {
      ymlPackages = yaml.load(readFileSync(ymlPath, 'utf8'))?.packages || []
    } catch {
      // Malformed yaml — flag separately
      issues.push({
        id: 'workspace-yaml-malformed',
        type: 'error',
        message: 'pnpm-workspace.yaml is malformed and could not be parsed.',
      })
      error('pnpm-workspace.yaml is malformed and could not be parsed.')
    }
    const rootPkg = loadPackageJson(workspaceDir)
    const pkgWorkspaces = Array.isArray(rootPkg?.workspaces) ? rootPkg.workspaces : []
    const ymlSet = new Set(ymlPackages)
    const pkgSet = new Set(pkgWorkspaces)
    const onlyInYml = [...ymlSet].filter(g => !pkgSet.has(g))
    const onlyInPkg = [...pkgSet].filter(g => !ymlSet.has(g))
    if (onlyInYml.length || onlyInPkg.length) {
      issues.push({
        id: 'workspace-manifests-out-of-sync',
        type: 'warn',
        message: `pnpm-workspace.yaml and package.json::workspaces declare different package globs.`,
        details: { onlyInYml, onlyInPkg },
      })
      warn(`[workspace-manifests-out-of-sync] pnpm-workspace.yaml and package.json::workspaces are out of sync:`)
      if (onlyInYml.length) log(`    only in pnpm-workspace.yaml:        ${onlyInYml.join(', ')}`)
      if (onlyInPkg.length) log(`    only in package.json::workspaces:    ${onlyInPkg.join(', ')}`)
      log(`  ${colors.dim}Pick one set of globs and copy it to the other manifest. The two should always match — pnpm reads pnpm-workspace.yaml, npm/yarn read package.json::workspaces.${colors.reset}`)
    }
  }

  // Discover foundations + sites via the canonical workspace globs.
  // Doctor used to walk fixed paths (`foundation/`, `foundations/*`) which
  // missed the default-path `src/` shape that Thread D made canonical.
  // Using the same primitives every other command uses keeps doctor in
  // step with whatever layout the workspace has.
  const discovered = await discoverFoundations(workspaceDir)
  const foundations = []
  const extensions = []
  for (const f of discovered) {
    const fullPath = join(workspaceDir, f.path)
    const folderName = basename(f.path)
    const entry = { path: fullPath, name: f.name, folderName }
    if (buildIsExtensionPackage(fullPath)) {
      extensions.push(entry)
    } else {
      foundations.push(entry)
    }
  }

  if (foundations.length === 0) {
    warn('No foundations found')
  } else {
    success(`Found ${foundations.length} foundation(s):`)
    for (const f of foundations) {
      const nameMismatch = f.name !== f.folderName ? ` ${colors.dim}(folder: ${f.folderName}/)${colors.reset}` : ''
      log(`    • ${f.name}${nameMismatch}`)
    }
  }

  if (extensions.length > 0) {
    log('')
    success(`Found ${extensions.length} extension(s):`)
    for (const e of extensions) {
      const nameMismatch = e.name !== e.folderName ? ` ${colors.dim}(folder: ${e.folderName}/)${colors.reset}` : ''
      log(`    • ${e.name}${nameMismatch}`)
    }
  }

  // Discover sites via the canonical workspace globs (same rationale as
  // foundations above: respects whatever layout the user chose).
  const sites = (await discoverSites(workspaceDir)).map(s => ({
    path: join(workspaceDir, s.path),
    name: s.name,
  }))

  if (sites.length === 0) {
    warn('No sites found')
  } else {
    log('')
    success(`Found ${sites.length} site(s):`)
    for (const s of sites) {
      log(`    • ${s.name}`)
    }
  }

  // Check each site (issues array was declared earlier alongside the
  // workspace-manifest-sync check).
  for (const site of sites) {
    const siteName = site.name
    const sitePath = site.path
    const siteYml = loadSiteYml(sitePath)
    const sitePkg = loadPackageJson(sitePath)

    log('')
    info(`Checking site: ${siteName}`)

    if (!siteYml) {
      issues.push({ type: 'error', site: siteName, message: 'Missing site.yml' })
      error('Missing site.yml')
      continue
    }

    if (!sitePkg) {
      issues.push({ type: 'error', site: siteName, message: 'Missing package.json' })
      error('Missing package.json')
      continue
    }

    const foundationName = siteYml.foundation
    if (!foundationName) {
      warn('No foundation specified in site.yml (using runtime loading?)')
      continue
    }

    // Check if foundation name matches a known foundation
    const matchingFoundation = foundations.find(f => f.name === foundationName)

    if (!matchingFoundation) {
      // Check if it might match a folder name instead
      const folderMatch = foundations.find(f => f.folderName === foundationName)
      if (folderMatch) {
        issues.push({
          type: 'error',
          site: siteName,
          message: `Foundation mismatch: site.yml uses folder name "${foundationName}" instead of package name "${folderMatch.name}"`
        })
        error(`Foundation mismatch:`)
        log(`    site.yml says: ${colors.yellow}foundation: ${foundationName}${colors.reset}`)
        log(`    This matches the folder name, but the package name is: ${colors.green}${folderMatch.name}${colors.reset}`)
        log('')
        log(`  ${colors.dim}To fix, update site.yml:${colors.reset}`)
        log(`    foundation: ${folderMatch.name}`)
        continue
      }

      issues.push({
        type: 'error',
        site: siteName,
        message: `Foundation "${foundationName}" not found`
      })
      error(`Foundation "${foundationName}" not found`)
      log('')
      log(`  ${colors.dim}Available foundations:${colors.reset}`)
      for (const f of foundations) {
        log(`    • ${f.name} (${f.folderName}/)`)
      }
      continue
    }

    success(`Foundation reference: ${foundationName}`)

    // Check package.json dependency
    const deps = { ...sitePkg.dependencies, ...sitePkg.devDependencies }
    const depValue = deps[foundationName]

    if (!depValue) {
      issues.push({
        type: 'error',
        site: siteName,
        message: `Missing dependency "${foundationName}" in package.json`
      })
      error(`Missing dependency "${foundationName}" in package.json`)
      log('')
      log(`  ${colors.dim}Add to site's package.json dependencies:${colors.reset}`)
      log(`    "${foundationName}": "file:${relative(sitePath, matchingFoundation.path)}"`)
      continue
    }

    if (depValue.startsWith('file:')) {
      const depPath = join(sitePath, depValue.slice(5))
      if (!existsSync(depPath)) {
        issues.push({
          type: 'error',
          site: siteName,
          message: `Dependency path doesn't exist: ${depValue}`
        })
        error(`Dependency path doesn't exist: ${depValue}`)
        log('')
        log(`  ${colors.dim}Update site's package.json:${colors.reset}`)
        log(`    "${foundationName}": "file:${relative(sitePath, matchingFoundation.path)}"`)
        continue
      }
      success(`Dependency path: ${depValue}`)
    } else {
      success(`Dependency: ${depValue} (npm package)`)
    }

    // Check if foundation is built
    const foundationDist = join(matchingFoundation.path, 'dist', 'foundation.js')
    if (!existsSync(foundationDist)) {
      issues.push({
        type: 'warn',
        site: siteName,
        message: `Foundation not built: ${matchingFoundation.name}`
      })
      warn(`Foundation not built yet`)
      log(`  ${colors.dim}Run: uniweb build${colors.reset}`)
    } else {
      success(`Foundation built: dist/foundation.js exists`)
    }
  }

  // Check extensions
  for (const ext of extensions) {
    log('')
    info(`Checking extension: ${ext.name}`)

    // Check if it declares extension: true
    if (!isExtensionPackage(ext.path)) {
      issues.push({
        type: 'warn',
        message: `Extension "${ext.name}" in extensions/ doesn't declare extension: true in foundation.js`
      })
      warn(`Missing extension identity`)
      log(`  ${colors.dim}Add to src/foundation.js:${colors.reset}`)
      log(`    export default { extension: true }`)
    } else {
      success(`Extension identity: extension: true`)
    }

    // Check for vars or layouts
    const config = loadFoundationJs(ext.path)
    const schema = loadSchemaJson(ext.path)

    if (schema?._self?.vars && Object.keys(schema._self.vars).length > 0) {
      issues.push({
        type: 'warn',
        message: `Extension "${ext.name}" declares theme variables (vars). Extensions don't define theme variables.`
      })
      warn(`Extension declares vars — these won't take effect`)
    }

    if (schema?._layouts && Object.keys(schema._layouts).length > 0) {
      issues.push({
        type: 'warn',
        message: `Extension "${ext.name}" provides layouts. Extensions don't provide layouts.`
      })
      warn(`Extension provides layouts — these won't take effect`)
    }

    // Check if built
    const extensionDist = join(ext.path, 'dist', 'foundation.js')
    if (!existsSync(extensionDist)) {
      issues.push({
        type: 'warn',
        message: `Extension not built: ${ext.name}`
      })
      warn(`Extension not built yet`)
      log(`  ${colors.dim}Run: uniweb build${colors.reset}`)
    } else {
      success(`Extension built: dist/foundation.js exists`)
    }
  }

  // Check if any foundation with extension: true is wired as a primary foundation
  for (const f of foundations) {
    if (isExtensionPackage(f.path)) {
      const sitesUsingAsPrimary = sites.filter(s => {
        const siteYml = loadSiteYml(s.path)
        return siteYml?.foundation === f.name
      })
      for (const site of sitesUsingAsPrimary) {
        issues.push({
          type: 'warn',
          site: site.name,
          message: `Foundation "${f.name}" declares extension: true but is wired as the primary foundation. It should be in extensions: instead.`
        })
        warn(`"${f.name}" is an extension but used as primary foundation in site "${site.name}"`)
        log(`  ${colors.dim}Move it to extensions: in site.yml instead of foundation:${colors.reset}`)
      }
    }
  }

  // Validate extension URLs in site.yml
  for (const site of sites) {
    const siteYml = loadSiteYml(site.path)
    if (!siteYml?.extensions || !Array.isArray(siteYml.extensions)) continue

    for (const extUrl of siteYml.extensions) {
      if (typeof extUrl !== 'string') continue

      // Skip remote URLs — can't validate those
      if (extUrl.startsWith('http://') || extUrl.startsWith('https://')) continue

      // Local extension URL: check if it maps to a known extension
      // URLs like /effects/foundation.js or /extensions/effects/foundation.js
      const urlParts = extUrl.replace(/^\//, '').split('/')
      const extName = urlParts.length >= 2 ? urlParts[urlParts.length - 2] : urlParts[0]

      // Check if a matching extension exists and is built
      const matchingExt = extensions.find(e => e.folderName === extName || e.name === extName)
      if (matchingExt && !existsSync(join(matchingExt.path, 'dist', 'foundation.js'))) {
        issues.push({
          type: 'warn',
          site: site.name,
          message: `Extension "${extName}" referenced in site.yml is not built`
        })
      }
    }
  }

  // Check AGENTS.md freshness
  log('')
  const agentsPath = join(workspaceDir, 'AGENTS.md')
  const agentsVersion = readAgentsVersion(agentsPath)
  const cliVersion = getCliVersion()

  if (!existsSync(agentsPath)) {
    warn('AGENTS.md not found')
    info(`Run: uniweb update`)
    issues.push({ type: 'warn', message: 'AGENTS.md not found' })
  } else if (!agentsVersion) {
    // No stamp — manually created or pre-stamp version
    warn('AGENTS.md has no version stamp (may be outdated)')
    info(`Run: uniweb update`)
    issues.push({ type: 'warn', message: 'AGENTS.md has no version stamp' })
  } else if (agentsVersion !== cliVersion) {
    warn(`AGENTS.md is outdated (v${agentsVersion} → v${cliVersion})`)
    info(`Run: uniweb update`)
    issues.push({ type: 'warn', message: `AGENTS.md outdated (v${agentsVersion} → v${cliVersion})` })
  } else {
    success(`AGENTS.md is up to date (v${cliVersion})`)
  }

  // Summary
  log('')
  log('─'.repeat(50))

  const errors = issues.filter(i => i.type === 'error')
  const warnings = issues.filter(i => i.type === 'warn')

  if (errors.length === 0 && warnings.length === 0) {
    log('')
    log(`${colors.green}${colors.bright}All checks passed!${colors.reset}`)
    log('')
  } else {
    log('')
    if (errors.length > 0) {
      log(`${colors.red}${errors.length} error(s)${colors.reset}`)
    }
    if (warnings.length > 0) {
      log(`${colors.yellow}${warnings.length} warning(s)${colors.reset}`)
    }
    log('')
  }

  return { issues, errors: errors.length, warnings: warnings.length }
}
