/**
 * uniweb doctor - Diagnose project configuration issues
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve, basename, dirname, relative } from 'node:path'
import yaml from 'js-yaml'

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
  return existsSync(join(dir, 'site.yml')) || existsSync(join(dir, 'site.yaml'))
}

/**
 * Check if a directory is a foundation
 */
function isFoundation(dir) {
  return existsSync(join(dir, 'src', 'components'))
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

  // Detect project type and find workspace root
  let workspaceDir = projectDir

  if (isSite(projectDir)) {
    workspaceDir = dirname(projectDir)
    if (basename(workspaceDir) === 'sites') {
      workspaceDir = dirname(workspaceDir)
    }
  } else if (isFoundation(projectDir)) {
    workspaceDir = dirname(projectDir)
    if (basename(workspaceDir) === 'foundations') {
      workspaceDir = dirname(workspaceDir)
    }
  }

  // Check workspace structure
  const hasWorkspaceConfig = existsSync(join(workspaceDir, 'pnpm-workspace.yaml')) ||
                             existsSync(join(workspaceDir, 'package.json'))

  if (!hasWorkspaceConfig) {
    error('Not in a Uniweb workspace')
    log(`${colors.dim}Run this command from your project root or a site/foundation directory.${colors.reset}`)
    process.exit(1)
  }

  log('')
  info(`Workspace: ${workspaceDir}`)

  // Find all foundations
  const foundations = []

  // Check single-foundation layout
  const foundationDir = join(workspaceDir, 'foundation')
  if (isFoundation(foundationDir)) {
    const pkg = loadPackageJson(foundationDir)
    foundations.push({
      path: foundationDir,
      name: pkg?.name || 'foundation',
      folderName: 'foundation'
    })
  }

  // Check multi-foundation layout
  const foundationsDir = join(workspaceDir, 'foundations')
  if (existsSync(foundationsDir)) {
    try {
      const entries = readdirSync(foundationsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const foundationPath = join(foundationsDir, entry.name)
          if (isFoundation(foundationPath)) {
            const pkg = loadPackageJson(foundationPath)
            foundations.push({
              path: foundationPath,
              name: pkg?.name || entry.name,
              folderName: entry.name
            })
          }
        }
      }
    } catch {
      // Ignore errors
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

  // Find all sites
  const sites = []

  // Check single-site layout
  const siteDir = join(workspaceDir, 'site')
  if (isSite(siteDir)) {
    sites.push({ path: siteDir, name: 'site' })
  }

  // Check multi-site layout
  const sitesDir = join(workspaceDir, 'sites')
  if (existsSync(sitesDir)) {
    try {
      const entries = readdirSync(sitesDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sitePath = join(sitesDir, entry.name)
          if (isSite(sitePath)) {
            sites.push({ path: sitePath, name: entry.name })
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  if (sites.length === 0) {
    warn('No sites found')
  } else {
    log('')
    success(`Found ${sites.length} site(s):`)
    for (const s of sites) {
      log(`    • ${s.name}`)
    }
  }

  // Check each site
  const issues = []

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
      log(`  ${colors.dim}Run: pnpm --filter ${matchingFoundation.name} build${colors.reset}`)
    } else {
      success(`Foundation built: dist/foundation.js exists`)
    }
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
