/**
 * uniweb update — Update the CLI itself, and (in a Uniweb project) the
 * project's AGENTS.md.
 *
 * Two responsibilities, in priority order:
 *
 * 1. **Self-update the global install.** Most users running `uniweb update`
 *    expect the verb to update the CLI binary itself (this is what `npm
 *    update -g`, `gh update`, `claude update`, etc. all do). The CLI
 *    detects the relevant package manager and runs the global-install
 *    command for it (`npm i -g uniweb@latest`, `pnpm add -g uniweb@latest`,
 *    `yarn global add uniweb@latest`). In TTY, prompts before executing.
 *    In non-interactive mode, prints the command and exits — never runs an
 *    unconfirmed self-update from a script.
 *
 * 2. **Refresh AGENTS.md** (only when the cwd resolves to a *Uniweb*
 *    project — checked via `package.json::devDependencies::uniweb` or
 *    `dependencies::uniweb` at the workspace root). The previous
 *    implementation walked up looking for ANY pnpm-workspace.yaml or
 *    `package.json::workspaces` root, which falsely identified unrelated
 *    monorepos as Uniweb projects and wrote AGENTS.md into them.
 *
 * Flags:
 *   --agents-only        Skip self-update; only refresh AGENTS.md.
 *   --no-agents          Skip AGENTS.md; only self-update.
 *   --yes                Skip the confirmation prompt before self-update.
 *   --non-interactive    Auto-detected; never runs unconfirmed self-update.
 *
 * Project-local case (CLI lives in node_modules, not global): self-update
 * isn't possible — that's a project decision (bump the dep in
 * package.json). The verb prints that explanation and proceeds with the
 * AGENTS.md refresh path only.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import prompts from 'prompts'

import { findWorkspaceRoot } from '../utils/workspace.js'
import { readAgentsVersion, generateAgentsContent } from '../utils/agents-stamp.js'
import { getCliVersion } from '../versions.js'
import { isNonInteractive } from '../utils/interactive.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
}

const success = (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`)
const warn = (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`)
const error = (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`)
const log = console.log

/**
 * Detect whether this CLI is running from a global install. Mirrors the
 * logic in index.js::isGlobalInstall — when global, process.argv[1]
 * points outside any node_modules.
 */
function isGlobalInstall() {
  const scriptPath = process.argv[1]
  if (!scriptPath) return false
  return !scriptPath.split('/').includes('node_modules') &&
         !scriptPath.split('\\').includes('node_modules')
}

/**
 * Find a *Uniweb* workspace root from cwd. Stricter than findWorkspaceRoot
 * — also requires that the workspace's root package.json declares uniweb
 * as a dep or devDep. Otherwise the previous behavior (walking up to any
 * pnpm-workspace.yaml) writes AGENTS.md into unrelated monorepos.
 */
function findUniwebWorkspace(cwd) {
  const workspaceDir = findWorkspaceRoot(cwd)
  if (!workspaceDir) return null
  const pkgPath = join(workspaceDir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const hasUniwebDep = !!(pkg.devDependencies?.uniweb || pkg.dependencies?.uniweb)
    return hasUniwebDep ? workspaceDir : null
  } catch {
    return null
  }
}

/**
 * Detect the package manager that owns the global install. Heuristic
 * based on the CLI's filesystem path — pnpm and yarn berry use distinctive
 * directory layouts; npm is the fallback.
 *
 * @returns {'pnpm'|'yarn'|'npm'}
 */
function detectGlobalPm() {
  const path = (process.argv[1] || '').toLowerCase()
  if (path.includes('/pnpm/') || path.includes('\\pnpm\\')) return 'pnpm'
  if (path.includes('/yarn/') || path.includes('\\yarn\\')) return 'yarn'
  return 'npm'
}

/**
 * Build the global-install command for a given PM.
 */
function globalInstallCmd(pm) {
  if (pm === 'pnpm') return 'pnpm add -g uniweb@latest'
  if (pm === 'yarn') return 'yarn global add uniweb@latest'
  return 'npm i -g uniweb@latest'
}

/**
 * Fetch the latest published version. Returns null on network error.
 */
async function fetchLatestVersion() {
  try {
    const res = await fetch('https://registry.npmjs.org/uniweb/latest')
    if (!res.ok) return null
    const data = await res.json()
    return data?.version || null
  } catch {
    return null
  }
}

/**
 * Compare two semver strings: 1 if a>b, -1 if a<b, 0 if equal.
 */
