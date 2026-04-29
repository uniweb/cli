/**
 * Handoff Command
 *
 * Creates a site record on Unicloud and transfers ownership to a client.
 * The developer builds content locally and hands off a licensed, registered site.
 *
 * Usage:
 *   uniweb handoff <email>                    # Register site + transfer to client
 *   uniweb handoff <email> --site <id>        # Specify site ID (default: auto-generated)
 *   uniweb handoff <email> --web              # Show web-based handoff instructions
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { RemoteRegistry } from '../utils/registry.js'
import { ensureAuth } from '../utils/auth.js'
import { findWorkspaceRoot, findFoundations, classifyPackage, promptSelect } from '../utils/workspace.js'
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
 * Parse a flag value from args.
 * @param {string[]} args
 * @param {string} flag - e.g. '--site'
 * @returns {string|null}
 */
function parseFlag(args, flag) {
  const idx = args.indexOf(flag)
  if (idx === -1 || !args[idx + 1]) return null
  return args[idx + 1]
}

/**
 * Resolve the foundation directory (same logic as invite.js).
 */
async function resolveFoundationDir(args) {
  const cwd = process.cwd()
  const prefix = getCliPrefix()

  const type = await classifyPackage(cwd)
  if (type === 'foundation') return cwd

  const workspaceRoot = findWorkspaceRoot(cwd)
  if (workspaceRoot) {
    const foundations = await findFoundations(workspaceRoot)

    if (foundations.length === 1) {
      return resolve(workspaceRoot, foundations[0])
    }

    if (foundations.length > 1) {
      if (isNonInteractive(args)) {
        error('Multiple foundations found. Specify which one.')
        console.log('')
        for (const f of foundations) {
          console.log(`  ${colors.cyan}cd ${f} && ${prefix} handoff ...${colors.reset}`)
        }
        process.exit(1)
      }

      const choice = await promptSelect('Which foundation?', foundations)
      if (!choice) {
        console.log('\nCancelled.')
        process.exit(0)
      }
      return resolve(workspaceRoot, choice)
    }
  }

  error('No foundation found in this workspace.')
  console.log('')
  console.log(`  ${colors.dim}\`handoff\` creates a site record for your foundation and transfers${colors.reset}`)
  console.log(`  ${colors.dim}ownership to a client — they get a licensed, ready-to-use project.${colors.reset}`)
  console.log('')
  console.log(`  ${colors.dim}Run this command from a foundation directory or workspace root.${colors.reset}`)
  process.exit(1)
}

/**
 * Read foundation name and version from dist/meta/schema.json, auto-building if needed.
 */
