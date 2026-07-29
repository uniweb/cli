/**
 * The deploy wizard — "Where should this site go?"
 *
 * Distinct from `host-prompt.js`, and the split matters. `promptForHost`
 * answers a *build* question — which host-specific helper files should
 * land in `dist/` — so it lists every registered adapter, including
 * shape-only entries like `generic-static`. This module answers a
 * *shipping* question, so it lists destinations you can actually act on
 * and says what acting will do.
 *
 * The bug that motivated the split: the deploy path used to reuse
 * `promptForHost`, offering six adapters when only one implemented a
 * deploy hook. Five of six choices dead-ended on "does not implement a
 * deploy step". A picker must never offer a door that doesn't open — so
 * entries are derived from real adapter capability (`deploy` / `initCi`),
 * not from a registry key list.
 *
 * Two synthetic entries round out the menu:
 *   - Uniweb Cloud — not an adapter; it delegates to `uniweb publish`.
 *     Listed after the third-party hosts rather than first: the framework
 *     is backend-optional and standalone-first, so leading a generic
 *     `deploy` with the paid product would read as an upsell.
 *   - Somewhere else — delegates to `uniweb export`.
 */

import { promptSelect } from './workspace.js'
import { isNonInteractive } from './interactive.js'

export const UNIWEB_DESTINATION = {
  value: { kind: 'uniweb' },
  title: 'Uniweb Cloud · paid, dynamic + visual editing',
  description:
    'Sync + dynamic SSR, visual editing for content authors, foundation propagation. Runs `uniweb publish`.'
}

export const EXPORT_DESTINATION = {
  value: { kind: 'export' },
  title: 'Somewhere else · export a folder',
  description:
    'Builds a self-contained dist/ you upload yourself. Runs `uniweb export`.'
}

/**
 * Build the destination list from the adapter registry.
 *
 * @returns {Promise<Array<{value: object, title: string, description: string}>>}
 */
export async function buildDestinationChoices() {
  const { listAdapters, getAdapter } = await import('@uniweb/build/hosts')

  const adapters = listAdapters()
    .map((name) => getAdapter(name))
    .filter((a) => a.display?.wizard !== false)
    // Never offer a door that doesn't open.
    .filter(
      (a) => typeof a.deploy === 'function' || typeof a.initCi === 'function'
    )
    .sort((a, b) => (a.display?.order ?? 999) - (b.display?.order ?? 999))

  const choices = adapters.map((a) => ({
    value: { kind: 'adapter', host: a.name },
    title: `${a.display?.title || a.name} · ${a.display?.qualifier || ''}`
      .trim()
      .replace(/ ·\s*$/, ''),
    description: a.display?.summary || ''
  }))

  return [...choices, UNIWEB_DESTINATION, EXPORT_DESTINATION]
}

/**
 * Ask *how* to ship to an adapter that supports both paths. Skipped when
 * the adapter only supports one — no point asking a question with a
 * single answer.
 *
 * @returns {Promise<'ci'|'deploy'|null>} null when cancelled.
 */
async function promptForAction(adapter) {
  const canCi = typeof adapter.initCi === 'function'
  const canDeploy = typeof adapter.deploy === 'function'

  if (canCi && !canDeploy) return 'ci'
  if (canDeploy && !canCi) return 'deploy'

  const label = adapter.display?.title || adapter.name
  const previews = adapter.display?.previews
    ? ' Pull requests get their own preview URL.'
    : ''

  return promptSelect(`${label} — how?`, [
    {
      value: 'ci',
      title: 'Set it up to deploy on every push · recommended',
      description: `Writes a GitHub Actions workflow. One-time setup — after this, pushing to the default branch deploys.${previews}`
    },
    {
      value: 'deploy',
      title: 'Upload from this machine now',
      description: `Builds dist/ here and pushes it with ${adapter.display?.pushWith || 'the host CLI'}.`
    }
  ])
}

/**
 * Run the wizard.
 *
 * @param {object} opts
 * @param {string[]} opts.args — Argv, used only to gate non-interactive mode.
 * @param {string|null} [opts.preselect] — Host name to float to the top, so
 *   Enter repeats what deploy.yml already records.
 * @returns {Promise<{kind: string, host?: string, action?: string}|null>}
 *   null when the user cancels.
 * @throws {Error} When non-interactive — the caller prints the guidance.
 */
export async function promptForDestination({
  args = [],
  preselect = null
} = {}) {
  if (isNonInteractive(args)) {
    throw new Error(
      'Cannot prompt for a destination when running non-interactively.'
    )
  }

  let choices = await buildDestinationChoices()

  // Float the remembered target so Enter does the obvious thing.
  if (preselect) {
    const idx = choices.findIndex(
      (c) => c.value.kind === 'adapter' && c.value.host === preselect
    )
    if (idx > 0)
      choices = [choices[idx], ...choices.filter((_, i) => i !== idx)]
  }

  const picked = await promptSelect('Where should this site go?', choices)
  if (!picked) return null
  if (picked.kind !== 'adapter') return picked

  const { getAdapter } = await import('@uniweb/build/hosts')
  const adapter = getAdapter(picked.host)
  const action = await promptForAction(adapter)
  if (!action) return null

  return { ...picked, action }
}
