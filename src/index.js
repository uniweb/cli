#!/usr/bin/env node

/**
 * Uniweb CLI
 *
 * Scaffolds new Uniweb sites and foundations, builds projects, and generates docs.
 *
 * Install globally:
 *   npm i -g uniweb
 *
 * Usage:
 *   uniweb create [project-name]
 *   uniweb create --template marketing
 *   uniweb add foundation [name]
 *   uniweb build
 *   uniweb docs
 *
 * Global install delegation:
 *   When installed globally, project-bound commands (build, docs, etc.) are
 *   delegated to the project-local CLI if one exists in node_modules. This
 *   ensures version alignment between the CLI and @uniweb/build.
 */

import { existsSync, readFileSync } from 'node:fs'
import { execSync, spawn as spawnChild } from 'node:child_process'
import { resolve, join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import prompts from 'prompts'
// `doctor`, `add`, `publish`, and `deploy` are loaded lazily via
// importProjectCommand() — each imports `@uniweb/build` at the top,
// so a static import here would crash `npx uniweb@latest create …`
// (no @uniweb/build in the npx scratch dir) before any command runs.
// Same pattern as `build` and `docs`.
import { i18n } from './commands/i18n.js'
import { inspect } from './commands/inspect.js'
import { login } from './commands/login.js'
import { invite } from './commands/invite.js'
import { handoff } from './commands/handoff.js'
import { update } from './commands/update.js'
import { template } from './commands/template.js'
import {
  resolveTemplate,
  parseTemplateId,
} from './templates/index.js'
import { validateTemplate } from './templates/validator.js'
import { scaffoldWorkspace, scaffoldFoundation, scaffoldSite, applyContent, applyStarter, mergeTemplateDependencies } from './utils/scaffold.js'
import { detectPackageManager, filterCmd, installCmd, runCmd } from './utils/pm.js'
import { isNonInteractive, getCliPrefix, stripNonInteractiveFlag, formatOptions } from './utils/interactive.js'
import { findWorkspaceRoot } from './utils/workspace.js'

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

// Template choices for interactive prompt
const TEMPLATE_CHOICES = [
  { title: 'None', value: 'none', description: 'Foundation + site with no content' },
  { title: 'Starter', value: 'starter', description: 'Foundation + site + sample content' },
  { title: 'Marketing', value: 'marketing', description: 'Landing page, features, pricing, testimonials' },
  { title: 'Docs', value: 'docs', description: 'Documentation with sidebar and search' },
  { title: 'Academic', value: 'academic', description: 'Research site with publications and team' },
  { title: 'Dynamic', value: 'dynamic', description: 'Live API data fetching with loading states' },
  { title: 'International', value: 'international', description: 'Multilingual site with i18n and blog' },
  { title: 'Store', value: 'store', description: 'E-commerce with product grid' },
  { title: 'Extensions', value: 'extensions', description: 'Multi-foundation with visual effects extension' },
  { title: 'Blank workspace', value: 'blank', description: 'Empty workspace — grow with uniweb add' },
]

function log(message) {
  console.log(message)
}

function success(message) {
  console.log(`${colors.green}✓${colors.reset} ${message}`)
}

function error(message) {
  console.error(`${colors.red}✗${colors.reset} ${message}`)
}

function title(message) {
  console.log(`\n${colors.cyan}${colors.bright}${message}${colors.reset}\n`)
}

// CLI version (read once, lazily)
const __dirname = dirname(fileURLToPath(import.meta.url))
let _cliVersion = null
function getCliVersion() {
  if (!_cliVersion) {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
    _cliVersion = pkg.version
  }
  return _cliVersion
}

/**
 * Commands that always run from the global CLI (no project context needed)
 */
const STANDALONE_COMMANDS = new Set([
  'create', '--help', '-h', '--version', '-v', 'login',
])

/**
 * Check if this CLI is running from a global install.
 * When installed globally, process.argv[1] points outside any node_modules.
 * When run via npx or as a local dependency, it's inside node_modules.
 */
function isGlobalInstall() {
  const scriptPath = process.argv[1]
  if (!scriptPath) return false
  // Normalize path separators for Windows compatibility
  return !scriptPath.split('/').includes('node_modules') &&
         !scriptPath.split('\\').includes('node_modules')
}

/**
 * Find the project-local CLI entry point, if one exists.
 * Walks up from cwd looking for node_modules/uniweb/src/index.js.
 */
function findLocalCli() {
  let dir = process.cwd()
  while (true) {
    const localCli = join(dir, 'node_modules', 'uniweb', 'src', 'index.js')
    if (existsSync(localCli)) return localCli
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Delegate execution to the project-local CLI.
 * Spawns the local CLI with the same arguments and inherits stdio.
 * Warns if the local version differs from the global version.
 */
function delegateToLocal(localCliPath) {
  // Check for version mismatch between global and local CLI
  try {
    const localPkgPath = join(dirname(localCliPath), '..', 'package.json')
    const localPkg = JSON.parse(readFileSync(localPkgPath, 'utf8'))
    const globalVersion = getCliVersion()
    if (localPkg.version && localPkg.version !== globalVersion) {
      const yellow = '\x1b[33m'
      const dim = '\x1b[2m'
      const reset = '\x1b[0m'
      console.error(`${yellow}Note:${reset} Global CLI is ${dim}${globalVersion}${reset}, project has ${dim}${localPkg.version}${reset} ${dim}(using project version)${reset}`)
    }
  } catch { /* ignore — version check is best-effort */ }

  return new Promise((resolve, reject) => {
    const child = spawnChild(
      process.execPath,
      [localCliPath, ...process.argv.slice(2)],
      { stdio: 'inherit' }
    )
    child.on('close', (code) => process.exit(code ?? 0))
    child.on('error', reject)
  })
}

/**
 * Import a command module that may depend on @uniweb/build.
 * Provides a helpful error when the dependency can't be resolved
 * (e.g., running a project-bound command from a global install
 * outside a project directory).
 */
async function importProjectCommand(modulePath) {
  try {
    return await import(modulePath)
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && err.message?.includes('@uniweb/')) {
      error('This command must be run from inside a Uniweb project.')
      log('')
      log(`Make sure you're in a project directory with dependencies installed:`)
      log(`  ${colors.cyan}cd your-project${colors.reset}`)
      log(`  ${colors.cyan}npm install${colors.reset}`)
      log('')
      log(`Or create a new project:`)
      log(`  ${colors.cyan}uniweb create my-project${colors.reset}`)
      process.exit(1)
    }
    throw err
  }
}

/**
 * Create a project using the new package template flow (default)
 */
async function createFromPackageTemplates(projectDir, projectName, options = {}) {
  const { onProgress, onWarning, pm = 'pnpm', includeStarter = true } = options

  onProgress?.('Setting up workspace...')

  // 1. Scaffold workspace
  await scaffoldWorkspace(projectDir, {
    projectName,
    workspaceGlobs: ['site', 'src'],
    scripts: {
      dev: filterCmd(pm, 'site', 'dev'),
      build: 'uniweb build',
      preview: filterCmd(pm, 'site', 'preview'),
    },
  }, { onProgress, onWarning })

  // 2. Scaffold foundation (folder: src/, package name: src)
  // The folder name 'src' carries the meaning — a foundation is the site's
  // source code. The package name 'src' keeps it unique within the
  // workspace, since 'site' is taken by the site package.
  onProgress?.('Creating foundation...')
  await scaffoldFoundation(join(projectDir, 'src'), {
    name: 'src',
    projectName,
    isExtension: false,
  }, { onProgress, onWarning })

  // 3. Scaffold site
  onProgress?.('Creating site...')
  await scaffoldSite(join(projectDir, 'site'), {
    name: 'site',
    projectName,
    foundationName: 'src',
    foundationPath: 'file:../src',
    foundationRef: 'src',
  }, { onProgress, onWarning })

  // 4. Apply starter content (unless creating a "none" project)
  if (includeStarter) {
    onProgress?.('Adding starter content...')
    await applyStarter(projectDir, { projectName }, { onProgress, onWarning })
  }

  success(`Created project: ${projectName}`)
}

/**
 * Create a blank workspace (no packages, grow with `add`)
 */
async function createBlankWorkspace(projectDir, projectName, options = {}) {
  const { onProgress, onWarning } = options

  onProgress?.('Setting up blank workspace...')

  await scaffoldWorkspace(projectDir, {
    projectName,
    workspaceGlobs: [],
    scripts: {
      build: 'uniweb build',
    },
  }, { onProgress, onWarning })

  success(`Created blank workspace: ${projectName}`)
}

/**
 * Create a project from a format 2 content template
 *
 * Scaffolds workspace structure from package templates, then overlays
 * content (sections, pages, theme) from the content template.
 */
async function createFromContentTemplate(projectDir, projectName, metadata, templateRootPath, options = {}) {
  const { onProgress, onWarning, pm = 'pnpm' } = options

  // Determine packages to create
  // Default single-foundation single-site project uses package names
  // 'src' (folder: src/) and 'site' (folder: site/). The folder
  // convention is set in computePlacement() below.
  const packages = metadata.packages || [
    { type: 'foundation', name: 'src' },
    { type: 'site', name: 'site', foundation: 'src' },
  ]

  // Compute placement for each package
  const placed = computePlacement(packages)

  // Compute workspace globs and scripts from placement
  const workspaceGlobs = placed.map(p => p.relativePath)
  const sites = placed.filter(p => p.type === 'site')
  const scripts = {
    build: 'uniweb build',
  }
  if (sites.length === 1) {
    scripts.dev = filterCmd(pm, sites[0].name, 'dev')
    scripts.preview = filterCmd(pm, sites[0].name, 'preview')
  } else {
    for (const s of sites) {
      scripts[`dev:${s.name}`] = filterCmd(pm, s.name, 'dev')
      scripts[`preview:${s.name}`] = filterCmd(pm, s.name, 'preview')
    }
    // First site gets unqualified aliases
    if (sites.length > 0) {
      scripts.dev = filterCmd(pm, sites[0].name, 'dev')
      scripts.preview = filterCmd(pm, sites[0].name, 'preview')
    }
  }

  // 1. Scaffold workspace
  onProgress?.('Setting up workspace...')
  await scaffoldWorkspace(projectDir, {
    projectName,
    workspaceGlobs,
    scripts,
  }, { onProgress, onWarning })

  // 2. Scaffold and apply content for each package
  for (const pkg of placed) {
    const fullPath = join(projectDir, pkg.relativePath)

    if (pkg.type === 'foundation' || pkg.type === 'extension') {
      onProgress?.(`Creating ${pkg.type}: ${pkg.name}...`)
      await scaffoldFoundation(fullPath, {
        name: pkg.name,
        projectName,
        isExtension: pkg.type === 'extension',
      }, { onProgress, onWarning })
    } else if (pkg.type === 'site') {
      // Find the foundation this site wires to
      const foundationName = pkg.foundation || 'src'
      const foundationPkg = placed.find(p =>
        (p.type === 'foundation') && (p.name === foundationName)
      )
      const foundationPath = foundationPkg
        ? computeFoundationFilePath(pkg.relativePath, foundationPkg.relativePath)
        : 'file:../src'

      onProgress?.(`Creating site: ${pkg.name}...`)
      // Always write `foundation: <name>` to site.yml — the value is
      // never the implicit default in the new layout (the build's
      // `detectFoundationType` defaults to 'foundation' when absent,
      // which doesn't match 'src').
      await scaffoldSite(fullPath, {
        name: pkg.name,
        projectName,
        foundationName,
        foundationPath,
        foundationRef: foundationName,
      }, { onProgress, onWarning })
    }

    // Apply content from the matching content directory
    const contentDir = findContentDirFor(metadata.contentDirs, pkg)
    if (contentDir) {
      onProgress?.(`Applying ${metadata.name} content to ${pkg.name}...`)
      await applyContent(contentDir.dir, fullPath, { projectName }, {
        onProgress,
        onWarning,
        renames: contentDir.renames,
      })
    }

    // Merge template dependencies into package.json
    if (metadata.dependencies) {
      const deps = metadata.dependencies[pkg.name] || metadata.dependencies[pkg.type]
      if (deps) {
        await mergeTemplateDependencies(join(fullPath, 'package.json'), deps)
      }
    }
  }

  success(`Created project: ${projectName}`)
}

/**
 * Compute placement (relative paths) for packages
 *
 * Rules:
 * - 1 foundation → src/             (folder name is 'src' regardless of package name;
 *                                    the package name is typically 'src' or
 *                                    whatever the template declared)
 * - Multiple foundations → foundations/{name}/
 * - Extensions → extensions/{name}/
 * - 1 site named "site" → site/
 * - Multiple sites → sites/{name}/
 */
function computePlacement(packages) {
  const foundations = packages.filter(p => p.type === 'foundation')
  const extensions = packages.filter(p => p.type === 'extension')
  const sites = packages.filter(p => p.type === 'site')

  const placed = []

  for (const f of foundations) {
    if (foundations.length === 1) {
      placed.push({ ...f, relativePath: 'src' })
    } else {
      placed.push({ ...f, relativePath: `foundations/${f.name}` })
    }
  }

  for (const e of extensions) {
    placed.push({ ...e, relativePath: `extensions/${e.name}` })
  }

  for (const s of sites) {
    if (sites.length === 1 && s.name === 'site') {
      placed.push({ ...s, relativePath: 'site' })
    } else {
      placed.push({ ...s, relativePath: `sites/${s.name}` })
    }
  }

  return placed
}

/**
 * Find the content directory that matches a placed package
 */
function findContentDirFor(contentDirs, pkg) {
  if (!contentDirs) return null
  // Match by name first, then by type
  return contentDirs.find(d => d.name === pkg.name) ||
         contentDirs.find(d => d.type === pkg.type && d.name === pkg.type)
}

/**
 * Compute relative file: path from site to foundation
 */
function computeFoundationFilePath(sitePath, foundationPath) {
  const rel = relative(sitePath, foundationPath)
  return `file:${rel}`
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const nonInteractive = isNonInteractive(rawArgs)
  const args = stripNonInteractiveFlag(rawArgs)
  const command = args[0]
  const pm = detectPackageManager()

  // Handle --version / -v
  if (command === '--version' || command === '-v') {
    console.log(`uniweb ${getCliVersion()}`)
    return
  }

  // Global install launcher: delegate project-bound commands to local CLI
  const global = isGlobalInstall()
  if (global && command && !STANDALONE_COMMANDS.has(command)) {
    const localCli = findLocalCli()
    if (localCli) {
      await delegateToLocal(localCli)
      return
    }
    // No local CLI found — fall through and try to run the command directly.
    // Commands that need @uniweb/build will get a helpful error via importProjectCommand().
  }

  // Start non-blocking update check for global installs
  let showUpdateNotification = () => {}
  if (global) {
    try {
      const { startUpdateCheck } = await import('./utils/update-check.js')
      showUpdateNotification = startUpdateCheck(getCliVersion())
    } catch {
      // Update check is optional — don't fail if the module is missing
    }
  }

  // Show help
  if (!command || command === '--help' || command === '-h') {
    showHelp()
    await showUpdateNotification()
    return
  }

  // Per-command --help: short-circuit BEFORE the command's side effects run.
  // Critical for `deploy --help` (used to open a browser to production for
  // login because deploy.js doesn't parse --help and ensureAuth ran first).
  // Falls back to the global help when a command has no dedicated block.
  if (args.slice(1).some(a => a === '--help' || a === '-h')) {
    const printed = printCommandHelp(command)
    if (printed) {
      await showUpdateNotification()
      return
    }
    // No dedicated block — show global help as a useful fallback rather
    // than executing the command (which often has side effects).
    showHelp()
    await showUpdateNotification()
    return
  }

  // Handle build command (dynamic import — depends on @uniweb/build)
  if (command === 'build') {
    const { build } = await importProjectCommand('./commands/build.js')
    await build(args.slice(1))
    await showUpdateNotification()
    return
  }

  // Handle dev command — thin wrapper that shells to the package manager's
  // workspace-filtered `dev` script (mirrors what `uniweb create` writes
  // into the root package.json::scripts.dev). Lazy import keeps startup
  // fast when the user is not running dev.
  if (command === 'dev') {
    const { dev } = await import('./commands/dev.js')
    await dev(args.slice(1))
    return
  }

  // Handle docs command (dynamic import — depends on @uniweb/build)
  if (command === 'docs') {
    const { docs } = await importProjectCommand('./commands/docs.js')
    await docs(args.slice(1))
    await showUpdateNotification()
    return
  }

  // Handle i18n command
  if (command === 'i18n') {
    await i18n(args.slice(1))
    return
  }

  // Handle doctor command (dynamic import — depends on @uniweb/build)
  if (command === 'doctor') {
    const { doctor } = await importProjectCommand('./commands/doctor.js')
    const result = await doctor(args.slice(1))
    process.exit(result?.errors > 0 ? 1 : 0)
  }

  // Handle update command
  if (command === 'update') {
    await update(args.slice(1))
    return
  }

  // Handle inspect command
  if (command === 'inspect') {
    await inspect(args.slice(1))
    return
  }

  // Handle add command (dynamic import — depends on @uniweb/build)
  if (command === 'add') {
    const { add } = await importProjectCommand('./commands/add.js')
    await add(args.slice(1))
    return
  }

  // Handle rename command (dynamic import — depends on @uniweb/build via deps)
  if (command === 'rename') {
    const { rename } = await importProjectCommand('./commands/rename.js')
    await rename(args.slice(1))
    return
  }

  // Handle publish command (dynamic import — depends on @uniweb/build)
  if (command === 'publish') {
    const { publish } = await importProjectCommand('./commands/publish.js')
    await publish(args.slice(1))
    return
  }

  // Handle deploy command (dynamic import — depends on @uniweb/build)
  if (command === 'deploy') {
    const { deploy } = await importProjectCommand('./commands/deploy.js')
    await deploy(args.slice(1))
    return
  }

  // Handle export command (dynamic import — depends on @uniweb/build)
  if (command === 'export') {
    const { exportSite } = await importProjectCommand('./commands/export.js')
    await exportSite(args.slice(1))
    return
  }

  // Handle login command
  if (command === 'login') {
    await login(args.slice(1))
    return
  }

  // Handle invite command
  if (command === 'invite') {
    await invite(args.slice(1))
    return
  }

  // Handle handoff command
  if (command === 'handoff') {
    await handoff(args.slice(1))
    return
  }

  // Handle template command
  if (command === 'template') {
    await template(args.slice(1))
    return
  }

  // Handle create command
  if (command !== 'create') {
    error(`Unknown command: ${command}`)
    showHelp()
    process.exit(1)
  }

  title('Uniweb Project Generator')

  // Guard: prevent creating nested workspaces
  const existingRoot = findWorkspaceRoot(process.cwd())
  if (existingRoot) {
    error(`Already inside a Uniweb workspace: ${existingRoot}`)
    log(`\nTo add packages to this workspace, use:`)
    log(`  ${colors.cyan}uniweb add foundation [name]${colors.reset}`)
    log(`  ${colors.cyan}uniweb add site [name]${colors.reset}`)
    log(`  ${colors.cyan}uniweb add foundation --from <template>${colors.reset}\n`)
    process.exit(1)
  }

  // Parse arguments
  let projectName = args[1]
  let templateType = null  // null = use new package template flow

  // Check for --template flag
  const templateIndex = args.indexOf('--template')
  if (templateIndex !== -1 && args[templateIndex + 1]) {
    templateType = args[templateIndex + 1]
    // Validate template identifier (will throw if invalid)
    try {
      parseTemplateId(templateType)
    } catch (err) {
      error(`Invalid template: ${err.message}`)
      process.exit(1)
    }
  }

  // Check for --name flag (used for project display name)
  let displayName = null
  const nameIndex = args.indexOf('--name')
  if (nameIndex !== -1 && args[nameIndex + 1]) {
    displayName = args[nameIndex + 1]
  }

  // Check for --blank flag
  let isBlank = args.includes('--blank')

  // Handle --template blank as alias for --blank
  if (templateType === 'blank') {
    isBlank = true
    templateType = null
  }

  // Check for --no-git flag
  const noGit = args.includes('--no-git')

  // Skip positional name if it starts with -- (it's a flag, not a name)
  if (projectName && projectName.startsWith('--')) {
    projectName = null
  }

  const prefix = getCliPrefix()

  // Non-interactive: fail with actionable message instead of prompting
  if (nonInteractive && !projectName) {
    error(`Missing project name.\n`)
    log(`Usage: ${prefix} create <project-name> [--template <name>] [--blank]`)
    process.exit(1)
  }

  // Non-interactive: default to starter when no template specified
  if (nonInteractive && !templateType && !isBlank) {
    templateType = 'starter'
  }

  // Interactive prompts
  const response = await prompts([
    {
      type: projectName ? null : 'text',
      name: 'projectName',
      message: 'Project name:',
      initial: 'website',
      validate: (value) => {
        if (!value) return 'Project name is required'
        if (!/^[a-z0-9-]+$/.test(value)) {
          return 'Project name can only contain lowercase letters, numbers, and hyphens'
        }
        return true
      },
    },
  ], {
    onCancel: () => {
      log('\nScaffolding cancelled.')
      process.exit(0)
    },
  })

  projectName = projectName || response.projectName

  if (!projectName) {
    error('Missing project name')
    process.exit(1)
  }

  // Prompt for template if not specified via --template or --blank
  if (!templateType && !isBlank) {
    const templateResponse = await prompts({
      type: 'select',
      name: 'template',
      message: 'Template:',
      choices: TEMPLATE_CHOICES,
      initial: 1,
    }, {
      onCancel: () => {
        log('\nScaffolding cancelled.')
        process.exit(0)
      },
    })
    templateType = templateResponse.template
    // Handle "blank" selection from interactive prompt
    if (templateType === 'blank') {
      isBlank = true
      templateType = null
    }
  }

  const effectiveName = displayName || projectName

  // Create project directory
  const projectDir = resolve(process.cwd(), projectName)

  if (existsSync(projectDir)) {
    error(`Directory already exists: ${projectName}`)
    process.exit(1)
  }

  // Template routing logic
  const progressCb = (msg) => log(`  ${colors.dim}${msg}${colors.reset}`)
  const warningCb = (msg) => log(`  ${colors.yellow}Warning: ${msg}${colors.reset}`)

  if (isBlank) {
    // Blank workspace (--blank or --template blank)
    log('\nCreating blank workspace...')
    await createBlankWorkspace(projectDir, effectiveName, {
      onProgress: progressCb,
      onWarning: warningCb,
    })
  } else if (templateType === 'none') {
    // Foundation + site with no content
    log('\nCreating project...')
    await createFromPackageTemplates(projectDir, effectiveName, {
      onProgress: progressCb,
      onWarning: warningCb,
      pm,
      includeStarter: false,
    })
  } else if (templateType === 'starter') {
    // Starter: foundation + site + sample content
    log('\nCreating project...')
    await createFromPackageTemplates(projectDir, effectiveName, {
      onProgress: progressCb,
      onWarning: warningCb,
      pm,
    })
  } else {
    // External: official/npm/github/local
    log(`\nResolving template: ${templateType}...`)

    try {
      const resolved = await resolveTemplate(templateType, {
        onProgress: progressCb,
      })

      log(`\nCreating project from ${resolved.name || resolved.package || `${resolved.owner}/${resolved.repo}`}...`)

      // Validate and apply as format 2 content template
      const metadata = await validateTemplate(resolved.path, {})

      try {
        await createFromContentTemplate(projectDir, effectiveName, metadata, resolved.path, {
          onProgress: progressCb,
          onWarning: warningCb,
          pm,
        })
      } finally {
        if (resolved.cleanup) await resolved.cleanup()
      }
    } catch (err) {
      error(`Failed to apply template: ${err.message}`)
      log('')
      log(`${colors.yellow}Troubleshooting:${colors.reset}`)
      log(`  • Check your network connection`)
      log(`  • Official templates require GitHub access (may be blocked by corporate networks)`)
      log(`  • Try the starter template instead: ${colors.cyan}uniweb create ${projectName} --template starter${colors.reset}`)
      process.exit(1)
    }
  }

  // Initialize git repository
  if (!noGit) {
    // Skip git init if already inside a git repo (common for monorepos/workspaces)
    let insideGitRepo = false
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: projectDir, stdio: 'ignore' })
      insideGitRepo = true
    } catch {
      // Not inside a git repo — proceed with init
    }

    if (insideGitRepo) {
      log(`  ${colors.dim}Skipping git init — already inside a git repository${colors.reset}`)
    } else {
      try {
        execSync('git --version', { stdio: 'ignore' })
        try {
          execSync('git init', { cwd: projectDir, stdio: 'ignore' })
          execSync('git add -A', { cwd: projectDir, stdio: 'ignore' })
          execSync('git commit -m "Initial commit from uniweb"', { cwd: projectDir, stdio: 'ignore' })
          success('Git repository initialized')
        } catch {
          log(`  ${colors.yellow}Warning: Git repository initialized but initial commit failed${colors.reset}`)
          log(`  ${colors.dim}Run 'git commit -m "Initial commit"' after configuring git${colors.reset}`)
        }
      } catch {
        // git not available — skip silently
      }
    }
  }

  // Success message
  title('Project created successfully!')

  if (isBlank) {
    log(`Next steps:\n`)
    log(`  ${colors.cyan}cd ${projectName}${colors.reset}`)
    log(`  ${colors.cyan}${prefix} add project${colors.reset}`)
    log(`  ${colors.cyan}${installCmd(pm)}${colors.reset}`)
    log(`  ${colors.cyan}${prefix} dev${colors.reset}                       ${colors.dim}# Start dev server${colors.reset}`)
  } else {
    log(`Next steps:\n`)
    log(`  ${colors.cyan}cd ${projectName}${colors.reset}`)
    log(`  ${colors.cyan}${installCmd(pm)}${colors.reset}`)
    log(`  ${colors.cyan}${prefix} dev${colors.reset}                       ${colors.dim}# Start dev server${colors.reset}`)
  }
  log('')
  log(`When ready to ship:\n`)
  log(`  ${colors.cyan}${prefix} deploy${colors.reset}                     ${colors.dim}# Uniweb hosting (default; uniweb login first)${colors.reset}`)
  log(`  ${colors.cyan}${prefix} deploy --host=<adapter>${colors.reset}    ${colors.dim}# cloudflare-pages, netlify, vercel, github-pages, s3-cloudfront${colors.reset}`)
  log(`  ${colors.cyan}${prefix} export${colors.reset}                     ${colors.dim}# Build dist/ for any static host (no Uniweb account)${colors.reset}`)
  log('')
  log(`  ${colors.dim}See ${colors.reset}${colors.cyan}${prefix} <command> --help${colors.reset}${colors.dim} for command-specific options.${colors.reset}`)
  log('')

  await showUpdateNotification()
}

