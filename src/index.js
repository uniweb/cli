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

import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import prompts from 'prompts'
import { build } from './commands/build.js'
import { docs } from './commands/docs.js'
import { doctor } from './commands/doctor.js'
import { i18n } from './commands/i18n.js'
import { add } from './commands/add.js'
import { getVersionsForTemplates } from './versions.js'
import {
  resolveTemplate,
  applyExternalTemplate,
  parseTemplateId,
  BUILTIN_TEMPLATES,
} from './templates/index.js'
import { copyTemplateDirectory, registerVersions } from './templates/processor.js'
import { scaffoldWorkspace, scaffoldFoundation, scaffoldSite, applyStarter } from './utils/scaffold.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

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

// Legacy built-in template definitions (metadata for display)
const legacyTemplates = {
  single: {
    name: 'Single Project',
    description: 'One site + one foundation in site/ and foundation/',
  },
  multi: {
    name: 'Multi-Site Workspace',
    description: 'Multiple sites and foundations in sites/* and foundations/*',
  },
}

/**
 * Get the path to a built-in template
 */
function getBuiltinTemplatePath(templateName) {
  return join(__dirname, '..', 'templates', templateName)
}

/**
 * Apply a legacy built-in template using file-based templates (single/multi)
 */
async function applyBuiltinTemplate(templateName, targetPath, options = {}) {
  const { projectName, variant, onProgress, onWarning } = options

  const templatePath = getBuiltinTemplatePath(templateName)

  // Load template.json for metadata
  let templateConfig = {}
  const configPath = join(templatePath, 'template.json')
  if (existsSync(configPath)) {
    templateConfig = JSON.parse(readFileSync(configPath, 'utf8'))
  }

  // Determine base template path if specified
  let basePath = null
  if (templateConfig.base) {
    basePath = join(__dirname, '..', 'templates', templateConfig.base)
    if (!existsSync(basePath)) {
      if (onWarning) {
        onWarning(`Base template '${templateConfig.base}' not found at ${basePath}`)
      }
      basePath = null
    }
  }

  // Register versions for Handlebars templates
  registerVersions(getVersionsForTemplates())

  // Prepare template data
  const templateData = {
    projectName: projectName || 'my-project',
    templateName: templateName,
    templateTitle: projectName || 'My Project',
    templateDescription: templateConfig.description || 'A Uniweb project',
  }

  // Copy template files
  await copyTemplateDirectory(templatePath, targetPath, templateData, {
    variant,
    basePath,
    onProgress,
    onWarning,
  })

  success(`Created project: ${projectName || 'my-project'}`)
}

/**
 * Create a project using the new package template flow (default)
 */
