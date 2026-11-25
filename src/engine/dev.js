/**
 * `uniweb dev`, for a project whose `$devBackend` names an engine on this machine (`./local.js`):
 *
 *   - it starts the engine when it is stopped, and says so;
 *   - it serves the site on the port the engine calls its compute functions on — the one
 *     `UNIWEBD_FUNCTIONS_URL` names in the engine's `.env` — unless `--port` says otherwise;
 *   - it hands the dev server the engine's functions key, so its compute runner checks each call;
 *   - it registers the project's types (`uniweb register --schema-only`) when the engine holds
 *     none of them yet, and again when `src/schemas` changes while it runs;
 *   - then, once, it sends the site's `blueprint.yml`, how the engine begins (`sendBlueprint`).
 *
 * ⛔ IT REGISTERS ONLY WHILE THE CLI WORKS WITH THAT ENGINE. The CLI talks to one backend at a
 * time, and a developer who signed in to Uniweb to publish must never have a half-edited type
 * registered there by `uniweb dev`. Signed in elsewhere, it says so and registers nothing.
 *
 * What it registered is kept beside the engine (`registered.json`: a digest of each foundation's
 * types, and of the blueprint it sent), so a start with nothing changed registers nothing. `uniweb engine reset` forgets it.
 *
 * ⚠️ A registered version is fixed: the engine refuses a changed type under the same version
 * (`version_content_changed`). Until it takes one in place, a changed type means
 * `uniweb engine reset --yes`, and this says so.
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { loggedInOrigin } from '../utils/config.js'
import { readRegistryAuth } from '../utils/registry-auth.js'
import { runRelayed } from '../utils/closed-reader.js'
import { discoverFoundations } from '../utils/discover.js'
import { dockerProblem, engineRunning, findEngineFor, originOf, readEngineFile, readEngineInfo, readEnv } from './local.js'
import { bringUp, devBackendAddressOf } from './verbs.js'

const CLI = fileURLToPath(new URL('../index.js', import.meta.url))
const REGISTERED = 'registered.json'

const c = { reset: '\x1b[0m', dim: '\x1b[2m', yellow: '\x1b[33m', red: '\x1b[31m', green: '\x1b[32m' }
const note = (m) => console.error(`${c.dim}→ ${m}${c.reset}`)
const warn = (m) => console.error(`${c.yellow}⚠${c.reset} ${m}`)

/**
 * Get the project's engine ready for a dev server.
 *
 * @param {object} p
 * @param {string} p.sitePath
 * @param {string} p.rootDir - the workspace
 * @returns {Promise<{ port: number|null, foundationDir: string|null, engine: { dir: string, info: object }|null, functionsKey?: string|null }>}
 */
export async function prepareDevEngine({ sitePath, rootDir }) {
  const address = devBackendAddressOf(sitePath)
  const found = address ? findEngineFor(address) : null
  if (!found) return { port: null, foundationDir: null, engine: null }
  const { name, dir } = found

  const docker = dockerProblem()
  if (docker) {
    warn(`The engine ${name} can't start: ${docker}`)
  } else if (!engineRunning(dir)) {
    note(`Starting the engine ${name}…`)
    if (!(await bringUp(dir))) warn(`The engine ${name} did not start; the site's backend won't answer.`)
  }

  const info = readEngineInfo(dir) || found.info
  const port = portOf(readEnv(dir).UNIWEBD_FUNCTIONS_URL)
  const foundationDir = await foundationOf(sitePath, rootDir)
  if (foundationDir) {
    const registered = await registerTypes({ foundationDir, dir, info })
    if (registered === 'registered' || registered === 'current') await sendBlueprint({ siteDir: sitePath, foundationDir, dir, info })
  }
  return { port, foundationDir, engine: { dir, info }, functionsKey: readEngineFile(dir, info, 'functions_key') }
}

/**
 * Register the foundation's types on the engine when they changed since it last did, while the
 * CLI works with that engine.
 *
 * @returns {Promise<'current'|'registered'|'refused'|'elsewhere'>}
 */
export async function registerTypes({ foundationDir, dir, info }) {
  const on = loggedInOrigin()
  if (on !== originOf(info.api)) {
    note(`The CLI works with ${on || 'no backend'}, not this engine, so its types are not registered. To work with it: uniweb engine setup`)
    return 'elsewhere'
  }
  const digest = typesDigest(foundationDir)
  const held = readRegistered(dir)
  if (held[foundationDir] === digest) return 'current'

  note(held[foundationDir] ? 'The types changed: registering them on the engine…' : 'Registering the project\'s types on the engine…')
  const code = await runRelayed(process.execPath, [CLI, 'register', '--schema-only'], { cwd: foundationDir })
  if (code === 0) {
    writeRegistered(dir, { ...held, [foundationDir]: digest })
    return 'registered'
  }
  warn(
    'The engine did not take the types (above). A type changed under a version it already holds is refused: ' +
      'to start the engine over with the types as they are now, run `uniweb engine reset --yes`, then `uniweb dev`.'
  )
  return 'refused'
}

/**
 * Send the site's `blueprint.yml` to the engine, once, after its types are registered: how the
 * engine begins — who may sign up, its teams, who adds and sees each type, its public queries, its
 * integrations — named in full as a push names them (`@uniweb/build/uwx`'s `blueprintForWire`).
 *
 * The engine takes it once, as a live backend takes its blueprint once: changing a setting
 * afterwards is the setting's own request (the Admin App), or `uniweb engine reset`, which takes
 * it again. A `blueprint.yml` edited after it was taken is said, not sent.
 *
 * @returns {Promise<'sent'|'held'|'none'|'failed'>}
 */
