/**
 * Package Manager Detection
 *
 * Detect whether the user ran the CLI via npm or pnpm,
 * and generate PM-appropriate commands for output messages.
 */

/**
 * Detect which package manager invoked the CLI.
 * Uses the standard npm_config_user_agent env var (same technique as create-vite, create-next-app).
 * @returns {'pnpm' | 'npm'}
 */
export function detectPackageManager() {
  const ua = process.env.npm_config_user_agent || ''
  if (ua.startsWith('pnpm/')) return 'pnpm'
  return 'npm'
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
 * @param {'pnpm' | 'npm'} pm
 * @returns {string}
 */
export function installCmd(pm) {
  return pm === 'pnpm' ? 'pnpm install' : 'npm install'
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
