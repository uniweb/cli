/**
 * Credential Storage
 *
 * Manages authentication credentials at ~/.uniweb/auth.json.
 * User-global (not workspace-local) — you publish as yourself, not as a project.
 *
 * Used by `login`, `publish`, and `deploy` commands.
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
 * Read stored credentials.
 * @returns {Promise<{ token: string, email: string, expiresAt?: string } | null>}
 */
export async function readAuth() {
  const authPath = getAuthPath()
  if (!existsSync(authPath)) return null

  try {
    return JSON.parse(await readFile(authPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Write credentials to storage.
 * @param {{ token: string, email: string, expiresAt?: string }} auth
 */
export async function writeAuth(auth) {
  const dir = getAuthDir()
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'auth.json'), JSON.stringify(auth, null, 2))
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
