/**
 * i18n CLI Commands
 *
 * Commands for managing site content internationalization.
 *
 * Usage:
 *   uniweb i18n extract      Extract translatable strings to manifest
 *   uniweb i18n sync         Sync manifest with content changes
 *   uniweb i18n status       Show translation coverage per locale
 */

import { resolve, join } from 'path'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import yaml from 'js-yaml'

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

function warn(message) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`)
}

function error(message) {
  console.error(`${colors.red}✗${colors.reset} ${message}`)
}

/**
 * Main i18n command handler
 * @param {string[]} args - Command arguments
 */
export async function i18n(args) {
  const subcommand = args[0]

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    showHelp()
    return
  }

  // Find site root
  const siteRoot = await findSiteRoot()
  if (!siteRoot) {
    error('Could not find site root. Make sure you are in a Uniweb site directory.')
    process.exit(1)
  }

  // Load site config for locale settings
  const config = await loadSiteConfig(siteRoot)

  switch (subcommand) {
    case 'extract':
      await runExtract(siteRoot, config, args.slice(1))
      break
    case 'sync':
      await runSync(siteRoot, config, args.slice(1))
      break
    case 'status':
      await runStatus(siteRoot, config, args.slice(1))
      break
    default:
      error(`Unknown subcommand: ${subcommand}`)
      showHelp()
      process.exit(1)
  }
}

/**
 * Find site root by looking for site.yml
 */
async function findSiteRoot() {
  let dir = process.cwd()

  // Check current directory and parents
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'site.yml'))) {
      return dir
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }

  return null
}

/**
 * Load site configuration
 *
 * Resolves locales from config:
 * - undefined → all available locales (from locales/*.json)
 * - '*' → explicitly all available locales
 * - ['es', 'fr'] → only those specific locales
 */
async function loadSiteConfig(siteRoot) {
  const configPath = join(siteRoot, 'site.yml')
  const content = await readFile(configPath, 'utf-8')
  const config = yaml.load(content) || {}

  const localesDir = config.i18n?.localesDir || 'locales'
  const localesPath = join(siteRoot, localesDir)

  // Resolve locales (undefined/'*' → all available, array → specific)
  const { resolveLocales } = await import('@uniweb/build/i18n')
  const locales = await resolveLocales(config.i18n?.locales, localesPath)

  return {
    defaultLocale: config.defaultLanguage || 'en',
    locales,
    localesDir,
    ...config.i18n,
  }
}

/**
 * Extract command - extract translatable strings from site content
 */
async function runExtract(siteRoot, config, args) {
  const verbose = args.includes('--verbose') || args.includes('-v')

  log(`\n${colors.cyan}Extracting translatable content...${colors.reset}\n`)

  // Check if site has been built
  const siteContentPath = join(siteRoot, 'dist', 'site-content.json')
  if (!existsSync(siteContentPath)) {
    error('Site content not found. Run "uniweb build" first.')
    process.exit(1)
  }

  try {
    // Dynamic import to avoid loading at CLI startup
    const { extractManifest, formatSyncReport } = await import('@uniweb/build/i18n')

    const { manifest, report } = await extractManifest(siteRoot, {
      localesDir: config.localesDir,
      siteContentPath,
      verbose,
    })

    // Show results
    const unitCount = Object.keys(manifest.units).length
    success(`Extracted ${unitCount} translatable strings`)

    if (report) {
      log('')
      log(formatSyncReport(report))
    }

    log(`\nManifest written to: ${colors.dim}${config.localesDir}/manifest.json${colors.reset}`)

    if (config.locales.length === 0) {
      log(`\n${colors.dim}No translation files found in ${config.localesDir}/.`)
      log(`After translating, create locale files like ${config.localesDir}/es.json${colors.reset}`)
    }
  } catch (err) {
    error(`Extraction failed: ${err.message}`)
    if (verbose) console.error(err)
    process.exit(1)
  }
}

/**
 * Sync command - detect changes and update manifest
 */
async function runSync(siteRoot, config, args) {
  const verbose = args.includes('--verbose') || args.includes('-v')
  const dryRun = args.includes('--dry-run')

  log(`\n${colors.cyan}Syncing i18n manifest...${colors.reset}\n`)

  // Check if site has been built
  const siteContentPath = join(siteRoot, 'dist', 'site-content.json')
  if (!existsSync(siteContentPath)) {
    error('Site content not found. Run "uniweb build" first.')
    process.exit(1)
  }

  // Check if manifest exists
  const manifestPath = join(siteRoot, config.localesDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    warn('No existing manifest found. Running extract instead.')
    return runExtract(siteRoot, config, args)
  }

  try {
    const { extractManifest, formatSyncReport } = await import('@uniweb/build/i18n')

    if (dryRun) {
      log(`${colors.dim}(dry run - no files will be modified)${colors.reset}\n`)
    }

    const { manifest, report } = await extractManifest(siteRoot, {
      localesDir: config.localesDir,
      siteContentPath,
      verbose,
      dryRun,
    })

    log(formatSyncReport(report))

    if (!dryRun) {
      success('\nManifest updated')
    }
  } catch (err) {
    error(`Sync failed: ${err.message}`)
    if (verbose) console.error(err)
    process.exit(1)
  }
}

/**
 * Status command - show translation coverage
 */
async function runStatus(siteRoot, config, args) {
  const locale = args.find(a => !a.startsWith('-'))

  log(`\n${colors.cyan}Translation Status${colors.reset}\n`)

  // Check if manifest exists
  const manifestPath = join(siteRoot, config.localesDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    error('No manifest found. Run "uniweb i18n extract" first.')
    process.exit(1)
  }

  if (config.locales.length === 0) {
    log(`${colors.dim}No translation files found in ${config.localesDir}/.`)
    log(`Create locale files like ${config.localesDir}/es.json to add translations.${colors.reset}`)
    return
  }

  try {
    const { getTranslationStatus, formatTranslationStatus } = await import('@uniweb/build/i18n')

    const localesToCheck = locale ? [locale] : config.locales

    const status = await getTranslationStatus(siteRoot, {
      localesDir: config.localesDir,
      locales: localesToCheck,
    })

    log(formatTranslationStatus(status))

    // Show next steps if there are missing translations
    const hasMissing = Object.values(status.locales).some(l => l.missing > 0)
    if (hasMissing) {
      log(`\n${colors.dim}To translate missing strings, edit the locale files in ${config.localesDir}/`)
      log(`Or use AI tools with the manifest.json as reference.${colors.reset}`)
    }
  } catch (err) {
    error(`Status check failed: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Show help for i18n commands
 */
