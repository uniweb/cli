/**
 * ⭐ A CHANGED `blueprint.yml` NEVER REACHES A BACKEND ALREADY STARTED FROM THE SITE — and the CLI says
 * so: at the push that sends one (`push`, `publish`, and `sync` through push), and in `uniweb status`.
 *
 * The file says how a backend started from the site begins (`@uniweb/build`'s `uwx/blueprint.js`). It
 * is applied once, when that backend starts, and from then on the site's owner changes the running
 * backend in its administration. A push still checks the file and carries it with the site, and a pull
 * writes it back, so a changed file is accepted without a word. A person who changed it expects the
 * running backend to follow, and nothing else tells them it doesn't.
 *
 * ⭐ ONE RULE, read off the site's status (`GET /dev/site/status/{uuid}`, its `backend_state`):
 *
 *   no key      a backend older than the field, which says nothing either way: say nothing, and
 *               never read it as `null`
 *   `null`      no backend has been started from this site, so the file is how its next one
 *               begins: say nothing
 *   any other   a backend has been started from it (running, being started, stopped, destroyed, or
 *               a state a backend names later), and a changed file no longer reaches it
 *
 * ⛔ NO PROMISE OF ANOTHER BACKEND. A publish starts a backend only where the state reads `null`, so
 * one that was destroyed is not started again by it. Nothing here says the file will found one, and
 * nothing reads a state's name past `null`.
 *
 * ⛔ THE STATE BEFORE THE PUSH. A publish can start the site's first backend once its push has landed,
 * and that start takes the blueprint the push just stored. Read after the publish, the state would say
 * `provisioning` about a change that did reach it. So `push` and `publish` judge by the status they
 * read before sending.
 *
 * "Changed" means what the push sends against what the site held before it, compared as a pull
 * compares them (`sameBlueprint`): the status carries the stored request whole, the `backend` row's
 * `config.blueprint` included, with its types in full (measured 2026-11-10 on a local backend). A push
 * that sends no blueprint says nothing.
 */

import * as uwx from '@uniweb/build/uwx'
import { BLUEPRINT_FILE, readBlueprint, siteSelfScope } from '@uniweb/build/uwx'

// ⛔ AN OLDER `@uniweb/build` EXPORTS NONE OF THESE (they came with build `753d745`), and this CLI is its
// peer, so a project can run it over one. A named import would stop `push`, `publish` and `status` from
// loading at all, so they are read off the namespace: without them nothing here is said, and the verbs
// work as they did before.
const { blueprintForWire, liftBlueprint, sameBlueprint } = uwx
const COMPARABLE = [blueprintForWire, liftBlueprint, sameBlueprint].every((fn) => typeof fn === 'function')

/**
 * Whether a backend has been started from the site, by its status: `true` or `false`, or `null` when
 * the status says nothing (none was read, or it comes from a backend older than `backend_state`).
 *
 * @param {object|null} status - the site's status reply
 * @returns {boolean|null}
 */
export function backendStarted(status) {
  if (!status || typeof status !== 'object' || !Object.hasOwn(status, 'backend_state')) return null
  return status.backend_state !== null
}

/** The blueprint the site holds, by its status: its `backend` row's, or undefined for none. */
const heldBlueprint = (status) => liftBlueprint(status?.services).blueprint

const STARTED = `${BLUEPRINT_FILE} is how a backend started from this site begins, and this site's backend has started`

/** Where the change is made instead — by a person, in a browser. */
const ADMINISTRATION = "What a running backend allows, the site's owner changes in the backend's administration."

/**
 * Whether a push's `services` rows carry a blueprint, so that `sentBlueprintNote` has something to
 * judge: a push asks the site's status only then.
 *
 * @param {object[]|null} sent - the `services` rows the push sends; null when it sends no site content
 * @returns {boolean}
 */
export function sendsBlueprint(sent) {
  return COMPARABLE && Array.isArray(sent) && liftBlueprint(sent).blueprint !== undefined
}

/**
 * What a push or a publish says after sending a blueprint the site did not hold, when the site's
 * backend has started: the lines to print, the first the headline. Null when there is nothing to say.
 *
 * @param {object} p
 * @param {object|null} p.status - the site's status, read BEFORE the push sent anything
 * @param {object[]|null} p.sent - the `services` rows the push sends; null when it sends no site content
 * @returns {string[]|null}
 */
export function sentBlueprintNote({ status, sent }) {
  if (!sendsBlueprint(sent) || backendStarted(status) !== true) return null
  if (sameBlueprint(liftBlueprint(sent).blueprint, heldBlueprint(status))) return null
  return [`${STARTED}: the change just sent doesn't reach it.`, ADMINISTRATION]
}

/**
 * `hosting.blueprint`, for `uniweb status`: a site that keeps a blueprint here and whose backend has
 * started. `ok` while the file, as a push would send it, says what the site holds; `attention` when it
 * says something else. Null when there is nothing to say: no file, a backend that says nothing, none
 * started, or a file a push would refuse, which `doctor` names.
 *
 * @param {object} p
 * @param {string} p.siteDir
 * @param {object|null} p.status - the site's status reply
 * @returns {Promise<object|null>}
 */
export async function blueprintCheck({ siteDir, status }) {
  if (!COMPARABLE || backendStarted(status) !== true) return null
  let local
  try {
    const file = readBlueprint(siteDir)
    if (!file) return null
    local = blueprintForWire(file, await siteSelfScope(siteDir))
  } catch {
    return null
  }
  const differs = !sameBlueprint(local, heldBlueprint(status))
  const detail = { backend_state: status.backend_state, differs }
  return differs
    ? {
        id: 'hosting.blueprint',
        state: 'attention',
        summary: `${STARTED}: the file here differs from what the site holds, and a push of it doesn't reach that backend.`,
        lines: [ADMINISTRATION],
        detail
      }
    : { id: 'hosting.blueprint', state: 'ok', summary: `${STARTED}: a change to the file doesn't reach it.`, detail }
}
