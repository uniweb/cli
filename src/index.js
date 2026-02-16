#!/usr/bin/env node

/**
 * Uniweb CLI
 *
 * Scaffolds new Uniweb sites and foundations, builds projects, and generates docs.
 *
 * Usage:
 *   npx uniweb create [project-name]
 *   npx uniweb create --template marketing
 *   npx uniweb add foundation [name]
 *   npx uniweb build
 *   npx uniweb docs                          # Generate COMPONENTS.md from schema
 */

import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, join, relative } from 'node:path'
import prompts from 'prompts'
import { build } from './commands/build.js'
import { docs } from './commands/docs.js'
import { doctor } from './commands/doctor.js'
import { i18n } from './commands/i18n.js'
import { inspect } from './commands/inspect.js'
import { add } from './commands/add.js'
import { login } from './commands/login.js'
import { publish } from './commands/publish.js'
import { deploy } from './commands/deploy.js'
import {
  resolveTemplate,
  parseTemplateId,
} from './templates/index.js'
import { validateTemplate } from './templates/validator.js'
import { scaffoldWorkspace, scaffoldFoundation, scaffoldSite, applyContent, applyStarter, mergeTemplateDependencies } from './utils/scaffold.js'
import { detectPackageManager, filterCmd, installCmd, runCmd } from './utils/pm.js'
import { isNonInteractive, getCliPrefix, stripNonInteractiveFlag, formatOptions } from './utils/interactive.js'

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

/**
 * Create a project using the new package template flow (default)
 */
