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
import { resolveFoundationSrcPath } from '@uniweb/build'
import { scaffoldFoundation, scaffoldSite, applyContent, applyStarter, mergeTemplateDependencies } from '../utils/scaffold.js'
import {
  readWorkspaceConfig,
  addWorkspaceGlob,
  updateRootScripts,
} from '../utils/config.js'
import { discoverFoundations, discoverSites } from '../utils/discover.js'
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
    subcommand: args[0],   // foundation, site, extension, ci, …
    name: null,
    path: null,
    project: null,
    foundation: null,
    site: null,
    from: null,
    host: null,
    force: false,
    domain: null,
  }

  // Booleans (no value) consumed up-front so the value-flag loop below
  // doesn't accidentally swallow the next positional.
  const BOOLEAN_FLAGS = new Set(['--force'])

  // Find positional name (first arg after subcommand that's not a flag).
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (!BOOLEAN_FLAGS.has(args[i])) i++ // skip flag value
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
    } else if (args[i] === '--host' && args[i + 1]) {
      result.host = args[++i]
    } else if (args[i] === '--domain' && args[i + 1]) {
      result.domain = args[++i]
    } else if (args[i] === '--force') {
      result.force = true
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
        { label: 'foundation', description: 'Component system for content authors' },
        { label: 'site', description: 'Content site' },
        { label: 'extension', description: 'Additional component package' },
        { label: 'section', description: 'Section type in a foundation' },
        { label: 'ci', description: 'CI deploy workflow for a host (e.g., GitHub Pages)' },
      ]))
      log('')
      log(`Usage: ${prefix} add <project|foundation|site|extension|section|ci> [name]`)
      process.exit(1)
    }

    const response = await prompts({
      type: 'select',
      name: 'subcommand',
      message: 'What would you like to add?',
      choices: [
        { title: 'Project', value: 'project', description: 'Co-located foundation + site pair' },
        { title: 'Foundation', value: 'foundation', description: 'Component system for content authors' },
        { title: 'Site', value: 'site', description: 'Content site' },
        { title: 'Extension', value: 'extension', description: 'Additional component package' },
        { title: 'Section', value: 'section', description: 'Section type in a foundation' },
        { title: 'CI workflow', value: 'ci', description: 'Deploy workflow for a host (e.g., GitHub Pages)' },
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
    case 'ci':
      await addCi(rootDir, parsed, pm)
      break
    default:
      error(`Unknown subcommand: ${parsed.subcommand}`)
      log(`Valid subcommands: project, foundation, site, extension, section, ci`)
      process.exit(1)
  }
}

/**
 * Add a foundation to the workspace
 */
async function addFoundation(rootDir, projectName, opts, pm = 'pnpm') {
  const name = opts.name
  const existingNames = await getExistingPackageNames(rootDir)

  // Resolve placement first (path + package name) so we have everything we
  // need to validate before scaffolding. Note: `name` here may be a bare
  // name (`ui`) or a path (`foundations/ui`); resolvePlacement handles
  // both. Format validation runs on the derived package name below, not
  // on the raw input — slashes in the input are intentional path syntax.
  const FOUNDATION_KIND = { defaultDir: 'src', defaultPkg: 'src', projectSub: 'src' }
  const placement = resolvePlacement(rootDir, name, opts, FOUNDATION_KIND)
  const { relativePath } = placement
  let { packageName } = placement
  const fullPath = join(rootDir, relativePath)

  // Validate the derived package name (format + reserved-name check). The
  // auto-derived `src` default is grandfathered in (`src` IS reserved
  // but `src` is the convention for "the package that lives in src/").
  if (packageName !== 'src') {
    const valid = validatePackageName(packageName)
    if (valid !== true) {
      error(valid)
      process.exit(1)
    }
  }

  // Collision check 1: target folder already exists.
  if (existsSync(fullPath)) {
    error(`Cannot create foundation: ${colors.bright}${relativePath}/${colors.reset} already exists.`)
    log('')
    log(`Pick a different name, or pass --path to choose a different folder:`)
    log(`  ${colors.cyan}${getCliPrefix()} add foundation <name>${colors.reset}`)
    log(`  ${colors.cyan}${getCliPrefix()} add foundation <name> --path <parent-dir>${colors.reset}`)
    process.exit(1)
  }

  // Collision check 2: a package with the same name already exists somewhere
  // in the workspace.
  //
  // Cross-role collisions auto-resolve. If a *site* already owns this name,
  // suffix the foundation with `-src` (matching the `add project` and
  // `add extension` precedents). The site keeps its name; the foundation
  // gets a self-documenting suffix that says "this is the source code for
  // the site that owns this name." Same-role collisions stay an error —
  // two foundations with the same name is a real "be more specific"
  // situation, not a disambiguation case.
  if (existingNames.has(packageName)) {
    const sites = await discoverSites(rootDir)
    const isSiteCollision = sites.some(s => s.name === packageName)
    if (isSiteCollision) {
      const suffixed = `${packageName}-src`
      if (existingNames.has(suffixed)) {
        error(`Cannot create foundation: both ${colors.bright}${packageName}${colors.reset} and ${colors.bright}${suffixed}${colors.reset} are taken in this workspace.`)
        log(`Pick a different name:`)
        log(`  ${colors.cyan}${getCliPrefix()} add foundation <other-name>${colors.reset}`)
        process.exit(1)
      }
      info(`Package "${packageName}" is taken by a site; using "${suffixed}" for this foundation.`)
      packageName = suffixed
    } else {
      error(`Cannot create foundation: a foundation named ${colors.bright}${packageName}${colors.reset} already exists in this workspace.`)
      log(`Pick a different name:`)
      log(`  ${colors.cyan}${getCliPrefix()} add foundation <other-name>${colors.reset}`)
      process.exit(1)
    }
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

  // Register the package in pnpm-workspace.yaml — by exact path, not by glob.
  // No glob inference: if the user wants `foundations/*` they can edit the
  // workspace file themselves. This matches the "no assumptions" rule.
  await addWorkspaceGlob(rootDir, relativePath)

  // Update root scripts
  const sites = await discoverSites(rootDir)
  await updateRootScripts(rootDir, sites, pm)

  success(`Created foundation ${colors.bright}${packageName}${colors.reset} at ${relativePath}/`)
  log('')
  log(`Next: ${colors.cyan}${installCmd(pm)}${colors.reset}`)
}

/**
 * Add a site to the workspace
 */
async function addSite(rootDir, projectName, opts, pm = 'pnpm') {
  const name = opts.name
  const existingNames = await getExistingPackageNames(rootDir)

  // Resolve placement first (path + package name); see notes in addFoundation.
  const SITE_KIND = { defaultDir: 'site', defaultPkg: 'site', projectSub: 'site' }
  const placement = resolvePlacement(rootDir, name, opts, SITE_KIND)
  const { relativePath } = placement
  let siteName = placement.packageName
  const fullPath = join(rootDir, relativePath)

  // Validate the package name (skip for the auto-derived 'site' default).
  if (siteName !== 'site') {
    const valid = validatePackageName(siteName)
    if (valid !== true) {
      error(valid)
      process.exit(1)
    }
  }

  // Collision check 1: target folder exists.
  if (existsSync(fullPath)) {
    error(`Cannot create site: ${colors.bright}${relativePath}/${colors.reset} already exists.`)
    log('')
    log(`Pick a different name, or pass --path to choose a different folder:`)
    log(`  ${colors.cyan}${getCliPrefix()} add site <name>${colors.reset}`)
    log(`  ${colors.cyan}${getCliPrefix()} add site <name> --path <parent-dir>${colors.reset}`)
    process.exit(1)
  }

  // Collision check 2: cross-role collisions auto-resolve with `-site`
  // suffix; same-role collisions error. See the symmetric logic in
  // addFoundation for the rationale.
  if (existingNames.has(siteName)) {
    const foundations = await discoverFoundations(rootDir)
    const isFoundationCollision = foundations.some(f => f.name === siteName)
    if (isFoundationCollision) {
      const suffixed = `${siteName}-site`
      if (existingNames.has(suffixed)) {
        error(`Cannot create site: both ${colors.bright}${siteName}${colors.reset} and ${colors.bright}${suffixed}${colors.reset} are taken in this workspace.`)
        log(`Pick a different name:`)
        log(`  ${colors.cyan}${getCliPrefix()} add site <other-name>${colors.reset}`)
        process.exit(1)
      }
      info(`Package "${siteName}" is taken by a foundation; using "${suffixed}" for this site.`)
      siteName = suffixed
    } else {
      error(`Cannot create site: a site named ${colors.bright}${siteName}${colors.reset} already exists in this workspace.`)
      log(`Pick a different name:`)
      log(`  ${colors.cyan}${getCliPrefix()} add site <other-name>${colors.reset}`)
      process.exit(1)
    }
  }

  // Resolve foundation
  const foundation = await resolveFoundation(rootDir, opts.foundation)

  if (foundation) {
    // Compute relative path from site to foundation
    const foundationPath = computeFoundationPath(relativePath, foundation.path)

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
    log(`  ${colors.yellow}⚠ No foundation wired. Add one later with: uniweb add foundation${colors.reset}`)
  }

  // Apply template content if --from specified
  if (opts.from) {
    await applyFromTemplate(opts.from, 'site', fullPath, projectName)
  }

  // Register the package by exact path. No glob inference.
  await addWorkspaceGlob(rootDir, relativePath)

  // Update root scripts (discover sites after registration — includes the new one)
  const sites = await discoverSites(rootDir)
  if (!sites.find(s => s.path === relativePath)) {
    sites.push({ name: siteName, path: relativePath })
  }
  await updateRootScripts(rootDir, sites, pm)

  if (foundation) {
    success(`Created site ${colors.bright}${siteName}${colors.reset} at ${relativePath}/ → foundation '${foundation.name}'`)
  } else {
    success(`Created site ${colors.bright}${siteName}${colors.reset} at ${relativePath}/`)
  }
  log('')
  log(`Next: ${colors.cyan}${installCmd(pm)} && uniweb dev ${siteName}${colors.reset}`)
  if (!opts.from) {
    log('')
    log(`${colors.dim}To add your first page, create ${relativePath}/pages/home/page.yml and a .md file.${colors.reset}`)
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

  // Wire extension to site:
  //   - --site <name>: explicit, wire it.
  //   - exactly one site: silent auto-wire (intent is unambiguous).
  //   - multiple sites, interactive: single-select prompt (extensions are
  //     typically per-site specialization — pick which site).
  //   - multiple sites, non-interactive: don't wire silently. Print a
  //     warning so the user/agent knows wiring is pending, and exit 0
  //     (the extension itself is fine).
  //   - no sites: print a note and exit 0.
  let wiredSite = null
  let unwiredReason = null
  if (opts.site) {
    wiredSite = await wireExtensionToSite(rootDir, opts.site, name, target)
  } else {
    const sites = await discoverSites(rootDir)
    if (sites.length === 1) {
      wiredSite = await wireExtensionToSite(rootDir, sites[0].name, name, target)
    } else if (sites.length > 1) {
      if (isNonInteractive(process.argv)) {
        unwiredReason = `Multiple sites in workspace; extension not wired. Re-run with --site <name>, or edit <site>/site.yml::extensions: manually.`
      } else {
        const sortedSites = [...sites].sort((a, b) => a.name.localeCompare(b.name))
        const response = await prompts({
          type: 'select',
          name: 'site',
          message: 'Which site is this extension for?',
          choices: sortedSites.map(s => ({ title: s.name, description: s.path, value: s.name })),
        }, {
          onCancel: () => {
            log('\nCancelled.')
            process.exit(0)
          },
        })
        if (response.site) {
          wiredSite = await wireExtensionToSite(rootDir, response.site, name, target)
        }
      }
    } else {
      unwiredReason = `No site in this workspace yet. Wire this extension into a site's site.yml::extensions: once you create one.`
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
  if (unwiredReason) {
    log(`  ${colors.yellow}⚠ ${unwiredReason}${colors.reset}`)
  }
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

  // Compute package names. Co-located projects use the `-src` / `-site`
  // suffix convention so package names are unique within the workspace.
  // The folder structure inside the project is `src/` + `site/`, mirroring
  // the single-project default layout.
  const foundationPkgName = `${name}-src`
  const sitePkgName = `${name}-site`

  // Check package name collisions
  for (const pkgName of [foundationPkgName, sitePkgName]) {
    if (existingNames.has(pkgName)) {
      error(`Package name '${pkgName}' already exists in this workspace.`)
      process.exit(1)
    }
  }

  const progressCb = (msg) => info(`  ${msg}`)

  // Scaffold foundation (folder: src/, package name: <project>-src)
  info(`Creating foundation: ${foundationPkgName}...`)
  await scaffoldFoundation(join(projectDir, 'src'), {
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
    foundationPath: 'file:../src',
    foundationRef: foundationPkgName,
  }, { onProgress: progressCb })

  // Apply template content if --from specified
  if (opts.from) {
    await applyFromTemplate(opts.from, 'foundation', join(projectDir, 'src'), projectName)
    await applyFromTemplate(opts.from, 'site', join(projectDir, 'site'), projectName)
  }

  // Update workspace globs for co-located layout
  await addWorkspaceGlob(rootDir, '*/src')
  await addWorkspaceGlob(rootDir, '*/site')

  // Update root scripts
  const sites = await discoverSites(rootDir)
  if (!sites.find(s => s.path === `${name}/site`)) {
    sites.push({ name: sitePkgName, path: `${name}/site` })
  }
  await updateRootScripts(rootDir, sites, pm)

  success(`Created project '${name}' at ${name}/`)
  log(`  ${colors.dim}Foundation: ${name}/src/ (${foundationPkgName})${colors.reset}`)
  log(`  ${colors.dim}Site: ${name}/site/ (${sitePkgName})${colors.reset}`)
  log('')
  log(`Next: ${colors.cyan}${installCmd(pm)} && uniweb dev ${sitePkgName}${colors.reset}`)
}

/**
 * Resolve where a foundation or site should be placed, given the user's input.
 *
 * The rule: **the user names a folder, and we create exactly that folder.**
 * No silent nesting under `foundations/` / `sites/`, no inferring layout from
 * pre-existing globs. The framework doesn't require any particular folder
 * structure (the build classifies packages by their contents, not their
 * location), so the CLI shouldn't impose one.
 *
 * Resolution priority (foundation example, same shape for site):
 *
 *   1. `--path <dir>`                   → explicit folder. Name is the path's
 *                                          last segment (used as the package
 *                                          name unless `name` was also given).
 *   2. `name` contains `/`              → treat as a path (e.g., `foundations/ui`).
 *                                          Folder = the path, package name =
 *                                          the last segment.
 *   3. `name` (no slash)                → folder = `<name>/`, package name = `<name>`.
 *   4. `--project <project>`            → folder = `<project>/<defaultSub>` and
 *                                          package name = `<project>-<defaultSub>`
 *                                          (the co-located convention; only this
 *                                          one uses the `-src` / `-site` suffix).
 *   5. (no input)                       → folder = `<defaultDir>/`, package name
 *                                          = `<defaultPkg>` (`src/` + `src`
 *                                          for foundations; `site/` + `site` for
 *                                          sites).
 *
 * @param {string} rootDir
 * @param {string|null} name - Either a bare name or a path-with-slash.
 * @param {{ path?: string, project?: string }} opts
 * @param {{ defaultDir: string, defaultPkg: string, projectSub: string }} kind
 * @returns {{ relativePath: string, packageName: string }}
 */
function resolvePlacement(rootDir, name, opts, kind) {
  // 1. --path is a PARENT directory. The folder is `<path>/<name>` if a
  //    name was given, or `<path>` itself if not (the path's last segment
  //    is then taken as the package name).
  if (opts.path) {
    const parent = opts.path.replace(/\/+$/, '')
    if (name) {
      const last = name.split('/').filter(Boolean).pop()
      return {
        relativePath: `${parent}/${name}`.replace(/\/+/g, '/'),
        packageName: last,
      }
    }
    const lastSegment = parent.split('/').filter(Boolean).pop() || parent
    return {
      relativePath: parent,
      packageName: lastSegment,
    }
  }

  // 2. name contains a slash → treat as a path.
  if (name && name.includes('/')) {
    const relativePath = name.replace(/\/+$/, '')
    const lastSegment = relativePath.split('/').filter(Boolean).pop()
    return {
      relativePath,
      packageName: lastSegment,
    }
  }

  // 3. Bare name.
  if (name) {
    return {
      relativePath: name,
      packageName: name,
    }
  }

  // 4. --project (co-located convention with -src / -site suffix).
  if (opts.project) {
    return {
      relativePath: `${opts.project}/${kind.projectSub}`,
      packageName: `${opts.project}-${kind.projectSub}`,
    }
  }

  // 5. Default placement.
  return {
    relativePath: kind.defaultDir,
    packageName: kind.defaultPkg,
  }
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
    const match = metadata.contentDirs.find(d => d.type === packageType) ||
                  metadata.contentDirs.find(d => d.name === packageType)
    const contentDir = match ? match.dir : null

    if (contentDir) {
      info(`Applying ${metadata.name} content...`)
      await applyContent(contentDir, targetDir, {
        projectName,
        versions: getVersionsForTemplates(),
      }, {
        onProgress: (msg) => info(`  ${msg}`),
        renames: match.renames,
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
    const extensionUrl = `/${extensionPath}/dist/entry.js`
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

  // Resolve sections directory — source root comes from package.json::main
  // (works for both nested `src/` layouts and flat layouts).
  const foundationDir = join(rootDir, foundation.path)
  const foundationSrc = resolveFoundationSrcPath(foundationDir)
  const sectionsDir = join(foundationSrc, 'sections')
  const sectionDir = join(sectionsDir, name)
  const relSectionPath = relative(foundationDir, sectionDir)

  if (existsSync(sectionDir)) {
    error(`Section '${name}' already exists at ${foundation.path}/${relSectionPath}/`)
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

  success(`Created section '${name}' at ${foundation.path}/${relSectionPath}/`)
  log(`  ${colors.dim}index.jsx${colors.reset}  — component (customize the JSX)`)
  log(`  ${colors.dim}meta.js${colors.reset}    — metadata (add content expectations, params, presets)`)
  if (foundations.length === 1) {
    log('')
    log(`${colors.dim}The dev server will pick it up automatically.${colors.reset}`)
  }
}

/**
 * Add a CI deploy workflow for a host adapter.
 *
 * Wires through the host-adapter registry: each adapter optionally
 * exports `initCi({ rootDir, site, packageManager, nodeVersion })`
 * returning `{ files, postInstructions }`. The CLI handles file writes,
 * --force overwrite, and consistent output. Today only github-pages
 * implements initCi; the registry's other adapters (cloudflare-pages,
 * vercel, s3-cloudfront, generic-static) error out with a clear message
 * and can plug in later.
 */
async function addCi(rootDir, opts, pm = 'pnpm') {
  // Lazy-load the host registry so the CLI doesn't pay this import on
  // every add invocation.
  let getAdapter
  try {
    ({ getAdapter } = await import('@uniweb/build/hosts'))
  } catch {
    error('Failed to load host adapter registry from @uniweb/build/hosts.')
    process.exit(1)
  }

  // Resolve host. With one CI-capable adapter today (github-pages),
  // default silently when --host isn't passed. If more adapters add
  // initCi later, this becomes a picker.
  const host = opts.host || 'github-pages'

  let adapter
  try {
    adapter = getAdapter(host)
  } catch (err) {
    error(err.message)
    process.exit(1)
  }

  if (typeof adapter.initCi !== 'function') {
    error(`Host '${host}' does not provide a CI workflow yet.`)
    log(`Currently supported: github-pages.`)
    log(`Other hosts may use platform-side integrations (e.g., Vercel/Netlify connect via dashboard).`)
    process.exit(1)
  }

  // Validate --domain (lightweight: must look like a hostname). The
  // adapter decides what to do with it; today only github-pages uses
  // it (writes a CNAME, switches UNIWEB_BASE to root).
  if (opts.domain && !isLikelyDomain(opts.domain)) {
    error(`Invalid --domain value: '${opts.domain}'`)
    log(`Expected a bare hostname (e.g., 'mysite.com' or 'docs.mysite.com'). No scheme, no path.`)
    process.exit(1)
  }

  // If --domain wasn't passed, fall back to whatever's already in
  // deploy.yml's targets.<host>.domain. Lets re-running `add ci` (e.g.,
  // to refresh the workflow after a CLI upgrade) keep the domain
  // without the user re-typing it.
  const { loadDeployYml } = await import('@uniweb/build/site')
  let resolvedDomain = opts.domain

  // Resolve site: --site flag, single site auto, prompt, or error.
  const sites = await discoverSites(rootDir)
  if (sites.length === 0) {
    error('No site found in this workspace. Add one with `uniweb add site` first.')
    process.exit(1)
  }

  let site
  if (opts.site) {
    site = sites.find(s => s.name === opts.site)
    if (!site) {
      error(`Site '${opts.site}' not found.`)
      log(`Available sites: ${sites.map(s => s.name).join(', ')}`)
      process.exit(1)
    }
  } else if (sites.length === 1) {
    site = sites[0]
  } else if (isNonInteractive(process.argv)) {
    error(`Multiple sites in workspace. Specify --site <name>.`)
    log(`Available sites: ${sites.map(s => s.name).join(', ')}`)
    process.exit(1)
  } else {
    const sortedSites = [...sites].sort((a, b) => a.name.localeCompare(b.name))
    const response = await prompts({
      type: 'select',
      name: 'site',
      message: 'Which site should the workflow build?',
      choices: sortedSites.map(s => ({ title: s.name, description: s.path, value: s })),
    }, {
      onCancel: () => {
        log('\nCancelled.')
        process.exit(0)
      },
    })
    site = response.site
  }

  // Read node version from root package.json engines.node if pinned;
  // otherwise default to 20 (matches the workspace template's >=20.19).
  const rootPkg = JSON.parse(
    await readFile(join(rootDir, 'package.json'), 'utf-8').catch(() => '{}')
  )
  const nodeVersion = parseNodeMajor(rootPkg.engines?.node) || '20'

  const siteDir = join(rootDir, site.path)
  if (!resolvedDomain) {
    try {
      const deployYml = await loadDeployYml(siteDir)
      const remembered = deployYml?.targets?.[host]?.domain
      if (remembered && isLikelyDomain(remembered)) {
        resolvedDomain = remembered
        info(`Using domain '${remembered}' from deploy.yml.`)
      }
    } catch {
      // Malformed deploy.yml — surface elsewhere; don't block add ci.
    }
  }

  const result = await adapter.initCi({
    rootDir,
    site,
    packageManager: pm,
    nodeVersion,
    domain: resolvedDomain,
  })

  // Write files. Refuse to overwrite without --force so re-running
  // doesn't silently clobber edits the user made to the workflow.
  for (const file of result.files) {
    const fullPath = join(rootDir, file.path)
    if (existsSync(fullPath) && !opts.force) {
      error(`File already exists: ${file.path}`)
      log(`Re-run with --force to overwrite.`)
      process.exit(1)
    }
    await mkdir(join(fullPath, '..'), { recursive: true })
    await writeFile(fullPath, file.content)
    success(`Wrote ${file.path}`)
  }

  // Persist the adapter's target config into deploy.yml so the user's
  // intent (host + adapter-specific fields like `domain`) is remembered
  // across CLI upgrades and re-runs. github-pages deploys via GHA, not
  // via `uniweb deploy`, so without this its config would never reach
  // deploy.yml. The writer:
  //   - scaffolds a fresh deploy.yml on first call (this target is the
  //     default), or
  //   - merges into an existing targets.<targetName> without touching
  //     `default`, `autoSave`, or other targets.
  if (result.targetConfig) {
    try {
      const { recordTarget } = await import('@uniweb/build/site')
      const writeResult = await recordTarget(siteDir, {
        targetName: host,
        targetConfig: result.targetConfig,
      })
      success(
        writeResult.action === 'scaffold'
          ? `Wrote ${relative(rootDir, writeResult.path)} (default target: ${host})`
          : `Updated ${relative(rootDir, writeResult.path)} (target: ${host})`
      )
    } catch (err) {
      // deploy.yml persistence is best-effort: the workflow + CNAME
      // are the load-bearing artifacts. Print a warning and continue.
      info(`Warning: could not update deploy.yml: ${err.message}`)
    }
  }

  if (result.postInstructions?.length) {
    log('')
    log(`${colors.bright}Next steps:${colors.reset}`)
    for (const line of result.postInstructions) {
      log(line ? `  ${line}` : '')
    }
  }
}

function isLikelyDomain(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253) return false
  // Reject schemes, paths, ports, whitespace, leading/trailing dots/hyphens.
  // Each label is 1–63 chars of [a-z0-9-], no leading/trailing hyphen.
  // The TLD must be at least 2 characters of letters.
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value)
}

function parseNodeMajor(engines) {
  if (!engines) return null
  const match = String(engines).match(/(\d+)/)
  return match ? match[1] : null
}

/**
 * Show help for the add command
 */
function showAddHelp() {
  log(`
${colors.cyan}${colors.bright}Uniweb Add${colors.reset}

Add projects, foundations, sites, extensions, section types, or CI workflows to your workspace.

${colors.bright}Usage:${colors.reset}
  uniweb add project [name] [options]
  uniweb add foundation [name] [options]
  uniweb add site [name] [options]
  uniweb add extension <name> [options]
  uniweb add section <name> [options]
  uniweb add ci [options]

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

${colors.bright}CI Options:${colors.reset}
  --host <name>      Host adapter (default: github-pages)
  --site <name>      Site the workflow builds (prompted if multiple exist)
  --domain <host>    Custom domain (writes CNAME, serves at root)
  --force            Overwrite an existing workflow file

${colors.bright}Examples:${colors.reset}
  uniweb add project docs                              # Create docs/foundation/ + docs/site/
  uniweb add project docs --from academic              # Co-located pair + academic content
  uniweb add foundation                                # Create ./foundation/ at root
  uniweb add foundation ui                             # Create ./foundations/ui/
  uniweb add site                                      # Create ./site/ at root
  uniweb add site blog --foundation marketing          # Create ./sites/blog/ wired to marketing
  uniweb add extension effects --site site             # Create ./extensions/effects/
  uniweb add section Hero                              # Create Hero section type
  uniweb add section Hero --foundation ui              # Target specific foundation
  uniweb add foundation --project docs                 # Create ./docs/foundation/ (co-located)
  uniweb add site --project docs                       # Create ./docs/site/ (co-located)
  uniweb add ci                                        # Add GitHub Pages deploy workflow
  uniweb add ci --host github-pages --site marketing   # Pick host + site explicitly
  uniweb add ci --domain mysite.com                    # Custom domain → writes CNAME + UNIWEB_BASE=/
`)
}
