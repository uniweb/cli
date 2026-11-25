/**
 * `uniweb engine setup | start | stop | status | reset` — the engine on this machine, for the
 * project you are in (`./local.js` has where it lives and how a project finds it).
 *
 *   setup [--engine <dir>]   give the project its engine and point it there (`./setup.js`)
 *   start | stop [<name>]    start it and wait until it answers; stop it, keeping its data
 *   status [<name>]          running or not, its addresses, and whether the CLI works with it
 *   guide [<name>]           print the engine's own guide (its AGENTS.md): what the backend
 *                            is, and the bar a solution meets. Read it from here, not copied
 *                            into the project, so it is the running engine's
 *   reset [<name>] --yes     start over: its data is wiped, and `uniweb dev` registers the
 *                            project's types again. What proves `blueprint.yml` matches what was
 *                            tested before going live
 *
 * `<name>` is an engine in `~/.uniweb/engines/`; without it, the one the project's `$devBackend`
 * names.
 *
 * @module
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { findWorkspaceRoot } from '../utils/workspace.js'
import { discoverSites } from '../utils/discover.js'
import { loggedInOrigin } from '../utils/config.js'
import { runRegistryLogin } from '../utils/registry-auth.js'
import { setupEngine } from './setup.js'
import {
  dockerProblem,
  engineDir,
  engineGuidePath,
  engineRunning,
  findEngineFor,
  originOf,
  readEngineFile,
  readEngineInfo,
  startEngine,
  stopEngine,
  waitReady,
  wipeEngine,
} from './local.js'

const c = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', bold: '\x1b[1m' }
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`),
}

export const ENGINE_VERBS = ['setup', 'start', 'stop', 'status', 'reset', 'guide']

/**
 * @param {string} sub
 * @param {string[]} rest - the arguments after it
 * @returns {Promise<{ exitCode: number }>}
 */
export async function engineVerb(sub, rest) {
  const positional = positionals(rest)

  if (sub === 'setup') {
    const site = await projectSite()
    if (!site) {
      say.err('Run this from a project: a folder with a site.yml, or a workspace holding one.')
      return { exitCode: 2 }
    }
    const from = flagValue(rest, '--engine')
    const result = await setupEngine({ siteDir: site.dir, projectName: site.projectName, from: from ? resolve(from) : null, log: (m) => console.log(m) })
    if (!result.ok) {
      say.err(result.reason)
      return { exitCode: 1 }
    }
    printReady(result)
    return { exitCode: 0 }
  }

  const found = await engineFor(positional[0])
  if (!found) {
    say.err(
      positional[0]
        ? `There is no engine named ${positional[0]} on this machine.`
        : 'This project has no engine on this machine. Give it one: uniweb engine setup'
    )
    return { exitCode: 2 }
  }
  const { name, dir } = found

  if (sub === 'guide') {
    const at = engineGuidePath(dir)
    if (!at) {
      say.err(`The engine ${name} carries no guide (${dir}).`)
      return { exitCode: 1 }
    }
    process.stdout.write(readFileSync(at, 'utf8'))
    return { exitCode: 0 }
  }

  if (sub === 'status') {
    const info = readEngineInfo(dir)
    const running = !dockerProblem() && engineRunning(dir)
    console.log(`${c.bold}${name}${c.reset}  ${running ? `${c.green}running${c.reset}` : 'stopped'}  ${c.dim}${dir}${c.reset}`)
    if (info) {
      say.dim(`API      ${info.api}`)
      if (info.records) say.dim(`records  ${info.records}`)
      if (info.admin) say.dim(`admin    ${info.admin}`)
      if (info.owner?.sign_in) say.dim(`sign in  ${info.owner.sign_in}`)
      if (info.home_org) say.dim(`org      @${info.home_org}`)
      const on = loggedInOrigin() === originOf(info.api)
      say.dim(on ? 'The CLI works with this engine.' : `The CLI works with ${loggedInOrigin() || 'no backend'}, not this engine.`)
    }
    return { exitCode: 0 }
  }

  const docker = dockerProblem()
  if (docker) {
    say.err(docker)
    return { exitCode: 1 }
  }

  if (sub === 'stop') {
    if (!(await stopEngine(dir))) return { exitCode: 1 }
    say.ok(`Stopped ${name}. Its data is kept: uniweb engine start ${name}`)
    return { exitCode: 0 }
  }

  if (sub === 'start') {
    if (!(await bringUp(dir))) return { exitCode: 1 }
    say.ok(`${name} is running.`)
    printAddresses(readEngineInfo(dir))
    return { exitCode: 0 }
  }

  if (sub === 'reset') {
    if (!rest.includes('--yes')) {
      say.err(`This wipes ${name}: its members, entries and settings. To go ahead: uniweb engine reset${positional[0] ? ` ${name}` : ''} --yes`)
      return { exitCode: 2 }
    }
    say.info(`Wiping ${name}…`)
    if (!(await wipeEngine(dir))) return { exitCode: 1 }
    // What `uniweb dev` registered went with the data (`./dev.js`).
    rmSync(join(dir, 'registered.json'), { force: true })
    if (!(await bringUp(dir))) return { exitCode: 1 }
    const info = readEngineInfo(dir)
    // Its token is new, and the session the CLI held on it went with the data.
    if (info && loggedInOrigin() === originOf(info.api)) await signIn(dir, info)
    say.ok(`${name} starts over. \`uniweb dev\` registers the project's types again.`)
    return { exitCode: 0 }
  }

  return { exitCode: 2 }
}

