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
 * Minimal yes/no prompt. Returns `defaultYes` on an empty answer.
 *
 * Shared rather than per-command: every verb that can stop and ask needs one, and
 * three hand-rolled copies would eventually disagree about what a bare Enter means
 * — which is the answer the user gives most often and thinks about least.
 *
 * ⛔ Callers must decide NOT to ask before calling: this always reads stdin, and a
 * prompt in a non-interactive run hangs a pipeline. Gate on `isNonInteractive(args)`
 * (and on any --yes/--force style skip the verb defines).
 */
export async function confirm(question, defaultYes = false) {
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const a = (
      await rl.question(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'} `)
    )
      .trim()
      .toLowerCase()
    if (!a) return defaultYes
    return a === 'y' || a === 'yes'
  } finally {
    rl.close()
  }
}

/**
 * Ask the user to pick one of a short list, returning `fallback` on an empty answer
 * or anything unparseable.
 *
 * ⛔ **Prompts on STDERR**, like everything else a human reads here — `stdout` is the
 * CLI's data channel and a prompt written there corrupts any caller piping it.
 *
 * ⛔ Callers must decide NOT to ask before calling (see `confirm`): this reads stdin,
 * and a prompt in a non-interactive run hangs a pipeline.
 *
 * @param {string} question
 * @param {string[]} options - shown in order, numbered from 1
 * @param {string} fallback - returned for an empty or unparseable answer
 * @returns {Promise<string>}
 */
export async function pickOne(question, options, fallback) {
  if (!Array.isArray(options) || options.length === 0) return fallback
  if (options.length === 1) return options[0]
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    process.stderr.write(`${question}\n`)
    options.forEach((o, i) => {
      const mark = o === fallback ? ' \x1b[2m(default)\x1b[0m' : ''
      process.stderr.write(`  \x1b[1m${i + 1}\x1b[0m) ${o}${mark}\n`)
    })
    const a = (await rl.question(`Choose [1-${options.length}]: `)).trim()
    if (!a) return fallback
    const n = Number.parseInt(a, 10)
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1]
    // A pasted origin is a reasonable answer to a list of origins.
    if (options.includes(a)) return a
    return fallback
  } finally {
    rl.close()
  }
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
  return args.filter((a) => a !== '--non-interactive')
}

/**
 * Format a list of options with aligned descriptions for terminal output.
 * @param {{ label: string, description: string }[]} options
 * @returns {string}
 */
export function formatOptions(options) {
  const maxLen = Math.max(...options.map((o) => o.label.length))
  return options
    .map((o) => `  ${o.label.padEnd(maxLen + 3)}${o.description}`)
    .join('\n')
}
