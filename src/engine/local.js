/**
 * THE ENGINE ON THIS MACHINE — a solution's backend run with Docker, one per project, kept outside
 * the project in `~/.uniweb/engines/<name>/`.
 *
 * ⭐ THE CLI COMPOSES NOTHING ABOUT IT. The folder holds the engine's own files: the compose file
 * the backend gave (`engine get`), the `.env` the CLI writes for it, and what the engine writes
 * back when it starts — `engine.json` (its addresses, whole: `api`, `records`, `admin`, `ready`,
 * its `home_org`, the owner's `sign_in`), `cli-token` (a CLI session for its owner, new at every
 * start) and `functions-key`. Every address the CLI uses is read from `engine.json`.
 *
 * ⭐ A PROJECT FINDS ITS ENGINE BY ADDRESS. `site.yml::$devBackend.backend` holds the engine's
 * `api` (written by `engine setup`), and the engine is the folder whose `engine.json` states that
 * address (`findEngineFor`). Nothing else in the project names it.
 *
 * ⛔ Outside the project on purpose: `.env`, the token and the functions key are this machine's,
 * and a project's files are committed and shared.
 *
 * @module
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { getAuthDir } from '../utils/registry-auth.js'
import { runRelayed } from '../utils/closed-reader.js'

/** Where every engine on this machine lives. */
export function enginesDir() {
  return join(getAuthDir(), 'engines')
}

/** An engine's folder, by name. */
export function engineDir(name) {
  return join(enginesDir(), name)
}

/** A name for a project's engine: lowercase letters, digits and dashes, as a compose project takes. */
export function engineNameFor(projectName) {
  const name = String(projectName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return name || 'engine'
}

/**
 * Why Docker can't run the engine here, in a sentence a person acts on — or null when it can.
 *
 * @returns {string|null}
 */
export function dockerProblem() {
  const info = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 20000 })
  if (info.error?.code === 'ENOENT') {
    return 'Docker is not installed. The engine runs in Docker: install Docker Desktop (https://www.docker.com/products/docker-desktop/), start it, and run this again.'
  }
  // ⛔ `--format` exits 0 when the daemon can't be reached, printing no version: the version is the test.
  if (info.status !== 0 || !String(info.stdout || '').trim()) {
    return 'Docker is installed but not running. Start Docker Desktop (or the Docker service), then run this again.'
  }
  const compose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8', timeout: 20000 })
  if (compose.status !== 0) {
    return 'Docker Compose is missing. It comes with Docker Desktop; on Linux, install the `docker-compose-plugin` package.'
  }
  return null
}

/**
 * The engine's `.env`, as a map.
 *
 * @param {string} dir
 * @returns {Record<string, string>}
 */
export function readEnv(dir) {
  const file = join(dir, '.env')
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (m) out[m[1]] = m[2]
  }
  return out
}

/**
 * Set keys in the engine's `.env`, keeping every other line as it is.
 *
 * @param {string} dir
 * @param {Record<string, string|number>} values
 */
export function writeEnv(dir, values) {
  const file = join(dir, '.env')
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : []
  const pending = new Map(Object.entries(values).map(([k, v]) => [k, String(v)]))
  const out = lines.map((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    if (m && pending.has(m[1])) {
      const value = pending.get(m[1])
      pending.delete(m[1])
      return `${m[1]}=${value}`
    }
    return line
  })
  while (out.length && out[out.length - 1] === '') out.pop()
  for (const [k, v] of pending) out.push(`${k}=${v}`)
  writeFileSync(file, out.join('\n') + '\n')
}

/**
 * What the engine says about itself (`engine.json`), or null before its first start.
 *
 * @param {string} dir
 * @returns {{ api: string, records?: string, admin?: string, ready?: string, home_org?: string, owner?: { username?: string, sign_in?: string }, cli_token?: string, functions_key?: string }|null}
 */
export function readEngineInfo(dir) {
  try {
    const info = JSON.parse(readFileSync(join(dir, 'engine.json'), 'utf8'))
    return info && typeof info.api === 'string' ? info : null
  } catch {
    return null
  }
}

/**
 * A file the engine wrote beside `engine.json` and named there (`cli_token`, `functions_key`), its
 * content trimmed — or null.
 */
export function readEngineFile(dir, info, key) {
  const name = info?.[key]
  if (typeof name !== 'string' || !name || name.includes('/') || name.includes('..')) return null
  try {
    return readFileSync(join(dir, name), 'utf8').trim() || null
  } catch {
    return null
  }
}

/**
 * The engine whose API is `api` — the one a project's `$devBackend` names — or null.
 *
 * @param {string} api
 * @returns {{ name: string, dir: string, info: object }|null}
 */
export function findEngineFor(api) {
  const want = normalizeUrl(api)
  if (!want || !existsSync(enginesDir())) return null
  for (const name of readdirSync(enginesDir())) {
    const dir = engineDir(name)
    const info = readEngineInfo(dir)
    if (info && normalizeUrl(info.api) === want) return { name, dir, info }
  }
  return null
}

