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
 * `tone` controls the lead-in: 'soft' (default — trailing notice for finished
 * commands) vs 'eager' (leading notice for staleness-sensitive commands like
 * `create`, where the user is about to scaffold files from CLI-bundled
 * templates and a stale CLI means stale starter content).
 */
function printNotification(current, latest, tone = 'soft') {
  const yellow = '\x1b[33m'
  const cyan = '\x1b[36m'
  const dim = '\x1b[2m'
  const reset = '\x1b[0m'
  console.error('')
  if (tone === 'eager') {
    console.error(`${yellow}Heads up:${reset} this CLI is ${dim}${current}${reset}; latest is ${cyan}${latest}${reset}.`)
    console.error(`${dim}Templates ship with the CLI — consider updating first:${reset} npm i -g uniweb`)
    console.error(`${dim}Or run a one-shot fresh:${reset} npx uniweb@latest <command>`)
  } else {
    console.error(`${yellow}Update available:${reset} ${dim}${current}${reset} → ${cyan}${latest}${reset}`)
    console.error(`${dim}Run${reset} npm i -g uniweb ${dim}to update${reset}`)
  }
}

/**
 * Synchronously read the cache and print a notification if a newer
 * version is known. No network fetch — only reads what `startUpdateCheck`
 * has previously cached. Returns true if a notification was printed.
 *
 * Two call sites today, with different tone needs:
 *   - `create` (tone='eager'): loud leading notice — templates ship with
 *     the CLI, the user is about to scaffold files, this matters.
 *   - `--version` / `-v` (tone='soft'): brief trailing notice — the user
 *     was already asking about version, mention staleness while we're
 *     here. Goes to stderr so scripts capturing stdout aren't affected.
 *
 * @param {string} currentVersion
 * @param {'eager'|'soft'} [tone='eager']
 * @returns {boolean} true if a notification was printed
 */
export function maybeNotifyFromCache(currentVersion, tone = 'eager') {
  const state = readState()
  if (!state.latestVersion) return false
  if (compareSemver(state.latestVersion, currentVersion) <= 0) return false
  printNotification(currentVersion, state.latestVersion, tone)
  return true
}

// Old name preserved as alias — `create` calls it without a tone arg
// and gets the eager default. Keeps that call site unchanged.
export const maybeEagerNotification = maybeNotifyFromCache

/**
 * Fetch the latest version (with a tight timeout) and print a notice if
 * a newer version is found. Updates the on-disk cache as a side effect
 * so future cache-only callers benefit too.
 *
 * Use this for TTY invocations of `--version` / `-v` where the user is
 * interactively asking about the version and a brief network wait is
 * acceptable. Don't use it for non-TTY callers — scripts capturing
 * stdout (`version=$(uniweb -v)`) need a fast, offline-safe path.
 *
 * @param {string} currentVersion
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=1500] Network timeout. Slow / offline
 *   calls return silently — never block the verb for long.
 * @param {'eager'|'soft'} [opts.tone='soft'] Notification copy.
 * @returns {Promise<boolean>} true if a notice was printed.
 */
export async function fetchAndNotifyIfNewer(currentVersion, { timeoutMs = 1500, tone = 'soft' } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let latest = null
  try {
    const res = await fetch('https://registry.npmjs.org/uniweb/latest', { signal: controller.signal })
    if (res.ok) {
      const data = await res.json()
      latest = data?.version || null
    }
  } catch {
    // Aborted, network error, parse error — all silent. The verb
    // shouldn't block on update-check failures.
  } finally {
    clearTimeout(timer)
  }
  if (!latest) return false
  // Refresh the cache so other code paths see this fresh result.
  writeState({ lastCheck: Date.now(), latestVersion: latest })
  if (compareSemver(latest, currentVersion) <= 0) return false
  printNotification(currentVersion, latest, tone)
  return true
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
