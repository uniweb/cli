/**
 * `uniweb engine` — the Application Engine for your machine, from your account.
 *
 *   uniweb engine get [<dir>]      write the engine's files into <dir> (default `uniweb-engine`)
 *   uniweb engine update [<dir>]   the same, for a directory that holds them (default `.`)
 *
 * The backend you are logged in to says which files make the engine for this machine, and
 * gives each a path, a size, a SHA-256 and an address to download it from. The CLI writes
 * them and interprets none: it runs nothing, loads nothing and holds no credential beyond
 * the login. What to do with them is in the `AGENTS.md` and `README.md` among them.
 *
 * ⭐ `get` and `update` are one operation. A file already in <dir> with the size and
 * SHA-256 asked for is kept, so a second run downloads only what changed, and an
 * interrupted download carries on from where it stopped (`<path>.part`, an HTTP range).
 * A file the backend no longer lists is left where it is: the directory is the
 * developer's, their `.env` among it.
 *
 * ⛔ A path that leaves <dir> (absolute, or with a `..` segment) is refused before anything
 * is written, and a file that doesn't match its size and SHA-256 is never kept.
 *
 * A refusal is shown as the backend sent it: not invited yet, or a licence to accept first,
 * with the address to accept it at.
 *
 * Auth: the session of the backend you are logged in to (`uniweb login`) / UNIWEB_TOKEN.
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { BackendClient } from '../backend/client.js'
import { humanBytes } from '../utils/bytes.js'
import { checkFlags } from '../utils/flag-guard.js'

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  cyan: '\x1b[36m'
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`)
}

const ROUTE = '/dev/engine'

/**
 * Where a listed file goes, or null when its path would leave the directory.
 *
 * @param {string} dir - absolute
 * @param {unknown} path - as the backend sent it: relative, `/`-separated
 * @returns {string|null}
 */
export function placeIn(dir, path) {
  if (typeof path !== 'string' || path === '' || path.includes('\\') || path.includes('\0')) return null
  if (isAbsolute(path) || path.startsWith('/')) return null
  const parts = path.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null
  const target = resolve(dir, ...parts)
  const rel = relative(dir, target)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? target : null
}

/** The listing's files, each checked: a path inside <dir>, a size, a SHA-256 and an address. */
function filesOf(body, dir) {
  const files = Array.isArray(body?.files) ? body.files : null
  if (!files || files.length === 0) return { error: 'The backend listed no files for the engine.' }
  const out = []
  for (const f of files) {
    const target = placeIn(dir, f?.path)
    if (!target) return { error: `The backend listed a file outside the directory, refused: ${JSON.stringify(f?.path)}` }
    if (!Number.isSafeInteger(f.size) || f.size < 0 || !/^[0-9a-f]{64}$/i.test(f.sha256 ?? '') || typeof f.url !== 'string') {
      return { error: `The backend listed ${f.path} without a size, a SHA-256 and an address.` }
    }
    out.push({ path: f.path, target, size: f.size, sha256: f.sha256.toLowerCase(), url: f.url })
  }
  return { files: out }
}

async function sha256Of(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

/** Whether `file` is already what the listing asks for. */
async function holds(file, { size, sha256 }) {
  if (!existsSync(file)) return false
  if (statSync(file).size !== size) return false
  return (await sha256Of(file)) === sha256
}

/** Ask for the listing. Returns `{ body }`, or `{ exitCode }` once a refusal is shown. */
async function askForListing(client) {
  let res
  try {
    res = await client.request(ROUTE, { query: { arch: process.arch } })
  } catch (err) {
    say.err(err.message)
    return { exitCode: 1 }
  }
  const body = await res.json().catch(() => null)
  if (res.ok) return { body }

  if (res.status === 403 && body?.reason === 'engine_licence_not_accepted') {
    say.err(body.detail || 'Accept the engine\'s licence first.')
    if (body.accept_url) console.error(`  Accept it here, then run this command again: ${body.accept_url}`)
  } else if (res.status === 403 && body?.reason === 'engine_not_invited') {
    say.err(body.detail || 'Your account has no access to the engine yet.')
  } else if (res.status === 401) {
    say.err(`Your session on ${client.origin} is not accepted — sign in again: uniweb login`)
  } else if (res.status === 404) {
    say.err(`${client.origin} offers no engine to download.`)
  } else {
    say.err(`The backend refused: HTTP ${res.status}${body?.detail ? ` — ${body.detail}` : ''}`)
  }
  return { exitCode: 1 }
}

/**
 * Download one file into `<target>.part`, carrying on from what it holds, then check it and
 * move it into place. Returns `'expired'` when its address no longer answers, so the caller
 * can ask for fresh ones.
 */
async function download(file, { fetchImpl, progress }) {
  const part = `${file.target}.part`
  await mkdir(dirname(file.target), { recursive: true })
  let have = existsSync(part) ? statSync(part).size : 0
  if (have > file.size) {
    await rm(part)
    have = 0
  }

  if (have < file.size) {
    const res = await fetchImpl(file.url, have > 0 ? { headers: { Range: `bytes=${have}-` } } : {})
    // 403: the address lapsed or its signature doesn't hold; 404: a new release came out since the
    // list. Either way, ask the backend again (backend, 2026-11-24).
    if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410) return 'expired'
    if (res.status !== 200 && res.status !== 206) throw new Error(`${file.path}: HTTP ${res.status}`)
    // A 200 is the whole file: start over.
    const append = res.status === 206 && have > 0
    if (!append) have = 0
    const out = createWriteStream(part, { flags: append ? 'a' : 'w' })
    const body = Readable.fromWeb(res.body)
    let got = have
    body.on('data', (chunk) => {
      got += chunk.length
      progress?.(got)
    })
    try {
      await pipeline(body, out)
    } catch (err) {
      throw new Error(`${file.path}: the download stopped (${err.message}). Run the command again: it carries on from where it stopped.`)
    }
  }

  const size = statSync(part).size
  if (size !== file.size || (await sha256Of(part)) !== file.sha256) {
    await rm(part, { force: true })
    throw new Error(`${file.path} did not match the size and SHA-256 the backend gave, and was not kept. Run the command again.`)
  }
  await rename(part, file.target)
  return 'done'
}

