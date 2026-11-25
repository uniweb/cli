/**
 * `uniweb engine setup` — give a solution project its own engine on this machine, and point the
 * project at it. `uniweb create` runs it for a solution template; run alone, it finishes what
 * `create` could not (no Docker yet, no sign-in).
 *
 * In order, each step either finishes unattended or says what a person does:
 *
 *   1. Docker runs here.
 *   2. The developer's handle, from the backend the CLI is signed in to (uniweb.app by default):
 *      the engine founds its home org under it, so a bare-named foundation registers as
 *      `@<handle>/…` on the engine and on uniweb.app alike. A home org is founded once, so the
 *      handle is in place before the first start.
 *   3. The engine's files, into `~/.uniweb/engines/<name>/`: from that backend (`engine get`,
 *      whose licence the person accepts in the browser), or from a folder given with `--engine`.
 *   4. Its `.env`: its name, the handle, two free ports for it, and the address of the compute
 *      runner `uniweb dev` serves (`UNIWEBD_FUNCTIONS_URL`, on a port the project's dev server
 *      then takes).
 *   5. Start it, and wait until it answers.
 *   6. The CLI's one session moves to the engine, signed in as its owner with the token the
 *      engine wrote, in its home org. Going live is `uniweb login` back to Uniweb.
 *   7. `site.yml::$devBackend` names the engine's API and records, from `engine.json`.
 *
 * The types and the blueprint are not sent here: they need the project installed, which `uniweb
 * dev` has, and it sends both (`./dev.js`).
 *
 * @module
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { DEFAULT_BACKEND_ORIGIN, loggedInOrigin } from '../utils/config.js'
import { readRegistryAuth, fetchMe, runRegistryLogin } from '../utils/registry-auth.js'
import {
  dockerProblem,
  engineDir,
  engineNameFor,
  freePorts,
  originOf,
  readEngineFile,
  readEngineInfo,
  startEngine,
  waitReady,
  writeEnv,
  findEngineFor,
  claimedPorts,
} from './local.js'

/** Where the dev server answers a local engine's compute calls (`@uniweb/build`'s `DEV_COMPUTE_ADDRESS`). */
const COMPUTE_PATH = '/_compute'

/**
 * @param {object} p
 * @param {string} p.siteDir - the site whose `site.yml` is pointed at the engine
 * @param {string} p.projectName - names the engine
 * @param {string|null} [p.from] - a folder holding the engine's compose file, instead of `engine get`
 * @param {(line: string) => void} [p.log]
 * @returns {Promise<{ ok: true, dir: string, info: object, devPort: number } | { ok: false, reason: string }>}
 */