/**
 * The ports every engine on this machine is set to use — its own two, and the dev server's its
 * compute runner is called on — so a new one picks others even while those aren't listening.
 *
 * @returns {Set<number>}
 */
export function claimedPorts() {
  const out = new Set()
  if (!existsSync(enginesDir())) return out
  for (const name of readdirSync(enginesDir())) {
    const env = readEnv(engineDir(name))
    for (const key of ['ENGINE_PORT', 'ENGINE_APP_PORT']) if (/^\d+$/.test(env[key] || '')) out.add(Number(env[key]))
    try {
      const port = Number(new URL(env.UNIWEBD_FUNCTIONS_URL).port)
      if (port) out.add(port)
    } catch {
      // none
    }
  }
  return out
}

/** Whether the engine's own service is running. */
export function engineRunning(dir) {
  const ps = spawnSync('docker', ['compose', 'ps', '--status', 'running', '--services'], { cwd: dir, encoding: 'utf8', timeout: 20000 })
  return ps.status === 0 && ps.stdout.split('\n').map((s) => s.trim()).includes('engine')
}

/**
 * Start the engine and wait until it is healthy (`docker compose up -d --wait`), its output relayed.
 * Its images are loaded first when its folder holds ones not loaded yet (`loadImages`).
 *
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
export async function startEngine(dir) {
  const images = await loadImages(dir)
  if (images.error) {
    console.error(`\x1b[31m✗\x1b[0m ${images.error}`)
    return false
  }
  return (await runRelayed('docker', ['compose', 'up', '-d', '--wait'], { cwd: dir })) === 0
}

/** Docker's name for this machine's architecture, as a release names its images. */
const DOCKER_ARCH = { x64: 'amd64', arm64: 'arm64' }

/**
 * Load the engine's images into Docker from the archive its folder holds for this machine
 * (`images-<arch>.tar.gz`, as a release carries them), once per archive: a later start, or a
 * folder with no archive (images built or pulled another way), loads nothing.
 *
 * @param {string} dir
 * @returns {Promise<{ loaded?: string, error?: string }>}
 */
export async function loadImages(dir) {
  const archives = existsSync(dir) ? readdirSync(dir).filter((f) => /^images-[A-Za-z0-9_-]+\.tar\.gz$/.test(f)) : []
  if (!archives.length) return {}
  const arch = DOCKER_ARCH[process.arch] || process.arch
  const file = archives.find((f) => f === `images-${arch}.tar.gz`)
  if (!file) {
    return { error: `The engine's images in ${dir} are for ${archives.map((f) => f.slice(7, -7)).join(', ')}, not this machine (${arch}). Get them again: uniweb engine update ${dir}` }
  }
  const at = join(dir, file)
  const { size, mtimeMs } = statSync(at)
  const stamp = `${file}:${size}:${Math.round(mtimeMs)}`
  const marker = join(dir, '.images-loaded')
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === stamp) return {}
  console.log(`\x1b[36m→\x1b[0m Loading the engine's images into Docker (${file})…`)
  if ((await runRelayed('docker', ['load', '-i', file], { cwd: dir })) !== 0) {
    return { error: `Docker could not load ${at}.` }
  }
  writeFileSync(marker, stamp + '\n')
  return { loaded: file }
}

/** The engine's guide for the agent working on its project: the `AGENTS.md` its files carry, else `README.md`. */
export function engineGuidePath(dir) {
  for (const name of ['AGENTS.md', 'README.md']) {
    const at = join(dir, name)
    if (existsSync(at)) return at
  }
  return null
}

/** Stop it, keeping its data. */
export async function stopEngine(dir) {
  return (await runRelayed('docker', ['compose', 'stop'], { cwd: dir })) === 0
}

/** Remove its containers and its data (`down -v`): what `reset` starts over from. */
export async function wipeEngine(dir) {
  return (await runRelayed('docker', ['compose', 'down', '-v'], { cwd: dir })) === 0
}

/**
 * Wait until `url` answers 2xx, or `ms` pass.
 *
 * @param {string} url
 * @param {number} [ms]
 * @returns {Promise<boolean>}
 */
export async function waitReady(url, ms = 60000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (res.ok) return true
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/**
 * A port nothing on this machine listens on, from `start` up — `count` of them in a row.
 *
 * @param {number} start
 * @param {number} [count]
 * @param {Set<number>} [avoid] - ports already chosen for something else
 * @returns {Promise<number>} the first of them
 */
export async function freePorts(start, count = 1, avoid = new Set()) {
  for (let port = start; port < start + 1000; port++) {
    let all = true
    for (let i = 0; i < count; i++) {
      if (avoid.has(port + i) || !(await portFree(port + i))) {
        all = false
        break
      }
    }
    if (all) return port
  }
  throw new Error(`No free port between ${start} and ${start + 1000}.`)
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

/** The origin of an address, or null. */
export function originOf(url) {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}