/** A progress line for a large file in a terminal; nothing when output is piped. */
function progressFor(file) {
  if (!process.stdout.isTTY || file.size < 8 * 1024 * 1024) return null
  let shown = -1
  return (got) => {
    const pct = Math.floor((got / file.size) * 100)
    if (pct === shown) return
    shown = pct
    process.stdout.write(`\r  ${c.dim}${file.path}: ${pct}% of ${humanBytes(file.size)}${c.reset}`)
    if (got >= file.size) process.stdout.write('\n')
  }
}

/**
 * @param {string[]} args
 * @param {{ fetchImpl?: typeof fetch, client?: BackendClient }} [deps] - tests
 */
export async function engine(args = [], deps = {}) {
  const sub = args[0]
  if (sub !== 'get' && sub !== 'update') {
    console.log('uniweb engine <command>')
    console.log('  get [<dir>]     Download the Application Engine for this machine into <dir> (default uniweb-engine)')
    console.log('  update [<dir>]  Bring a downloaded engine up to date (default: this directory)')
    return { exitCode: sub ? 2 : 0 }
  }

  const bad = checkFlags('engine', args.slice(1))
  if (bad) {
    say.err(bad.message)
    return { exitCode: 2 }
  }
  const positional = args.slice(1).filter((a) => !a.startsWith('-'))
  if (positional.length > 1) {
    say.err(`Usage: uniweb engine ${sub} [<dir>]`)
    return { exitCode: 2 }
  }
  const dir = resolve(positional[0] ?? (sub === 'get' ? 'uniweb-engine' : '.'))
  if (existsSync(dir) && !statSync(dir).isDirectory()) {
    say.err(`${dir} is a file, not a directory.`)
    return { exitCode: 2 }
  }

  const client = deps.client ?? new BackendClient({ args, command: 'Getting the engine' })
  const fetchImpl = deps.fetchImpl ?? ((url, init) => globalThis.fetch(url, init))

  let listing = await askForListing(client)
  if (listing.exitCode != null) return listing
  let checked = filesOf(listing.body, dir)
  if (checked.error) {
    say.err(checked.error)
    return { exitCode: 1 }
  }
  const version = listing.body?.version

  if (sub === 'update' && !anyPresent(checked.files)) {
    say.err(`${dir} holds no engine to update. To download one: uniweb engine get ${positional[0] ?? '<dir>'}`)
    return { exitCode: 2 }
  }

  say.info(`The Application Engine${version ? ` ${version}` : ''} for ${process.arch}, from ${client.origin}`)
  let kept = 0
  let fetched = 0
  let refreshed = false
  for (let i = 0; i < checked.files.length; i++) {
    const file = checked.files[i]
    if (await holds(file.target, file)) {
      kept++
      continue
    }
    say.dim(`${file.path} (${humanBytes(file.size)})`)
    let outcome
    try {
      outcome = await download(file, { fetchImpl, progress: progressFor(file) })
      if (outcome === 'expired' && !refreshed) {
        // An address lasts an hour, and a release can change under it: ask once for a fresh list
        // and carry on from this file.
        refreshed = true
        listing = await askForListing(client)
        if (listing.exitCode != null) return listing
        checked = filesOf(listing.body, dir)
        if (checked.error) {
          say.err(checked.error)
          return { exitCode: 1 }
        }
        const again = checked.files.find((f) => f.path === file.path)
        if (!again) {
          say.err(`The backend no longer lists ${file.path}. Run the command again.`)
          return { exitCode: 1 }
        }
        checked.files[i] = again
        outcome = await download(again, { fetchImpl, progress: progressFor(again) })
      }
    } catch (err) {
      say.err(err.message)
      return { exitCode: 1 }
    }
    if (outcome === 'expired') {
      say.err(`The address for ${file.path} was refused. Run the command again.`)
      return { exitCode: 1 }
    }
    fetched++
  }

  const where = shown(dir)
  if (fetched === 0) say.ok(`The engine in ${where} is up to date${version ? ` (${version})` : ''}.`)
  else say.ok(`Wrote ${fetched} file${fetched === 1 ? '' : 's'} to ${where}${kept ? `, kept ${kept} unchanged` : ''}.`)
  const guide = checked.files.find((f) => f.path === 'AGENTS.md') ?? checked.files.find((f) => f.path === 'README.md')
  if (guide) console.log(`Next: follow ${shown(guide.target)} to start it.`)
  return { exitCode: 0 }
}

/** A path as a person reads it: from here when it is under here, else from home, else whole. */
export function shown(path) {
  const here = relative(process.cwd(), path)
  if (here === '') return '.'
  if (!here.startsWith('..') && !isAbsolute(here)) return here
  const home = homedir()
  return path === home ? '~' : path.startsWith(home + sep) ? `~${sep}${path.slice(home.length + 1)}` : path
}

function anyPresent(files) {
  return files.some((f) => existsSync(f.target) || existsSync(`${f.target}.part`))
}

export default engine