async function createFromPackageTemplates(projectDir, projectName, options = {}) {
  const { onProgress, onWarning, pm = 'pnpm', includeStarter = true } = options

  onProgress?.('Setting up workspace...')

  // 1. Scaffold workspace
  await scaffoldWorkspace(projectDir, {
    projectName,
    workspaceGlobs: ['foundation', 'site'],
    scripts: {
      dev: filterCmd(pm, 'site', 'dev'),
      build: 'uniweb build',
      preview: filterCmd(pm, 'site', 'preview'),
    },
  }, { onProgress, onWarning })

  // 2. Scaffold foundation
  onProgress?.('Creating foundation...')
  await scaffoldFoundation(join(projectDir, 'foundation'), {
    name: 'foundation',
    projectName,
    isExtension: false,
  }, { onProgress, onWarning })

  // 3. Scaffold site
  onProgress?.('Creating site...')
  await scaffoldSite(join(projectDir, 'site'), {
    name: 'site',
    projectName,
    foundationName: 'foundation',
    foundationPath: 'file:../foundation',
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
  const packages = metadata.packages || [
    { type: 'foundation', name: 'foundation' },
    { type: 'site', name: 'site', foundation: 'foundation' },
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
      const foundationName = pkg.foundation || 'foundation'
      const foundationPkg = placed.find(p =>
        (p.type === 'foundation') && (p.name === foundationName)
      )
      const foundationPath = foundationPkg
        ? computeFoundationFilePath(pkg.relativePath, foundationPkg.relativePath)
        : 'file:../foundation'

      onProgress?.(`Creating site: ${pkg.name}...`)
      await scaffoldSite(fullPath, {
        name: pkg.name,
        projectName,
        foundationName,
        foundationPath,
        foundationRef: foundationName !== 'foundation' ? foundationName : undefined,
      }, { onProgress, onWarning })
    }

    // Apply content from the matching content directory
    const contentDir = findContentDirFor(metadata.contentDirs, pkg)
    if (contentDir) {
      onProgress?.(`Applying ${metadata.name} content to ${pkg.name}...`)
      await applyContent(contentDir.dir, fullPath, { projectName }, { onProgress, onWarning })
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
 * - 1 foundation named "foundation" → foundation/
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
    if (foundations.length === 1 && f.name === 'foundation') {
      placed.push({ ...f, relativePath: 'foundation' })
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

  // Show help
  if (!command || command === '--help' || command === '-h') {
    showHelp()
    return
  }

  // Handle build command
  if (command === 'build') {
    await build(args.slice(1))
    return
  }

  // Handle docs command
  if (command === 'docs') {
    await docs(args.slice(1))
    return
  }

  // Handle i18n command
  if (command === 'i18n') {
    await i18n(args.slice(1))
    return
  }

  // Handle doctor command
  if (command === 'doctor') {
    await doctor(args.slice(1))
    return
  }

  // Handle inspect command
  if (command === 'inspect') {
    await inspect(args.slice(1))
    return
  }

  // Handle add command
  if (command === 'add') {
    await add(args.slice(1))
    return
  }

  // Handle publish command
  if (command === 'publish') {
    await publish(args.slice(1))
    return
  }

  // Handle deploy command
  if (command === 'deploy') {
    await deploy(args.slice(1))
    return
  }

  // Handle login command
  if (command === 'login') {
    await login(args.slice(1))
    return
  }

  // Handle create command
  if (command !== 'create') {
    error(`Unknown command: ${command}`)
    showHelp()
    process.exit(1)
  }

  title('Uniweb Project Generator')

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

  // Success message
  title('Project created successfully!')

  if (isBlank) {
    log(`Next steps:\n`)
    log(`  ${colors.cyan}cd ${projectName}${colors.reset}`)
    log(`  ${colors.cyan}${prefix} add project${colors.reset}`)
    log(`  ${colors.cyan}${installCmd(pm)}${colors.reset}`)
    log(`  ${colors.cyan}${runCmd(pm, 'dev')}${colors.reset}`)
  } else {
    log(`Next steps:\n`)
    log(`  ${colors.cyan}cd ${projectName}${colors.reset}`)
    log(`  ${colors.cyan}${installCmd(pm)}${colors.reset}`)
    log(`  ${colors.cyan}${runCmd(pm, 'dev')}${colors.reset}`)
  }
  log('')
}

function showHelp() {
  log(`
${colors.cyan}${colors.bright}Uniweb CLI${colors.reset}

${colors.bright}Usage:${colors.reset}
  npx uniweb <command> [options]

${colors.bright}Commands:${colors.reset}
  create [name]      Create a new project
  add <type> [name]  Add a foundation, site, or extension to a project
  build              Build the current project
  deploy             Deploy a site to Uniweb hosting
  publish            Publish a foundation to the Uniweb Registry
  inspect <path>     Inspect parsed content shape of a markdown file or folder
  docs               Generate component documentation
  doctor             Diagnose project configuration issues
  i18n <cmd>         Internationalization (extract, sync, status)
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
  --non-interactive    Fail with usage info instead of prompting
                       Auto-detected when CI=true or no TTY (pipes, agents)

${colors.bright}Publish Options:${colors.reset}
  --local            Publish to the local registry (.unicloud/) instead of Uniweb Registry
  --edit-access <p>  Set edit access policy: "open" or "restricted" (default: restricted)
  --dry-run          Show what would be published without uploading

${colors.bright}Deploy Options:${colors.reset}
  --prod             Deploy to production (default: preview URL)
  --dry-run          Show what would be deployed without uploading

${colors.bright}Build Options:${colors.reset}
  --target <type>    Build target (foundation, site) - auto-detected if not specified
  --prerender        Force pre-rendering (overrides site.yml)
  --no-prerender     Skip pre-rendering (overrides site.yml)
  --foundation-dir   Path to foundation directory (for prerendering)
  --platform <name>  Deployment platform (e.g., vercel) for platform-specific output
  --shell            Build site without embedded content (for dynamic backend serving)

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
  npx uniweb create my-project                           # Foundation + site + starter content
  npx uniweb create my-project --template none           # Foundation + site, no content
  npx uniweb create my-project --blank                   # Empty workspace
  npx uniweb create my-project --template marketing      # Official template
  npx uniweb create my-project --template ./my-template  # Local template

  cd my-project
  npx uniweb add project docs                            # Add docs/foundation/ + docs/site/
  npx uniweb add project docs --from academic            # Co-located pair + academic content
  npx uniweb add foundation                              # Add foundation at root
  npx uniweb add site blog --foundation marketing        # Add site wired to marketing
  npx uniweb add extension effects --site site           # Add extensions/effects/

  npx uniweb build
  npx uniweb build --target foundation
  cd foundation && npx uniweb docs                       # Generate COMPONENTS.md
`)
}

// Run CLI
main().catch((err) => {
  error(err.message)
  process.exit(1)
})
