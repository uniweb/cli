/**
 * Lightweight Update Notification
 *
 * Checks the npm registry for newer versions of the CLI.
 * Runs at most once per day, caches results in ~/.uniweb/update-check.json.
 * Uses Node 20+ built-in fetch — no external dependencies.
 */

import { homedir } from 'node:os'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHECK_INTERVAL = 24 * 60 * 60 * 1000 // 1 day
const STATE_DIR = join(homedir(), '.uniweb')
const STATE_FILE = join(STATE_DIR, 'update-check.json')

/**
 * Compare two semver strings.
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareSemver(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

/**
 * Read cached update check state.
 */
function readState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    }
  } catch { /* ignore corrupt cache */ }
  return {}
}

/**
 * Write update check state to disk.
 */
function writeState(state) {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(state))
  } catch { /* ignore write errors */ }
}

/**
 * Print update notification to stderr (doesn't interfere with piped output).
 */
function printNotification(current, latest) {
  const yellow = '\x1b[33m'
  const cyan = '\x1b[36m'
  const dim = '\x1b[2m'
  const reset = '\x1b[0m'
  console.error('')
  console.error(`${yellow}Update available:${reset} ${dim}${current}${reset} → ${cyan}${latest}${reset}`)
  console.error(`${dim}Run${reset} npm i -g uniweb ${dim}to update${reset}`)
}

/**
 * Start a non-blocking update check.
 *
 * Returns a function that, when called (optionally awaited), prints
 * the notification if a newer version was found.
 *
 * @param {string} currentVersion - The currently running CLI version
 * @returns {Function} Call at the end of command execution to show notification
 */
export function startUpdateCheck(currentVersion) {
  let notification = null
  const state = readState()

  // Use cached result if checked recently
  if (state.lastCheck && (Date.now() - state.lastCheck) < CHECK_INTERVAL) {
    if (state.latestVersion && compareSemver(state.latestVersion, currentVersion) > 0) {
      notification = state.latestVersion
    }
    return () => {
      if (notification) printNotification(currentVersion, notification)
    }
  }

  // Background fetch (non-blocking)
  const fetchPromise = fetch('https://registry.npmjs.org/uniweb/latest')
    .then(r => r.json())
    .then(data => {
      const latest = data.version
      writeState({ lastCheck: Date.now(), latestVersion: latest })
      if (compareSemver(latest, currentVersion) > 0) {
        notification = latest
      }
    })
    .catch(() => { /* network error — ignore silently */ })

  return async () => {
    await fetchPromise
    if (notification) printNotification(currentVersion, notification)
  }
}
