/**
 * Add Command
 *
 * Adds foundations, sites, extensions, section types, or co-located projects to an existing workspace.
 *
 * Usage:
 *   uniweb add project [name] [--from <template>]
 *   uniweb add foundation [name] [--from <template>] [--path <dir>] [--project <name>]
 *   uniweb add site [name] [--from <template>] [--foundation <name>] [--path <dir>] [--project <name>]
 *   uniweb add extension [name] [--from <template>] [--site <name>] [--path <dir>]
 *   uniweb add section <name> [--foundation <name>]
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import prompts from 'prompts'
import yaml from 'js-yaml'
import { scaffoldFoundation, scaffoldSite, applyContent, applyStarter, mergeTemplateDependencies } from '../utils/scaffold.js'
import {
  readWorkspaceConfig,
  addWorkspaceGlob,
  discoverFoundations,
  discoverSites,
  updateRootScripts,
} from '../utils/config.js'
import { validatePackageName, getExistingPackageNames, resolveUniqueName } from '../utils/names.js'
import { findWorkspaceRoot } from '../utils/workspace.js'
import { detectPackageManager, filterCmd, installCmd } from '../utils/pm.js'
import { isNonInteractive, getCliPrefix, stripNonInteractiveFlag, formatOptions } from '../utils/interactive.js'
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
export async function add(rawArgs) {
  const nonInteractive = isNonInteractive(rawArgs)
  const args = stripNonInteractiveFlag(rawArgs)

  if (args[0] === '--help' || args[0] === '-h') {
    showAddHelp()
    return
  }

  const pm = detectPackageManager()
  const prefix = getCliPrefix()

  // Find workspace root
  const rootDir = findWorkspaceRoot()
  if (!rootDir) {
    error('Not in a Uniweb workspace. Run this command from a project directory.')
    error('Use "uniweb create" to create a new project first.')
    process.exit(1)
  }

  // Interactive subcommand chooser when no args given
  let parsed
  if (!args.length || (args[0] && args[0].startsWith('--'))) {
    if (nonInteractive) {
      error(`Missing subcommand.\n`)
      log(formatOptions([
        { label: 'project', description: 'Co-located foundation + site pair' },
        { label: 'foundation', description: 'Component library' },
        { label: 'site', description: 'Content site' },
        { label: 'extension', description: 'Additional component package' },
        { label: 'section', description: 'Section type in a foundation' },
      ]))
      log('')
      log(`Usage: ${prefix} add <project|foundation|site|extension|section> [name]`)
      process.exit(1)
    }

    const response = await prompts({
      type: 'select',
      name: 'subcommand',
      message: 'What would you like to add?',
      choices: [
        { title: 'Project', value: 'project', description: 'Co-located foundation + site pair' },
        { title: 'Foundation', value: 'foundation', description: 'Component library' },
        { title: 'Site', value: 'site', description: 'Content site' },
        { title: 'Extension', value: 'extension', description: 'Additional component package' },
        { title: 'Section', value: 'section', description: 'Section type in a foundation' },
      ],
    }, {
      onCancel: () => {
        log('\nCancelled.')
        process.exit(0)
      },
    })
    parsed = parseArgs([response.subcommand, ...args])
  } else {
    parsed = parseArgs(args)
  }

  // Read root package.json for project name
  const rootPkg = JSON.parse(
    await readFile(join(rootDir, 'package.json'), 'utf-8').catch(() => '{}')
  )
  const projectName = rootPkg.name || 'my-project'

  switch (parsed.subcommand) {
    case 'project':
      await addProject(rootDir, projectName, parsed, pm)
      break
    case 'foundation':
      await addFoundation(rootDir, projectName, parsed, pm)
      break
    case 'site':
      await addSite(rootDir, projectName, parsed, pm)
      break
    case 'extension':
      await addExtension(rootDir, projectName, parsed, pm)
      break
    case 'section':
      await addSection(rootDir, parsed)
      break
    default:
      error(`Unknown subcommand: ${parsed.subcommand}`)
      log(`Valid subcommands: project, foundation, site, extension, section`)
      process.exit(1)
  }
}

/**
 * Add a foundation to the workspace
 */
