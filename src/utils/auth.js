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

  // Need to log in
  const prompts = (await import('prompts')).default

  if (auth && isExpired(auth)) {
    console.log(`\x1b[33mSession expired.\x1b[0m ${command} requires a Uniweb account.\n`)
  } else {
    console.log(`${command} requires a Uniweb account.\n`)
  }

  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: 'What would you like to do?',
    choices: [
      { title: 'Log in (paste token from uniweb.app/cli-login)', value: 'login' },
      { title: 'Cancel', value: 'cancel' },
    ],
  }, {
    onCancel: () => {
      process.exit(0)
    },
  })

  if (action !== 'login') {
    process.exit(0)
  }

  const response = await prompts([
    {
      type: 'text',
      name: 'email',
      message: 'Email:',
      validate: (v) => (v && v.includes('@') ? true : 'Enter a valid email'),
    },
    {
      type: 'password',
      name: 'token',
      message: 'Token:',
      validate: (v) => (v ? true : 'Token is required'),
    },
  ], {
    onCancel: () => {
      process.exit(0)
    },
  })

  if (!response.email || !response.token) {
    process.exit(1)
  }

  await writeAuth({
    token: response.token,
    email: response.email,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  })

  console.log(`\n\x1b[32m✓\x1b[0m Logged in as \x1b[1m${response.email}\x1b[0m\n`)

  return response.token
}
