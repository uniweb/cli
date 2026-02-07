/**
 * Add Command
 *
 * Adds foundations, sites, or extensions to an existing workspace.
 *
 * Usage:
 *   uniweb add foundation [name] [--from <template>] [--path <dir>] [--project <name>]
 *   uniweb add site [name] [--from <template>] [--foundation <name>] [--path <dir>] [--project <name>]
 *   uniweb add extension [name] [--from <template>] [--site <name>] [--path <dir>]
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import prompts from 'prompts'
import yaml from 'js-yaml'
import { scaffoldFoundation, scaffoldSite, applyContent, mergeTemplateDependencies } from '../utils/scaffold.js'
import {
  readWorkspaceConfig,
  addWorkspaceGlob,
  discoverFoundations,
  discoverSites,
  updateRootScripts,
} from '../utils/config.js'
import { findWorkspaceRoot } from '../utils/workspace.js'
import { resolveTemplate } from '../templates/index.js'
import { validateTemplate } from '../templates/validator.js'
import { getVersionsForTemplates } from '../versions.js'

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}

function log(message) { console.log(message) }
function success(message) { console.log(`${colors.green}✓${colors.reset} ${message}`) }
function error(message) { console.error(`${colors.red}✗${colors.reset} ${message}`) }
function info(message) { console.log(`${colors.dim}${message}${colors.reset}`) }

/**
 * Parse add command arguments
 */
function parseArgs(args) {
  const result = {
    subcommand: args[0],   // foundation, site, extension
    name: null,
    path: null,
    project: null,
    foundation: null,
    site: null,
    from: null,
  }

  // Find positional name (first arg after subcommand that's not a flag)
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      i++ // skip flag value
      continue
    }
    if (!result.name) {
      result.name = args[i]
    }
  }

  // Parse flags
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--path' && args[i + 1]) {
      result.path = args[++i]
    } else if (args[i] === '--project' && args[i + 1]) {
      result.project = args[++i]
    } else if (args[i] === '--foundation' && args[i + 1]) {
      result.foundation = args[++i]
    } else if (args[i] === '--site' && args[i + 1]) {
      result.site = args[++i]
    } else if (args[i] === '--from' && args[i + 1]) {
      result.from = args[++i]
    }
  }

  return result
}

/**
 * Main add command handler
 */
export async function add(args) {
  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    showAddHelp()
    return
  }

  const parsed = parseArgs(args)

  // Find workspace root
  const rootDir = findWorkspaceRoot()
  if (!rootDir) {
    error('Not in a Uniweb workspace. Run this command from a project directory.')
    error('Use "uniweb create" to create a new project first.')
    process.exit(1)
  }

  // Read root package.json for project name
  const rootPkg = JSON.parse(
    await readFile(join(rootDir, 'package.json'), 'utf-8').catch(() => '{}')
  )
  const projectName = rootPkg.name || 'my-project'

  switch (parsed.subcommand) {
    case 'foundation':
      await addFoundation(rootDir, projectName, parsed)
      break
    case 'site':
      await addSite(rootDir, projectName, parsed)
      break
    case 'extension':
      await addExtension(rootDir, projectName, parsed)
      break
    default:
      error(`Unknown subcommand: ${parsed.subcommand}`)
      log(`Valid subcommands: foundation, site, extension`)
      process.exit(1)
  }
}

/**
 * Add a foundation to the workspace
 */
async function addFoundation(rootDir, projectName, opts) {
  const name = opts.name
  const target = await resolveFoundationTarget(rootDir, name, opts)
  const fullPath = join(rootDir, target)

  if (existsSync(fullPath)) {
    error(`Directory already exists: ${target}`)
    process.exit(1)
  }

  // Scaffold
  await scaffoldFoundation(fullPath, {
    name: name || 'foundation',
    projectName,
    isExtension: false,
  }, {
    onProgress: (msg) => info(`  ${msg}`),
  })

  // Apply template content if --from specified
  if (opts.from) {
    await applyFromTemplate(opts.from, 'foundation', fullPath, projectName)
  }

  // Update workspace globs
  const glob = computeGlob(target, 'foundation')
  await addWorkspaceGlob(rootDir, glob)

  // Update root scripts
  const sites = await discoverSites(rootDir)
  await updateRootScripts(rootDir, sites)

  success(`Created foundation '${name || 'foundation'}' at ${target}/`)
  log('')
  log(`Next: ${colors.cyan}pnpm install${colors.reset}`)
}

