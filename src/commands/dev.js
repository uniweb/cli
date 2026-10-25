/**
 * Dev Command
 *
 * Starts a dev server for a site in the current workspace. Wraps the
 * project's `dev` script (set up by `uniweb create` to filter to the
 * appropriate site package). Provides discoverability and consistency
 * with `uniweb build` / `uniweb deploy` — users shouldn't have to know
 * whether to type `pnpm dev` or `npm run dev` when the rest of the CLI
 * is verb-shaped.
 *
 * Usage:
 *   uniweb dev                  Start dev server for the (single) site
 *   uniweb dev <site>           Start dev server for a specific site
 *   uniweb dev --site <name>    Same, with explicit flag form
 *   uniweb dev --port <n>       On that port, or not at all
 *   uniweb dev --status         Print the running dev server's address
 *   uniweb dev --stop           Stop the running dev server
 *
 * ⭐ THE DEV SERVER SAYS WHERE IT IS; NOTHING GUESSES. It takes a free port (Vite moves past a
 * busy one), and once it listens it records the address it was given (`@uniweb/build/site`'s
 * `dev-server.js`). `dev` reads that record: it prints the address the moment the server
 * states it, `--status` prints it later, a second `dev` for the site points at the running
 * server rather than starting another on another port, and `--stop` stops it. ⛔ Until
 * 2026-10-25 a caller had to pick a port to know the address, and `--port` was read as the
 * site's name.
 *
 * Resolution order for which site to launch:
 *   1. --site <name> (if passed)
 *   2. Positional <site> arg
 *   3. The single site in the workspace (if exactly one)
 *   4. The first site in the workspace, with a "multiple sites" notice
 *      pointing at --site for explicit selection
 *
 * Multi-site workspaces with no positional / flag will run the first
 * site by default (mirrors the `pnpm dev` shortcut `uniweb create` writes).
 * Use `--site` to pick a different one without editing the root scripts.
 *
 * A site whose foundation is a catalog ref — every clone — has no build of it, and
 * only the backend the site is on can say where that version is served. So `dev`
 * asks it, through the site, and hands the answer to the dev server it starts in its
 * environment (`UNIWEB_PREVIEW`), with the backend it asked, which is also where the
 * site's kept media URLs are fetched from. Nothing is written: `site.yml` keeps the
 * ref and the round trip never sees the URL. A backend that does not say is an
 * ordinary answer — `dev` says so and starts nothing (`backend/site-preview.js`).
 *
 * Implementation: shells out to the package manager that invoked the CLI
 * (detected via npm_config_user_agent), running the workspace-filtered
 * dev command (`pnpm --filter <name> dev` or `npm -w <name> run dev`).
 * No special handling of vite directly — the site package already owns
 * its dev script, and shelling through pnpm/npm respects whatever the
 * site has configured (Vite plugins, env vars, port overrides, etc.).
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { detectPackageManager, filterCmd } from '../utils/pm.js'
import { readWorkspaceConfig } from '../utils/config.js'
import { discoverSites } from '../utils/discover.js'
import { findWorkspaceRoot } from '../utils/workspace.js'
import { readFlagValue } from '../utils/args.js'
import { checkFlags } from '../utils/flag-guard.js'
import {
  checkSiteInstall,
  readDeclaredFoundation
} from '../utils/install-integrity.js'
import { discoverFoundations } from '../utils/discover.js'

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const RESET = '\x1b[0m'

/** The flags `dev` reads a value after — none of which is ever the site's name. */
const VALUE_FLAGS = ['--site', '--port', '--org']

/**
 * What `uniweb dev` was asked: the site, by `--site` or a bare name; the port, if one; and
 * whether to report on the running server or stop it rather than start one.
 *
 * @param {string[]} args
 * @returns {{ site: string|null, port: number|null, status: boolean, stop: boolean, error?: string }}
 */
export function readDevArgs(args) {
  let positional = null
  for (let i = 0; i < args.length && positional === null; i++) {
    if (args[i] === '--') break
    if (VALUE_FLAGS.includes(args[i])) i++
    else if (!args[i].startsWith('-')) positional = args[i]
  }
  const siteFlag = readFlagValue(args, '--site')
  const wanted = {
    site: typeof siteFlag === 'string' ? siteFlag : positional,
    port: null,
    status: args.includes('--status'),
    stop: args.includes('--stop')
  }
  const port = readFlagValue(args, '--port')
  if (port !== undefined) {
    const n = Number(port)
    if (port === null || !Number.isInteger(n) || n < 1 || n > 65535) {
      return { ...wanted, error: '`--port` takes a port number, 1–65535: uniweb dev --port 5199' }
    }
    wanted.port = n
  }
  if (wanted.status && wanted.stop) {
    return { ...wanted, error: '`--status` and `--stop` ask for different things; pass one.' }
  }
  return wanted
}