/**
 * Print help for a specific command. Returns true if a dedicated help
 * block exists for the command, false to signal "fall back to global
 * help."
 *
 * Help text intentionally lives next to the dispatcher rather than in
 * the per-command files because most help-seekers haven't run that
 * command yet — keeping it here means `uniweb foo --help` prints
 * without loading @uniweb/build or any project context.
 */
function printCommandHelp(command) {
  const blocks = {
    deploy: `
${colors.cyan}${colors.bright}uniweb deploy${colors.reset} ${colors.dim}— Deploy a site${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb deploy [options]

The host is determined by the resolved deploy.yml target. Defaults to
${colors.cyan}uniweb${colors.reset} hosting (link-mode, edge JIT prerender) when no deploy.yml exists.

${colors.bright}Hosts:${colors.reset}
  uniweb              Uniweb hosting (default; requires \`uniweb login\`)
  cloudflare-pages    Cloudflare Pages (build artifact + adapter postBuild)
  netlify             Netlify (alias of cloudflare-pages adapter)
  vercel              Vercel (build-only — deploy via \`npx vercel\`)
  github-pages        GitHub Pages (build-only — push dist/ to gh-pages)
  s3-cloudfront       AWS S3 + CloudFront (uploads + invalidates via CLI)
  generic-static      Plain static-host build, no host-specific helpers

${colors.bright}Options:${colors.reset}
  --target <name>     Pick a target from deploy.yml (default: deploy.yml's \`default:\`)
  --host <name>       Override the resolved target's host (does not persist)
  --host              No value → interactive picker (TTY only)
  --dry-run           Resolve site.yml + foundation/runtime; print summary; no writes
  --no-auto-publish   Don't auto-publish workspace-local foundation as part of deploy
  --no-save           Skip the auto-save of lastDeploy in deploy.yml
  --local             Internal: target the unicloud mock (see workspace root CLAUDE.md)
  --non-interactive   Fail with usage info instead of prompting

${colors.bright}Auth:${colors.reset}
  \`host: uniweb\` requires authentication. Run \`uniweb login\` first, set
  \`UNIWEB_TOKEN=<bearer>\` env var, or use a static-host adapter that
  doesn't need a Uniweb account. CI / agents / piped stdin auto-detect
  non-interactive mode and bail with an actionable error instead of
  hanging on a browser callback.

${colors.bright}Examples:${colors.reset}
  uniweb deploy                              # Default (host=uniweb)
  uniweb deploy --dry-run                    # Print summary, no writes
  uniweb deploy --host=cloudflare-pages      # One-off override
  uniweb deploy --target=preview             # Pick named target from deploy.yml
`,
    publish: `
${colors.cyan}${colors.bright}uniweb publish${colors.reset} ${colors.dim}— Publish a foundation to the catalog${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb publish [@org/name] [options]

For site-bound foundations (one foundation, one site), use \`uniweb deploy\`
instead — it auto-publishes under a site-scoped slot, no naming ceremony.

${colors.bright}Options:${colors.reset}
  --catalog          Confirm publish to the public catalog (required in CI)
  --propagate        Walk trusting sites' policy waves (default: silent)
  --name <id>        Foundation id (overrides package.json::uniweb.id)
  --namespace <ns>   Force org-scope namespace (overrides package.json)
  --local            Internal: publish to the unicloud mock (see workspace root CLAUDE.md)
  --registry <url>   Use a specific registry URL
  --edit-access <p>  "open" or "restricted" (default: restricted)
  --dry-run          Show what would be published without uploading
  --non-interactive  Fail with usage info instead of prompting
`,
    create: `
${colors.cyan}${colors.bright}uniweb create${colors.reset} ${colors.dim}— Create a new project${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb create [name] [options]

${colors.bright}Options:${colors.reset}
  --template <type>  Project template (default: starter)
                     Built-in: starter, none, marketing
                     Local:    ./path/to/template
                     npm:      @scope/template-name
                     GitHub:   github:user/repo or https://github.com/user/repo
  --blank            Create an empty workspace (grow with \`uniweb add\`)
  --name <name>      Project display name
  --no-git           Skip git repository initialization

${colors.bright}Examples:${colors.reset}
  uniweb create my-project                       # Foundation + site + starter content
  uniweb create my-project --template marketing  # Official template
  uniweb create my-project --blank               # Empty workspace
`,
    dev: `
${colors.cyan}${colors.bright}uniweb dev${colors.reset} ${colors.dim}— Start a dev server for a site${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb dev                  Start dev server for the (single) site
  uniweb dev <site>           Start dev server for a specific site
  uniweb dev --site <name>    Same, with explicit flag form

Thin wrapper around the package manager's workspace-filtered \`dev\`
script (\`pnpm --filter <site> dev\` or \`npm -w <site> run dev\`). Picks
the single site automatically; for multi-site workspaces the first
site runs by default with a notice pointing at \`--site\` for explicit
selection.
`,
    build: `
${colors.cyan}${colors.bright}uniweb build${colors.reset} ${colors.dim}— Build the current project${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb build [options]

At workspace root, builds all foundations first, then all sites.
Pre-rendering is enabled by default when build.prerender: true in site.yml.

${colors.bright}Options:${colors.reset}
  --target <type>    Build target (foundation, site) — auto-detected if not specified
  --prerender        Force pre-rendering (overrides site.yml)
  --no-prerender     Skip pre-rendering (overrides site.yml)
  --foundation-dir   Path to foundation directory (for prerendering)
  --host <name>      Apply host-specific postBuild (e.g., cloudflare-pages emits _redirects)
  --platform <name>  (Deprecated alias for --host)
`,
    add: `
${colors.cyan}${colors.bright}uniweb add${colors.reset} ${colors.dim}— Add a foundation, site, or extension${colors.reset}

${colors.bright}Subcommands:${colors.reset}
  add project [name]      Add a co-located foundation + site pair
  add foundation [name]   Add a foundation (--from, --path, --project)
  add site [name]         Add a site (--from, --foundation, --path, --project)
  add extension <name>    Add an extension (--from, --site, --path)
  add section <name>      Add a section type to a foundation (--foundation)

${colors.bright}Common options:${colors.reset}
  --from <template>       Source content from a template
  --path <dir>            Override default folder location
  --foundation <name>     Wire site/extension to this foundation (CI-friendly)
  --site <name>           Wire extension to this site (CI-friendly)
  --non-interactive       Fail with usage info instead of prompting
`,
    export: `
${colors.cyan}${colors.bright}uniweb export${colors.reset} ${colors.dim}— Export a self-contained site for third-party hosting${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb export [options]

Builds dist/ and prints upload examples for common static hosts. No login,
no deploy step — you push the artifact to your host of choice yourself.
For Uniweb-hosted sites, use \`uniweb deploy\`.

${colors.bright}Options:${colors.reset}
  --no-prerender     Skip per-page prerendered HTML
  --host <name>      Apply host-specific postBuild (cloudflare-pages, github-pages, …)
`,
    doctor: `
${colors.cyan}${colors.bright}uniweb doctor${colors.reset} ${colors.dim}— Diagnose project configuration issues${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb doctor [options]

${colors.bright}Options:${colors.reset}
  --fix              Apply fixes for safely-fixable issues
  --fix <issue-id>   Apply fix for a specific issue id only
  --non-interactive  Fail with usage info instead of prompting

Exit code is 1 if errors are found (warnings only → exit 0).
`,
    rename: `
${colors.cyan}${colors.bright}uniweb rename${colors.reset} ${colors.dim}— Rename a workspace package${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb rename foundation <old> <new>

Today supports renaming foundations only. Updates folder name, foundation
package.json::name, every dependent site's site.yml::foundation, every
dependent site's package.json::dependencies, pnpm-workspace.yaml, and
package.json::workspaces. Transactional — bails on conflict before any
filesystem mutation.
`,
    login: `
${colors.cyan}${colors.bright}uniweb login${colors.reset} ${colors.dim}— Log in to your Uniweb account${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb login [options]

Opens a browser to hub.uniweb.app for OAuth-style login, then captures
the token via a loopback callback. Falls back to a paste-token prompt
if the browser flow fails.

${colors.bright}Options:${colors.reset}
  --backend <url>    Override the auth backend (default: https://hub.uniweb.app)

In non-interactive mode (CI / no TTY / --non-interactive), this command
errors out — set the \`UNIWEB_TOKEN\` env var instead, or run \`login\`
once on a machine with a browser to seed ~/.uniweb/auth.json.
`,
    invite: `
${colors.cyan}${colors.bright}uniweb invite${colors.reset} ${colors.dim}— Create a foundation invite for a client${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb invite <email> [options]

${colors.bright}Options:${colors.reset}
  --uses <n>         Max sites per invite (default: 1)
  --expires <days>   Days until expiry (default: 30)
  --version <n>      Major version to license (default: current)
  --list             List invites for your foundation
  --revoke <id>      Revoke an invite
  --resend <id>      Resend an invite
`,
    handoff: `
${colors.cyan}${colors.bright}uniweb handoff${colors.reset} ${colors.dim}— Hand off a site to a client${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb handoff <email> [options]

${colors.bright}Options:${colors.reset}
  --site <id>        Site identifier (default: auto-generated)
  --web              Show web-based handoff instructions instead
`,
    template: `
${colors.cyan}${colors.bright}uniweb template${colors.reset} ${colors.dim}— Manage cloud templates${colors.reset}

${colors.bright}Subcommands:${colors.reset}
  template publish        Publish a site as a cloud template

${colors.bright}Publish Options:${colors.reset}
  --name <name>      Template registry name (overrides site.yml template: field)
  --title <title>    Display title (overrides site.yml name: field)
  --description <t>  Description
  --registry <url>   Registry URL (default: http://localhost:4001)
`,
    docs: `
${colors.cyan}${colors.bright}uniweb docs${colors.reset} ${colors.dim}— Generate component documentation${colors.reset}

${colors.bright}Subcommands:${colors.reset}
  docs               Generate COMPONENTS.md from foundation schema
  docs site          Show site.yml configuration reference
  docs page          Show page.yml configuration reference
  docs meta          Show component meta.js reference

${colors.bright}Options:${colors.reset}
  --output <file>    Output filename (default: COMPONENTS.md)
  --from-source      Read meta.js files directly instead of schema.json
`,
    i18n: `
${colors.cyan}${colors.bright}uniweb i18n${colors.reset} ${colors.dim}— Internationalization workflow${colors.reset}

${colors.bright}Subcommands:${colors.reset}
  i18n extract       Extract translatable strings to manifest
  i18n sync          Update manifest with content changes
  i18n status        Show translation coverage per locale
`,
    inspect: `
${colors.cyan}${colors.bright}uniweb inspect${colors.reset} ${colors.dim}— Inspect parsed content shape${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb inspect <path>

Prints the parsed content shape of a markdown file or folder — the
{ content, params, items, … } object that components actually receive.
Useful for debugging "why isn't my section getting X?".
`,
    update: `
${colors.cyan}${colors.bright}uniweb update${colors.reset} ${colors.dim}— Update AGENTS.md to match installed CLI version${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb update

Refreshes the project's AGENTS.md from the CLI's bundled version. Run
after upgrading the \`uniweb\` package to pick up new content authoring
patterns and platform documentation.
`,
  }

  if (!blocks[command]) return false
  log(blocks[command])
  return true
}

