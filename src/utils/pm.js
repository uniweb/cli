/**
 * Package Manager Detection
 *
 * Detect whether the user ran the CLI via npm or pnpm,
 * and generate PM-appropriate commands for output messages.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

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
