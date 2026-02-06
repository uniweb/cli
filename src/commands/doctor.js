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
  // Primary: has foundation.js config
  if (existsSync(join(dir, 'src', 'foundation.js'))) return true
  // Fallback: has src/sections/
  if (existsSync(join(dir, 'src', 'sections'))) return true
  // Legacy fallback: has src/components/
  if (existsSync(join(dir, 'src', 'components'))) return true
  return false
}

/**
 * Load foundation.js config from a directory
 * Returns the default export, or null if not found/loadable
 */
function loadFoundationJs(dir) {
  const filePath = join(dir, 'src', 'foundation.js')
  if (!existsSync(filePath)) return null
  try {
    const content = readFileSync(filePath, 'utf8')
    // Simple extraction: check for extension: true
    return { extension: /extension\s*:\s*true/.test(content) }
  } catch {
    return null
  }
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
  const schema = loadSchemaJson(dir)
  if (schema?._self?.role === 'extension') return true
  const config = loadFoundationJs(dir)
  return config?.extension === true
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
    const parentName = basename(workspaceDir)
    if (parentName === 'foundations' || parentName === 'extensions') {
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

  // Discover extensions
  const extensions = []

  const extensionsDir = join(workspaceDir, 'extensions')
  if (existsSync(extensionsDir)) {
    try {
      const entries = readdirSync(extensionsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const extensionPath = join(extensionsDir, entry.name)
          if (isFoundation(extensionPath)) {
            const pkg = loadPackageJson(extensionPath)
            extensions.push({
              path: extensionPath,
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

  if (extensions.length > 0) {
    log('')
    success(`Found ${extensions.length} extension(s):`)
    for (const e of extensions) {
      const nameMismatch = e.name !== e.folderName ? ` ${colors.dim}(folder: ${e.folderName}/)${colors.reset}` : ''
      log(`    • ${e.name}${nameMismatch}`)
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
      log(`  ${colors.dim}Run: pnpm --filter ${ext.name} build${colors.reset}`)
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