async function readSchema(foundationDir) {
  const distDir = join(foundationDir, 'dist')
  const foundationJs = join(distDir, 'foundation.js')
  const schemaJson = join(distDir, 'meta', 'schema.json')

  if (!existsSync(foundationJs) || !existsSync(schemaJson)) {
    console.log(`${colors.yellow}⚠${colors.reset} No build found. Building foundation...`)
    console.log('')
    execSync('npx uniweb build --target foundation', {
      cwd: foundationDir,
      stdio: 'inherit',
    })
    console.log('')

    if (!existsSync(foundationJs) || !existsSync(schemaJson)) {
      error('Build did not produce dist/foundation.js and dist/meta/schema.json')
      process.exit(1)
    }
  }

  try {
    const schema = JSON.parse(await readFile(schemaJson, 'utf8'))
    const name = schema._self?.name
    const version = schema._self?.version

    if (!name || !version) {
      error('dist/meta/schema.json missing _self.name or _self.version')
      process.exit(1)
    }

    return { name, version }
  } catch (err) {
    error(`Failed to read dist/meta/schema.json: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Create a RemoteRegistry instance with auth.
 */
async function createRegistry(args) {
  const token = await ensureAuth({ command: 'Handing off' })

  const registryUrl = parseFlag(args, '--registry')
  const url = registryUrl || process.env.UNIWEB_REGISTRY_URL || 'http://localhost:4001'

  return new RemoteRegistry(url, token)
}

/**
 * Handle --web flag: show web-based handoff guidance.
 */
function showWebHandoff(email, name) {
  console.log('')
  info(`Web-based handoff`)
  console.log('')
  console.log(`  1. Create a site on ${colors.cyan}uniweb.app${colors.reset} using ${colors.bright}${name}${colors.reset}`)
  console.log(`  2. Add pages and content`)
  console.log(`  3. Transfer ownership to ${colors.bright}${email}${colors.reset}:`)
  console.log(`     ${colors.dim}Settings → Transfer site${colors.reset}`)
  console.log('')
  console.log(`  ${colors.dim}The license stays with the site — the client can edit${colors.reset}`)
  console.log(`  ${colors.dim}and publish immediately.${colors.reset}`)
}

/**
 * Main handoff command handler.
 */
export async function handoff(args = []) {
  const prefix = getCliPrefix()

  // Extract email (first positional arg with @)
  const email = args.find(a => !a.startsWith('--') && a.includes('@'))
  if (!email) {
    error('Email is required.')
    console.log('')
    console.log(`  ${colors.dim}Usage: ${prefix} handoff <email> [--site <id>] [--web]${colors.reset}`)
    console.log('')
    console.log(`  ${colors.dim}Creates a site record for your foundation and transfers ownership${colors.reset}`)
    console.log(`  ${colors.dim}to the client. They get a licensed project, ready to use.${colors.reset}`)
    process.exit(1)
  }

  const foundationDir = await resolveFoundationDir(args)
  const { name, version } = await readSchema(foundationDir)

  // --web: guidance-only, no API call
  if (args.includes('--web')) {
    showWebHandoff(email, name)
    return
  }

  const registry = await createRegistry(args)

  // Derive site ID
  const siteIdFlag = parseFlag(args, '--site')
  const siteId = siteIdFlag || `${name}-${randomUUID().slice(0, 6)}`

  info(`Creating site ${colors.bright}${siteId}${colors.reset} with ${name} v${version}...`)

  // 1. Create site record
  let siteResult
  try {
    siteResult = await registry.createSite(siteId, { foundation: { name } })
  } catch (err) {
    if (err.statusCode === 409) {
      error(`Site "${siteId}" already exists.`)
      console.log(`  ${colors.dim}Use --site <id> to specify a different site identifier.${colors.reset}`)
      process.exit(1)
    }
    if (err.statusCode === 404) {
      error(err.message)
      console.log(`  ${colors.dim}Make sure your foundation is published: ${prefix} publish${colors.reset}`)
      process.exit(1)
    }
    error(err.message)
    process.exit(1)
  }

  // 2. Transfer ownership to client
  info(`Transferring to ${colors.bright}${email}${colors.reset}...`)

  try {
    await registry.transferSiteOwnership(siteId, email)
  } catch (err) {
    error(`Site created but transfer failed: ${err.message}`)
    console.log(`  ${colors.dim}Site "${siteId}" is registered. Transfer manually:${colors.reset}`)
    console.log(`  ${colors.dim}  PATCH /api/sites/${siteId}/owner  { "newOwner": "${email}" }${colors.reset}`)
    process.exit(1)
  }

  // 3. Show result
  console.log('')
  success(`Site created and transferred`)
  console.log('')
  console.log(`  ${colors.dim}Site:${colors.reset}        ${colors.bright}${siteId}${colors.reset}`)
  console.log(`  ${colors.dim}Foundation:${colors.reset}  ${name} v${version.split('.')[0]}`)
  console.log(`  ${colors.dim}Owner:${colors.reset}       ${email}`)
  console.log(`  ${colors.dim}License:${colors.reset}     ${siteResult.license ? `${colors.green}✓${colors.reset} granted` : `${colors.yellow}⚠${colors.reset} not granted`}`)
  console.log('')
  console.log(`  ${colors.bright}Next steps:${colors.reset}`)
  console.log(`    1. Add ${colors.cyan}id: ${siteId}${colors.reset} to your site.yml`)
  console.log(`    2. Share the site files with ${colors.bright}${email}${colors.reset}`)
  console.log(`       ${colors.dim}(git repo, zip, shared drive — any method works)${colors.reset}`)
  console.log(`    3. Client opens the project in Uniweb Studio`)
}

export default handoff
