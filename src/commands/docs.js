/**
 * Docs Command
 *
 * Generates markdown documentation from foundation schema and
 * provides configuration references.
 *
 * Usage:
 *   uniweb docs                    # Generate COMPONENTS.md
 *   uniweb docs site               # Show site.yml reference
 *   uniweb docs page               # Show page.yml reference
 *   uniweb docs meta               # Show component meta.js reference
 *   uniweb docs --output README.md # Custom output filename
 *   uniweb docs --from-source      # Build schema from source (no build required)
 *   uniweb docs --target <path>    # Specify foundation directory explicitly
 *
 * When run from a site directory, automatically finds and documents the
 * linked foundation, placing COMPONENTS.md in the site folder.
 *
 * When run from workspace root, auto-detects foundations. If multiple exist,
 * prompts for selection.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { generateDocs } from '@uniweb/build'
import {
  isWorkspaceRoot,
  findFoundations,
  promptSelect,
} from '../utils/workspace.js'

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

function info(message) {
  console.log(`${colors.cyan}→${colors.reset} ${message}`)
}

// =============================================================================
// Reference Content
// =============================================================================

const SITE_REFERENCE = `
${colors.cyan}${colors.bright}site.yml Reference${colors.reset}

Site-wide configuration for your Uniweb project.

${colors.bright}Core Settings:${colors.reset}
  ${colors.cyan}name${colors.reset}              Site name (used in metadata and browser tab)
  ${colors.cyan}defaultLanguage${colors.reset}   Default locale code (default: "en")
  ${colors.cyan}foundation${colors.reset}        Foundation package name ("foundation" for local)

${colors.bright}Page Ordering:${colors.reset}
  ${colors.cyan}pages${colors.reset}             Array of page folder names
                    First item becomes homepage at /
                    Example: [home, about, docs, pricing]
  ${colors.cyan}index${colors.reset}             Alternative: just name the homepage
                    Rest are auto-discovered

${colors.bright}Internationalization:${colors.reset}
  ${colors.cyan}i18n.locales${colors.reset}      Locales to build (array or "*" for all)
                    Example: [es, fr, de]
  ${colors.cyan}i18n.localesDir${colors.reset}   Translation files directory (default: "locales")

${colors.bright}Build Options:${colors.reset}
  ${colors.cyan}build.prerender${colors.reset}   Enable static HTML generation (default: false)
                    Generates SEO-friendly static pages

${colors.bright}Example:${colors.reset}
  ${colors.dim}name: My Site
  defaultLanguage: en
  foundation: foundation
  pages: [home, about, docs]
  i18n:
    locales: [es, fr]
  build:
    prerender: true${colors.reset}

${colors.dim}Schema: https://raw.githubusercontent.com/uniweb/cli/main/schemas/site.schema.json${colors.reset}
`

const PAGE_REFERENCE = `
${colors.cyan}${colors.bright}page.yml Reference${colors.reset}

Page-level configuration in site/pages/[page]/page.yml

${colors.bright}Basic Metadata:${colors.reset}
  ${colors.cyan}title${colors.reset}             Page title (browser tab, nav, SEO)
  ${colors.cyan}description${colors.reset}       Meta description for SEO
  ${colors.cyan}label${colors.reset}             Short nav label (defaults to title)
  ${colors.cyan}order${colors.reset}             Navigation sort order (lower = first)

${colors.bright}Child Page Ordering:${colors.reset}
  ${colors.cyan}pages${colors.reset}             Array of child page names
                    First becomes index for this route
  ${colors.cyan}index${colors.reset}             Alternative: just name the index page

${colors.bright}Navigation Visibility:${colors.reset}
  ${colors.cyan}hidden${colors.reset}            Hide from all navigation (page still exists)
  ${colors.cyan}hideInHeader${colors.reset}      Hide from header nav only
  ${colors.cyan}hideInFooter${colors.reset}      Hide from footer nav only

${colors.bright}Layout Options:${colors.reset}
  ${colors.cyan}layout${colors.reset}            Layout name or object with name, hide, params
                    String: layout name (e.g., MarketingLayout)
                    Object: { name, hide: [areas], params: {...} }
  ${colors.cyan}layout.hide${colors.reset}       Array of area names to suppress on this page
                    Example: [header, footer] or [left, right]
  ${colors.cyan}layout.params${colors.reset}     Layout-specific parameters (merged with meta.js defaults)

${colors.bright}Section Control:${colors.reset}
  ${colors.cyan}sections${colors.reset}          "*" for auto-discover, or explicit array
                    Nested arrays create subsections:
                    - hero
                    - features:
                        - logocloud
                        - stats

${colors.bright}SEO Options:${colors.reset}
  ${colors.cyan}seo.noindex${colors.reset}       Prevent search engine indexing
  ${colors.cyan}seo.image${colors.reset}         Open Graph image URL
  ${colors.cyan}seo.changefreq${colors.reset}    Sitemap hint (daily, weekly, monthly...)
  ${colors.cyan}seo.priority${colors.reset}      Sitemap priority (0.0 to 1.0)

${colors.bright}Example:${colors.reset}
  ${colors.dim}title: About Us
  description: Learn about our company
  order: 2
  hideInFooter: true
  layout:
    hide: [right]
  seo:
    image: /about-og.png${colors.reset}

${colors.dim}Schema: https://raw.githubusercontent.com/uniweb/cli/main/schemas/page.schema.json${colors.reset}
`

const META_REFERENCE = `
${colors.cyan}${colors.bright}Component meta.js Reference${colors.reset}

Component metadata in foundation/src/components/[Name]/meta.js

${colors.bright}Identity:${colors.reset}
  ${colors.cyan}title${colors.reset}             Display name in editor
  ${colors.cyan}description${colors.reset}       What the component does
  ${colors.cyan}category${colors.reset}          Grouping: "impact", "showcase", "structure"
  ${colors.cyan}purpose${colors.reset}           Single verb: Introduce, Express, Explain
  ${colors.cyan}hidden${colors.reset}            If true, not selectable in frontmatter

${colors.bright}Content Expectations:${colors.reset}
  ${colors.cyan}content${colors.reset}           Object describing expected markdown structure
                    Keys: title, pretitle, subtitle, paragraphs, links, items
                    Values: "Description [count]"
                    Count: [1], [1-3], [2+]

${colors.bright}Parameters:${colors.reset}
  ${colors.cyan}params${colors.reset}            Object of configurable parameters
                    Each param has: type, label, options, default
                    Types: "select", "boolean", "string", "number"

${colors.bright}Presets:${colors.reset}
  ${colors.cyan}presets${colors.reset}           Named parameter combinations
                    Each preset: { label, params: {...} }

${colors.bright}Special:${colors.reset}
  ${colors.cyan}background${colors.reset}        true if component supports background images
  ${colors.cyan}data${colors.reset}              Dynamic data binding ("articles", "events:5")

${colors.bright}Example:${colors.reset}
  ${colors.dim}export default {
    title: 'Hero Banner',
    description: 'Bold hero section with headline and CTA',
    category: 'impact',
    background: true,

    content: {
      pretitle: 'Eyebrow text',
      title: 'Headline',
      paragraphs: 'Description [1-2]',
      links: 'CTA buttons [1-2]',
    },

    params: {
      theme: {
        type: 'select',
        options: ['gradient', 'glass', 'dark'],
        default: 'gradient',
      },
      layout: {
        type: 'select',
        options: ['center', 'left', 'split'],
        default: 'center',
      },
    },

    presets: {
      default: { label: 'Centered', params: { theme: 'gradient', layout: 'center' } },
      minimal: { label: 'Minimal', params: { theme: 'light', layout: 'left' } },
    },
  }${colors.reset}

${colors.bright}Runtime Benefits:${colors.reset}
  - Content structure is guaranteed (no null checks needed)
  - Param defaults are applied automatically
  - Components receive clean { content, params } props

${colors.dim}Full guide: https://github.com/uniweb/cli/blob/main/docs/component-metadata.md${colors.reset}
`

// =============================================================================
// Subcommand Handlers
// =============================================================================

function showSiteReference() {
  log(SITE_REFERENCE)
}

function showPageReference() {
  log(PAGE_REFERENCE)
}

function showMetaReference() {
  log(META_REFERENCE)
}

// =============================================================================
// Original Docs Functionality
// =============================================================================

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const options = {
    output: 'COMPONENTS.md',
    fromSource: false,
    target: null,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--output' || arg === '-o') {
      options.output = args[++i]
    } else if (arg === '--from-source' || arg === '-s') {
      options.fromSource = true
    } else if (arg === '--target' || arg === '-t') {
      options.target = args[++i]
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    }
  }

  return options
}

/**
 * Show help message
 */
