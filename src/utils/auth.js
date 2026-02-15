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
