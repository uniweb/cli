/**
 * Docs Command
 *
 * Generates markdown documentation from foundation schema.
 *
 * Usage:
 *   uniweb docs                    # Generate docs for current directory
 *   uniweb docs --output README.md # Custom output filename
 *   uniweb docs --from-source      # Build schema from source (no build required)
 */

import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
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
  uniweb docs                         Generate COMPONENTS.md from schema.json
  uniweb docs --output DOCS.md        Custom output filename
  uniweb docs --from-source           Build schema from source (no build required)

${colors.dim}Options:${colors.reset}
  -o, --output <file>    Output filename (default: COMPONENTS.md)
  -s, --from-source      Read meta.js files directly instead of schema.json
  -h, --help             Show this help message

${colors.dim}Notes:${colors.reset}
  By default, docs are generated from dist/schema.json (requires build).
  Use --from-source to generate without building first.
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
 * Main docs command
 */
export async function docs(args) {
  const options = parseArgs(args)

  if (options.help) {
    showHelp()
    return
  }

  const projectDir = resolve(process.cwd())

  // Verify this is a foundation
  if (!isFoundation(projectDir)) {
    error('This directory does not appear to be a foundation.')
    log(`${colors.dim}Foundations have a src/components/ directory with component folders.${colors.reset}`)
    process.exit(1)
  }

  // Check if schema.json exists (if not using --from-source)
  const schemaPath = join(projectDir, 'dist', 'schema.json')
  if (!options.fromSource && !existsSync(schemaPath)) {
    log(`${colors.yellow}⚠${colors.reset} No dist/schema.json found.`)
    log(`${colors.dim}Run 'uniweb build' first, or use '--from-source' to read meta.js files directly.${colors.reset}`)
    log('')
    info('Falling back to --from-source mode')
    options.fromSource = true
  }

  try {
    info('Generating documentation...')

    const result = await generateDocs(projectDir, {
      output: options.output,
      fromSource: options.fromSource,
    })

    success(`Generated ${result.outputPath}`)
    log(`${colors.dim}Documented ${result.componentCount} components${colors.reset}`)
  } catch (err) {
    error(`Failed to generate docs: ${err.message}`)
    process.exit(1)
  }
}
