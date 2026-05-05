/**
 * Interactive host adapter selection
 *
 * Prompts the user to pick a host adapter from the registry. Used when
 * `--host` is passed without a value to `uniweb deploy / build / export`.
 *
 * Non-interactive contexts (CI, piped input, --non-interactive) get a
 * structured error instead of a prompt — never silently default to
 * something the user didn't pick.
 */

import { promptSelect } from './workspace.js'
import { isNonInteractive } from './interactive.js'

/**
 * Pick a host adapter, optionally with a pre-selection.
 *
 * @param {object} opts
 * @param {string[]} opts.args — Argv, used only to gate non-interactive mode.
 * @param {string|null} [opts.preselect] — Suggested adapter name; the prompt
 *   highlights this so Enter accepts it without arrow-key navigation.
 * @returns {Promise<string>} The chosen adapter name.
 * @throws {Error} When non-interactive (with the registry list in the message),
 *   or when the user aborts the prompt.
 */
export async function promptForHost({ args, preselect = null } = {}) {
  // Lazy-load so this module doesn't pull @uniweb/build at import time
  // for callers that never reach the prompt path.
  const { listAdapters } = await import('@uniweb/build/hosts')
  const adapters = listAdapters()

  if (isNonInteractive(args || [])) {
    const list = adapters.join(', ')
    throw new Error(
      `--host requires a value when running non-interactively. Known adapters: ${list}.`
    )
  }

  // promptSelect doesn't expose initial-index, so move the preselect to
  // the top of the list — the menu still highlights index 0 by default.
  const ordered = preselect && adapters.includes(preselect)
    ? [preselect, ...adapters.filter(a => a !== preselect)]
    : adapters

  const choice = await promptSelect('Pick a host adapter:', ordered)
  if (!choice) {
    throw new Error('Host selection cancelled.')
  }
  return choice
}