function showHelp() {
  log(`
${colors.cyan}${colors.bright}Uniweb CLI${colors.reset} ${colors.dim}v${getCliVersion()}${colors.reset}

${colors.bright}Usage:${colors.reset}
  uniweb <command> [options]

${colors.bright}Commands:${colors.reset}
  create [name]      Create a new project
  add <type> [name]  Add a foundation, site, or extension to a project
  rename <type>      Rename a workspace package (foundation today)
  dev                Start a dev server for a site
  build              Build the current project
  deploy             Deploy a site to Uniweb hosting
  export             Export a self-contained site for third-party hosting
  publish            Publish a foundation to the Uniweb catalog (deliberate; for site-bound foundations, use deploy)
  invite <email>     Create a foundation invite for a client
  handoff <email>    Hand off a site to a client
  inspect <path>     Inspect parsed content shape of a markdown file or folder
  docs               Generate component documentation
  doctor             Diagnose project configuration issues
  update             Update AGENTS.md to match installed CLI version
  i18n <cmd>         Internationalization (extract, sync, status)
  template publish   Publish a site as a cloud template
  login              Log in to your Uniweb account

${colors.bright}Create Options:${colors.reset}
  --template <type>  Project template (default: starter)
  --blank            Create an empty workspace (grow with uniweb add)
  --name <name>      Project display name
  --no-git           Skip git repository initialization

${colors.bright}Add Subcommands:${colors.reset}
  add project [name]      Add a co-located foundation + site pair
  add foundation [name]   Add a foundation (--from, --path, --project)
  add site [name]         Add a site (--from, --foundation, --path, --project)
  add extension <name>    Add an extension (--from, --site, --path)
  add section <name>      Add a section type to a foundation (--foundation)

${colors.bright}Global Options:${colors.reset}
  --version, -v        Show version
  --non-interactive    Fail with usage info instead of prompting
                       Auto-detected when CI=true or no TTY (pipes, agents)

${colors.bright}Publish Options:${colors.reset}
  --catalog          Confirm publish to the public catalog (required in CI)
  --propagate        Walk trusting sites' policy waves (default: silent)
  --name <id>        Foundation id (overrides package.json::uniweb.id)
  --namespace <ns>   Force org-scope namespace (overrides package.json)
  --local            Publish to the local registry (.unicloud/) instead of Uniweb Registry
  --registry <url>   Use a specific registry URL
  --edit-access <p>  Set edit access policy: "open" or "restricted" (default: restricted)
  --dry-run          Show what would be published without uploading

  uniweb publish is for cataloging a foundation as a product. For
  site-bound foundations (one foundation, one site), use uniweb deploy
  instead — it auto-publishes under a site-scoped slot, no naming
  ceremony.

${colors.bright}Invite Options:${colors.reset}
  --uses <n>         Max sites per invite (default: 1)
  --expires <days>   Days until expiry (default: 30)
  --version <n>      Major version to license (default: current)
  --list             List invites for your foundation
  --revoke <id>      Revoke an invite
  --resend <id>      Resend an invite

${colors.bright}Handoff Options:${colors.reset}
  --site <id>        Site identifier (default: auto-generated)
  --web              Show web-based handoff instructions instead

${colors.bright}Template Options:${colors.reset}
  --name <name>      Template registry name (overrides site.yml template: field)
  --title <title>    Display title (overrides site.yml name: field)
  --description <t>  Description
  --registry <url>   Registry URL (default: http://localhost:4001)

${colors.bright}Deploy Options:${colors.reset}
  --dry-run          Resolve site.yml + foundation/runtime; print summary; no writes
  --no-auto-publish  Don't auto-publish workspace-local foundation as part of deploy

${colors.bright}Export Options:${colors.reset}
  --no-prerender     Skip per-page prerendered HTML

${colors.bright}Build Options:${colors.reset}
  --target <type>    Build target (foundation, site) - auto-detected if not specified
  --prerender        Force pre-rendering (overrides site.yml)
  --no-prerender     Skip pre-rendering (overrides site.yml)
  --foundation-dir   Path to foundation directory (for prerendering)
  --platform <name>  Deployment platform (e.g., vercel) for platform-specific output

  At workspace root, builds all foundations first, then all sites.
  Pre-rendering is enabled by default when build.prerender: true in site.yml

${colors.bright}Docs Subcommands:${colors.reset}
  docs               Generate COMPONENTS.md from foundation schema
  docs site          Show site.yml configuration reference
  docs page          Show page.yml configuration reference
  docs meta          Show component meta.js reference

${colors.bright}Docs Options:${colors.reset}
  --output <file>    Output filename (default: COMPONENTS.md)
  --from-source      Read meta.js files directly instead of schema.json

${colors.bright}i18n Commands:${colors.reset}
  extract            Extract translatable strings to manifest
  sync               Update manifest with content changes
  status             Show translation coverage per locale

${colors.bright}Template Types:${colors.reset}
  starter                       Foundation + site + sample content (default)
  none                          Foundation + site with no content
  marketing                     Official marketing template
  ./path/to/template            Local directory
  @scope/template-name          npm package
  github:user/repo              GitHub repository
  https://github.com/user/repo  GitHub URL

${colors.bright}Examples:${colors.reset}
  uniweb create my-project                           # Foundation + site + starter content
  uniweb create my-project --template none           # Foundation + site, no content
  uniweb create my-project --blank                   # Empty workspace
  uniweb create my-project --template marketing      # Official template
  uniweb create my-project --template ./my-template  # Local template

  cd my-project
  uniweb add project docs                            # Add docs/foundation/ + docs/site/
  uniweb add project docs --from academic            # Co-located pair + academic content
  uniweb add foundation                              # Add foundation at root
  uniweb add site blog --foundation marketing        # Add site wired to marketing
  uniweb add extension effects --site site           # Add extensions/effects/

  uniweb build
  uniweb build --target foundation
  cd foundation && uniweb docs                       # Generate COMPONENTS.md

${colors.bright}Install:${colors.reset}
  npm i -g uniweb          Global install (recommended)
  npx uniweb <command>     Run without installing
`)
}

// Run CLI
main().catch((err) => {
  error(err.message)
  process.exit(1)
})
