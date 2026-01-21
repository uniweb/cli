/**
 * Docs Command
 *
 * Generates markdown documentation from foundation schema.
 *
 * Usage:
 *   uniweb docs                    # Generate docs for current directory
 *   uniweb docs --output README.md # Custom output filename
 *   uniweb docs --from-source      # Build schema from source (no build required)
 *
 * When run from a site directory, automatically finds and documents the
 * linked foundation, placing COMPONENTS.md in the site folder.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { generateDocs } from '@uniweb/build'

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

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const options = {
    output: 'COMPONENTS.md',
    fromSource: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--output' || arg === '-o') {
      options.output = args[++i]
    } else if (arg === '--from-source' || arg === '-s') {
      options.fromSource = true
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
${colors.bright}uniweb docs${colors.reset} - Generate component documentation

${colors.dim}Usage:${colors.reset}
  uniweb docs                         Generate COMPONENTS.md
  uniweb docs --output DOCS.md        Custom output filename
  uniweb docs --from-source           Build schema from source (no build required)

${colors.dim}Options:${colors.reset}
  -o, --output <file>    Output filename (default: COMPONENTS.md)
  -s, --from-source      Read meta.js files directly instead of schema.json
  -h, --help             Show this help message

${colors.dim}Notes:${colors.reset}
  Run from a foundation directory to generate docs there.
  Run from a site directory to auto-detect the linked foundation
  and generate docs in the site folder for convenience.
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
 * Main docs command
 */
export async function docs(args) {
  const options = parseArgs(args)

  if (options.help) {
    showHelp()
    return
  }

  const projectDir = resolve(process.cwd())
  let foundationDir = projectDir
  let outputDir = projectDir

  // Check if we're in a site directory
  if (isSite(projectDir)) {
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