/**
 * Add a site to the workspace
 */
async function addSite(rootDir, projectName, opts) {
  const name = opts.name
  const target = await resolveSiteTarget(rootDir, name, opts)
  const fullPath = join(rootDir, target)

  if (existsSync(fullPath)) {
    error(`Directory already exists: ${target}`)
    process.exit(1)
  }

  // Resolve foundation
  const foundation = await resolveFoundation(rootDir, opts.foundation)
  if (!foundation) {
    error('No foundation found. Add a foundation first: uniweb add foundation')
    process.exit(1)
  }

  // Compute relative path from site to foundation
  const foundationPath = computeFoundationPath(target, foundation.path)
  const siteName = name || 'site'

  // Scaffold
  await scaffoldSite(fullPath, {
    name: siteName,
    projectName,
    foundationName: foundation.name,
    foundationPath,
    foundationRef: foundation.name,
  }, {
    onProgress: (msg) => info(`  ${msg}`),
  })

  // Apply template content if --from specified
  if (opts.from) {
    await applyFromTemplate(opts.from, 'site', fullPath, projectName)
  }

  // Update workspace globs
  const glob = computeGlob(target, 'site')
  await addWorkspaceGlob(rootDir, glob)

  // Update root scripts (discover sites after glob is added — includes the new one)
  const sites = await discoverSites(rootDir)
  // If the new site wasn't discovered (glob may not match yet), add it
  if (!sites.find(s => s.path === target)) {
    sites.push({ name: siteName, path: target })
  }
  await updateRootScripts(rootDir, sites)

  success(`Created site '${siteName}' at ${target}/ → foundation '${foundation.name}'`)
  log('')
  log(`Next: ${colors.cyan}pnpm install && pnpm --filter ${siteName} dev${colors.reset}`)
}

/**
 * Add an extension to the workspace
 */
async function addExtension(rootDir, projectName, opts) {
  const name = opts.name

  if (!name) {
    error('Extension name is required: uniweb add extension <name>')
    process.exit(1)
  }

  // Determine target
  let target
  if (opts.path) {
    target = opts.path
  } else {
    target = `extensions/${name}`
  }

  const fullPath = join(rootDir, target)

  if (existsSync(fullPath)) {
    error(`Directory already exists: ${target}`)
    process.exit(1)
  }

  // Scaffold foundation with extension flag
  await scaffoldFoundation(fullPath, {
    name,
    projectName,
    isExtension: true,
  }, {
    onProgress: (msg) => info(`  ${msg}`),
  })

  // Apply template content if --from specified
  if (opts.from) {
    await applyFromTemplate(opts.from, 'extension', fullPath, projectName)
  }

  // Update workspace globs
  await addWorkspaceGlob(rootDir, 'extensions/*')

  // Wire extension to site if specified (or only one site exists)
  let wiredSite = null
  if (opts.site) {
    wiredSite = await wireExtensionToSite(rootDir, opts.site, name, target)
  } else {
    const sites = await discoverSites(rootDir)
    if (sites.length === 1) {
      wiredSite = await wireExtensionToSite(rootDir, sites[0].name, name, target)
    }
  }

  // Update root scripts
  const sites = await discoverSites(rootDir)
  await updateRootScripts(rootDir, sites)

  let msg = `Created extension '${name}' at ${target}/`
  if (wiredSite) {
    msg += ` → wired to site '${wiredSite}'`
  }
  success(msg)
  log('')
  log(`Next: ${colors.cyan}pnpm install${colors.reset}`)
}

/**
 * Resolve placement for a foundation
 */
