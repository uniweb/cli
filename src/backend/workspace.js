/**
 * THE WORKSPACE A COMMAND WORKS IN — one at a time, chosen with the login.
 *
 * ⭐ **[Diego, 2026-09-23]** — *"when a user has workspace in the backend, I expected them
 * to explicitly login into one"*, and a site the backend keeps in ANOTHER workspace is
 * refused rather than worked on anyway: *"that's the intent of the workspace concept."*
 * The app keeps one workspace per tab; the CLI keeps one per login, and every site
 * request names it (`x-uniweb-workspace`, `client.js`). A site outside it answers `409
 * wrong_workspace`, and the command stops, saying how to switch — nothing is adopted.
 *
 * Where a command's workspace comes from — the first answer wins:
 *
 *   1. `--org @acme` / `--personal`     this command only
 *   2. `UNIWEB_WORKSPACE=@acme|personal` a process logged in with `UNIWEB_TOKEN`, which has
 *                                        no `uniweb login` to choose one (a template
 *                                        installer, an agent driving several backends)
 *   3. the one chosen at `uniweb login`  the session's
 *   4. none chosen                       your personal workspace when you belong to no
 *                                        organization; otherwise refused, naming 1–3
 *
 * New sites are created in it: a create names the workspace, and the workspace is the
 * site's owner.
 *
 * ⛔ **The personal workspace is named by naming NONE.** `@<your handle>` is your personal
 * SCOPE — a registry namespace for foundations and data schemas — not a workspace.
 */

import { readOrgFlag } from '../utils/args.js'
import { fetchOrgs } from '../utils/registry-orgs.js'
import { readRegistryAuth } from '../utils/registry-auth.js'
import { workspaceHandle, describeWorkspace } from './client.js'

export { describeWorkspace }

/** The personal workspace, as a login stores the choice (a handle is stored with its `@`). */
export const PERSONAL = 'personal'

/** Names a process's workspace when it is logged in with `UNIWEB_TOKEN`. */
export const WORKSPACE_ENV = 'UNIWEB_WORKSPACE'

/**
 * A workspace choice as it may be written — `@acme`, `acme`, `personal` — or null when
 * the value names none.
 *
 * @param {unknown} value
 * @returns {string|null} `@acme`, `PERSONAL`, or null
 */
export function parseWorkspaceChoice(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const v = value.trim()
  return v === PERSONAL ? PERSONAL : workspaceHandle(v)
}

/** A choice in the header's form: `@acme`, or null for the personal workspace. */
export function headerOf(choice) {
  return choice === PERSONAL ? null : choice
}

/** What a source is called in a sentence — "(… )" after the workspace. */
export const SOURCE_LABEL = {
  flag: 'named on this command',
  env: WORKSPACE_ENV,
  login: 'your login',
  personal: 'you belong to no organization',
  offline: 'not resolved in a preview'
}

const CHOOSE = [
  'Choose the workspace you work in:',
  '    uniweb login --org @acme      (or --personal) — for every command after',
  '    --org @acme / --personal      — for this command only',
  `    ${WORKSPACE_ENV}=@acme        — for a process logged in with UNIWEB_TOKEN`
].join('\n')

/**
 * The workspace this command works in.
 *
 * @param {object} p
 * @param {import('./client.js').BackendClient} p.client - its origin and token
 * @param {string[]} [p.args]
 * @param {boolean} [p.offline=false] - a preview (`--dry-run`, `-o`): never authenticates,
 *   so step 4 answers "not resolved" instead of asking the backend
 * @returns {Promise<{ workspace: string|null, source: string } | { refused: true, reason: string }>}
 *   `workspace` in the header's form — `@acme`, or null for the personal workspace
 */