function showHelp() {
  log(`
${colors.bright}uniweb docs${colors.reset} - Documentation and configuration references

${colors.dim}Usage:${colors.reset}
  uniweb docs                         Generate COMPONENTS.md
  uniweb docs site                    Show site.yml configuration reference
  uniweb docs page                    Show page.yml configuration reference
  uniweb docs meta                    Show component meta.js reference

${colors.dim}Generation Options:${colors.reset}
  -o, --output <file>    Output filename (default: COMPONENTS.md)
  -s, --from-source      Read meta.js files directly instead of schema.json
  -t, --target <path>    Foundation directory (auto-detected if not specified)
  -h, --help             Show this help message

${colors.dim}Examples:${colors.reset}
  uniweb docs                         Generate component docs
  uniweb docs site                    Quick reference for site.yml options
  uniweb docs page                    Quick reference for page.yml options
  uniweb docs meta                    Learn about component meta.js schema
  uniweb docs --output DOCS.md        Custom output filename
  uniweb docs --from-source           Generate without building first

${colors.dim}Notes:${colors.reset}
  Run from a foundation directory to generate docs there.
  Run from a site directory to auto-detect the linked foundation.
  Run from workspace root to auto-detect foundations.
`)
}

/**
 * Detect if current directory is a foundation
 */
