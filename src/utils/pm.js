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
  return pm === 'pnpm'
    ? `pnpm --filter ${pkg} ${cmd}`
    : `npm -w ${pkg} run ${cmd}`
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
 * Generate a run-script command.
 * @param {'pnpm' | 'npm'} pm
 * @param {string} script - Script name
 * @returns {string}
 */
export function runCmd(pm, script) {
  return pm === 'pnpm' ? `pnpm ${script}` : `npm run ${script}`
}
