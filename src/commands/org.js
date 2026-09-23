/**
 * uniweb org — the orgs you belong to, on the backend you are logged in to.
 *
 *   uniweb org list                 Your personal scope, and the orgs you're a member of.
 *   uniweb org create <handle>      Create an org; you become a member.
 *
 * ⭐ You need no org to register a foundation: `@<your handle>` is your personal scope
 * (2026-09-23). An org is for a scope — and sites — you share, and it needs a handle
 * of its own: a backend refuses one named after an account, yours included.
 *
 * Auth: the session of the backend you are logged in to (`uniweb login`) / UNIWEB_TOKEN.
 */

import { BackendClient } from '../backend/client.js'
import { validateHandle, bareHandle } from '../utils/registry-orgs.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m'
}
const error = (m) => console.error(`${colors.red}✗${colors.reset} ${m}`)
const success = (m) => console.log(`${colors.green}✓${colors.reset} ${m}`)

export async function org(args = []) {
  const sub = args[0]

  if (sub === 'list') {
    const client = new BackendClient({ args, command: 'Listing orgs' })
    const { account_handle: mine, orgs: all } = await client.fetchOrgs()
    // An org named after you — made before 2026-09-23 — is your personal scope's `@`.
    const orgs = all.filter((u) => u.handle !== mine)
    if (mine) {
      console.log(
        `Your personal scope: ${colors.bright}@${mine}${colors.reset}${colors.dim} — register under it with no org${colors.reset}`
      )
    }
    if (!orgs.length) {
      console.log(
        `You belong to no org. To share a scope and sites with others: uniweb org create <handle>`
      )
      return { exitCode: 0 }
    }
    console.log('Your orgs:')
    for (const u of orgs) {
      console.log(
        `  ${colors.bright}@${u.handle}${colors.reset}${u.is_primary ? `${colors.dim} (primary)${colors.reset}` : ''}`
      )
    }
    return { exitCode: 0 }
  }

  if (sub === 'create') {
    const handle = bareHandle(args[1])
    if (!handle) {
      error('Usage: uniweb org create <handle>')
      return { exitCode: 2 }
    }
    const invalid = validateHandle(handle)
    if (invalid) {
      error(invalid)
      return { exitCode: 2 }
    }
    const client = new BackendClient({ args, command: 'Creating an org' })
    try {
      // Named after you, it is your personal scope already — and a backend refuses it.
      const { account_handle: mine } = await client.fetchOrgs()
      if (mine && handle === mine) {
        error(
          `@${handle} is your personal scope already — you can register under it with no org. An org needs a handle of its own.`
        )
        return { exitCode: 2 }
      }
      const org = await client.createOrg(handle)
      success(
        `Created ${colors.bright}@${org.handle}${colors.reset} — you're a member${org.is_primary ? ' (primary)' : ''}.`
      )
      console.log(
        `${colors.dim}Register under it: uniweb register --scope @${org.handle}${colors.reset}`
      )
      return { exitCode: 0 }
    } catch (err) {
      error(err.message)
      return { exitCode: 1 }
    }
  }

  console.log('uniweb org <command>')
  console.log('  list             Your personal scope, and the orgs you belong to')
  console.log('  create <handle>  Create an org (you become a member)')
  return { exitCode: sub ? 2 : 0 }
}

export default org
