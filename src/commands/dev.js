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
import { discoverSites, readWorkspaceConfig } from '../utils/config.js'
import { findWorkspaceRoot } from '../utils/workspace.js'
import { readFlagValue } from '../utils/args.js'

const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const RESET = '\x1b[0m'

export async function dev(args = []) {
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
    console.error(`${RED}✗${RESET} Not in a Uniweb workspace (no pnpm-workspace.yaml or package.json::workspaces).`)
    console.error(`  Run \`uniweb create <name>\` to scaffold a project, or cd into an existing one.`)
    process.exit(1)
  }

  const sites = await discoverSites(rootDir)
  if (sites.length === 0) {
    console.error(`${RED}✗${RESET} No sites found in this workspace.`)
    console.error(`  Add one with \`uniweb add site <name>\`.`)
    process.exit(1)
  }

  // Pick the site
  const siteFlag = readFlagValue(args, '--site')
  const positional = args.find(a => !a.startsWith('-'))
  const requested = (typeof siteFlag === 'string' ? siteFlag : null) || positional || null

  let site
  if (requested) {
    site = sites.find(s => s.name === requested) || sites.find(s => s.path === requested)
    if (!site) {
      console.error(`${RED}✗${RESET} Site "${requested}" not found.`)
      console.error(`  Available: ${sites.map(s => s.name).join(', ')}`)
      process.exit(1)
    }
  } else if (sites.length === 1) {
    site = sites[0]
  } else {
    site = sites[0]
    console.error(`${YELLOW}⚠${RESET} Multiple sites found; using ${CYAN}${site.name}${RESET}.`)
    console.error(`  Pick a different one with \`uniweb dev --site <name>\`.`)
    console.error(`  Available: ${sites.map(s => s.name).join(', ')}`)
    console.error('')
  }

  const pm = detectPackageManager()
  const command = filterCmd(pm, site.name, 'dev')
  const [bin, ...rest] = command.split(' ')
  const sitePath = join(rootDir, site.path)

  console.error(`${DIM}→ ${command}${RESET} ${DIM}(site: ${site.name}, dir: ${sitePath})${RESET}`)
  console.error('')

  const child = spawn(bin, rest, { cwd: rootDir, stdio: 'inherit' })
  child.on('close', code => process.exit(code ?? 0))
  child.on('error', err => {
    console.error(`${RED}✗${RESET} Failed to start dev server: ${err.message}`)
    process.exit(1)
  })
}
