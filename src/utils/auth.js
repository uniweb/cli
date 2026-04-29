/**
 * Credential Storage
 *
 * Manages authentication credentials at ~/.uniweb/auth.json.
 * User-global (not workspace-local) — you publish as yourself, not as a project.
 *
 * Used by `login`, `publish`, and `deploy` commands.
 *
 * Stored shape (auth.json):
 *   {
 *     token: string,           // bearer JWT, sent in Authorization: Bearer <token>
 *     email: string,           // signup_email; permanent, deliverable
 *     loginName?: string,      // PHP session login_name; immutable per session model
 *     sub?: string,            // memberId from JWT; permanent, numeric
 *     namespaces?: string[],   // org handles the user can publish under
 *     expiresAt?: string       // ISO timestamp; JWT exp claim
 *   }
 *
 * The extra identity fields (loginName, sub, namespaces) are decoded from
 * the JWT at write time and persisted alongside the token. They're cheap
 * to derive (HS256 payload is base64url-encoded JSON), but persisting them
 * means callers don't need to decode the JWT themselves to ask
 * "who is the user?" — they just `readAuth()`.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Get the ~/.uniweb/ directory path.
 * @returns {string}
 */
export function getAuthDir() {
  return join(homedir(), '.uniweb')
}

/**
 * Get the ~/.uniweb/auth.json file path.
 * @returns {string}
 */
export function getAuthPath() {
  return join(getAuthDir(), 'auth.json')
}

/**
 * Decode the payload of a JWT. Returns `null` for malformed tokens.
 * No signature verification — that's the server's job; we just want to
 * read the claims locally.
 *
 * @param {string} token
 * @returns {Object|null}
 */
export function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    // base64url → base64
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

/**
 * Read stored credentials. If the persisted record predates the
 * identity-fields plumbing (no loginName/sub/namespaces) but has a
 * token, derive the missing fields from the JWT in memory so callers
 * see a consistent shape regardless of write generation.
 *
 * @returns {Promise<{ token: string, email: string, loginName?: string, sub?: string, namespaces?: string[], expiresAt?: string } | null>}
 */
export async function readAuth() {
  const authPath = getAuthPath()
  if (!existsSync(authPath)) return null

  let auth
  try {
    auth = JSON.parse(await readFile(authPath, 'utf8'))
  } catch {
    return null
  }

  // Backfill identity fields from the JWT for older auth.json files
  // that were written before this plumbing existed. Read-only — the
  // file isn't rewritten until the next login.
  if (auth?.token && (auth.loginName === undefined || auth.sub === undefined || auth.namespaces === undefined)) {
    const payload = decodeJwtPayload(auth.token)
    if (payload) {
      if (auth.loginName === undefined && typeof payload.loginName === 'string') {
        auth.loginName = payload.loginName
      }
      if (auth.sub === undefined && typeof payload.sub === 'string') {
        auth.sub = payload.sub
      }
      if (auth.namespaces === undefined && Array.isArray(payload.namespaces)) {
        auth.namespaces = payload.namespaces
      }
    }
  }

  return auth
}

/**
 * Write credentials to storage. Decodes the JWT and persists the
 * identity claims (loginName, sub, namespaces) alongside the token,
 * so future `readAuth()` calls don't have to decode it themselves.
 *
 * @param {{ token: string, email: string, expiresAt?: string }} auth - Caller passes the basics; identity fields are derived.
 */
export async function writeAuth(auth) {
  const record = { ...auth }

  if (record.token) {
    const payload = decodeJwtPayload(record.token)
    if (payload) {
      if (typeof payload.loginName === 'string') record.loginName = payload.loginName
      if (typeof payload.sub === 'string') record.sub = payload.sub
      if (Array.isArray(payload.namespaces)) record.namespaces = payload.namespaces
    }
  }

  const dir = getAuthDir()
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'auth.json'), JSON.stringify(record, null, 2))
}

/**
 * Remove stored credentials.
 */
export async function clearAuth() {
  const authPath = getAuthPath()
  if (existsSync(authPath)) {
    await unlink(authPath)
  }
}

/**
 * Check if credentials are expired.
 * @param {{ expiresAt?: string }} auth
 * @returns {boolean}
 */
export function isExpired(auth) {
  if (!auth?.expiresAt) return false
  return new Date(auth.expiresAt) < new Date()
}

/**
 * Ensure the user is authenticated. If not, prompt inline login.
 * Returns the auth token on success, exits the process on cancel.
 *
 * @param {Object} options
 * @param {string} options.command - The command that needs auth (for messaging)
 * @returns {Promise<string>} Bearer token
 */
export async function ensureAuth({ command = 'This command' } = {}) {
  const auth = await readAuth()

  if (auth?.token && !isExpired(auth)) {
    return auth.token
  }

  // Need to log in — delegate to the login command
  if (auth && isExpired(auth)) {
    console.log(`\x1b[33mSession expired.\x1b[0m ${command} requires a Uniweb account.\n`)
  } else {
    console.log(`${command} requires a Uniweb account.\n`)
  }

  const { login } = await import('../commands/login.js')
  await login([])

  // Re-read auth after login
  const newAuth = await readAuth()
  if (!newAuth?.token) {
    process.exit(1)
  }

  return newAuth.token
}