async function addFoundation(rootDir, projectName, opts, pm = 'pnpm') {
  let name = opts.name
  const existingNames = await getExistingPackageNames(rootDir)

  // Reject reserved names (format + reserved check only — collisions handled at package name level)
  if (name) {
    const valid = validatePackageName(name)
    if (valid !== true) {
      error(valid)
      process.exit(1)
    }
  }

  // Interactive name prompt when name not provided and no --path
  if (!name && !opts.path) {
    if (!isNonInteractive(process.argv)) {
      const foundations = await discoverFoundations(rootDir)
      const hasDefault = foundations.length === 0 && !existsSync(join(rootDir, 'foundation'))
      const response = await prompts({
        type: 'text',
        name: 'name',
        message: 'Foundation name:',
        initial: hasDefault ? 'foundation' : undefined,
        validate: (value) => validatePackageName(value),
      }, {
        onCancel: () => {
          log('\nCancelled.')
          process.exit(0)
        },
      })
      // Only set name if user chose something other than the default —
      // null name tells resolveFoundationTarget to use default placement (./foundation/)
      if (!hasDefault || response.name !== 'foundation') {
        name = response.name
      }
    }
    // Non-interactive without name: defaults to 'foundation' — resolveFoundationTarget handles it
  }

  const target = await resolveFoundationTarget(rootDir, name, opts)
  const fullPath = join(rootDir, target)

  if (existsSync(fullPath)) {
    error(`Directory already exists: ${target}`)
    process.exit(1)
  }

  // Package name = name or 'foundation'
  const packageName = name || 'foundation'
  if (existingNames.has(packageName)) {
    error(`Package name '${packageName}' already exists in this workspace.`)
    log(`Choose a different name: ${getCliPrefix()} add foundation <name>`)
    process.exit(1)
  }

  // Scaffold
  await scaffoldFoundation(fullPath, {
    name: packageName,
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
  await updateRootScripts(rootDir, sites, pm)

  success(`Created foundation '${packageName}' at ${target}/`)
  log('')
  log(`Next: ${colors.cyan}${installCmd(pm)}${colors.reset}`)
}

/**
 * Add a site to the workspace
 */
async function addSite(rootDir, projectName, opts, pm = 'pnpm') {
  let name = opts.name
  const existingNames = await getExistingPackageNames(rootDir)

  // Reject reserved names (format + reserved check only — collisions handled at package name level)
  if (name) {
    const valid = validatePackageName(name)
    if (valid !== true) {
      error(valid)
      process.exit(1)
    }
  }

  // Interactive name prompt when name not provided and no --path
  if (!name && !opts.path) {
    if (!isNonInteractive(process.argv)) {
      const existingSites = await discoverSites(rootDir)
      const hasDefault = existingSites.length === 0 && !existsSync(join(rootDir, 'site'))
      const response = await prompts({
        type: 'text',
        name: 'name',
        message: 'Site name:',
        initial: hasDefault ? 'site' : undefined,
        validate: (value) => validatePackageName(value),
      }, {
        onCancel: () => {
          log('\nCancelled.')
          process.exit(0)
        },
      })
      // Only set name if user chose something other than the default —
      // null name tells resolveSiteTarget to use default placement (./site/)
      if (!hasDefault || response.name !== 'site') {
        name = response.name
      }
    }
    // Non-interactive without name: defaults to 'site' — resolveSiteTarget handles it
  }

  const target = await resolveSiteTarget(rootDir, name, opts)
  const fullPath = join(rootDir, target)

  if (existsSync(fullPath)) {
    error(`Directory already exists: ${target}`)
    process.exit(1)
  }

  // Resolve foundation
  const foundation = await resolveFoundation(rootDir, opts.foundation)

  // Package name = name or 'site'
  const siteName = name || 'site'
  if (existingNames.has(siteName)) {
    error(`Package name '${siteName}' already exists in this workspace.`)
    log(`Choose a different name: ${getCliPrefix()} add site <name>`)
    process.exit(1)
  }

  if (foundation) {
    // Compute relative path from site to foundation
    const foundationPath = computeFoundationPath(target, foundation.path)

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
  } else {
    // No foundation — scaffold without wiring
    await scaffoldSite(fullPath, {
      name: siteName,
      projectName,
      foundationName: '',
      foundationPath: '',
    }, {
      onProgress: (msg) => info(`  ${msg}`),
    })
    log(`  ${colors.yellow}⚠ No foundation wired. Add one later with: npx uniweb add foundation${colors.reset}`)
  }

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
  await updateRootScripts(rootDir, sites, pm)

  if (foundation) {
    success(`Created site '${siteName}' at ${target}/ → foundation '${foundation.name}'`)
  } else {
    success(`Created site '${siteName}' at ${target}/`)
  }
  log('')
  log(`Next: ${colors.cyan}${installCmd(pm)} && ${filterCmd(pm, siteName, 'dev')}${colors.reset}`)
  if (!opts.from) {
    log('')
    log(`${colors.dim}To add your first page, create ${target}/pages/home/page.yml and a .md file.${colors.reset}`)
    log(`${colors.dim}Or use --from to start with template content: uniweb add site --from starter${colors.reset}`)
  }
}

/**
 * Add an extension to the workspace
 */
async function addExtension(rootDir, projectName, opts, pm = 'pnpm') {
  let name = opts.name
  const existingNames = await getExistingPackageNames(rootDir)

  // Reject reserved names (format + reserved check only — collisions handled at package name level)
  if (name) {
    const valid = validatePackageName(name)
    if (valid !== true) {
      error(valid)
      process.exit(1)
    }
  }

  // Interactive name prompt when name not provided
  if (!name) {
    if (isNonInteractive(process.argv)) {
      error(`Missing extension name.\n`)
      log(`Usage: ${getCliPrefix()} add extension <name>`)
      process.exit(1)
    }

    const response = await prompts({
      type: 'text',
      name: 'name',
      message: 'Extension name:',
      validate: (value) => validatePackageName(value),
    }, {
      onCancel: () => {
        log('\nCancelled.')
        process.exit(0)
      },
    })
    name = response.name
  }

  // Auto-suffix package name if it collides with an existing package
  const extensionPackageName = existingNames.has(name)
    ? resolveUniqueName(name, '-ext', existingNames)
    : name

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
    name: extensionPackageName,
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
  await updateRootScripts(rootDir, sites, pm)

  let msg = `Created extension '${name}' at ${target}/`
  if (wiredSite) {
    msg += ` → wired to site '${wiredSite}'`
  }
  success(msg)
  log('')
  log(`Next: ${colors.cyan}${installCmd(pm)}${colors.reset}`)
}

/**
 * Add a co-located foundation + site pair to the workspace
 */
async function addProject(rootDir, projectName, opts, pm = 'pnpm') {
  let name = opts.name
  const existingNames = await getExistingPackageNames(rootDir)

  // Validate name format
  if (name) {
    const valid = validatePackageName(name)
    if (valid !== true) {
      error(valid)
      process.exit(1)
    }
  }

  // Interactive name prompt when name not provided
  if (!name) {
    if (isNonInteractive(process.argv)) {
      error(`Missing project name.\n`)
      log(`Usage: ${getCliPrefix()} add project <name>`)
      process.exit(1)
    }

    const response = await prompts({
      type: 'text',
      name: 'name',
      message: 'Project name:',
      validate: (value) => validatePackageName(value),
    }, {
      onCancel: () => {
        log('\nCancelled.')
        process.exit(0)
      },
    })
    name = response.name
  }

  // Check directory doesn't already exist
  const projectDir = join(rootDir, name)
  if (existsSync(projectDir)) {
    error(`Directory already exists: ${name}/`)
    process.exit(1)
  }

  // Compute package names
  const foundationPkgName = `${name}-foundation`
  const sitePkgName = `${name}-site`

  // Check package name collisions
  for (const pkgName of [foundationPkgName, sitePkgName]) {
    if (existingNames.has(pkgName)) {
      error(`Package name '${pkgName}' already exists in this workspace.`)
      process.exit(1)
    }
  }

  const progressCb = (msg) => info(`  ${msg}`)

  // Scaffold foundation
  info(`Creating foundation: ${foundationPkgName}...`)
  await scaffoldFoundation(join(projectDir, 'foundation'), {
    name: foundationPkgName,
    projectName,
    isExtension: false,
  }, { onProgress: progressCb })

  // Scaffold site
  info(`Creating site: ${sitePkgName}...`)
  await scaffoldSite(join(projectDir, 'site'), {
    name: sitePkgName,
    projectName,
    foundationName: foundationPkgName,
    foundationPath: 'file:../foundation',
    foundationRef: foundationPkgName,
  }, { onProgress: progressCb })

  // Apply template content if --from specified
  if (opts.from) {
    await applyFromTemplate(opts.from, 'foundation', join(projectDir, 'foundation'), projectName)
    await applyFromTemplate(opts.from, 'site', join(projectDir, 'site'), projectName)
  }

  // Update workspace globs for co-located layout
  await addWorkspaceGlob(rootDir, '*/foundation')
  await addWorkspaceGlob(rootDir, '*/site')

  // Update root scripts
  const sites = await discoverSites(rootDir)
  if (!sites.find(s => s.path === `${name}/site`)) {
    sites.push({ name: sitePkgName, path: `${name}/site` })
  }
  await updateRootScripts(rootDir, sites, pm)

  success(`Created project '${name}' at ${name}/`)
  log(`  ${colors.dim}Foundation: ${name}/foundation/ (${foundationPkgName})${colors.reset}`)
  log(`  ${colors.dim}Site: ${name}/site/ (${sitePkgName})${colors.reset}`)
  log('')
  log(`Next: ${colors.cyan}${installCmd(pm)} && ${filterCmd(pm, sitePkgName, 'dev')}${colors.reset}`)
}

/**
 * Resolve placement for a foundation
 *
 * Rules:
 * - --path: use it directly
 * - --project: {project}/foundation (co-located)
 * - Existing co-located glob: follow pattern
 * - Existing segregated glob: follow pattern
 * - First foundation: dir name is the name (default: 'foundation')
 * - Already have one: error in non-interactive, ask in interactive
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

  // Respect existing co-located layout
  if (hasColocated && name) {
    return `${name}/foundation`
  }

  // Respect existing segregated layout
  if (hasFoundationsGlob) {
    return `foundations/${name || 'foundation'}`
  }

  // dir name = name or 'foundation'
  const dirName = name || 'foundation'

  // Check if target already exists
  if (!existsSync(join(rootDir, dirName))) {
    return dirName
  }

  // Already have one at the target path — error with guidance
  if (isNonInteractive(process.argv)) {
    error(`Directory '${dirName}' already exists.`)
    log(`\nTo add another foundation, specify a name:`)
    log(`  ${getCliPrefix()} add foundation <name>`)
    log(`\nOr use --path for explicit placement:`)
    log(`  ${getCliPrefix()} add foundation --path <dir>`)
    process.exit(1)
  }

  // Interactive: the existsSync check in addFoundation will catch it
  return dirName
}

/**
 * Resolve placement for a site
 *
 * Same rules as resolveFoundationTarget, adapted for sites.
 */
async function resolveSiteTarget(rootDir, name, opts) {
  if (opts.path) return opts.path

  if (opts.project) {
    return `${opts.project}/site`
  }

  const { packages } = await readWorkspaceConfig(rootDir)
  const hasColocated = packages.some(p => p.includes('*/site'))
  const hasSitesGlob = packages.some(p => p.startsWith('sites/'))

  // Respect existing co-located layout
  if (hasColocated && name) {
    return `${name}/site`
  }

  // Respect existing segregated layout
  if (hasSitesGlob) {
    return `sites/${name || 'site'}`
  }

  // dir name = name or 'site'
  const dirName = name || 'site'

  // Check if target already exists
  if (!existsSync(join(rootDir, dirName))) {
    return dirName
  }

  // Already have one at the target path — error with guidance
  if (isNonInteractive(process.argv)) {
    error(`Directory '${dirName}' already exists.`)
    log(`\nTo add another site, specify a name:`)
    log(`  ${getCliPrefix()} add site <name>`)
    log(`\nOr use --path for explicit placement:`)
    log(`  ${getCliPrefix()} add site --path <dir>`)
    process.exit(1)
  }

  // Interactive: the existsSync check in addSite will catch it
  return dirName
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

  // Multiple foundations — prompt (or fail in non-interactive mode)
  if (isNonInteractive(process.argv)) {
    error(`Multiple foundations found. Specify which to use:\n`)
    log(formatOptions(foundations.map(f => ({
      label: f.name,
      description: f.path,
    }))))
    log('')
    log(`Usage: ${getCliPrefix()} add site <name> --foundation <name>`)
    process.exit(1)
  }

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
 * Add a section type to a foundation
 */
async function addSection(rootDir, opts) {
  let name = opts.name

  // Interactive name prompt when not provided
  if (!name) {
    if (isNonInteractive(process.argv)) {
      error(`Missing section name.\n`)
      log(`Usage: ${getCliPrefix()} add section <Name>`)
      log(`\nSection names use PascalCase: Hero, FeatureGrid, CallToAction`)
      process.exit(1)
    }

    const response = await prompts({
      type: 'text',
      name: 'name',
      message: 'Section name (PascalCase):',
      validate: (value) => /^[A-Z][a-zA-Z0-9]*$/.test(value) || 'Use PascalCase: Hero, FeatureGrid, CallToAction',
    }, {
      onCancel: () => {
        log('\nCancelled.')
        process.exit(0)
      },
    })
    name = response.name
  }

  // Validate PascalCase
  if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
    error(`Section name must be PascalCase (e.g., Hero, FeatureGrid, CallToAction).`)
    process.exit(1)
  }

  // Find the foundation
  const foundations = await discoverFoundations(rootDir)
  let foundation

  if (foundations.length === 0) {
    error('No foundation found in this workspace.')
    log(`Create one first: ${getCliPrefix()} add foundation`)
    process.exit(1)
  } else if (foundations.length === 1) {
    foundation = foundations[0]
  } else if (opts.foundation) {
    foundation = foundations.find(f => f.name === opts.foundation)
    if (!foundation) {
      error(`Foundation '${opts.foundation}' not found.`)
      log(`Available: ${foundations.map(f => f.name).join(', ')}`)
      process.exit(1)
    }
  } else if (isNonInteractive(process.argv)) {
    error(`Multiple foundations found. Specify which to use:\n`)
    log(formatOptions(foundations.map(f => ({ label: f.name, description: f.path }))))
    log('')
    log(`Usage: ${getCliPrefix()} add section ${name} --foundation <name>`)
    process.exit(1)
  } else {
    const response = await prompts({
      type: 'select',
      name: 'foundation',
      message: 'Which foundation?',
      choices: foundations.map(f => ({ title: f.name, description: f.path, value: f })),
    }, {
      onCancel: () => {
        log('\nCancelled.')
        process.exit(0)
      },
    })
    foundation = response.foundation
  }

  // Resolve sections directory
  const sectionsDir = join(rootDir, foundation.path, 'src', 'sections')
  const sectionDir = join(sectionsDir, name)

  if (existsSync(sectionDir)) {
    error(`Section '${name}' already exists at ${foundation.path}/src/sections/${name}/`)
    process.exit(1)
  }

  // Create section directory and files
  await mkdir(sectionDir, { recursive: true })

  const componentContent = `import { H2, P, Link, cn } from '@uniweb/kit'

export default function ${name}({ content, params }) {
  const { title, paragraphs = [], links = [] } = content || {}

  return (
    <div className="max-w-4xl mx-auto px-6">
      {title && <H2 text={title} className="text-heading text-3xl font-bold" />}
      <P text={paragraphs} className="text-body mt-4" />
      {links.length > 0 && (
        <div className="mt-6 flex gap-3 flex-wrap">
          {links.map((link, i) => (
            <Link key={i} to={link.href} className={cn(
              'px-5 py-2.5 rounded-lg font-medium transition-colors',
              i === 0
                ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary-hover'
            )}>
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
`

  const metaContent = `export default {
  title: '${name}',
  description: '',
  params: {},
}
`

  await writeFile(join(sectionDir, 'index.jsx'), componentContent)
  await writeFile(join(sectionDir, 'meta.js'), metaContent)

  success(`Created section '${name}' at ${foundation.path}/src/sections/${name}/`)
  log(`  ${colors.dim}index.jsx${colors.reset}  — component (customize the JSX)`)
  log(`  ${colors.dim}meta.js${colors.reset}    — metadata (add content expectations, params, presets)`)
  if (foundations.length === 1) {
    log('')
    log(`${colors.dim}The dev server will pick it up automatically.${colors.reset}`)
  }
}

/**
 * Show help for the add command
 */
function showAddHelp() {
  log(`
${colors.cyan}${colors.bright}Uniweb Add${colors.reset}

Add projects, foundations, sites, extensions, or section types to your workspace.

${colors.bright}Usage:${colors.reset}
  uniweb add project [name] [options]
  uniweb add foundation [name] [options]
  uniweb add site [name] [options]
  uniweb add extension <name> [options]
  uniweb add section <name> [options]

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

${colors.bright}Section Options:${colors.reset}
  --foundation <n>   Foundation to add section to (prompted if multiple exist)

${colors.bright}Examples:${colors.reset}
  uniweb add project docs                              # Create docs/foundation/ + docs/site/
  uniweb add project docs --from academic              # Co-located pair + academic content
  uniweb add foundation                                # Create ./foundation/ at root
  uniweb add foundation ui                             # Create ./ui/ at root
  uniweb add site                                      # Create ./site/ at root
  uniweb add site blog --foundation marketing          # Create ./blog/ wired to marketing
  uniweb add extension effects --site site             # Create ./extensions/effects/
  uniweb add section Hero                              # Create Hero section type
  uniweb add section Hero --foundation ui              # Target specific foundation
  uniweb add foundation --project docs                 # Create ./docs/foundation/ (co-located)
  uniweb add site --project docs                       # Create ./docs/site/ (co-located)
`)
}
