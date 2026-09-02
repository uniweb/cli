/**
 * Content conformance on the paths that SHIP content.
 *
 * `uniweb validate` answers "does my data match the schemas my foundation
 * declares?" — and until this existed, it was the *only* caller. `build`,
 * `publish`, `push` and `deploy` never ran it, so a malformed data block built
 * clean, deployed clean, and synced to a backend with nothing having checked
 * it. The first symptom was a section rendering nothing on a live site, with no
 * error anywhere in the chain.
 *
 * ## It WARNS. It never blocks, and that is a decision, not a TODO.
 *
 * A schema can be newer than the content that was valid when it was authored —
 * a foundation upgrade, a `@std/*` revision — so a finding does not mean the
 * content is wrong, it means the two disagree. A framework that refused to
 * publish over that would make an author's site hostage to a schema release,
 * for a defect whose real-world cost is one section rendering wrong. `--strict`
 * on `uniweb validate` is where the gate lives, and CI is where it belongs.
 *
 * So: silent when everything conforms, silent when it cannot check, one compact
 * block when it finds something, and **the ship proceeds either way**.
 *
 * ## Why it is quiet about being unable to check
 *
 * A site whose foundation is a registry ref or a URL has no schemas on disk, so
 * there is nothing to check against — the common case for exactly the sites
 * `publish` is used on. `uniweb validate` reports that as "skipped" because the
 * user asked it a direct question and deserves an answer. Here the user asked
 * to ship, and a line saying what was not done on every deploy is noise that
 * teaches people to skim past this block — including the times it fires.
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import yaml from 'js-yaml'
import { validateDataInputs } from '@uniweb/build'
import { discoverFoundations } from './discover.js'
import { findWorkspaceRoot } from './workspace.js'

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  yellow: '\x1b[33m'
}

/** How many findings to print before summarizing the rest. */
const MAX_SHOWN = 3

function readSiteYml(dir) {
  for (const f of ['site.yml', 'site.yaml']) {
    const p = join(dir, f)
    if (existsSync(p)) {
      try {
        return yaml.load(readFileSync(p, 'utf8'))
      } catch {
        return null
      }
    }
  }
  return null
}

/**
 * Check one site's file-based data against its local foundation's schemas.
 *
 * Resolves the foundation the same way `uniweb validate` does, so the two
 * commands agree about what is checkable — they must, or a deploy would warn
 * about something `validate` then reports as clean.
 *
 * @param {string} siteDir — the site's directory
 * @returns {Promise<{status: 'checked'|'skipped', reason?: string, report?: object, foundation?: string}>}
 */
export async function checkSiteConformance(siteDir) {
  const workspaceDir = findWorkspaceRoot(siteDir)
  if (!workspaceDir) return { status: 'skipped', reason: 'not in a workspace' }

  const siteYml = readSiteYml(siteDir)
  const declared = siteYml?.foundation
  if (!declared) {
    return { status: 'skipped', reason: 'no foundation declared in site.yml' }
  }

  // Resolution is the name/basename match `uniweb validate` uses, and nothing
  // more. A registry ref (`@ns/name@ver`), a URL or the object form matches no
  // local foundation and falls through to "skipped" on its own — pre-filtering
  // those shapes here would be a second, subtly different rule, and the two
  // commands disagreeing about what is checkable is precisely the bug that
  // would make a deploy warn about content `validate` then calls clean.
  const foundations = await discoverFoundations(workspaceDir)
  const match = foundations.find(
    (f) => f.name === declared || basename(f.path) === declared
  )
  if (!match) {
    return { status: 'skipped', reason: `foundation "${declared}" is not on disk` }
  }

  const report = await validateDataInputs({
    siteRoot: siteDir,
    foundationPath: join(workspaceDir, match.path)
  })
  return { status: 'checked', foundation: match.name, report }
}