export async function setupEngine({ siteDir, projectName, from = null, log = console.log }) {
  // 1 · Docker
  const docker = dockerProblem()
  if (docker) return { ok: false, reason: docker }

  // 2 · the handle, from the backend the CLI is signed in to
  const origin = loggedInOrigin() || DEFAULT_BACKEND_ORIGIN
  if (findEngineFor(`${origin}/api`)) {
    return {
      ok: false,
      reason: `The CLI is signed in to a local engine (${origin}). Sign in to Uniweb first, so the engine is made under your handle: uniweb login --browser`,
    }
  }
  let session = await readRegistryAuth(origin)
  if (!session?.token) {
    log(`→ Sign in to ${origin} first: the engine is yours, under your handle there.`)
    session = await runRegistryLogin({ apiBase: origin, args: ['--browser'] })
    if (!session?.token) return { ok: false, reason: `Not signed in to ${origin}.` }
  }
  let handle = session.handle
  if (!handle) {
    try {
      handle = (await fetchMe({ apiBase: origin, token: session.token }))?.handle
    } catch {
      // said below
    }
  }
  if (!handle) {
    return { ok: false, reason: `Your account on ${origin} has no handle yet, and the engine is made under it. Choose one there, then run: uniweb engine setup` }
  }

  // 3 · the engine's files
  const name = freeName(engineNameFor(projectName))
  const dir = engineDir(name)
  mkdirSync(dir, { recursive: true })
  if (from) {
    const compose = join(from, 'compose.yaml')
    if (!existsSync(compose)) return { ok: false, reason: `${from} holds no compose.yaml, which is what runs the engine.` }
    copyFileSync(compose, join(dir, 'compose.yaml'))
  } else {
    const { engine } = await import('../commands/engine.js')
    const got = await engine(['get', dir])
    if (got.exitCode !== 0) return { ok: false, reason: `The engine could not be downloaded from ${origin} (above).` }
    if (!existsSync(join(dir, 'compose.yaml'))) return { ok: false, reason: `What ${origin} gave holds no compose.yaml.` }
  }

  // 4 · its .env
  const claimed = claimedPorts()
  const enginePort = await freePorts(4100, 2, claimed)
  const devPort = await freePorts(4300, 1, new Set([...claimed, enginePort, enginePort + 1]))
  writeEnv(dir, {
    ENGINE_NAME: name,
    ENGINE_HANDLE: handle,
    ENGINE_PORT: enginePort,
    ENGINE_APP_PORT: enginePort + 1,
    UNIWEBD_FUNCTIONS_URL: `http://host.docker.internal:${devPort}${COMPUTE_PATH}`,
  })

  // 5 · start it
  log(`→ Starting the engine (${name})…`)
  if (!(await startEngine(dir))) return { ok: false, reason: `The engine did not start. See above, then: uniweb engine start ${name}` }
  const info = readEngineInfo(dir)
  if (!info) return { ok: false, reason: `The engine started but wrote no engine.json in ${dir}.` }
  if (info.ready && !(await waitReady(info.ready))) return { ok: false, reason: `The engine did not answer at ${info.ready}.` }

  // 6 · the session moves to the engine
  const token = readEngineFile(dir, info, 'cli_token')
  if (!token) return { ok: false, reason: `The engine wrote no CLI token in ${dir}.` }
  const args = ['--token', token]
  if (info.home_org) args.push('--org', `@${info.home_org}`)
  await runRegistryLogin({ apiBase: originOf(info.api), args })

  // 7 · the project points at it
  writeDevBackend(siteDir, info)

  return { ok: true, dir, info, devPort }
}

/**
 * The engine's name, or the first `<name>-2`, `-3`… no engine holds yet. A folder an earlier setup
 * made but never started (no `engine.json`) is taken again, so a retry doesn't leave it behind.
 */
function freeName(base) {
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}-${i}`
    if (!existsSync(join(engineDir(name), 'engine.json'))) return name
  }
}

/**
 * `site.yml::$devBackend`, set to the engine's API and records — the entry as written replaced
 * (a module, an address or a map, with its indented lines), every other line kept.
 */
export function writeDevBackend(siteDir, info) {
  const file = join(siteDir, 'site.yml')
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const block = ['$devBackend:', `  backend: ${info.api}`]
  if (info.records) block.push(`  records: ${info.records}`)
  const lines = text.split('\n')
  const at = lines.findIndex((l) => /^\$devBackend\s*:/.test(l))
  if (at === -1) {
    const out = text.replace(/\n*$/, '\n')
    writeFileSync(file, `${out}\n# This machine's engine (\`uniweb engine setup\`). Never published.\n${block.join('\n')}\n`)
    return
  }
  let end = at + 1
  while (end < lines.length && /^\s+\S/.test(lines[end])) end++
  lines.splice(at, end - at, ...block)
  writeFileSync(file, lines.join('\n'))
}

/**
 * Whether a site is a solution's: it asks its host for a `backend` service and says how that
 * backend begins (`blueprint.yml`).
 */
export function isSolutionSite(siteDir) {
  if (!existsSync(join(siteDir, 'blueprint.yml'))) return false
  try {
    const backend = (yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8')) || {}).services?.backend
    return backend !== undefined && backend !== null && backend !== false && backend?.enabled !== false
  } catch {
    return false
  }
}