export async function dev(args = []) {
  const badFlag = checkFlags('dev', args)
  if (badFlag) {
    console.error(`${RED}✗${RESET} ${badFlag.message}`)
    process.exit(2)
  }
  const wanted = readDevArgs(args)
  if (wanted.error) {
    console.error(`${RED}✗${RESET} ${wanted.error}`)
    process.exit(2)
  }

  const cwd = process.cwd()
  const rootDir = findWorkspaceRoot(cwd) || cwd

  // Verify we're in a Uniweb workspace (has pnpm-workspace.yaml or
  // package.json::workspaces). discoverSites already handles both.
  let workspaceConfig
  try {
    workspaceConfig = await readWorkspaceConfig(rootDir)
  } catch {
    workspaceConfig = { packages: [] }
  }
  if (workspaceConfig.packages.length === 0) {
    console.error(
      `${RED}✗${RESET} Not in a Uniweb workspace (no pnpm-workspace.yaml or package.json::workspaces).`
    )
    console.error(
      `  Run \`uniweb create <name>\` to scaffold a project, or cd into an existing one.`
    )
    process.exit(1)
  }

  const sites = await discoverSites(rootDir)
  if (sites.length === 0) {
    console.error(`${RED}✗${RESET} No sites found in this workspace.`)
    console.error(`  Add one with \`uniweb add site <name>\`.`)
    process.exit(1)
  }

  // Pick the site
  const requested = wanted.site

  let site
  if (requested) {
    site =
      sites.find((s) => s.name === requested) ||
      sites.find((s) => s.path === requested)
    if (!site) {
      console.error(`${RED}✗${RESET} Site "${requested}" not found.`)
      console.error(`  Available: ${sites.map((s) => s.name).join(', ')}`)
      process.exit(1)
    }
  } else if (sites.length === 1) {
    site = sites[0]
  } else {
    site = sites[0]
    console.error(
      `${YELLOW}⚠${RESET} Multiple sites found; using ${CYAN}${site.name}${RESET}.`
    )
    console.error(`  Pick a different one with \`uniweb dev --site <name>\`.`)
    console.error(`  Available: ${sites.map((s) => s.name).join(', ')}`)
    console.error('')
  }
  const sitePath = join(rootDir, site.path)

  const { runningDevServer, stopDevServer, DEV_PORT_ENV } = await import('@uniweb/build/site')
  if (wanted.status) {
    const running = await runningDevServer(sitePath)
    if (!running) {
      console.error(`No dev server is running for ${site.name}.`)
      process.exit(1)
    }
    console.log(running.url)
    return
  }
  if (wanted.stop) {
    const result = await stopDevServer(sitePath)
    if (result.none) console.error(`No dev server is running for ${site.name}.`)
    else if (result.stuck) {
      console.error(`${RED}✗${RESET} The dev server for ${site.name} (pid ${result.stuck.pid}) did not stop.`)
      console.error(`  Stop it with: kill -9 ${result.stuck.pid}`)
      process.exit(1)
    } else console.error(`${GREEN}✓${RESET} Stopped the dev server for ${site.name} (${result.stopped.url}).`)
    return
  }

  // One dev server per site: a second `dev` points at the running one rather than start another
  // on the next free port.
  const running = await runningDevServer(sitePath)
  if (running) {
    if (wanted.port !== null && wanted.port !== running.port) {
      console.error(`${RED}✗${RESET} ${site.name} is already being served at ${running.url}, not on port ${wanted.port}.`)
      console.error('  Stop it first: uniweb dev --stop')
      process.exit(1)
    }
    console.error(`${GREEN}✓${RESET} ${site.name} is already being served at ${CYAN}${running.url}${RESET} (pid ${running.pid}).`)
    console.error('  Stop it with: uniweb dev --stop')
    return
  }

  // A `file:` foundation dependency can be satisfied by a link or by a copy,
  // and a copy is a snapshot: the dev server serves it while builds read the
  // workspace source, so the two disagree and only the browser shows it. The
  // check is a few stats and package.json reads, so it runs every time rather
  // than waiting for someone to suspect it.
  await warnOnStaleInstall(rootDir, site)

  const pm = detectPackageManager()
  const command = filterCmd(pm, site.name, 'dev')
  const [bin, ...rest] = command.split(' ')

  // ⭐ A SITE WHOSE FOUNDATION IS A CATALOG REF — a clone — is previewed with what the backend
  // it is on says: where that version is served. Asked here, for this dev server alone, and
  // handed to it in its environment; nothing is written (`backend/site-preview.js`). Any other
  // site needs nothing from a backend, and this asks nothing.
  const { readSitePreview } = await import('../backend/site-preview.js')
  const asked = await readSitePreview({ siteDir: sitePath, args })
  if (asked?.refused) {
    console.error(`${RED}✗${RESET} ${asked.refused[0]}`)
    for (const line of asked.refused.slice(1)) console.error(`  ${line}`)
    process.exit(1)
  }
  let env = process.env
  if (asked?.preview) {
    const { PREVIEW_ENV, encodePreview } = await import('@uniweb/build/site')
    env = { ...process.env, [PREVIEW_ENV]: encodePreview(asked.preview) }
    console.error(
      `${DIM}→ Previewing with ${asked.preview.foundation.ref}, served by ${asked.preview.backend}${RESET}`
    )
  }
  // That port or none: the dev server refuses to move past it (`dev-server.js`).
  if (wanted.port !== null) env = { ...env, [DEV_PORT_ENV]: String(wanted.port) }

  await ensureSiteExtensionsBuilt(sitePath)

  console.error(
    `${DIM}→ ${command}${RESET} ${DIM}(site: ${site.name}, dir: ${sitePath})${RESET}`
  )
  console.error('')

  const startedAt = Date.now()
  const child = spawn(bin, rest, { cwd: rootDir, stdio: 'inherit', env })
  child.on('close', (code) => process.exit(code ?? 0))
  child.on('error', (err) => {
    console.error(`${RED}✗${RESET} Failed to start dev server: ${err.message}`)
    process.exit(1)
  })
  // A line of help, never a reason for the server to stop.
  announceWhenListening({ site, sitePath, startedAt, child, runningDevServer }).catch(() => {})
}