/**
 * Run the check and print a compact warning if anything does not conform.
 *
 * Swallows its own failures deliberately. This runs inside `publish` / `push` /
 * `deploy`, and an advisory check that can abort a ship is worse than no check:
 * the thing the user asked for is the ship, and a crash in a warning is a
 * regression with no upside. A checker that cannot run says nothing.
 *
 * @param {string} siteDir
 * @param {object} [options]
 * @param {string[]} [options.args] — the command's argv, to honour `--no-validate`
 * @param {(m: string) => void} [options.warn] — the caller's warning printer
 * @param {(m: string) => void} [options.dim] — the caller's dim printer
 * @returns {Promise<number>} how many violations were reported (0 when clean,
 *   skipped, suppressed, or the check itself failed)
 */
export async function warnIfContentDoesNotConform(siteDir, options = {}) {
  const {
    args = [],
    warn = (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
    dim = (m) => console.log(`  ${c.dim}${m}${c.reset}`)
  } = options

  if (args.includes('--no-validate')) return 0

  let result
  try {
    result = await checkSiteConformance(siteDir)
  } catch {
    return 0 // see the docstring: a warning must not be able to stop a ship
  }

  if (result.status !== 'checked') return 0

  const formatted = formatConformanceWarning(result, siteDir)
  if (!formatted) return 0

  warn(formatted.headline)
  for (const line of formatted.details) dim(line)
  return formatted.total
}

/**
 * Turn a report into the lines to print, or `null` when there is nothing to say.
 *
 * Split out from the reporting so the *warning* itself is testable without
 * scaffolding a whole workspace on disk. That is not tidiness: every test of
 * the silent paths would pass equally well against a function that could never
 * warn at all, so without this the suite would assert its own inertness.
 *
 * @param {{report?: object, foundation?: string}} result
 * @param {string} siteDir
 * @returns {{headline: string, details: string[], total: number}|null}
 */
export function formatConformanceWarning(result, siteDir = '') {
  const violations = result?.report?.violations || []
  const setupErrors = result?.report?.setupErrors || []
  const total = violations.length + setupErrors.length
  if (total === 0) return null

  // ⛔ **Two different kinds of finding share this block, and one sentence cannot
  // describe both.** A `violation` is a record whose VALUE disagrees with a
  // schema. A `setupError` is data that could not be read, or that never reached
  // the section meant to read it — *no record is involved*. Counting the second
  // as "content records that do not match" sends the reader hunting through their
  // data for a fault that is in their configuration, which is the worse of the
  // two searches and the one that ends in "the framework is wrong".
  //
  // The total still leads the block; only the naming is split.
  const parts = []
  if (violations.length > 0) {
    parts.push(
      `${violations.length} content record${violations.length === 1 ? '' : 's'} ` +
        `that ${violations.length === 1 ? 'does' : 'do'} not match the schemas ` +
        `${c.bold}${result.foundation}${c.reset} declares`
    )
  }
  if (setupErrors.length > 0) {
    parts.push(
      `${setupErrors.length} problem${setupErrors.length === 1 ? '' : 's'} ` +
        `with how data reaches your sections`
    )
  }
  const headline = `Found ${parts.join(' and ')}.`

  const lines = [
    // A finding on the record itself carries no `field` — "expected a list of
    // records, got object" is about the whole value — so naming one would print
    // an empty path segment.
    ...violations.map((v) => {
      const where = v.field ? `item "${v.item}" › ${v.field}` : `item "${v.item}"`
      return `${rel(siteDir, v.file)} — ${where}: ${v.message}`
    }),
    ...setupErrors.map((e) => `${rel(siteDir, e.file)} — ${e.message}`)
  ]

  const details = lines.slice(0, MAX_SHOWN).map((l) => `• ${l}`)
  if (lines.length > MAX_SHOWN) details.push(`…and ${lines.length - MAX_SHOWN} more`)

  // Name the command that explains it, and say plainly that this is not a
  // refusal — a warning during a ship reads as a failure unless it says so.
  details.push('Shipping anyway. Run `uniweb validate` for the full report.')

  return { headline, details, total }
}

/** Site-relative when it helps, the original when it does not. */
function rel(siteDir, file) {
  if (!file) return '(unknown file)'
  const r = relative(siteDir, file)
  return !r || r.startsWith('..') ? file : r
}
