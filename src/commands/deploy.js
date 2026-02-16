/**
 * Deploy Command
 *
 * Deploys a built site to Uniweb hosting.
 *
 * Usage:
 *   uniweb deploy                          # Deploy to Uniweb hosting
 *   uniweb deploy --local                  # Deploy to local server (no auth)
 *   uniweb deploy --registry <url>         # Deploy to a specific server URL
 *   uniweb deploy --dry-run                # Show what would be deployed
 *   uniweb deploy --prod                   # Deploy to production (future)
 */

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, join, basename, relative } from 'node:path'
import { execSync } from 'node:child_process'

import { ensureAuth } from '../utils/auth.js'
import { findWorkspaceRoot, findSites, findFoundations, classifyPackage, promptSelect } from '../utils/workspace.js'
import { isNonInteractive, getCliPrefix } from '../utils/interactive.js'

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
 * Resolve the site directory to deploy.
 *
 * Priority:
 * 1. In a site directory → use it
 * 2. At workspace root, one site → use it
 * 3. At workspace root, multiple → prompt (or error if non-interactive)
 * 4. No site → educational error with alternatives
 *
 * @param {string[]} args
 * @returns {Promise<string>} Absolute path to the site directory
 */
async function resolveSiteDir(args) {
  const cwd = process.cwd()
  const prefix = getCliPrefix()

  // Check if current directory is a site
  const type = await classifyPackage(cwd)
  if (type === 'site') {
    return cwd
  }

  // Check workspace
  const workspaceRoot = findWorkspaceRoot(cwd)
  if (workspaceRoot) {
    const sites = await findSites(workspaceRoot)

    if (sites.length === 1) {
      return resolve(workspaceRoot, sites[0])
    }

    if (sites.length > 1) {
      if (isNonInteractive(args)) {
        error('Multiple sites found. Specify which one to deploy.')
        console.log('')
        for (const s of sites) {
          console.log(`  ${colors.cyan}cd ${s} && ${prefix} deploy${colors.reset}`)
        }
        process.exit(1)
      }

      const choice = await promptSelect('Which site?', sites)
      if (!choice) {
        console.log('\nDeploy cancelled.')
        process.exit(0)
      }
      return resolve(workspaceRoot, choice)
    }
  }

  // No site found — educational error
  error('No site found in this workspace.')
  console.log('')
  console.log(`  ${colors.dim}\`deploy\` uploads your built site to Uniweb hosting.${colors.reset}`)
  console.log('')
  console.log(`  ${colors.dim}To deploy to other platforms:${colors.reset}`)
  console.log(`    ${colors.bright}vercel${colors.reset}               Vercel`)
  console.log(`    ${colors.bright}netlify deploy${colors.reset}       Netlify`)
  console.log(`    Or upload ${colors.cyan}dist/${colors.reset} to any static host`)
  process.exit(1)
}

/**
 * Parse --registry <url> from args.
 * @param {string[]} args
 * @returns {string|null}
 */
function parseRegistryUrl(args) {
  const idx = args.indexOf('--registry')
  if (idx === -1 || !args[idx + 1]) return null
  return args[idx + 1]
}

/**
 * Derive a siteId from the site's package.json or directory name.
 * @param {string} siteDir
 * @returns {Promise<string>}
 */
async function deriveSiteId(siteDir) {
  const pkgPath = join(siteDir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
      if (pkg.name) return pkg.name
    } catch {
      // Fall through
    }
  }
  return basename(siteDir)
}

/**
 * Walk a directory recursively and collect all files as base64.
 * @param {string} dir
 * @returns {Promise<Object<string, string>>} Map of relative paths to base64 content
 */
async function collectFiles(dir) {
  const files = {}
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const fullPath = join(entry.parentPath || entry.path, entry.name)
    const relPath = relative(dir, fullPath)
    const content = await readFile(fullPath)
    files[relPath] = content.toString('base64')
  }

  return files
}

/**
 * Main deploy command handler
 */
export async function deploy(args = []) {
  const isLocal = args.includes('--local')
  const isDryRun = args.includes('--dry-run')
  const registryUrl = parseRegistryUrl(args)
  const prefix = getCliPrefix()

  // 1. Resolve site directory
  const siteDir = await resolveSiteDir(args)

  // 2. Check auth (unless --local)
  let token = null
  if (!isLocal) {
    token = await ensureAuth({ command: 'Deploying' })
  }

  // 3. Auto-build if dist/ is missing
  const distDir = join(siteDir, 'dist')
  const indexHtml = join(distDir, 'index.html')

  if (!existsSync(indexHtml)) {
    console.log(`${colors.yellow}⚠${colors.reset} No build found. Building site...`)
    console.log('')
    execSync('npx uniweb build', {
      cwd: siteDir,
      stdio: 'inherit',
    })
    console.log('')

    if (!existsSync(indexHtml)) {
      error('Build did not produce dist/index.html')
      process.exit(1)
    }
  }

  // 4. Derive siteId
  const siteId = await deriveSiteId(siteDir)

  // 5. Collect files from dist/
  const files = await collectFiles(distDir)
  const filesCount = Object.keys(files).length

  // 6. Dry-run check
  if (isDryRun) {
    console.log('')
    info(`Would deploy ${colors.bright}${siteId}${colors.reset} (${filesCount} files)`)
    console.log(`  ${colors.dim}Source: ${distDir}${colors.reset}`)
    const serverUrl = registryUrl || process.env.UNIWEB_REGISTRY_URL || 'http://localhost:4001'
    console.log(`  ${colors.dim}Target: ${serverUrl}/sites/${siteId}/${colors.reset}`)
    return
  }

  // 7. Deploy
  const serverUrl = registryUrl || process.env.UNIWEB_REGISTRY_URL || 'http://localhost:4001'
  info(`Deploying ${colors.bright}${siteId}${colors.reset} (${filesCount} files)...`)

  const headers = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const payload = {
    siteId,
    files,
    metadata: {
      deployedBy: isLocal ? 'local' : 'cli',
    },
  }

  let res
  try {
    res = await fetch(`${serverUrl}/deploy`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
  } catch (err) {
    error(`Could not connect to ${serverUrl}`)
    console.log('')
    console.log(`  ${colors.dim}Make sure the cloud server is running:${colors.reset}`)
    console.log(`    ${colors.cyan}cd packages/cloud && pnpm dev${colors.reset}`)
    process.exit(1)
  }

  const body = await res.json()

  if (!res.ok) {
    if (res.status === 401) {
      error('Authentication failed.')
      console.log(`  Run ${colors.cyan}${prefix} login${colors.reset} to refresh your credentials.`)
      process.exit(1)
    }
    error(body.error || `Deploy failed (${res.status})`)
    process.exit(1)
  }

  console.log('')
  success(`Deployed ${colors.bright}${siteId}${colors.reset}`)

  const siteUrl = body.siteUrl
    ? `${serverUrl}${body.siteUrl}`
    : `${serverUrl}/sites/${siteId}/`
  console.log(`  ${colors.cyan}${siteUrl}${colors.reset}`)

  // Cross-promotion: if workspace has a foundation, tip about publish
  const workspaceRoot = findWorkspaceRoot(siteDir)
  if (workspaceRoot) {
    const foundations = await findFoundations(workspaceRoot)
    if (foundations.length > 0) {
      console.log('')
      console.log(`  ${colors.dim}Tip: Run \`${prefix} publish\` to register your foundation on the Uniweb Registry.${colors.reset}`)
    }
  }
}

export default deploy
