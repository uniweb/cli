/**
 * Invite Command
 *
 * Creates, lists, revokes, and resends foundation invites.
 *
 * Usage:
 *   uniweb invite <email>                     # Create invite (1 use, 30 days)
 *   uniweb invite <email> --uses 5            # Multi-use invite
 *   uniweb invite <email> --expires 60        # 60-day expiry
 *   uniweb invite --list                      # List invites for your foundation
 *   uniweb invite --revoke <inviteId>         # Revoke an invite
 *   uniweb invite --resend <inviteId>         # Resend an invite
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'

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
 * @param {string} flag - e.g. '--uses'
 * @returns {string|null}
 */
function parseFlag(args, flag) {
  const idx = args.indexOf(flag)
  if (idx === -1 || !args[idx + 1]) return null
  return args[idx + 1]
}

/**
 * Resolve the foundation directory (same logic as publish.js).
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
          console.log(`  ${colors.cyan}cd ${f} && ${prefix} invite ...${colors.reset}`)
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
  const token = await ensureAuth({ command: 'Creating invite' })

  const registryUrl = parseFlag(args, '--registry')
  const url = registryUrl || process.env.UNIWEB_REGISTRY_URL || 'http://localhost:4001'

  return new RemoteRegistry(url, token)
}

/**
 * Handle --list flag.
 */
async function handleList(args) {
  const foundationDir = await resolveFoundationDir(args)
  const { name } = await readSchema(foundationDir)
  const registry = await createRegistry(args)

  info(`Listing invites for ${colors.bright}${name}${colors.reset}...`)

  try {
    const invites = await registry.listInvites(name)

    if (invites.length === 0) {
      console.log(`\n  No invites found for ${name}.`)
      return
    }

    console.log('')
    for (const inv of invites) {
      const statusColor = inv.status === 'active' ? colors.green
        : inv.status === 'revoked' ? colors.red
        : colors.yellow
      console.log(`  ${statusColor}${inv.status}${colors.reset}  ${inv.email}  v${inv.majorVersion}  ${inv.usedCount}/${inv.maxUses} uses  ${colors.dim}${inv.inviteId}${colors.reset}`)
    }
    console.log('')
  } catch (err) {
    error(err.message)
    process.exit(1)
  }
}

/**
 * Handle --revoke flag.
 */
async function handleRevoke(args, inviteId) {
  const foundationDir = await resolveFoundationDir(args)
  const { name } = await readSchema(foundationDir)
  const registry = await createRegistry(args)

  info(`Revoking invite ${colors.dim}${inviteId}${colors.reset}...`)

  try {
    const result = await registry.revokeInvite(name, inviteId)
    console.log('')
    success(`Revoked invite for ${colors.bright}${result.email}${colors.reset}`)
  } catch (err) {
    error(err.message)
    process.exit(1)
  }
}

/**
 * Handle --resend flag.
 */
async function handleResend(args, inviteId) {
  const foundationDir = await resolveFoundationDir(args)
  const { name } = await readSchema(foundationDir)
  const registry = await createRegistry(args)

  info(`Resending invite ${colors.dim}${inviteId}${colors.reset}...`)

  try {
    const result = await registry.resendInvite(name, inviteId)
    console.log('')
    success(`Resent invite to ${colors.bright}${result.email}${colors.reset}`)
  } catch (err) {
    error(err.message)
    process.exit(1)
  }
}

/**
 * Handle create invite (default action).
 */
async function handleCreate(args, email) {
  const foundationDir = await resolveFoundationDir(args)
  const { name, version } = await readSchema(foundationDir)
  const registry = await createRegistry(args)

  // Parse options
  const versionFlag = parseFlag(args, '--version')
  const majorVersion = versionFlag
    ? parseInt(versionFlag, 10)
    : parseInt(version.split('.')[0], 10)

  const usesFlag = parseFlag(args, '--uses')
  const maxUses = usesFlag ? parseInt(usesFlag, 10) : 1

  const expiresFlag = parseFlag(args, '--expires')
  const expiresInDays = expiresFlag ? parseInt(expiresFlag, 10) : 30

  if (isNaN(majorVersion)) {
    error('Could not determine major version. Use --version to specify.')
    process.exit(1)
  }

  info(`Creating invite for ${colors.bright}${email}${colors.reset} → ${name} v${majorVersion}...`)

  try {
    const invite = await registry.createInvite(name, {
      email,
      majorVersion,
      maxUses,
      expiresInDays,
    })

    console.log('')
    success(`Invite created`)
    console.log('')
    console.log(`  ${colors.dim}ID:${colors.reset}       ${invite.inviteId}`)
    console.log(`  ${colors.dim}To:${colors.reset}       ${invite.email}`)
    console.log(`  ${colors.dim}For:${colors.reset}      ${name} v${invite.majorVersion}`)
    console.log(`  ${colors.dim}Uses:${colors.reset}     ${invite.maxUses}`)
    console.log(`  ${colors.dim}Expires:${colors.reset}  ${new Date(invite.expiresAt).toLocaleDateString()}`)
    console.log('')
  } catch (err) {
    error(err.message)
    process.exit(1)
  }
}

/**
 * Main invite command handler.
 */
export async function invite(args = []) {
  // Dispatch based on flags
  if (args.includes('--list')) {
    await handleList(args)
    return
  }

  const revokeId = parseFlag(args, '--revoke')
  if (revokeId) {
    await handleRevoke(args, revokeId)
    return
  }

  const resendId = parseFlag(args, '--resend')
  if (resendId) {
    await handleResend(args, resendId)
    return
  }

  // Default: create invite — first positional arg is the email
  const email = args.find(a => !a.startsWith('--') && a.includes('@'))
  if (!email) {
    error('Email is required.')
    console.log('')
    console.log(`  ${colors.dim}Usage: ${getCliPrefix()} invite <email> [--uses N] [--expires N]${colors.reset}`)
    console.log(`  ${colors.dim}       ${getCliPrefix()} invite --list${colors.reset}`)
    console.log(`  ${colors.dim}       ${getCliPrefix()} invite --revoke <id>${colors.reset}`)
    console.log(`  ${colors.dim}       ${getCliPrefix()} invite --resend <id>${colors.reset}`)
    process.exit(1)
  }

  await handleCreate(args, email)
}

export default invite
