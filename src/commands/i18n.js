/**
 * i18n CLI Commands
 *
 * Commands for managing site content internationalization.
 *
 * Usage:
 *   uniweb i18n extract           Extract translatable strings to manifest
 *   uniweb i18n sync              Sync manifest with content changes
 *   uniweb i18n status            Show translation coverage per locale
 *   uniweb i18n --target <path>   Specify site directory explicitly
 *
 * When run from workspace root, auto-detects sites. If multiple exist,
 * prompts for selection.
 */

import { resolve, join } from 'path'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import yaml from 'js-yaml'
import {
  isWorkspaceRoot,
  findSites,
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

function warn(message) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`)
}

function error(message) {
  console.error(`${colors.red}✗${colors.reset} ${message}`)
}

/**
 * Parse --target option from args
 */
function parseTargetOption(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' || args[i] === '-t') {
      return {
        target: args[i + 1],
        remainingArgs: [...args.slice(0, i), ...args.slice(i + 2)],
      }
    }
  }
  return { target: null, remainingArgs: args }
}

/**
 * Main i18n command handler
 * @param {string[]} args - Command arguments
 */
export async function i18n(args) {
  const subcommand = args[0]

  if (subcommand === '--help' || subcommand === '-h') {
    showHelp()
    return
  }

  // Parse --target option
  const { target, remainingArgs } = parseTargetOption(args)

  // Default to 'sync' if no subcommand (or if first arg is an option)
  const firstArg = remainingArgs[0]
  const effectiveSubcommand = !firstArg || firstArg.startsWith('-') ? 'sync' : firstArg
  const effectiveArgs = !firstArg || firstArg.startsWith('-') ? remainingArgs : remainingArgs.slice(1)

  // Find site root
  const siteRoot = await findSiteRoot(target)
  if (!siteRoot) {
    error('Could not find site root. Make sure you are in a Uniweb site directory.')
    process.exit(1)
  }

  // Load site config for locale settings
  const config = await loadSiteConfig(siteRoot)

  switch (effectiveSubcommand) {
    case 'extract':
      await runExtract(siteRoot, config, effectiveArgs)
      break
    case 'sync':
      await runSync(siteRoot, config, effectiveArgs)
      break
    case 'status':
      await runStatus(siteRoot, config, effectiveArgs)
      break
    case 'audit':
      await runAudit(siteRoot, config, effectiveArgs)
      break
    default:
      error(`Unknown subcommand: ${effectiveSubcommand}`)
      showHelp()
      process.exit(1)
  }
}

/**
 * Find site root by looking for site.yml
 * Handles: explicit target, workspace root detection, or walking up directories
 *
 * @param {string|null} target - Explicit target path (from --target option)
 */
async function findSiteRoot(target) {
  const cwd = process.cwd()

  // If explicit target specified, use it
  if (target) {
    const targetPath = resolve(cwd, target)
    if (existsSync(join(targetPath, 'site.yml'))) {
      return targetPath
    }
    error(`Target directory does not appear to be a site: ${target}`)
    log(`${colors.dim}Sites have a site.yml file.${colors.reset}`)
    process.exit(1)
  }

  // Check if we're at workspace root
  if (isWorkspaceRoot(cwd)) {
    const sites = await findSites(cwd)

    if (sites.length === 0) {
      error('No sites found in this workspace.')
      log(`${colors.dim}Sites have @uniweb/runtime in dependencies.${colors.reset}`)
      process.exit(1)
    }

    let targetSite
    if (sites.length === 1) {
      targetSite = sites[0]
      log(`${colors.cyan}→${colors.reset} Found site: ${targetSite}`)
    } else {
      log(`${colors.dim}Multiple sites found in workspace.${colors.reset}\n`)
      targetSite = await promptSelect('Select site:', sites)
      if (!targetSite) {
        log('Cancelled.')
        process.exit(0)
      }
    }

    return resolve(cwd, targetSite)
  }

  // Walk up directories looking for site.yml
  let dir = cwd
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
  const collectionsOnly = args.includes('--collections')
  const withCollections = args.includes('--with-collections')

  // Extract page content (unless --collections only)
  if (!collectionsOnly) {
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

  // Extract collection content (if --collections or --with-collections)
  if (collectionsOnly || withCollections) {
    log(`\n${colors.cyan}Extracting collection content...${colors.reset}\n`)

    // Check if collections exist
    const dataDir = join(siteRoot, 'public', 'data')
    if (!existsSync(dataDir)) {
      if (collectionsOnly) {
        error('No collections found. Create collection data in public/data/.')
        process.exit(1)
      }
      log(`${colors.dim}No collections found in public/data/.${colors.reset}`)
      return
    }

    try {
      const { extractCollectionManifest, formatSyncReport } = await import('@uniweb/build/i18n')

      const { manifest, report } = await extractCollectionManifest(siteRoot, {
        localesDir: config.localesDir,
      })

      const unitCount = Object.keys(manifest.units).length
      if (unitCount > 0) {
        success(`Extracted ${unitCount} translatable strings from collections`)

        if (report) {
          log('')
          log(formatSyncReport(report))
        }

        log(`\nManifest written to: ${colors.dim}${config.localesDir}/collections/manifest.json${colors.reset}`)
      } else {
        log(`${colors.dim}No translatable content found in collections.${colors.reset}`)
      }
    } catch (err) {
      error(`Collection extraction failed: ${err.message}`)
      if (verbose) console.error(err)
      if (collectionsOnly) process.exit(1)
    }
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
  const showMissing = args.includes('--missing')
  const outputJson = args.includes('--json')
  const byPage = args.includes('--by-page')

  // Check if manifest exists
  const localesPath = join(siteRoot, config.localesDir)
  const manifestPath = join(localesPath, 'manifest.json')
  if (!existsSync(manifestPath)) {
    error('No manifest found. Run "uniweb i18n extract" first.')
    process.exit(1)
  }

  // For --missing mode, use auditLocale which returns detailed missing info
  if (showMissing) {
    await runStatusMissing(siteRoot, config, locale, { outputJson, byPage })
    return
  }

  // Standard status mode
  if (!outputJson) {
    log(`\n${colors.cyan}Translation Status${colors.reset}\n`)
  }

  if (config.locales.length === 0) {
    if (outputJson) {
      log(JSON.stringify({ error: 'No translation files found', locales: [] }, null, 2))
    } else {
      log(`${colors.dim}No translation files found in ${config.localesDir}/.`)
      log(`Create locale files like ${config.localesDir}/es.json to add translations.${colors.reset}`)
    }
    return
  }

  try {
    const { getTranslationStatus, formatTranslationStatus } = await import('@uniweb/build/i18n')

    const localesToCheck = locale ? [locale] : config.locales

    const status = await getTranslationStatus(siteRoot, {
      localesDir: config.localesDir,
      locales: localesToCheck,
    })

    if (outputJson) {
      log(JSON.stringify(status, null, 2))
      return
    }

    log(formatTranslationStatus(status))

    // Show next steps if there are missing translations
    const hasMissing = Object.values(status.locales).some(l => l.missing > 0)
    if (hasMissing) {
      log(`\n${colors.dim}To translate missing strings, edit the locale files in ${config.localesDir}/`)
      log(`Or use: uniweb i18n status --missing --json > missing.json${colors.reset}`)
    }
  } catch (err) {
    error(`Status check failed: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Status --missing mode - show detailed missing strings
 */
async function runStatusMissing(siteRoot, config, locale, options = {}) {
  const { outputJson = false, byPage = false } = options
  const localesPath = join(siteRoot, config.localesDir)

  if (config.locales.length === 0) {
    if (outputJson) {
      log(JSON.stringify({ error: 'No translation files found', missing: [] }, null, 2))
    } else {
      log(`${colors.dim}No translation files found in ${config.localesDir}/.${colors.reset}`)
    }
    return
  }

  try {
    const { auditLocale } = await import('@uniweb/build/i18n')

    const localesToCheck = locale ? [locale] : config.locales

    // Collect missing strings from all requested locales
    const allMissing = []
    const byLocale = {}

    for (const loc of localesToCheck) {
      const result = await auditLocale(localesPath, loc)
      byLocale[loc] = {
        total: result.total,
        translated: result.valid.length,
        missing: result.missing.length,
        coverage: result.total > 0
          ? Math.round((result.valid.length / result.total) * 100)
          : 100
      }

      // Add locale info to each missing entry
      for (const entry of result.missing) {
        allMissing.push({
          locale: loc,
          ...entry
        })
      }
    }

    // JSON output
    if (outputJson) {
      const output = {
        locales: byLocale,
        missing: allMissing
      }
      log(JSON.stringify(output, null, 2))
      return
    }

    // Human-readable output
    log(`\n${colors.cyan}Missing Translations${colors.reset}\n`)

    // Show summary per locale
    for (const [loc, info] of Object.entries(byLocale)) {
      log(`${loc}: ${info.missing} missing (${info.coverage}% coverage)`)
    }

    if (allMissing.length === 0) {
      log(`\n${colors.green}All strings are translated!${colors.reset}`)
      return
    }

    log('')

    // Group by page if requested
    if (byPage) {
      const grouped = groupByPage(allMissing)
      for (const [page, entries] of Object.entries(grouped)) {
        log(`${colors.bright}${page}${colors.reset}`)
        for (const entry of entries) {
          const preview = truncateString(entry.source, 50)
          log(`  ${colors.dim}${entry.hash}${colors.reset} "${preview}"`)
        }
        log('')
      }
    } else {
      // Flat list
      for (const entry of allMissing.slice(0, 20)) {
        const preview = truncateString(entry.source, 60)
        const context = entry.contexts?.[0]
        const location = context ? `${context.page}:${context.section}` : ''
        log(`  ${colors.dim}${entry.hash}${colors.reset} "${preview}"`)
        if (location) {
          log(`    ${colors.dim}→ ${location}${colors.reset}`)
        }
      }

      if (allMissing.length > 20) {
        log(`\n  ${colors.dim}... and ${allMissing.length - 20} more${colors.reset}`)
      }
    }

    log(`\n${colors.dim}Use --json to export for translation tools.${colors.reset}`)
  } catch (err) {
    error(`Status check failed: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Group missing entries by page
 */
function groupByPage(entries) {
  const grouped = {}
  for (const entry of entries) {
    const page = entry.contexts?.[0]?.page || 'unknown'
    if (!grouped[page]) grouped[page] = []
    grouped[page].push(entry)
  }
  return grouped
}

/**
 * Truncate string for display
 */
function truncateString(str, maxLen) {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

/**
 * Audit command - find stale and missing translations
 */
async function runAudit(siteRoot, config, args) {
  const locale = args.find(a => !a.startsWith('-'))
  const clean = args.includes('--clean')
  const verbose = args.includes('--verbose') || args.includes('-v')

  log(`\n${colors.cyan}Translation Audit${colors.reset}\n`)

  // Check if manifest exists
  const localesPath = join(siteRoot, config.localesDir)
  const manifestPath = join(localesPath, 'manifest.json')
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
    const { auditLocale, cleanLocale, formatAuditReport } = await import('@uniweb/build/i18n')

    const localesToAudit = locale ? [locale] : config.locales
    const results = []

    for (const loc of localesToAudit) {
      const result = await auditLocale(localesPath, loc)
      results.push(result)
    }

    // Show report
    log(formatAuditReport(results, { verbose }))

    // Clean if requested
    if (clean) {
      log('')
      let totalRemoved = 0

      for (const result of results) {
        if (result.stale.length > 0) {
          const staleHashes = result.stale.map(s => s.hash)
          const removed = await cleanLocale(localesPath, result.locale, staleHashes)
          if (removed > 0) {
            success(`Removed ${removed} stale entries from ${result.locale}.json`)
            totalRemoved += removed
          }
        }
      }

      if (totalRemoved === 0) {
        log(`${colors.dim}No stale entries to remove.${colors.reset}`)
      }
    } else {
      // Suggest --clean if there are stale entries
      const hasStale = results.some(r => r.stale.length > 0)
      if (hasStale) {
        log(`\n${colors.dim}Run with --clean to remove stale entries.${colors.reset}`)
      }
    }
  } catch (err) {
    error(`Audit failed: ${err.message}`)
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
  uniweb i18n [command] [options]

${colors.bright}Commands:${colors.reset}
  (default)    Same as sync - extract/update strings (runs if no command given)
  extract      Extract translatable strings to locales/manifest.json
  sync         Update manifest with content changes (detects moved/changed content)
  status       Show translation coverage per locale
  audit        Find stale translations (no longer in manifest) and missing ones

${colors.bright}Options:${colors.reset}
  -t, --target <path>  Site directory (auto-detected if not specified)
  --verbose            Show detailed output
  --dry-run            (sync) Show changes without writing files
  --clean              (audit) Remove stale entries from locale files
  --missing            (status) List all missing strings instead of summary
  --json               (status) Output as JSON for translation tools
  --by-page            (status --missing) Group missing strings by page
  --collections        (extract/status/audit) Process only collections
  --with-collections   (extract/status/audit) Include collections with pages

${colors.bright}Configuration:${colors.reset}
  Optional site.yml settings:

    i18n:
      locales: [es, fr]          # Specific locales only (default: all available)
      locales: '*'               # Explicitly all available locales
      localesDir: locales        # Directory for translation files (default: locales)

  By default, all *.json files in locales/ are treated as translation targets.

${colors.bright}Workflow:${colors.reset}
  1. Build your site:           uniweb build
  2. Extract strings:           uniweb i18n
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
  uniweb i18n extract --with-collections  # Extract pages + collections
  uniweb i18n extract --collections       # Extract collections only
  uniweb i18n sync                 # Update manifest after content changes
  uniweb i18n sync --dry-run       # Preview changes without writing
  uniweb i18n status               # Show coverage for all locales
  uniweb i18n status es            # Show coverage for Spanish only
  uniweb i18n status --missing     # List all missing strings
  uniweb i18n status es --missing --json  # Export missing for AI translation
  uniweb i18n status --missing --by-page  # Group missing by page
  uniweb i18n audit                # Find stale and missing translations
  uniweb i18n audit --clean        # Remove stale entries
  uniweb i18n --target site        # Specify site directory explicitly

${colors.bright}Notes:${colors.reset}
  Run from a site directory to operate on that site.
  Run from workspace root to auto-detect sites (prompts if multiple).
`)
}

export default i18n
