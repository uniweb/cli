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
 *
 * ⭐ **A workspace is any unit the backend lets a request name** (backend, 2026-10-22): an
 * organization, and the units below one — a sub-org, a project — each under its child handle,
 * `@top:part` (`@studio:acme`); a unit with no handle by its uuid. The login checks and offers
 * them from the orgs read's `workspaces`, never its `orgs`, which are the SCOPES and leave every
 * child unit out (`registry-orgs.js`). A child handle names a workspace and no scope.
 */

import { readOrgFlag } from '../utils/args.js'
import { loginCommand } from '../utils/config.js'
import { fetchOrgs, bareHandle, validateHandle } from '../utils/registry-orgs.js'
import { readRegistryAuth } from '../utils/registry-auth.js'
import { workspaceHandle, describeWorkspace, isUnitUuid } from './client.js'

export { describeWorkspace }

/** The personal workspace, as a login stores the choice (a handle is stored with its `@`). */
export const PERSONAL = 'personal'

/** Names a process's workspace when it is logged in with `UNIWEB_TOKEN`. */
export const WORKSPACE_ENV = 'UNIWEB_WORKSPACE'

/**
 * A workspace as `--org` names it, in the header's form: a unit's uuid when the value is
 * written bare and shaped like one — the header's own rule, where the `@` tells the two
 * apart — else a handle, `@acme` or `@studio:acme`. Null when the value names none.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function namedWorkspace(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const v = value.trim()
  return isUnitUuid(v) ? v.toLowerCase() : workspaceHandle(v)
}

/**
 * A workspace choice as it may be written — `@acme`, `acme`, `@studio:acme`, a unit's uuid,
 * `personal` — or null when the value names none.
 *
 * @param {unknown} value
 * @returns {string|null} `@acme`, a uuid, `PERSONAL`, or null
 */
export function parseWorkspaceChoice(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const v = value.trim()
  return v === PERSONAL ? PERSONAL : namedWorkspace(v)
}

/**
 * The workspaces the orgs read lists — what the header admits — each by the name a request
 * gives it: `@handle`, or the unit's uuid when it has none. Null when the answer carries no
 * list, which a workspace reader refuses (`noWorkspaceList`).
 *
 * @param {{ workspaces?: Array<{ unit_uuid?: string, handle?: string|null, kind?: string, is_primary?: boolean }>|null }|null} envelope
 * @returns {Array<{ name: string, kind: string|null, primary: boolean }>|null}
 */
export function listedWorkspaces(envelope) {
  if (!Array.isArray(envelope?.workspaces)) return null
  return envelope.workspaces
    .map((w) => ({
      name: w?.handle ? workspaceHandle(w.handle) : isUnitUuid(w?.unit_uuid) ? w.unit_uuid.trim().toLowerCase() : null,
      kind: typeof w?.kind === 'string' ? w.kind : null,
      primary: w?.is_primary === true
    }))
    .filter((w) => w.name)
}

/**
 * The top-level organization of a unit named by its child handle — `@studio` for `@studio:acme`,
 * the part before the colon (backend, 2026-10-22).
 *
 * @param {string} handle - `@top:part`
 * @returns {string} `@top`
 */
export function topOfChildHandle(handle) {
  return `@${String(handle).replace(/^@/, '').split(':')[0]}`
}

/**
 * The account's own handle, as the header would name it (`@jane`), from the orgs read — or null.
 *
 * ⛔ **An account's handle names no workspace** (backend, 2026-10-22, pinned by its tests). A
 * handle names a person or an org, and only an org is a workspace: the header answers
 * `@<account handle>` with `400`, never as the personal workspace, which a request names by
 * naming none. So `--org @<your handle>` is refused, saying what names your own.
 */
export function ownHandle(envelope) {
  return envelope?.account_handle ? workspaceHandle(envelope.account_handle) : null
}

/** What naming your own handle as a workspace is told — `--personal`, or `UNIWEB_WORKSPACE=personal`. */
export const ownHandleNamesNone = (named, personal) =>
  `${named} is your own handle, which names no workspace — your personal workspace is ${personal}.`

/**
 * What a backend whose orgs read lists no workspaces is told. ⛔ The CLI does not check
 * against `orgs` in its place: that list leaves out every unit below an org.
 */
export const noWorkspaceList = (origin) =>
  `${origin} lists no workspaces, so the CLI cannot check or offer one — that backend is older than this CLI.`

/** A choice in the header's form: `@acme`, or null for the personal workspace. */
export function headerOf(choice) {
  return choice === PERSONAL ? null : choice
}

/** What a source is called in a sentence — "(… )" after the workspace. */
export const SOURCE_LABEL = {
  flag: 'named on this command',
  env: WORKSPACE_ENV,
  login: 'your login',
  personal: 'you belong to no organization or project',
  offline: 'not resolved in a preview'
}

/** How to choose, for a command on `origin` — its login names the backend when it must (`loginCommand`). */
const choose = (origin) =>
  [
    'Choose the workspace you work in:',
    `    ${loginCommand(origin)} --org @acme   (or --personal) — for every command after`,
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
  if (flag) return { workspace: namedWorkspace(flag), source: 'flag' }
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

  // Personal only when it is the one workspace there is — a project counts as much as an
  // organization (`listedWorkspaces`).
  const listed = listedWorkspaces(await client.fetchOrgs())
  if (!listed) return { refused: true, reason: noWorkspaceList(client.origin) }
  if (!listed.length) return { workspace: null, source: 'personal' }
  return {
    refused: true,
    reason: `You belong to organizations or projects, so no workspace is assumed.\n  ${choose(client.origin)}`
  }
}

