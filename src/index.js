#!/usr/bin/env node

/**
 * Uniweb CLI
 *
 * Scaffolds new Uniweb sites and foundations, builds projects, and generates docs.
 *
 * Usage:
 *   npx uniweb create [project-name]
 *   npx uniweb create --template marketing
 *   npx uniweb build
 *   npx uniweb docs                          # Generate COMPONENTS.md from schema
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import prompts from 'prompts'
import { build } from './commands/build.js'
import { docs } from './commands/docs.js'
import { i18n } from './commands/i18n.js'
import { getVersionsForTemplates, getVersion } from './versions.js'
import {
  resolveTemplate,
  applyExternalTemplate,
  parseTemplateId,
  listAvailableTemplates,
  BUILTIN_TEMPLATES,
} from './templates/index.js'
import { copyTemplateDirectory, registerVersions } from './templates/processor.js'

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

// Built-in template definitions (metadata for display)
const templates = {
  single: {
    name: 'Single Project',
    description: 'One site + one foundation in site/ and foundation/ (recommended)',
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
 * Get the shared base template path
 */
function getSharedTemplatePath() {
  return join(__dirname, '..', 'templates', '_shared')
}

/**
 * Apply a built-in template using file-based templates
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

  // Handle create command
  if (command !== 'create') {
    error(`Unknown command: ${command}`)
    showHelp()
    process.exit(1)
  }

  title('Uniweb Project Generator')

  // Parse arguments
  let projectName = args[1]
  let templateType = "single"; // or null for iteractive selection

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
    {
      type: templateType ? null : 'select',
      name: 'template',
      message: 'What would you like to create?',
      choices: [
        {
          title: templates.single.name,
          description: templates.single.description,
          value: 'single',
        },
        {
          title: templates.multi.name,
          description: templates.multi.description,
          value: 'multi',
        },
      ],
    },
  ], {
    onCancel: () => {
      log('\nScaffolding cancelled.')
      process.exit(0)
    },
  })

  projectName = projectName || response.projectName
  templateType = templateType || response.template

  if (!projectName || !templateType) {
    error('Missing project name or template type')
    process.exit(1)
  }

  // Create project directory
  const projectDir = resolve(process.cwd(), projectName)

  if (existsSync(projectDir)) {
    error(`Directory already exists: ${projectName}`)
    process.exit(1)
  }

  // Resolve and create project based on template
  const parsed = parseTemplateId(templateType)

  if (parsed.type === 'builtin') {
    const templateMeta = templates[templateType]
    log(`\nCreating ${templateMeta ? templateMeta.name.toLowerCase() : templateType}...`)

    // Apply file-based built-in template
    await applyBuiltinTemplate(templateType, projectDir, {
      projectName: displayName || projectName,
      variant,
      onProgress: (msg) => log(`  ${colors.dim}${msg}${colors.reset}`),
      onWarning: (msg) => log(`  ${colors.yellow}Warning: ${msg}${colors.reset}`),
    })
  } else {
    // External template (official, npm, or github)
    log(`\nResolving template: ${templateType}...`)

    try {
      const resolved = await resolveTemplate(templateType, {
        onProgress: (msg) => log(`  ${colors.dim}${msg}${colors.reset}`),
      })

      log(`\nCreating project from ${resolved.name || resolved.package || `${resolved.owner}/${resolved.repo}`}...`)

      await applyExternalTemplate(resolved, projectDir, {
        projectName: displayName || projectName,
        versions: getVersionsForTemplates(),
      }, {
        variant,
        onProgress: (msg) => log(`  ${colors.dim}${msg}${colors.reset}`),
        onWarning: (msg) => log(`  ${colors.yellow}Warning: ${msg}${colors.reset}`),
      })
    } catch (err) {
      error(`Failed to apply template: ${err.message}`)
      log('')
      log(`${colors.yellow}Troubleshooting:${colors.reset}`)
      log(`  • Check your network connection`)
      log(`  • Official templates require GitHub access (may be blocked by corporate networks)`)
      log(`  • Try the built-in template instead: ${colors.cyan}uniweb create ${projectName}${colors.reset}`)
      process.exit(1)
    }
  }

  // Success message
  title('Project created successfully!')

  log(`Next steps:\n`)
  log(`  ${colors.cyan}cd ${projectName}${colors.reset}`)
  log(`  ${colors.cyan}pnpm install${colors.reset}`)
  log(`  ${colors.cyan}pnpm dev${colors.reset}`)
  log('')
}

function showHelp() {
  log(`
${colors.cyan}${colors.bright}Uniweb CLI${colors.reset}

${colors.bright}Usage:${colors.reset}
  npx uniweb <command> [options]

${colors.bright}Commands:${colors.reset}
  create [name]      Create a new project
  build              Build the current project
  docs               Generate component documentation
  i18n <cmd>         Internationalization (extract, sync, status)

${colors.bright}Create Options:${colors.reset}
  --template <type>  Project template
  --variant <name>   Template variant (e.g., tailwind3 for legacy)
  --name <name>      Project display name

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
  single                        One site + one foundation (default)
  multi                         Multiple sites and foundations
  marketing                     Official marketing template
  @scope/template-name          npm package
  github:user/repo              GitHub repository
  https://github.com/user/repo  GitHub URL

${colors.bright}Examples:${colors.reset}
  npx uniweb create my-project
  npx uniweb create my-project --template single
  npx uniweb create my-project --template marketing
  npx uniweb create my-project --template marketing --variant tailwind3
  npx uniweb create my-project --template github:myorg/template
  npx uniweb build
  npx uniweb build --target foundation
  npx uniweb build                                     # Auto-prerenders if site.yml has build.prerender: true
  npx uniweb build --no-prerender                      # Skip prerendering even if enabled in config
  cd foundation && npx uniweb docs                     # Generate COMPONENTS.md
`)
}

// Run CLI
main().catch((err) => {
  error(err.message)
  process.exit(1)
})