/**
 * Say where the dev server is once it states it: one line, the same every time, for whoever
 * started it to read. Waits on the server's own record, written when it listens, so the
 * address is the one it was given, not one this derived from a port.
 */
async function announceWhenListening({ site, sitePath, startedAt, child, runningDevServer }) {
  let exited = false
  child.once('close', () => { exited = true })
  for (const until = Date.now() + 120_000; !exited && Date.now() < until; ) {
    const running = await runningDevServer(sitePath, { timeout: 1000 })
    if (running && Date.parse(running.startedAt) >= startedAt) {
      console.error(`${GREEN}✓${RESET} Serving ${site.name} at ${CYAN}${running.url}${RESET}`)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/**
 * Build the site's workspace extensions that are missing or older than their
 * sources, before its dev server starts — as `uniweb build` builds extensions
 * before sites. A site loads a workspace extension from its BUILD in dev as in a
 * built site (the dev server serves its `dist/`), so an unbuilt one is a 404 and a
 * stale one is the code as it was. Found by the rule the build follows
 * (`findSiteExtension`, `@uniweb/build`).
 *
 * Nothing watches an extension while the server runs: after editing one, run
 * `uniweb build` and reload. A failed build warns and dev starts anyway — the
 * site without its extension is still worth looking at.
 */
export async function ensureSiteExtensionsBuilt(sitePath) {
  let build, readSiteConfig, ensureFoundationFresh
  try {
    build = await import('@uniweb/build')
    ;({ readSiteConfig } = await import('@uniweb/build/site'))
    ;({ ensureFoundationFresh } = await import('./build.js'))
  } catch {
    return // Not installed yet — the dev server says so in its own words.
  }
  let declared
  try {
    declared = readSiteConfig(sitePath)?.extensions
  } catch {
    return // An unreadable site.yml is the dev server's to report.
  }
  if (!Array.isArray(declared)) return

  const dirs = new Set()
  for (const entry of declared) {
    const named = build.extensionNameOf(typeof entry === 'string' ? entry : entry?.url)
    const dir = named && build.findSiteExtension(named.name, sitePath)
    if (dir) dirs.add(dir)
  }
  const step = process.env.UNIWEB_BUILD_STEP
  process.env.UNIWEB_BUILD_STEP = 'dev' // a step of `dev`: no "what next" after each build
  try {
    for (const dir of dirs) {
      try {
        await ensureFoundationFresh(dir, 'extension')
      } catch (err) {
        console.error(
          `${YELLOW}⚠${RESET} Could not build the extension at ${dir}: ${err.message}`
        )
        console.error(`  The site will start without it. Fix it, then run \`uniweb build\` and reload.`)
        console.error('')
      }
    }
  } finally {
    if (step === undefined) delete process.env.UNIWEB_BUILD_STEP
    else process.env.UNIWEB_BUILD_STEP = step
  }
}

/**
 * Say so if the site is about to be served from an install that no longer
 * matches the workspace. Warns rather than exits — the server may still be
 * useful, and the author is the one who knows whether it is.
 */
async function warnOnStaleInstall(rootDir, site) {
  try {
    const sitePath = join(rootDir, site.path)
    const foundationName = readDeclaredFoundation(sitePath)
    if (!foundationName) return

    const foundations = await discoverFoundations(rootDir)
    const foundation = foundations
      .map((f) => ({ ...f, path: join(rootDir, f.path) }))
      .find((f) => f.name === foundationName)
    if (!foundation) return

    const findings = checkSiteInstall(
      { name: site.name, path: sitePath },
      foundation,
      rootDir
    )
    if (!findings.length) return

    console.error(
      `${YELLOW}⚠${RESET} Dev will not build against your workspace foundation:`
    )
    for (const finding of findings) {
      console.error(`  ${finding.message}`)
    }
    console.error(
      `  ${findings[0].remedy}. \`uniweb doctor\` explains in full.`
    )
    console.error('')
  } catch {
    // A diagnostic must never be the reason dev fails to start.
  }
}
