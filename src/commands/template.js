/**
 * Template Command
 *
 * Publish a site as a cloud template.
 *
 * Usage:
 *   uniweb template publish                  # Reads template name from site.yml `template:` field
 *   uniweb template publish --name my-tpl    # Override template name
 *   uniweb template publish --title "My Tpl" # Display title
 *   uniweb template publish --description "A starter template"
 *   uniweb template publish --registry <url> # Publish to a specific registry URL
 */

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import yaml from 'js-yaml'

import { ensureAuth } from '../utils/auth.js'
import { findWorkspaceRoot, findSites, classifyPackage } from '../utils/workspace.js'
import { isNonInteractive, getCliPrefix } from '../utils/interactive.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
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
 * Parse a named flag from args.
 * @param {string[]} args
 * @param {string} flag - e.g. '--name'
 * @returns {string|null}
 */
function parseFlag(args, flag) {
  const idx = args.indexOf(flag)
  if (idx === -1 || !args[idx + 1]) return null
  return args[idx + 1]
}

// Build infrastructure files to exclude from templates
const EXCLUDED_FILES = new Set([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml',
  'vite.config.js', 'vite.config.ts',
  'index.html', 'main.js', 'main.ts',
])
const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', '.git', '.vite',
])

/**
 * Resolve the site directory to publish as a template.
 *
 * Priority:
 * 1. In a site directory → use it
 * 2. site.yml in cwd (non-package site, e.g. cloud site) → use it
 * 3. At workspace root, one site → use it
 * 4. At workspace root, multiple → error
 * 5. No site → educational error
 */
async function resolveSiteDir() {
  const cwd = process.cwd()

  // Check if current directory is a site package
  const type = await classifyPackage(cwd)
  if (type === 'site') return cwd

  // Check for site.yml directly (non-package site, e.g. cloud site)
  if (existsSync(join(cwd, 'site.yml'))) return cwd

  // Check workspace
  const workspaceRoot = findWorkspaceRoot(cwd)
  if (workspaceRoot) {
    const sites = await findSites(workspaceRoot)
    if (sites.length === 1) return resolve(workspaceRoot, sites[0])
    if (sites.length > 1) {
      error('Multiple sites found. Run this command from inside the site directory.')
      process.exit(1)
    }
  }

  error('No site found. Run this command from a site directory (must contain site.yml).')
  process.exit(1)
}

/**
 * Recursively read all files in a directory, returning { relativePath: base64Content }.
 * Skips build infrastructure files and directories.
 */
async function readAllFiles(dir, baseDir = dir) {
  const files = {}
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue
      Object.assign(files, await readAllFiles(fullPath, baseDir))
    } else if (entry.isFile()) {
      if (EXCLUDED_FILES.has(entry.name)) continue
      const relPath = relative(baseDir, fullPath)
      const content = await readFile(fullPath)
      files[relPath] = content.toString('base64')
    }
  }

  return files
}

/**
 * Main template command dispatcher.
 */
export async function template(args = []) {
  const subcommand = args[0]

  if (subcommand === 'publish') {
    await templatePublish(args.slice(1))
    return
  }

  const prefix = getCliPrefix()
  error(subcommand ? `Unknown subcommand: template ${subcommand}` : 'Missing subcommand')
  console.log('')
  console.log(`${colors.bright}Usage:${colors.reset}`)
  console.log(`  ${prefix} template publish    Publish a site as a cloud template`)
  console.log('')
  console.log(`${colors.bright}Options:${colors.reset}`)
  console.log(`  --name <name>        Template registry name (overrides site.yml \`template:\` field)`)
  console.log(`  --title <title>      Display title (overrides site.yml \`name:\` field)`)
  console.log(`  --description <txt>  Description`)
  console.log(`  --registry <url>     Registry URL (default: http://localhost:4001)`)
  process.exit(1)
}

/**
 * Publish a site directory as a cloud template.
 */
async function templatePublish(args) {
  const registryUrl = parseFlag(args, '--registry')
  const nameOverride = parseFlag(args, '--name')
  const titleOverride = parseFlag(args, '--title')
  const descOverride = parseFlag(args, '--description')

  // 1. Resolve site directory
  const siteDir = await resolveSiteDir()

  // 2. Read and parse site.yml
  const siteYmlPath = join(siteDir, 'site.yml')
  if (!existsSync(siteYmlPath)) {
    error('No site.yml found in this directory')
    process.exit(1)
  }

  const siteYmlContent = await readFile(siteYmlPath, 'utf8')
  const siteConfig = yaml.load(siteYmlContent) || {}

  // 3. Determine template name: --name flag > site.yml `template:` field > directory name
  const templateName = nameOverride || siteConfig.template || siteDir.split('/').pop()

  if (!siteConfig.foundation) {
    error('site.yml must declare a foundation')
    process.exit(1)
  }

  // 4. Collect all content files (skip build infrastructure)
  info(`Collecting files from ${colors.dim}${siteDir}${colors.reset}`)
  const files = await readAllFiles(siteDir)
  const fileCount = Object.keys(files).length

  if (fileCount === 0) {
    error('No files found to publish')
    process.exit(1)
  }

  console.log(`  ${colors.dim}${fileCount} files${colors.reset}`)

  // 5. Authenticate
  const token = await ensureAuth({ command: 'Publishing template' })

  // 6. Build payload
  const url = registryUrl || process.env.UNIWEB_REGISTRY_URL || 'http://localhost:4001'

  const payload = { name: templateName, files }
  if (titleOverride || siteConfig.name) {
    payload.title = titleOverride || siteConfig.name
  }
  if (descOverride) payload.description = descOverride

  // 7. Publish via API
  info(`Publishing template ${colors.bright}${templateName}${colors.reset} to ${url}`)

  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${url}/api/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  const body = await res.json()

  if (!res.ok) {
    error(body.error || `Server error (${res.status})`)
    process.exit(1)
  }

  console.log('')
  success(`Published template ${colors.bright}${templateName}${colors.reset}`)
  console.log(`  ${colors.dim}Foundation: ${body.foundation}${colors.reset}`)
  console.log(`  ${colors.dim}Files: ${body.filesCount}${colors.reset}`)
}

export default template