async function resolveFoundationTarget(rootDir, name, opts) {
  if (opts.path) return opts.path

  if (opts.project) {
    return `${opts.project}/foundation`
  }

  // Check existing layout
  const { packages } = await readWorkspaceConfig(rootDir)
  const hasColocated = packages.some(p => p.includes('*/foundation'))
  const hasFoundationsGlob = packages.some(p => p.startsWith('foundations/'))
  const hasSingleFoundation = existsSync(join(rootDir, 'foundation'))

  if (hasColocated && opts.project) {
    return `${opts.project}/foundation`
  }

  // No name and no foundations exist → ./foundation/
  if (!name && !hasSingleFoundation && !hasFoundationsGlob) {
    return 'foundation'
  }

  // Named foundation or existing foundation → ./foundations/{name}/
  return `foundations/${name || 'foundation'}`
}

/**
 * Resolve placement for a site
 */
async function resolveSiteTarget(rootDir, name, opts) {
  if (opts.path) return opts.path

  if (opts.project) {
    return `${opts.project}/site`
  }

  const { packages } = await readWorkspaceConfig(rootDir)
  const hasColocated = packages.some(p => p.includes('*/site'))
  const hasSitesGlob = packages.some(p => p.startsWith('sites/'))
  const hasSingleSite = existsSync(join(rootDir, 'site'))

  if (hasColocated && opts.project) {
    return `${opts.project}/site`
  }

  // No name and no sites exist → ./site/
  if (!name && !hasSingleSite && !hasSitesGlob) {
    return 'site'
  }

  // Named site or existing site → ./sites/{name}/
  return `sites/${name || 'site'}`
}

/**
 * Resolve which foundation to wire a site to
 */
async function resolveFoundation(rootDir, foundationFlag) {
  const foundations = await discoverFoundations(rootDir)

  if (foundationFlag) {
    // Find by name
    const found = foundations.find(f => f.name === foundationFlag)
    if (found) return found

    // Not found — could be a URL or new foundation
    error(`Foundation '${foundationFlag}' not found in workspace.`)
    log(`Available foundations: ${foundations.map(f => f.name).join(', ') || 'none'}`)
    process.exit(1)
  }

  if (foundations.length === 0) {
    return null
  }

  if (foundations.length === 1) {
    info(`Using foundation: ${foundations[0].name}`)
    return foundations[0]
  }

  // Multiple foundations — prompt
  const response = await prompts({
    type: 'select',
    name: 'foundation',
    message: 'Which foundation should this site use?',
    choices: foundations.map(f => ({
      title: f.name,
      description: f.path,
      value: f,
    })),
  }, {
    onCancel: () => {
      log('\nCancelled.')
      process.exit(0)
    },
  })

  return response.foundation
}

/**
 * Compute the file: path from site to foundation
 */
function computeFoundationPath(sitePath, foundationPath) {
  // Compute relative path from site dir to foundation dir
  const rel = relative(sitePath, foundationPath)
  return `file:${rel}`
}

/**
 * Compute the appropriate glob pattern for a target directory
 */
function computeGlob(target, type) {
  // e.g., "foundation" → "foundation"
  // e.g., "foundations/marketing" → "foundations/*"
  // e.g., "docs/foundation" → "*/foundation"
  // e.g., "lib/mktg" → "lib/mktg"

  const parts = target.split('/')

  if (parts.length === 1) {
    // Direct: "foundation", "site"
    return target
  }

  if (parts.length === 2) {
    // Could be "foundations/marketing" or "docs/foundation"
    if (parts[1] === type) {
      // Co-located: "docs/foundation" → "*/foundation"
      return `*/${type}`
    }
    // Plural container: "foundations/marketing" → "foundations/*"
    return `${parts[0]}/*`
  }

  // Custom path — return as-is
  return target
}

/**
 * Apply content from a template to a scaffolded package
 *
 * @param {string} templateId - Template identifier (official name, local path, npm, github)
 * @param {string} packageType - 'foundation', 'site', or 'extension'
 * @param {string} targetDir - Absolute path to the scaffolded package
 * @param {string} projectName - Project name for template context
 */
