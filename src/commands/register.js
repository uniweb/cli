/**
 * uniweb register — submit a foundation and the data schemas it defines to the
 * backend registry as one names-only `.uwx` document (uwx-format.md §5).
 *
 * `uniweb login && uniweb register`. Distinct from `uniweb publish` (which
 * targets the legacy unicloud / uniweb-edge platform) — `register` talks to the
 * new backend over HTTP at a configurable endpoint.
 *
 * Usage:
 *   uniweb register                      Build the .uwx and submit it
 *   uniweb register --scope @org         Publish names under @org (resolves @/x -> @org/x)
 *   uniweb register --dry-run            Print the .uwx; submit nothing
 *   uniweb register -o foundation.uwx    Write the .uwx to a file; submit nothing
 *   uniweb register --registry <url>     Override the submit endpoint
 *
 * Endpoint resolution: --registry <url>  >  UNIWEB_REGISTER_URL  >  the local default.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { buildRegistryPackage } from '@uniweb/build/uwx'
import { classifyPackage } from '@uniweb/build'
import { ensureAuth } from '../utils/auth.js'
import { findWorkspaceRoot, findFoundations, promptSelect } from '../utils/workspace.js'
import { isNonInteractive, getCliPrefix } from '../utils/interactive.js'

// The backend route is `/api/registry/register`; the host defaults to a local
// server and is overridable via --registry / UNIWEB_REGISTER_URL (full URL).
const DEFAULT_REGISTER_URL = 'http://localhost:8080/api/registry/register'

const colors = {
  reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[36m',
}
const log = console.log
const success = (m) => log(`${colors.green}✓${colors.reset} ${m}`)
const error = (m) => console.error(`${colors.red}✗${colors.reset} ${m}`)
const info = (m) => log(`${colors.blue}→${colors.reset} ${m}`)

function flagValue(args, name) {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('-')) return args[i + 1]
  return null
}

// The uniweb CLI version, for the `.uwx` exporter envelope. Safe fallback if the
// package.json isn't reachable.
function cliVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

/**
 * Resolve which foundation to register: the cwd if it's a foundation, else the
 * single foundation in the workspace, else prompt (or error in non-interactive).
 * Mirrors `uniweb publish`.
 */
async function resolveFoundationDir(args) {
  const cwd = process.cwd()
  if (classifyPackage(cwd) === 'foundation') return cwd

  const workspaceRoot = findWorkspaceRoot(cwd)
  if (workspaceRoot) {
    const foundations = await findFoundations(workspaceRoot)
    if (foundations.length === 1) return resolve(workspaceRoot, foundations[0])
    if (foundations.length > 1) {
      if (isNonInteractive(args)) {
        error('Multiple foundations found. Run register from the one you mean.')
        for (const f of foundations) log(`  ${colors.cyan || ''}cd ${f} && ${getCliPrefix()} register${colors.reset}`)
        process.exit(1)
      }
      const choice = await promptSelect('Which foundation?', foundations)
      if (!choice) { log('\nRegister cancelled.'); process.exit(0) }
      return resolve(workspaceRoot, choice)
    }
  }

  error('No foundation found. Run register from a foundation directory or a workspace that has one.')
  process.exit(1)
}

export async function register(args = []) {
  const dryRun = args.includes('--dry-run')
  const output = flagValue(args, '-o') || flagValue(args, '--output')
  const scope = flagValue(args, '--scope')
  const registryUrl = flagValue(args, '--registry') || process.env.UNIWEB_REGISTER_URL || DEFAULT_REGISTER_URL

  const foundationDir = await resolveFoundationDir(args)
  const schemaPath = join(foundationDir, 'dist', 'meta', 'schema.json')
  if (!existsSync(schemaPath)) {
    error('No built schema found (dist/meta/schema.json).')
    log(`  Build the foundation first: ${colors.bright}uniweb build${colors.reset}`)
    return { exitCode: 2 }
  }

  let schema
  try {
    schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
  } catch (err) {
    error(`Could not read ${schemaPath}: ${err.message}`)
    return { exitCode: 2 }
  }

  let doc
  try {
    doc = buildRegistryPackage({
      schema,
      foundationDir,
      scope,
      exporter: { tool: 'uniweb', version: cliVersion(), instance: 'build' },
    })
  } catch (err) {
    error(`Could not assemble the .uwx: ${err.message}`)
    return { exitCode: 2 }
  }
  const json = JSON.stringify(doc, null, 2)

  const defined = doc.entities.filter((e) => e.model === '@uniweb/data-schema').map((e) => e.name)
  log('')
  info(`${colors.bright}${schema._self.name}@${schema._self.version}${colors.reset}`)
  log(`  ${colors.dim}data schemas defined: ${defined.length ? defined.join(', ') : '(none)'}${colors.reset}`)

  // Preview paths — no submit, no auth needed.
  if (output) {
    writeFileSync(resolve(output), json)
    success(`Wrote ${output} (${doc.entities.length} entities) — not submitted`)
    return { exitCode: 0 }
  }
  if (dryRun) {
    log('')
    log(json)
    log('')
    info(`Dry run — would submit to ${registryUrl}`)
    return { exitCode: 0 }
  }

  // Submit: login, then POST the .uwx.
  if (!scope) {
    log(`  ${colors.yellow}!${colors.reset} ${colors.dim}No --scope given — names stay @/… and the registry will likely reject them. Pass --scope @org.${colors.reset}`)
  }
  const token = await ensureAuth({ command: 'Registering', args })
  info(`Submitting to ${colors.dim}${registryUrl}${colors.reset} …`)
  let res
  try {
    res = await fetch(registryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: json,
    })
  } catch (err) {
    error(`Could not reach the registry at ${registryUrl}: ${err.message}`)
    log(`  ${colors.dim}Set the endpoint with --registry <url> or UNIWEB_REGISTER_URL.${colors.reset}`)
    return { exitCode: 2 }
  }
  if (!res.ok) {
    error(`Registry rejected the submission: HTTP ${res.status} ${res.statusText}`)
    if (res.status === 401 || res.status === 403) {
      log(`  ${colors.dim}The registry didn't accept your \`uniweb login\` session — the registry backend may use different credentials.${colors.reset}`)
    }
    const body = await res.text().catch(() => '')
    if (body) log(`  ${colors.dim}${body.slice(0, 500)}${colors.reset}`)
    return { exitCode: 1 }
  }
  success(`Registered ${schema._self.name}@${schema._self.version}${defined.length ? ` + ${defined.length} data schema(s)` : ''}`)
  return { exitCode: 0 }
}