/** Start an engine and wait until it answers. */
export async function bringUp(dir) {
  if (!(await startEngine(dir))) return false
  const info = readEngineInfo(dir)
  if (info?.ready && !(await waitReady(info.ready))) {
    say.err(`The engine did not answer at ${info.ready}.`)
    return false
  }
  return true
}

/** Sign the CLI in to an engine as its owner, with the token it wrote, in its home org. */
export async function signIn(dir, info) {
  const token = readEngineFile(dir, info, 'cli_token')
  if (!token) return false
  const args = ['--token', token]
  if (info.home_org) args.push('--org', `@${info.home_org}`)
  await runRegistryLogin({ apiBase: originOf(info.api), args })
  return true
}

function printReady({ dir, info, devPort }) {
  say.ok(`The engine is running, and the CLI works with it (${originOf(info.api)}).`)
  printAddresses(info)
  say.dim(`Its files: ${dir}`)
  say.dim(`uniweb dev serves the site on port ${devPort}, where the engine calls its compute functions.`)
  console.log('')
  say.dim('`uniweb dev` registers the project\'s types on it, then sends blueprint.yml, how it begins.')
  say.dim('The engine\'s own guide, for you or your agent: uniweb engine guide')
  say.dim('Going live: uniweb login (back to Uniweb), then uniweb publish.')
}

function printAddresses(info) {
  if (!info) return
  if (info.admin) say.dim(`Admin App: ${info.admin}`)
  if (info.owner?.sign_in) say.dim(`Sign in as its owner: ${info.owner.sign_in}`)
}

/** The engine named, or the one the project's `$devBackend` names. */
async function engineFor(name) {
  if (name) {
    const dir = engineDir(name)
    return existsSync(join(dir, 'compose.yaml')) ? { name, dir } : null
  }
  const site = await projectSite()
  const address = site && devBackendAddressOf(site.dir)
  return address ? findEngineFor(address) : null
}

/**
 * The project's site: the folder you are in when it holds a `site.yml`, else the workspace's site
 * — the one whose `$devBackend` is an address, else the first.
 */
export async function projectSite(cwd = process.cwd()) {
  if (existsSync(join(cwd, 'site.yml'))) return { dir: cwd, projectName: nameOf(findWorkspaceRoot(cwd) || cwd) }
  const root = findWorkspaceRoot(cwd)
  if (!root) return null
  const sites = (await discoverSites(root)).map((s) => join(root, s.path))
  const dir = sites.find((d) => devBackendAddressOf(d)) || sites[0]
  return dir ? { dir, projectName: nameOf(root) } : null
}

/** The engine address `site.yml::$devBackend` names (its string form, or the map's `backend`), or null. */
export function devBackendAddressOf(siteDir) {
  try {
    const site = yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8')) || {}
    const spec = site.$devBackend
    const backend = typeof spec === 'string' ? spec : spec && typeof spec === 'object' ? spec.backend : null
    return typeof backend === 'string' && /^https?:\/\//.test(backend) ? backend : null
  } catch {
    return null
  }
}

function nameOf(dir) {
  return dir.split(/[\\/]/).filter(Boolean).pop()
}

function positionals(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--engine' || a === '--org') {
      i++
      continue
    }
    if (!a.startsWith('-')) out.push(a)
  }
  return out
}

function flagValue(args, flag) {
  const at = args.indexOf(flag)
  if (at !== -1) return args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : null
  const inline = args.find((a) => a.startsWith(`${flag}=`))
  return inline ? inline.slice(flag.length + 1) : null
}

