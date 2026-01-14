/**
 * Build Command
 *
 * Builds foundations with schema generation.
 *
 * Usage:
 *   uniweb build                    # Build current directory
 *   uniweb build --target foundation # Explicitly build as foundation
 *   uniweb build --target site       # Explicitly build as site
 */

import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'

// Import build utilities from @uniweb/build
import {
  generateEntryPoint,
  buildSchema,
  discoverComponents,
  processAllPreviews,
} from '@uniweb/build'

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
 * Detect project type based on directory contents
 */
function detectProjectType(projectDir) {
  const srcDir = join(projectDir, 'src')
  const componentsDir = join(srcDir, 'components')
  const pagesDir = join(projectDir, 'pages')

  // Foundation: has src/components/ with component folders containing meta.js
  if (existsSync(componentsDir)) {
    return 'foundation'
  }

  // Site: has pages/ directory
  if (existsSync(pagesDir)) {
    return 'site'
  }

  return null
}

/**
 * Run a command and return a promise
 */
function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed with exit code ${code}`))
      }
    })

    proc.on('error', reject)
  })
}

/**
 * Build a foundation
 */
async function buildFoundation(projectDir, options = {}) {
  const srcDir = join(projectDir, 'src')
  const distDir = join(projectDir, 'dist')

  info('Building foundation...')

  // 1. Discover components
  log('')
  info('Discovering components...')
  const components = await discoverComponents(srcDir)
  const componentNames = Object.keys(components)

  if (componentNames.length === 0) {
    error('No components found with meta.js files')
    error('Make sure components are in src/components/[Name]/ with a meta.js file')
    process.exit(1)
  }

  success(`Found ${componentNames.length} components: ${componentNames.join(', ')}`)

  // 2. Generate entry point
  log('')
  info('Generating entry point...')
  const entryPath = join(srcDir, '_entry.generated.js')
  await generateEntryPoint(srcDir, entryPath)
  success('Generated _entry.generated.js')

  // 3. Build with Vite
  log('')
  info('Running Vite build...')

  // Check if vite.config.js uses the generated entry
  // For now, just run the standard vite build
  await runCommand('npx', ['vite', 'build'], projectDir)

  success('Vite build complete')

  // 4. Generate schema.json
  log('')
  info('Generating schema.json...')
  let schema = await buildSchema(srcDir)

  await mkdir(distDir, { recursive: true })

  // 5. Process preview images
  log('')
  info('Processing preview images...')
  const isProduction = process.env.NODE_ENV === 'production' || !process.env.NODE_ENV
  const { schema: updatedSchema, totalImages } = await processAllPreviews(
    srcDir,
    distDir,
    schema,
    isProduction
  )
  schema = updatedSchema

  if (totalImages > 0) {
    success(`Processed ${totalImages} preview image${totalImages > 1 ? 's' : ''} (converted to webp)`)
  } else {
    log(`  ${colors.dim}No preview images found${colors.reset}`)
  }

  // 6. Write schema.json
  const schemaPath = join(distDir, 'schema.json')
  await writeFile(schemaPath, JSON.stringify(schema, null, 2), 'utf-8')

  success(`Generated schema.json with ${componentNames.length} components`)

  // Summary
  log('')
  log(`${colors.green}${colors.bright}Build complete!${colors.reset}`)
  log('')
  log(`Output:`)
  log(`  ${colors.dim}dist/foundation.js${colors.reset}    - Bundled components`)
  log(`  ${colors.dim}dist/assets/style.css${colors.reset} - Compiled CSS`)
  log(`  ${colors.dim}dist/schema.json${colors.reset}      - Component schemas`)
  if (totalImages > 0) {
    log(`  ${colors.dim}dist/assets/[component]/${colors.reset} - Preview images`)
  }
}

/**
 * Build a site
 */
async function buildSite(projectDir, options = {}) {
  info('Building site...')

  // Just run vite build for sites
  await runCommand('npx', ['vite', 'build'], projectDir)

  success('Site build complete')
}

/**
 * Main build command handler
 */
export async function build(args = []) {
  const projectDir = process.cwd()

  // Parse arguments
  let targetType = null
  const targetIndex = args.indexOf('--target')
  if (targetIndex !== -1 && args[targetIndex + 1]) {
    targetType = args[targetIndex + 1]
    if (!['foundation', 'site'].includes(targetType)) {
      error(`Invalid target: ${targetType}`)
      log('Valid targets: foundation, site')
      process.exit(1)
    }
  }

  // Auto-detect project type if not specified
  if (!targetType) {
    targetType = detectProjectType(projectDir)

    if (!targetType) {
      error('Could not detect project type')
      log('Use --target foundation or --target site')
      process.exit(1)
    }

    info(`Detected project type: ${targetType}`)
  }

  // Run appropriate build
  try {
    if (targetType === 'foundation') {
      await buildFoundation(projectDir)
    } else {
      await buildSite(projectDir)
    }
  } catch (err) {
    error(err.message)
    process.exit(1)
  }
}

export default build
