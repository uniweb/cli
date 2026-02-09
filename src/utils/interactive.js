/**
 * Non-Interactive Mode Detection
 *
 * Detects when the CLI is running without a TTY (AI agents, CI, piped input)
 * and provides helpers for printing actionable error messages.
 */

/**
 * Detect if the CLI is running in non-interactive mode.
 * True when --non-interactive flag, CI env var, or no TTY.
 * @param {string[]} args - Command line arguments
 * @returns {boolean}
 */
export function isNonInteractive(args) {
  if (args.includes('--non-interactive')) return true
  if (process.env.CI) return true
  if (!process.stdin.isTTY) return true
  return false
}

/**
 * Get the CLI invocation prefix to use in suggested commands.
 * Mirrors however the user actually ran the CLI.
 * @returns {string}
 */
export function getCliPrefix() {
  const ua = process.env.npm_config_user_agent || ''
  if (ua.startsWith('pnpm/')) return 'pnpm uniweb'
  if (ua.startsWith('npm/')) return 'npx uniweb'
  return 'uniweb'
}

/**
 * Strip --non-interactive from an args array so it doesn't interfere
 * with positional argument parsing.
 * @param {string[]} args
 * @returns {string[]}
 */
export function stripNonInteractiveFlag(args) {
  return args.filter(a => a !== '--non-interactive')
}

/**
 * Format a list of options with aligned descriptions for terminal output.
 * @param {{ label: string, description: string }[]} options
 * @returns {string}
 */
export function formatOptions(options) {
  const maxLen = Math.max(...options.map(o => o.label.length))
  return options
    .map(o => `  ${o.label.padEnd(maxLen + 3)}${o.description}`)
    .join('\n')
}
