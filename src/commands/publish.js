/**
 * Publish Command
 *
 * Publishes a foundation to a registry so content authors can use it.
 *
 * Usage:
 *   uniweb publish                          # Publish to remote registry
 *   uniweb publish --local                  # Publish to local registry (.unicloud/)
 *   uniweb publish --registry <url>         # Publish to a specific registry URL
 *   uniweb publish --dry-run                # Show what would be published
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'

import { createLocalRegistry, RemoteRegistry } from '../utils/registry.js'
import { readAuth, isExpired } from '../utils/auth.js'
import { findWorkspaceRoot, findFoundations, findSites, classifyPackage, promptSelect } from '../utils/workspace.js'
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
 * Resolve the foundation directory to publish.
 *
 * Priority:
 * 1. In a foundation directory → use it
 * 2. At workspace root, one foundation → use it
 * 3. At workspace root, multiple → prompt (or error if non-interactive)
 * 4. No foundation → educational error
 *
 * @param {string[]} args
 * @returns {Promise<string>} Absolute path to the foundation directory
 */
async function resolveFoundationDir(args) {
  const cwd = process.cwd()
  const prefix = getCliPrefix()

  // Check if current directory is a foundation
  const type = await classifyPackage(cwd)
  if (type === 'foundation') {
    return cwd
  }

  // Check workspace
  const workspaceRoot = findWorkspaceRoot(cwd)
  if (workspaceRoot) {
    const foundations = await findFoundations(workspaceRoot)

    if (foundations.length === 1) {
      return resolve(workspaceRoot, foundations[0])
    }

    if (foundations.length > 1) {
      if (isNonInteractive(args)) {
        error('Multiple foundations found. Specify which one to publish.')
        console.log('')
        for (const f of foundations) {
          console.log(`  ${colors.cyan}cd ${f} && ${prefix} publish${colors.reset}`)
        }
        process.exit(1)
      }

      const choice = await promptSelect('Which foundation?', foundations)
      if (!choice) {
        console.log('\nPublish cancelled.')
        process.exit(0)
      }
      return resolve(workspaceRoot, choice)
    }
  }

  // No foundation found — educational error
  error('No foundation found in this workspace.')
  console.log('')
  console.log(`  ${colors.dim}\`publish\` shares your foundation with content authors so they can${colors.reset}`)
  console.log(`  ${colors.dim}create and edit sites in the Uniweb app — no code required.${colors.reset}`)
  console.log('')
  console.log(`  ${colors.dim}To publish, run this command from a foundation directory, or from a${colors.reset}`)
  console.log(`  ${colors.dim}workspace root that contains a foundation.${colors.reset}`)
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
 * Main publish command handler
 */
export async function publish(args = []) {
  const isLocal = args.includes('--local')
  const isDryRun = args.includes('--dry-run')
  const registryUrl = parseRegistryUrl(args)

  // 1. Resolve foundation directory
  const foundationDir = await resolveFoundationDir(args)

  // Verify it's actually a foundation (has src/foundation.js)
  if (!existsSync(join(foundationDir, 'src', 'foundation.js'))) {
    error('Not a foundation directory (no src/foundation.js)')
    process.exit(1)
  }

  // 2. Auto-build if dist/ is missing
  const distDir = join(foundationDir, 'dist')
  const foundationJs = join(distDir, 'foundation.js')
  const schemaJson = join(distDir, 'schema.json')

  if (!existsSync(foundationJs) || !existsSync(schemaJson)) {
    console.log(`${colors.yellow}⚠${colors.reset} No build found. Building foundation...`)
    console.log('')
    execSync('npx uniweb build --target foundation', {
      cwd: foundationDir,
      stdio: 'inherit',
    })
    console.log('')

    if (!existsSync(foundationJs) || !existsSync(schemaJson)) {
      error('Build did not produce dist/foundation.js and dist/schema.json')
      process.exit(1)
    }
  }

  // 3. Read name and version from schema.json
  let schema
  try {
    schema = JSON.parse(await readFile(schemaJson, 'utf8'))
  } catch (err) {
    error(`Failed to read dist/schema.json: ${err.message}`)
    process.exit(1)
  }

  const name = schema._self?.name
  const version = schema._self?.version

  if (!name || !version) {
    error('dist/schema.json missing _self.name or _self.version')
    console.log(`${colors.dim}  Ensure your package.json has "name" and "version" fields.${colors.reset}`)
    process.exit(1)
  }

  // 4. Create registry (local or remote)
  const isRemote = !isLocal
  let registry

  if (isLocal) {
    registry = createLocalRegistry(foundationDir)
  } else {
    // Remote publish — check auth
    const auth = await readAuth()
    if (!auth || !auth.token) {
      error('Not logged in.')
      console.log('')
      console.log(`  Run ${colors.cyan}${getCliPrefix()} login${colors.reset} first, then try again.`)
      process.exit(1)
    }

    if (isExpired(auth)) {
      error('Session expired.')
      console.log('')
      console.log(`  Run ${colors.cyan}${getCliPrefix()} login${colors.reset} to refresh your credentials.`)
      process.exit(1)
    }

    const url = registryUrl || process.env.UNIWEB_REGISTRY_URL || 'http://localhost:4001'
    registry = new RemoteRegistry(url, auth.token)
  }

  const registryLabel = isLocal ? 'local registry' : `registry`

  // 5. Check for duplicates
  if (await registry.exists(name, version)) {
    console.log('')
    error(`${colors.bright}${name}@${version}${colors.reset} is already published.`)
    console.log('')
    console.log(`  Bump the version in foundation.js to publish an update:`)
    console.log(`    ${colors.dim}export const version = '${bumpPatch(version)}'${colors.reset}`)
    process.exit(1)
  }

  // 6. Dry-run check
  if (isDryRun) {
    console.log('')
    info(`Would publish ${colors.bright}${name}@${version}${colors.reset} to ${registryLabel}`)
    console.log(`  ${colors.dim}Source: ${distDir}${colors.reset}`)
    if (isLocal) {
      console.log(`  ${colors.dim}Target: ${registry.getPackagePath(name, version)}${colors.reset}`)
    } else {
      console.log(`  ${colors.dim}Target: ${registry.apiUrl}${colors.reset}`)
    }
    return
  }

  // 7. Publish
  info(`Publishing ${colors.bright}${name}@${version}${colors.reset} to ${registryLabel}...`)

  try {
    await registry.publish(name, version, distDir, {
      publishedBy: isLocal ? 'local' : 'cli',
    })
  } catch (err) {
    if (err.code === 'CONFLICT') {
      error(`${colors.bright}${name}@${version}${colors.reset} already exists on the registry.`)
      console.log(`  Bump the version in foundation.js to publish an update.`)
      process.exit(1)
    }
    if (err.code === 'UNAUTHORIZED') {
      error('Authentication failed.')
      console.log(`  Run ${colors.cyan}${getCliPrefix()} login${colors.reset} to refresh your credentials.`)
      process.exit(1)
    }
    throw err
  }

  console.log('')
  success(`Published ${colors.bright}${name}@${version}${colors.reset}`)

  // Cross-promotion: if workspace has a site, tip about deploy
  const workspaceRoot = findWorkspaceRoot(foundationDir)
  if (workspaceRoot) {
    const sites = await findSites(workspaceRoot)
    if (sites.length > 0) {
      console.log('')
      console.log(`  ${colors.dim}Tip: Run \`${getCliPrefix()} deploy\` to deploy your site.${colors.reset}`)
    }
  }
}

/**
 * Bump the patch version of a semver string.
 * @param {string} version - e.g. "1.0.0"
 * @returns {string} - e.g. "1.0.1"
 */
function bumpPatch(version) {
  const parts = version.split('.')
  if (parts.length !== 3) return version
  parts[2] = String(Number(parts[2]) + 1)
  return parts.join('.')
}

export default publish
