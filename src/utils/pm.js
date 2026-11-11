/**
 * Package Manager Detection
 *
 * Detect whether the user ran the CLI via npm or pnpm,
 * and generate PM-appropriate commands for output messages.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

/**
 * Detect which package manager invoked the CLI.
 * Uses the standard npm_config_user_agent env var (same technique as create-vite, create-next-app).
 *
 * Note: this returns the *invoker* PM, which is empty when the user runs
 * a global CLI binary directly from a shell. For the workspace's own PM
 * (driven by lockfile presence), use `detectWorkspacePm`.
 *
 * @returns {'pnpm' | 'npm'}
 */
export function detectPackageManager() {
  const ua = process.env.npm_config_user_agent || ''
  if (ua.startsWith('pnpm/')) return 'pnpm'
  return 'npm'
}

/**
 * Detect the workspace's package manager by inspecting lockfiles at the
 * workspace root. This is the right signal for "what PM should I use to
 * install in this workspace" — independent of how the CLI was invoked.
 *
 * @param {string} workspaceRoot - Absolute path to workspace root
 * @returns {'pnpm' | 'yarn' | 'npm' | null} - null when no lockfile is present
 */
export function detectWorkspacePm(workspaceRoot) {
  if (!workspaceRoot) return null
  if (existsSync(join(workspaceRoot, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(workspaceRoot, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(workspaceRoot, 'package-lock.json'))) return 'npm'
  return null
}

/**
 * The pnpm major that actually installed this workspace.
 *
 * pnpm records the version it ran as in `node_modules/.modules.yaml`:
 *
 *     "packageManager": "pnpm@10.30.0"
 *
 * This is a *record of what happened*, not a guess about intent — which
 * matters, because intent cannot be inferred. The documented way to
 * scaffold is `npm create uniweb`, and plenty of people follow it with
 * `pnpm install`; the invoking package manager therefore says nothing
 * about the one the project uses. The lockfile says WHICH manager
 * (`detectWorkspacePm`); this says which pnpm MAJOR, which the lockfile
 * cannot — pnpm 10 and 11 both write `lockfileVersion: 9.0`.
 *
 * Despite the extension the file is JSON in current pnpm; `js-yaml`
 * parses both, since YAML is a superset. Older pnpm wrote real YAML.
 *
 * @param {string} workspaceRoot
 * @returns {string|null} pnpm major (e.g. '10'), or null when the file is
 *   absent or unreadable — callers fall back to their own default.
 */
export function detectInstalledPnpmVersion(workspaceRoot) {
  if (!workspaceRoot) return null
  const path = join(workspaceRoot, 'node_modules', '.modules.yaml')
  if (!existsSync(path)) return null
  try {
    // Cheap targeted read: the file is large (hoisted-dependency maps run
    // to hundreds of KB) and we want exactly one field, so match it
    // directly rather than parsing the whole document.
    const text = readFileSync(path, 'utf8')
    // Quotes optional on both key and value: current pnpm writes JSON
    // (`"packageManager": "pnpm@10.30.0"`), but the file is named .yaml and
    // YAML permits the bare form, so accept either rather than depending on
    // which serializer the installing pnpm happened to use.
    const match = text.match(/["']?packageManager["']?\s*:\s*["']?pnpm@(\d+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * Detect which package manager owns a *globally installed* `uniweb` CLI
 * binary, by inspecting its install path (`process.argv[1]`). pnpm and
 * yarn keep global packages under recognizable directory segments;
 * everything else is assumed to be npm. Only meaningful when the CLI is
 * actually a global install (see index.js::isGlobalInstall) — a
 * project-local or npx-launched copy is updated differently.
 *
 * @returns {'pnpm' | 'yarn' | 'npm'}
 */
export function detectGlobalCliPm() {
  const path = (process.argv[1] || '').toLowerCase().replace(/\\/g, '/')
  if (path.includes('/pnpm/')) return 'pnpm'
  if (path.includes('/yarn/')) return 'yarn'
  return 'npm'
}

/**
 * The command to (re)install the latest `uniweb` CLI globally with a
 * given package manager.
 * @param {'pnpm' | 'yarn' | 'npm'} pm
 * @returns {string}
 */
export function globalCliUpdateCmd(pm) {
  if (pm === 'pnpm') return 'pnpm add -g uniweb@latest'
  if (pm === 'yarn') return 'yarn global add uniweb@latest'
  return 'npm i -g uniweb@latest'
}

/**
 * Generate a workspace-filtered command.
 * pnpm: "pnpm --filter site dev"
 * npm:  "npm -w site run dev"
 * @param {'pnpm' | 'npm'} pm
 * @param {string} pkg - Package name to filter to
 * @param {string} cmd - Script name to run
 * @returns {string}
 */
export function filterCmd(pm, pkg, cmd) {
  return filterArgs(pm, pkg, cmd).join(' ')
}

/**
 * The same command as a program and its arguments, to run rather than to print.
 * @returns {string[]}
 */
export function filterArgs(pm, pkg, cmd) {
  return pm === 'pnpm' ? ['pnpm', '--filter', pkg, cmd] : ['npm', '-w', pkg, 'run', cmd]
}

/**
 * Whether pnpm is available on the current PATH. Used to recommend pnpm
 * (the framework's package manager) in post-scaffold next steps while still
 * falling back gracefully when it isn't installed. Mirrors the `git --version`
 * probe the create flow already uses to feature-detect git.
 * @returns {boolean}
 */
export function isPnpmAvailable() {
  try {
    execSync('pnpm --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Generate an install command.
 * @param {'pnpm' | 'yarn' | 'npm'} pm
 * @returns {string}
 */
export function installCmd(pm) {
  if (pm === 'pnpm') return 'pnpm install'
  if (pm === 'yarn') return 'yarn install'
  return 'npm install'
}

/**
 * The package manager to tell someone to install a workspace with: the one its lockfile names; with
 * no lockfile yet, pnpm where it is installed (the framework's own), else the one that ran this CLI.
 *
 * ⭐ THE ONE RULE FOR EVERY INSTALL LINE a command prints — `start`, `create`, `add`, `rename`,
 * `update`, and the hint for a workspace that isn't installed — so someone going from one command
 * to the next is told one thing. ⛔ Until 2026-11-11 each chose its own: `uniweb start` said
 * `npm install` before a project existed while the `create` it sends you to said `pnpm install`
 * wherever pnpm is installed (an agent building a site was told both in one session), `rename` said
 * whatever ran it, so `npx uniweb rename` in a pnpm workspace said `npm install`, and `add` never
 * said pnpm in a workspace not yet installed.
 *
 * It says what to run, not how a command writes a workspace's scripts (`filterArgs`), which each
 * command decides apart.
 *
 * @param {string|null} [workspaceRoot] - the workspace, when there is one
 * @returns {'pnpm' | 'yarn' | 'npm'}
 */
export function pmToInstall(workspaceRoot = null) {
  return detectWorkspacePm(workspaceRoot) || (isPnpmAvailable() ? 'pnpm' : detectPackageManager())
}

/**
 * The install to run right after a command edited the workspace's package.json files, and the one
 * to tell someone to run then.
 *
 * ⭐ NEVER FROZEN. Wherever `CI` is set (a CI job, and the shell some agents run in) pnpm makes
 * `install` frozen, and a frozen install refuses the package.json files the command just wrote.
 * Measured 2026-11-10: `uniweb update --yes` with `CI=1` failed at its install every time, and the
 * retry it printed failed the same way. npm's `install` is never frozen (`npm ci` is the frozen one).
 * yarn is left as it is: berry's flag for this (`--no-immutable`) is not one classic yarn has.
 *
 * @param {'pnpm' | 'yarn' | 'npm'} pm
 * @returns {string}
 */
export function installAfterEditCmd(pm) {
  if (pm === 'pnpm') return 'pnpm install --no-frozen-lockfile'
  return installCmd(pm)
}

/**
 * Generate a run-script command.
 * @param {'pnpm' | 'npm'} pm
 * @param {string} script - Script name
 * @returns {string}
 */
export function runCmd(pm, script) {
  return pm === 'pnpm' ? `pnpm ${script}` : `npm run ${script}`
}