function isFoundation(dir) {
  const srcDir = join(dir, 'src')
  const componentsDir = join(srcDir, 'components')
  return existsSync(componentsDir)
}

/**
 * Detect if current directory is a site
 */
function isSite(dir) {
  return existsSync(join(dir, 'site.yml')) || existsSync(join(dir, 'site.yaml'))
}

/**
 * Resolve foundation path from a site directory
 * Reads package.json to find foundation dependency with file: protocol
 */
async function resolveFoundationFromSite(siteDir) {
  const pkgPath = join(siteDir, 'package.json')
  if (!existsSync(pkgPath)) {
    return null
  }

  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }

    // Look for foundation dependency with file: protocol
    // Common names: "foundation", or the foundation name from site.yml
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version === 'string' && version.startsWith('file:')) {
        const relativePath = version.slice(5) // Remove 'file:' prefix
        const absolutePath = resolve(siteDir, relativePath)

        // Check if this is actually a foundation
        if (isFoundation(absolutePath)) {
          return { name, path: absolutePath }
        }
      }
    }
  } catch {
    // Ignore parse errors
  }

  return null
}

/**
 * Generate component documentation (original functionality)
 */
async function generateComponentDocs(args) {
  const options = parseArgs(args)

  const projectDir = resolve(process.cwd())
  let foundationDir = projectDir
  let outputDir = projectDir

  // If --target specified, use it directly
  if (options.target) {
    foundationDir = resolve(projectDir, options.target)
    outputDir = foundationDir
    if (!isFoundation(foundationDir)) {
      error(`Target directory does not appear to be a foundation: ${options.target}`)
      log(`${colors.dim}Foundations have a src/components/ directory.${colors.reset}`)
      process.exit(1)
    }
    info(`Using foundation: ${options.target}`)
  }
  // Check if we're at workspace root
  else if (isWorkspaceRoot(projectDir)) {
    const foundations = await findFoundations(projectDir)

    if (foundations.length === 0) {
      error('No foundations found in this workspace.')
      log(`${colors.dim}Foundations have @uniweb/build in devDependencies.${colors.reset}`)
      process.exit(1)
    }

    let targetFoundation
    if (foundations.length === 1) {
      targetFoundation = foundations[0]
      info(`Found foundation: ${targetFoundation}`)
    } else {
      log(`${colors.dim}Multiple foundations found in workspace.${colors.reset}\n`)
      targetFoundation = await promptSelect('Select foundation:', foundations)
      if (!targetFoundation) {
        log('Cancelled.')
        process.exit(0)
      }
    }

    foundationDir = resolve(projectDir, targetFoundation)
    outputDir = foundationDir
  }
  // Check if we're in a site directory
  else if (isSite(projectDir)) {
    const foundation = await resolveFoundationFromSite(projectDir)
    if (!foundation) {
      error('Could not find a linked foundation in this site.')
      log(`${colors.dim}Make sure package.json has a foundation dependency like:${colors.reset}`)
      log(`${colors.dim}  "foundation": "file:../foundation"${colors.reset}`)
      process.exit(1)
    }

    foundationDir = foundation.path
    outputDir = projectDir
    info(`Found foundation: ${foundation.name} (${foundation.path})`)
  } else if (!isFoundation(projectDir)) {
    error('This directory does not appear to be a foundation or site.')
    log(`${colors.dim}Foundations have a src/components/ directory.${colors.reset}`)
    log(`${colors.dim}Sites have a site.yml file.${colors.reset}`)
    process.exit(1)
  }

  // Check if schema.json exists (if not using --from-source)
  const schemaPath = join(foundationDir, 'dist', 'schema.json')
  if (!options.fromSource && !existsSync(schemaPath)) {
    log(`${colors.yellow}⚠${colors.reset} No dist/schema.json found in foundation.`)
    log(`${colors.dim}Run 'uniweb build' in the foundation first, or use '--from-source'.${colors.reset}`)
    log('')
    info('Falling back to --from-source mode')
    options.fromSource = true
  }

  try {
    info('Generating documentation...')

    const result = await generateDocs(foundationDir, {
      output: join(outputDir, options.output),
      fromSource: options.fromSource,
    })

    success(`Generated ${result.outputPath}`)
    log(`${colors.dim}Documented ${result.componentCount} components${colors.reset}`)
  } catch (err) {
    error(`Failed to generate docs: ${err.message}`)
    process.exit(1)
  }
}

// =============================================================================
// Main Command Entry Point
// =============================================================================

/**
 * Main docs command - handles subcommands and generates documentation
 */
export async function docs(args) {
  // Check for subcommand as first argument
  const firstArg = args[0]

  // Handle reference subcommands
  if (firstArg === 'site') {
    showSiteReference()
    return
  }

  if (firstArg === 'page') {
    showPageReference()
    return
  }

  if (firstArg === 'meta') {
    showMetaReference()
    return
  }

  // Handle help
  if (firstArg === '--help' || firstArg === '-h') {
    showHelp()
    return
  }

  // Default: generate component documentation
  await generateComponentDocs(args)
}