async function createFromPackageTemplates(projectDir, projectName, options = {}) {
  const { onProgress, onWarning } = options

  onProgress?.('Setting up workspace...')

  // 1. Scaffold workspace
  await scaffoldWorkspace(projectDir, {
    projectName,
    workspaceGlobs: ['foundation', 'site'],
    scripts: {
      dev: 'pnpm --filter site dev',
      build: 'uniweb build',
      preview: 'pnpm --filter site preview',
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

  // 4. Apply starter content
  onProgress?.('Adding starter content...')
  await applyStarter(projectDir, { projectName }, { onProgress, onWarning })

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

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

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

  // Handle add command
  if (command === 'add') {
    await add(args.slice(1))
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

  // Check for --variant flag
  let variant = null
  const variantIndex = args.indexOf('--variant')
  if (variantIndex !== -1 && args[variantIndex + 1]) {
    variant = args[variantIndex + 1]
  }

  // Check for --name flag (used for project display name)
  let displayName = null
  const nameIndex = args.indexOf('--name')
  if (nameIndex !== -1 && args[nameIndex + 1]) {
    displayName = args[nameIndex + 1]
  }

  // Check for --no-git flag
  const noGit = args.includes('--no-git')

  // Skip positional name if it starts with -- (it's a flag, not a name)
  if (projectName && projectName.startsWith('--')) {
    projectName = null
  }

  // Interactive prompts
  const response = await prompts([
    {
      type: projectName ? null : 'text',
      name: 'projectName',
      message: 'Project name:',
      initial: 'my-uniweb-project',
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

  if (templateType === 'blank') {
    // New: blank workspace
    log('\nCreating blank workspace...')
    await createBlankWorkspace(projectDir, effectiveName, {
      onProgress: progressCb,
      onWarning: warningCb,
    })
  } else if (!templateType) {
    // New: default flow (package templates + starter)
    log('\nCreating project...')
    await createFromPackageTemplates(projectDir, effectiveName, {
      onProgress: progressCb,
      onWarning: warningCb,
    })
  } else {
    const parsed = parseTemplateId(templateType)

    if (parsed.type === 'builtin' && (templateType === 'single' || templateType === 'multi')) {
      // Legacy: single/multi
      const templateMeta = legacyTemplates[templateType]
      log(`\nCreating ${templateMeta ? templateMeta.name.toLowerCase() : templateType}...`)

      await applyBuiltinTemplate(templateType, projectDir, {
        projectName: effectiveName,
        variant,
        onProgress: progressCb,
        onWarning: warningCb,
      })
    } else {
      // External: official/npm/github/local
      log(`\nResolving template: ${templateType}...`)

      try {
        const resolved = await resolveTemplate(templateType, {
          onProgress: progressCb,
        })

        log(`\nCreating project from ${resolved.name || resolved.package || `${resolved.owner}/${resolved.repo}`}...`)

        await applyExternalTemplate(resolved, projectDir, {
          projectName: effectiveName,
          versions: getVersionsForTemplates(),
        }, {
          variant,
          onProgress: progressCb,
          onWarning: warningCb,
        })
      } catch (err) {
        error(`Failed to apply template: ${err.message}`)
        log('')
        log(`${colors.yellow}Troubleshooting:${colors.reset}`)
        log(`  • Check your network connection`)
        log(`  • Official templates require GitHub access (may be blocked by corporate networks)`)
        log(`  • Try the default template instead: ${colors.cyan}uniweb create ${projectName}${colors.reset}`)
        process.exit(1)
      }
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

  if (templateType === 'blank') {
    log(`Next steps:\n`)
    log(`  ${colors.cyan}cd ${projectName}${colors.reset}`)
    log(`  ${colors.cyan}uniweb add foundation${colors.reset}`)
    log(`  ${colors.cyan}uniweb add site${colors.reset}`)
    log(`  ${colors.cyan}pnpm install${colors.reset}`)
    log(`  ${colors.cyan}pnpm dev${colors.reset}`)
  } else {
    log(`Next steps:\n`)
    log(`  ${colors.cyan}cd ${projectName}${colors.reset}`)
    log(`  ${colors.cyan}pnpm install${colors.reset}`)
    log(`  ${colors.cyan}pnpm dev${colors.reset}`)
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
  docs               Generate component documentation
  doctor             Diagnose project configuration issues
  i18n <cmd>         Internationalization (extract, sync, status)

${colors.bright}Create Options:${colors.reset}
  --template <type>  Project template (default: creates foundation + site + starter)
  --name <name>      Project display name
  --no-git           Skip git repository initialization

${colors.bright}Add Subcommands:${colors.reset}
  add foundation [name]   Add a foundation (--path, --project)
  add site [name]         Add a site (--foundation, --path, --project)
  add extension <name>    Add an extension (--site, --path)

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
  blank                         Empty workspace (grow with 'add')
  single                        Legacy: one site + one foundation
  multi                         Legacy: multiple sites and foundations
  marketing                     Official marketing template
  ./path/to/template            Local directory
  @scope/template-name          npm package
  github:user/repo              GitHub repository
  https://github.com/user/repo  GitHub URL

${colors.bright}Examples:${colors.reset}
  npx uniweb create my-project                           # Default (foundation + site + starter)
  npx uniweb create my-project --template blank          # Blank workspace
  npx uniweb create my-project --template marketing      # Official template
  npx uniweb create my-project --template ./my-template  # Local template

  cd my-project
  npx uniweb add foundation marketing                    # Add foundations/marketing/
  npx uniweb add site blog --foundation marketing        # Add sites/blog/ wired to marketing
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