export async function resolveWorkspace({ client, args = [], offline = false }) {
  const flag = readOrgFlag(args)
  if (flag) return { workspace: workspaceHandle(flag), source: 'flag' }
  if (args.includes('--personal')) return { workspace: null, source: 'flag' }

  const raw = process.env[WORKSPACE_ENV]
  if (raw !== undefined && raw !== '') {
    const env = parseWorkspaceChoice(raw)
    if (!env) {
      return {
        refused: true,
        reason: `${WORKSPACE_ENV}=${JSON.stringify(raw)} names no workspace — give @org, or ${PERSONAL}.`
      }
    }
    return { workspace: headerOf(env), source: 'env' }
  }

  // ⛔ A process logged in with UNIWEB_TOKEN is not the session's login: the token may be
  // another account's, so the session's workspace is not its to use.
  const useSession = !process.env.UNIWEB_TOKEN
  const fromSession = async () =>
    useSession ? parseWorkspaceChoice((await readRegistryAuth(client.origin))?.workspace) : null

  const chosen = await fromSession()
  if (chosen) return { workspace: headerOf(chosen), source: 'login' }
  if (offline) return { workspace: null, source: 'offline' }

  // Authenticate — a login this triggers chooses a workspace, so ask the session again.
  await client.token()
  const now = await fromSession()
  if (now) return { workspace: headerOf(now), source: 'login' }

  const { orgs } = await client.fetchOrgs()
  if (!orgs.length) return { workspace: null, source: 'personal' }
  return {
    refused: true,
    reason: `You belong to organizations, so no workspace is assumed.\n  ${CHOOSE}`
  }
}

/**
 * The workspace a login works in — asked once, at `uniweb login`, and stored with the
 * session.
 *
 *   `--org @acme`            must be an organization you belong to
 *   `--personal`             your personal workspace
 *   neither, no organization your personal workspace — said, not asked
 *   neither, organizations   a pick at a terminal; refused without one
 *
 * @param {object} p
 * @param {string} p.apiBase
 * @param {string} p.token
 * @param {string[]} [p.args]
 * @returns {Promise<{ choice: string, note?: string } | { refused: true, reason: string }>}
 *   `choice` is `@acme` or `PERSONAL`
 */
export async function chooseWorkspace({ apiBase, token, args = [] }) {
  const flag = readOrgFlag(args)
  if (!flag && args.includes('--personal')) return { choice: PERSONAL }

  const { orgs } = await fetchOrgs({ apiBase, token })
  const mine = orgs.map((o) => `@${o.handle}`)
  if (flag) {
    const h = workspaceHandle(flag)
    if (!mine.includes(h)) {
      return {
        refused: true,
        reason:
          `You are not a member of ${h} on ${apiBase}. ` +
          (mine.length
            ? `Your workspaces: ${[...mine, `--personal`].join(', ')}.`
            : 'You belong to no organization — use --personal.')
      }
    }
    return { choice: h }
  }
  if (!orgs.length) {
    return {
      choice: PERSONAL,
      note: 'You belong to no organization, so you work in your personal workspace.'
    }
  }

  const { isNonInteractive } = await import('../utils/interactive.js')
  if (isNonInteractive(args)) {
    return {
      refused: true,
      reason: `You belong to organizations — name the workspace you work in: ${[...mine, '--personal'].map((w) => (w.startsWith('@') ? `--org ${w}` : w)).join(' | ')}.`
    }
  }
  const prompts = (await import('prompts')).default
  const { choice } = await prompts(
    {
      type: 'select',
      name: 'choice',
      message: 'Which workspace do you work in?',
      choices: [
        { title: 'Personal — your own sites', value: PERSONAL },
        ...orgs.map((o) => ({
          title: `@${o.handle}${o.is_primary ? ' (primary)' : ''}`,
          value: `@${o.handle}`
        }))
      ],
      initial: 0
    },
    {
      onCancel: () => {
        console.error('\nCancelled.')
        process.exit(0)
      }
    }
  )
  return choice ? { choice } : { refused: true, reason: 'No workspace chosen.' }
}
