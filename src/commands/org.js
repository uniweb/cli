/**
 * uniweb org — manage publish orgs on the new backend.
 *
 *   uniweb org list                 List the orgs you're a member of.
 *   uniweb org create <handle>      Create an org; you become a member.
 *
 * Auth: the new-backend session (`uniweb login`) / UNIWEB_TOKEN. Distinct from
 * the legacy platform (publish/deploy); this talks to the registry backend.
 */

import { BackendClient } from '../backend/client.js'
import { validateHandle, bareHandle } from '../utils/registry-orgs.js'

const colors = { reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m' }
const error = (m) => console.error(`${colors.red}✗${colors.reset} ${m}`)
const success = (m) => console.log(`${colors.green}✓${colors.reset} ${m}`)

export async function org(args = []) {
  const sub = args[0]

  if (sub === 'list') {
    const client = new BackendClient({ args, command: 'Listing orgs' })
    const { orgs } = await client.fetchOrgs()
    if (!orgs.length) {
      console.log('You have no orgs yet. Create one: uniweb org create <handle>')
      return { exitCode: 0 }
    }
    console.log('Your orgs:')
    for (const u of orgs) {
      console.log(`  ${colors.bright}@${u.handle}${colors.reset}${u.is_primary ? `${colors.dim} (primary)${colors.reset}` : ''}`)
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
      const org = await client.createOrg(handle)
      success(`Created ${colors.bright}@${org.handle}${colors.reset} — you're a member${org.is_primary ? ' (primary)' : ''}.`)
      console.log(`${colors.dim}Publish under it: uniweb register --scope @${org.handle}${colors.reset}`)
      return { exitCode: 0 }
    } catch (err) {
      error(err.message)
      return { exitCode: 1 }
    }
  }

  console.log('uniweb org <command>')
  console.log('  list             List orgs you belong to')
  console.log('  create <handle>  Create an org (you become a member)')
  return { exitCode: sub ? 2 : 0 }
}

export default org