function showHelp() {
  log(`
${colors.cyan}${colors.bright}Uniweb i18n${colors.reset}

Site content internationalization commands.

${colors.bright}Usage:${colors.reset}
  uniweb i18n <command> [options]

${colors.bright}Commands:${colors.reset}
  extract      Extract translatable strings to locales/manifest.json
  sync         Update manifest with content changes (detects moved/changed content)
  status       Show translation coverage per locale

${colors.bright}Options:${colors.reset}
  --verbose    Show detailed output
  --dry-run    (sync) Show changes without writing files

${colors.bright}Configuration:${colors.reset}
  Optional site.yml settings:

    i18n:
      locales: [es, fr]          # Specific locales only (default: all available)
      locales: '*'               # Explicitly all available locales
      localesDir: locales        # Directory for translation files (default: locales)

  By default, all *.json files in locales/ are treated as translation targets.

${colors.bright}Workflow:${colors.reset}
  1. Build your site:           uniweb build
  2. Extract strings:           uniweb i18n extract
  3. Translate locale files:    Edit locales/es.json, locales/fr.json, etc.
  4. Build with translations:   uniweb build (generates locale-specific output)

${colors.bright}File Structure:${colors.reset}
  locales/
    manifest.json     Auto-generated: source strings + hashes + contexts
    es.json           Translations for Spanish
    fr.json           Translations for French
    _memory.json      Optional: translation memory for reuse

${colors.bright}Examples:${colors.reset}
  uniweb i18n extract              # Extract all translatable strings
  uniweb i18n extract --verbose    # Show extracted strings
  uniweb i18n sync                 # Update manifest after content changes
  uniweb i18n sync --dry-run       # Preview changes without writing
  uniweb i18n status               # Show coverage for all locales
  uniweb i18n status es            # Show coverage for Spanish only
`)
}

export default i18n