/**
 * The scope a bare name registers under by default — the workspace the command works in
 * *[Diego, 2026-10-06]*: an organization's handle, or your own handle for your personal
 * workspace.
 *
 * ⭐ A default, asked once: a name that carries a scope keeps it, and `--scope` names
 * another. The workspace still never decides anything else about a foundation — it
 * decides which SITE a command works on; here it only answers the question a bare name
 * asks the first time it registers.
 *
 * ⭐ **A unit below an organization — a sub-org, a project — takes its organization's scope**
 * *[Diego, 2026-10-22]*: its child handle (`@studio:acme`) names no scope (backend, the same day),
 * and a bare name registered from it defaults to the top-level org's handle, `@studio`, when that
 * org is among the account's organizations — the orgs read's `orgs`, the scopes. Not otherwise: a
 * project's guest belongs to the project alone and has only their own scope, and so do the people
 * of a sub-org whose belonging stops there — which the orgs read cannot tell apart, so membership is
 * read from `orgs` and nothing else.
 *
 * Null when the workspace names no scope, and the caller derives one as before
 * (`deriveScope`): none is chosen (you belong to organizations and none is named), the
 * command is a preview, the workspace is a unit without a handle, the workspace is a unit
 * below an organization the account is not a member of, or the account has no handle (a
 * service account).
 *
 * @param {{ workspace?: string|null, source?: string, refused?: boolean }} ws -
 *   `resolveWorkspace`'s answer
 * @param {string|null} accountHandle - the account's own handle (`GET /dev/orgs`), read
 *   only for the personal workspace
 * @param {Array<{ handle?: string }>} [orgs] - the orgs read's `orgs`, read only for a unit
 *   below an organization
 * @returns {string|null} `@handle`
 */
export function scopeOfWorkspace(ws, accountHandle, orgs = []) {
  if (!ws || ws.refused || ws.source === 'offline') return null
  if (typeof ws.workspace === 'string') {
    if (!ws.workspace.startsWith('@')) return null
    if (!ws.workspace.includes(':')) return ws.workspace
    const top = topOfChildHandle(ws.workspace)
    const member = (Array.isArray(orgs) ? orgs : []).some((o) => `@${bareHandle(o?.handle)}` === top)
    return member ? top : null
  }
  const h = bareHandle(accountHandle || '')
  return h && !validateHandle(h) ? `@${h}` : null
}

/**
 * The workspace a login works in — asked once, at `uniweb login`, and stored with the
 * session.
 *
 *   `--org @acme`            must be a workspace the orgs read lists — an organization, or
 *                            a sub-org or a project under its child handle (`@studio:acme`),
 *                            or a unit with no handle by its uuid
 *   `--personal`             your personal workspace
 *   neither, none listed     your personal workspace — said, not asked
 *   neither, some listed     a pick at a terminal; refused without one
 *
 * @param {object} p
 * @param {string} p.apiBase
 * @param {string} p.token
 * @param {string[]} [p.args]
 * @returns {Promise<{ choice: string, note?: string } | { refused: true, reason: string }>}
 *   `choice` is `@acme`, a unit's uuid, or `PERSONAL`
 */
export async function chooseWorkspace({ apiBase, token, args = [] }) {
  const flag = readOrgFlag(args)
  if (!flag && args.includes('--personal')) return { choice: PERSONAL }

  const envelope = await fetchOrgs({ apiBase, token })
  const listed = listedWorkspaces(envelope)
  if (!listed) return { refused: true, reason: noWorkspaceList(apiBase) }
  const mine = listed.map((w) => w.name)
  if (flag) {
    const named = namedWorkspace(flag)
    if (!named) return { refused: true, reason: `--org ${flag} names no workspace — give @org, or --personal.` }
    if (named === ownHandle(envelope)) return { refused: true, reason: ownHandleNamesNone(named, '--personal') }
    if (!mine.includes(named)) {
      return {
        refused: true,
        reason:
          `${describeWorkspace(named)} is not a workspace you can open on ${apiBase}. ` +
          (mine.length
            ? `Your workspaces: ${[...mine, `--personal`].join(', ')}.`
            : 'You belong to no organization or project — use --personal.')
      }
    }
    return { choice: named }
  }
  if (!listed.length) {
    return {
      choice: PERSONAL,
      note: 'You belong to no organization or project, so you work in your personal workspace.'
    }
  }

  const { isNonInteractive, getCliPrefix } = await import('../utils/interactive.js')
  // ⭐ How to choose, said whole: the session is stored already (`registry-auth.js`, the
  // login methods), so the login that finishes this signs nobody in again.
  const others = [...mine.slice(1).map((h) => `--org ${h}`), '--personal']
  const howToChoose =
    `Choose one: ${loginCommand(apiBase, getCliPrefix())} --org ${mine[0]} (or ${others.join(', ')}) — ` +
    'it will not ask you to sign in again.'
  if (isNonInteractive(args)) {
    return {
      refused: true,
      reason: `You belong to organizations or projects, so no workspace is assumed. ${howToChoose}`
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
        ...listed.map((w) => ({
          title: `${describeWorkspace(w.name)}${w.kind === 'project' ? ' — a project' : ''}${w.primary ? ' (primary)' : ''}`,
          value: w.name
        }))
      ],
      initial: 0
    },
    // ⛔ A cancelled pick is NOT a cancelled login: the session is stored already, so the
    // login says so and how to finish it (`finishLogin`), and exits 2. Until 2026-10-06 this
    // printed "Cancelled." and exited 0 — with the new session in place of the old one.
    { onCancel: () => false }
  )
  return choice ? { choice } : { refused: true, reason: `No workspace chosen. ${howToChoose}` }
}
