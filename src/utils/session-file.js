/**
 * `~/.uniweb/registry-auth.json` — the ONE reader of its shape.
 *
 *   { version: 2, current: "<origin>", sessions: { "<origin>": { token, … }, … } }
 *
 * ⛔ **There were two readers until 2026-09-21, and the copy is how "the backend you are
 * logged in to" stopped meaning anything.** `registry-auth.js` writes the file and read
 * it; the origin ladder in `config.js` kept a sync copy that read a top-level `origin`.
 * When the file became one session per backend (`fb4907e`), the writer moved to the shape
 * above and the copy kept reading `origin` — a field the new shape does not have — so
 * every command that falls back to the logged-in backend quietly fell through to the
 * default one. Both now read through here, so the shape has one reader to change.
 *
 * ⛔ Dependency-free, by requirement: `config.js` imports this, and `registry-auth.js`
 * imports `config.js`, so this module can import neither.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const SESSION_FILE_VERSION = 2

export function sessionFilePath() {
  return join(homedir(), '.uniweb', 'registry-auth.json')
}

const originOf = (value) => {
  try {
    // http(s) only — `localhost:8080` parses as a scheme with the origin "null".
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

/**
 * Any parsed value → `{ version: 2, current, sessions }`. Never throws.
 *
 * A v1 flat record is ONE session, keyed by its own `origin` stamp — or by
 * `defaultOrigin` when it carries none — and that session is current: it was the only
 * login there was.
 *
 * @param {*} raw - the parsed file, or anything
 * @param {string} defaultOrigin
 */
export function normalizeSessionFile(raw, defaultOrigin) {
  const empty = { version: SESSION_FILE_VERSION, current: null, sessions: {} }
  if (!raw || typeof raw !== 'object') return empty
  if (raw.sessions && typeof raw.sessions === 'object' && !Array.isArray(raw.sessions)) {
    return { version: SESSION_FILE_VERSION, current: originOf(raw.current), sessions: raw.sessions }
  }
  if (typeof raw.token === 'string') {
    const { origin, ...rest } = raw
    const key = originOf(origin) || defaultOrigin
    return { version: SESSION_FILE_VERSION, current: key, sessions: { [key]: rest } }
  }
  return empty
}

/** The file, normalized; synchronous, for the origin ladder. Never throws. */
export function readSessionFileSync(defaultOrigin) {
  const p = sessionFilePath()
  if (!existsSync(p)) return normalizeSessionFile(null, defaultOrigin)
  try {
    return normalizeSessionFile(JSON.parse(readFileSync(p, 'utf8')), defaultOrigin)
  } catch {
    return normalizeSessionFile(null, defaultOrigin)
  }
}

/**
 * **The backend the user is logged in to: the one they logged in to most recently.**
 *
 * Every login marks its backend `current`. With one stored session that session answers
 * even unmarked; with several and none marked there is no answer, and saying so beats
 * guessing between them. An expired session still answers — the user logged in there,
 * and the next request asks them to log in there again.
 *
 * @param {{ current?: string|null, sessions?: object }} file - normalized
 * @returns {string|null}
 */
export function loggedInOriginOf(file) {
  const sessions = file?.sessions || {}
  const has = (o) => !!(o && sessions[o] && typeof sessions[o].token === 'string')
  if (has(file?.current)) return file.current
  const all = Object.keys(sessions).filter(has)
  return all.length === 1 ? all[0] : null
}