async function applyFromTemplate(templateId, packageType, targetDir, projectName) {
  info(`Resolving template: ${templateId}...`)

  const resolved = await resolveTemplate(templateId, {
    onProgress: (msg) => info(`  ${msg}`),
  })

  try {
    const metadata = await validateTemplate(resolved.path, {})

    // Look in contentDirs for matching package type
    let contentDir = null
    const match = metadata.contentDirs.find(d => d.type === packageType) ||
                  metadata.contentDirs.find(d => d.name === packageType)
    if (match) {
      contentDir = match.dir
    }

    if (contentDir) {
      info(`Applying ${metadata.name} content...`)
      await applyContent(contentDir, targetDir, {
        projectName,
        versions: getVersionsForTemplates(),
      }, {
        onProgress: (msg) => info(`  ${msg}`),
      })

      // Merge template dependencies
      if (metadata.dependencies) {
        const deps = metadata.dependencies[packageType] || metadata.dependencies[match?.name]
        if (deps) {
          await mergeTemplateDependencies(join(targetDir, 'package.json'), deps)
        }
      }

      // If site content applied, inform about expected section types
      if (packageType === 'site' && metadata.components) {
        log('')
        info(`This template expects section types: ${metadata.components.join(', ')}`)
        info(`Make sure your foundation provides them.`)
      }
    } else {
      info(`Template '${metadata.name}' has no ${packageType} content to apply.`)
    }
  } finally {
    if (resolved.cleanup) await resolved.cleanup()
  }
}

/**
 * Wire an extension URL to a site's site.yml
 */
async function wireExtensionToSite(rootDir, siteName, extensionName, extensionPath) {
  // Find the site directory
  const sites = await discoverSites(rootDir)
  const site = sites.find(s => s.name === siteName)
  if (!site) {
    info(`Could not find site '${siteName}' to wire extension.`)
    return null
  }

  const siteYmlPath = join(rootDir, site.path, 'site.yml')
  if (!existsSync(siteYmlPath)) {
    info(`No site.yml found at ${site.path}`)
    return null
  }

  try {
    const content = await readFile(siteYmlPath, 'utf-8')
    const config = yaml.load(content) || {}

    // Add extension URL
    const extensionUrl = `/${extensionPath}/dist/foundation.js`
    if (!config.extensions) {
      config.extensions = []
    }
    if (!config.extensions.includes(extensionUrl)) {
      config.extensions.push(extensionUrl)
    }

    await writeFile(siteYmlPath, yaml.dump(config, { flowLevel: -1, quotingType: "'" }))
    return siteName
  } catch (err) {
    info(`Warning: Could not update site.yml: ${err.message}`)
    return null
  }
}

/**
 * Show help for the add command
 */
function showAddHelp() {
  log(`
${colors.cyan}${colors.bright}Uniweb Add${colors.reset}

Add foundations, sites, or extensions to your workspace.

${colors.bright}Usage:${colors.reset}
  uniweb add foundation [name] [options]
  uniweb add site [name] [options]
  uniweb add extension <name> [options]

${colors.bright}Common Options:${colors.reset}
  --from <template>  Apply content from a template after scaffolding
  --path <dir>       Custom directory for the package

${colors.bright}Foundation Options:${colors.reset}
  --project <name>   Group under a project directory (co-located layout)

${colors.bright}Site Options:${colors.reset}
  --foundation <n>   Foundation to wire to (prompted if multiple exist)
  --project <name>   Group under a project directory (co-located layout)

${colors.bright}Extension Options:${colors.reset}
  --site <name>      Site to wire extension URL into

${colors.bright}Examples:${colors.reset}
  uniweb add foundation                                # Create ./foundation/
  uniweb add foundation marketing                      # Create ./foundations/marketing/
  uniweb add foundation marketing --from marketing     # Scaffold + marketing sections
  uniweb add site blog --foundation marketing          # Create ./sites/blog/ wired to marketing
  uniweb add site blog --from docs --foundation blog   # Scaffold + docs pages
  uniweb add extension effects --site site             # Create ./extensions/effects/
  uniweb add foundation --project docs                 # Create ./docs/foundation/ (co-located)
  uniweb add site --project docs                       # Create ./docs/site/ (co-located)
`)
}