function compareSemver(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

/**
 * Run a shell command, inheriting stdio. Resolves with the exit code.
 */
function runCommand(cmd) {
  return new Promise((resolve) => {
    const [bin, ...rest] = cmd.split(' ')
    const child = spawn(bin, rest, { stdio: 'inherit' })
    child.on('close', code => resolve(code ?? 0))
    child.on('error', () => resolve(1))
  })
}

export async function update(args = []) {
  const agentsOnly = args.includes('--agents-only')
  const skipAgents = args.includes('--no-agents')
  const skipPrompt = args.includes('--yes') || isNonInteractive(args)
  const isGlobal = isGlobalInstall()
  const workspaceDir = findUniwebWorkspace(process.cwd())
  const inProject = !!workspaceDir
  const cliVersion = getCliVersion()

  // ─── Step 1: Self-update path ─────────────────────────────────
  if (!agentsOnly) {
    if (!isGlobal) {
      // Project-local: can't self-update meaningfully.
      log(`${colors.dim}Running the project-local CLI (v${cliVersion}). This copy is pinned by your${colors.reset}`)
      log(`${colors.dim}project's package.json. To update it, bump${colors.reset} ${colors.cyan}uniweb${colors.reset}${colors.dim} in${colors.reset} ${colors.cyan}package.json${colors.reset}${colors.dim} and re-install.${colors.reset}`)
      log('')
    } else {
      const latest = await fetchLatestVersion()
      if (latest === null) {
        warn('Could not reach the npm registry to check for updates.')
        log(`${colors.dim}Current: ${cliVersion}. Try later, or run${colors.reset} ${colors.cyan}${globalInstallCmd(detectGlobalPm())}${colors.reset}${colors.dim} manually.${colors.reset}`)
        log('')
      } else if (compareSemver(latest, cliVersion) <= 0) {
        success(`uniweb is up to date (v${cliVersion}).`)
        log('')
      } else {
        const pm = detectGlobalPm()
        const cmd = globalInstallCmd(pm)
        log(`${colors.yellow}Update available:${colors.reset} ${colors.dim}${cliVersion}${colors.reset} → ${colors.cyan}${latest}${colors.reset}`)
        log(`${colors.dim}Detected package manager:${colors.reset} ${pm}`)
        log(`${colors.dim}Will run:${colors.reset} ${colors.cyan}${cmd}${colors.reset}`)
        log('')

        if (skipPrompt) {
          log(`${colors.dim}Non-interactive — skipping self-update. Run the command above to update.${colors.reset}`)
          log('')
        } else {
          const { go } = await prompts({
            type: 'confirm',
            name: 'go',
            message: `Run \`${cmd}\` now?`,
            initial: true,
          })
          if (go) {
            const code = await runCommand(cmd)
            if (code === 0) {
              success(`Self-update complete.`)
            } else {
              error(`Self-update failed (exit ${code}). Run the command above manually if needed.`)
            }
            log('')
          } else {
            log(`${colors.dim}Skipped self-update.${colors.reset}`)
            log('')
          }
        }
      }
    }
  }

  // ─── Step 2: AGENTS.md refresh path ───────────────────────────
  if (skipAgents) return
  if (!inProject) {
    if (agentsOnly) {
      error('Not in a Uniweb project (no `uniweb` dep in the workspace root package.json).')
      log(`${colors.dim}Run this command from inside a project created by${colors.reset} ${colors.cyan}uniweb create${colors.reset}${colors.dim}.${colors.reset}`)
      process.exit(1)
    }
    // Self-update-only path. Quietly skip AGENTS.md.
    return
  }

  const agentsPath = join(workspaceDir, 'AGENTS.md')
  const currentAgentsVersion = readAgentsVersion(agentsPath)
  if (currentAgentsVersion === cliVersion) {
    success(`AGENTS.md is already up to date (v${cliVersion}).`)
    return
  }

  // Prompt before writing in TTY, unless --yes / non-interactive (in which
  // case we err on the side of doing the right thing — refresh — since the
  // user explicitly invoked `uniweb update` from a Uniweb project).
  if (!skipPrompt && !agentsOnly) {
    const action = currentAgentsVersion ? `Update AGENTS.md (v${currentAgentsVersion} → v${cliVersion})?` : `Create AGENTS.md (v${cliVersion})?`
    const { yes } = await prompts({ type: 'confirm', name: 'yes', message: action, initial: true })
    if (!yes) {
      log(`${colors.dim}Skipped AGENTS.md.${colors.reset}`)
      return
    }
  }

  const content = generateAgentsContent()
  writeFileSync(agentsPath, content)
  if (currentAgentsVersion) {
    success(`Updated AGENTS.md (v${currentAgentsVersion} → v${cliVersion}).`)
  } else {
    success(`Created AGENTS.md (v${cliVersion}).`)
  }
}