export async function sendBlueprint({ siteDir, foundationDir, dir, info }) {
  const file = join(siteDir, 'blueprint.yml')
  if (!existsSync(file)) return 'none'
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex')
  const held = readRegistered(dir)
  if (held.blueprint) {
    if (held.blueprint !== digest) {
      note('blueprint.yml changed since the engine took it. The engine takes it once: change a setting in its Admin App, or start over with `uniweb engine reset --yes` to take it as it is now.')
    }
    return 'held'
  }

  let body
  try {
    const { readBlueprint, refuseUnreadableBlueprint, blueprintForWire } = await import('@uniweb/build/uwx')
    const blueprint = readBlueprint(siteDir)
    if (!blueprint) return 'none'
    refuseUnreadableBlueprint(blueprint)
    const { name, version } = foundationIdentity(foundationDir)
    const scope = name?.startsWith('@') ? name.slice(0, name.indexOf('/')) : null
    body = { foundations: name && version ? [`${name}@${version}`] : [], blueprint: blueprintForWire(blueprint, scope) }
  } catch (err) {
    warn(`blueprint.yml was not sent: ${err.message}`)
    return 'failed'
  }

  const origin = originOf(info.api)
  const token = (await readRegistryAuth(origin))?.token
  let res
  try {
    res = await fetch(`${origin}/dev/backend/blueprint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch (err) {
    warn(`blueprint.yml was not sent: the engine did not answer (${err.message}).`)
    return 'failed'
  }
  const answer = await res.json().catch(() => null)
  if (res.ok) {
    writeRegistered(dir, { ...readRegistered(dir), blueprint: digest })
    console.error(`${c.green}✓${c.reset} The engine took blueprint.yml.`)
    for (const line of Array.isArray(answer?.left_out) ? answer.left_out : []) {
      warn(`blueprint.yml: ${line.key ?? ''} left out${line.why ? `: ${line.why}` : ''}${line.code ? ` (${line.code})` : ''}`)
    }
    return 'sent'
  }
  if (res.status === 409) {
    writeRegistered(dir, { ...readRegistered(dir), blueprint: digest })
    note('The engine has already taken a blueprint. To take blueprint.yml again: `uniweb engine reset --yes`.')
    return 'held'
  }
  warn(`The engine did not take blueprint.yml: ${answer?.detail || answer?.title || `HTTP ${res.status}`}`)
  return 'failed'
}

/** The foundation's name and version, as `register` registered them: `main.js`'s name, else package.json's. */
function foundationIdentity(foundationDir) {
  let pkg = {}
  try {
    pkg = JSON.parse(readFileSync(join(foundationDir, 'package.json'), 'utf8'))
  } catch {
    // none
  }
  let name = null
  for (const main of [join(foundationDir, 'main.js'), join(foundationDir, 'src', 'main.js')]) {
    if (!existsSync(main)) continue
    const m = /\bname\s*:\s*['"]([^'"]+)['"]/.exec(readFileSync(main, 'utf8'))
    if (m) name = m[1]
    break
  }
  return { name: name || pkg.name || null, version: pkg.version || null }
}

/**
 * Watch the foundation's types while the dev server runs, and register them again when they
 * change. Returns a function that stops watching.
 */
export function watchTypes({ foundationDir, dir, info }) {
  const at = schemasDir(foundationDir)
  if (!at) return () => {}
  let timer = null
  let running = false
  const watcher = watch(at, { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      if (running) return
      running = true
      try {
        await registerTypes({ foundationDir, dir, info })
      } finally {
        running = false
      }
    }, 800)
  })
  return () => {
    clearTimeout(timer)
    watcher.close()
  }
}

/** A digest of what registering sends that a dev edit changes: the types, and `main.js`. */
export function typesDigest(foundationDir) {
  const hash = createHash('sha256')
  const at = schemasDir(foundationDir)
  if (at) {
    for (const file of filesUnder(at)) {
      hash.update(relative(at, file)).update('\0').update(readFileSync(file)).update('\0')
    }
  }
  for (const main of [join(foundationDir, 'main.js'), join(foundationDir, 'src', 'main.js')]) {
    if (existsSync(main)) hash.update('main.js\0').update(readFileSync(main))
  }
  return hash.digest('hex')
}

function schemasDir(foundationDir) {
  for (const at of [join(foundationDir, 'src', 'schemas'), join(foundationDir, 'schemas')]) {
    if (existsSync(at) && statSync(at).isDirectory()) return at
  }
  return null
}

function filesUnder(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const at = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(at))
    else if (entry.isFile()) out.push(at)
  }
  return out
}

/** The site's foundation: the folder `site.yml::foundation` names in the workspace, else its first foundation. */
async function foundationOf(sitePath, rootDir) {
  try {
    const named = (yaml.load(readFileSync(join(sitePath, 'site.yml'), 'utf8')) || {}).foundation
    if (typeof named === 'string' && !named.startsWith('@') && !/^https?:/.test(named)) {
      const dir = join(rootDir, named)
      if (existsSync(join(dir, 'package.json'))) return dir
    }
  } catch {
    // fall through
  }
  const foundations = await discoverFoundations(rootDir)
  return foundations.length ? join(rootDir, foundations[0].path) : null
}

function readRegistered(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, REGISTERED), 'utf8')) || {}
  } catch {
    return {}
  }
}

function writeRegistered(dir, value) {
  writeFileSync(join(dir, REGISTERED), JSON.stringify(value, null, 2) + '\n')
}

function portOf(url) {
  try {
    const port = Number(new URL(url).port)
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}
