/**
 * Does the installed tree match what the workspace declares?
 *
 * A site reaches its foundation through a `file:` dependency, and a package
 * manager can satisfy that two ways: a symlink to the workspace source, or a
 * materialized copy under its store. Only the first stays correct — a copy is a
 * snapshot, and it carries its own nested `node_modules`, so it keeps resolving
 * whatever `@uniweb/*` versions were current when it was made.
 *
 * That state is nearly invisible. `uniweb build` resolves the workspace source
 * directly and stays correct throughout; only the dev server, which serves out
 * of `node_modules`, sees the stale copy. So the build is green, the tests pass,
 * and the browser renders a blank page or silently runs an old kit. It is
 * produced by an interrupted or partial install — which means the most likely
 * moment to acquire it is immediately after `uniweb update`.
 *
 * Cheap by design: a handful of `lstat` calls and `package.json` reads, so it
 * can run on every `uniweb dev` rather than only when someone thinks to ask.
 *
 * Reports; never prints. Callers present findings in their own voice.
 */

import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import yaml from 'js-yaml'
import { stripVersionRange } from './dep-survey.js'

/**
 * The foundation a site declares, or null. Small enough to live beside the one
 * check that needs it rather than becoming another shared module.
 *
 * @param {string} sitePath
 * @returns {string|null}
 */
export function readDeclaredFoundation(sitePath) {
  for (const name of ['site.yml', 'site.yaml']) {
    const path = join(sitePath, name)
    if (!existsSync(path)) continue
    try {
      return yaml.load(readFileSync(path, 'utf8'))?.foundation ?? null
    } catch {
      return null
    }
  }
  return null
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Where a package name resolves from a starting directory, walking up through
 * node_modules the way Node does. Returns the directory, or null.
 */
function resolvePackageDir(fromDir, packageName) {
  let dir = resolve(fromDir)

  while (true) {
    const candidate = join(dir, 'node_modules', packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate

    const parent = resolve(dir, '..')
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Check one site against the foundation it declares.
 *
 * @param {Object} site - { name, path }
 * @param {Object} foundation - { name, path } — the workspace source
 * @param {string} workspaceDir - For readable paths in findings
 * @returns {Array<Object>} findings, each { id, severity, site, message, detail, remedy }
 */
export function checkSiteInstall(site, foundation, workspaceDir) {
  const findings = []
  const rel = (p) => relative(workspaceDir, p) || '.'

  const linkPath = join(site.path, 'node_modules', foundation.name)

  // Nothing installed at all — not this check's business to complain about,
  // and every other check will already be shouting.
  if (!existsSync(linkPath)) {
    return findings
  }

  // A symlink points at one source of truth; a real directory is a snapshot.
  const stat = lstatSync(linkPath)
  const isLink = stat.isSymbolicLink()

  if (!isLink) {
    findings.push({
      id: 'foundation-not-linked',
      severity: 'error',
      site: site.name,
      message: `The foundation "${foundation.name}" is installed as a copy, not a link.`,
      detail:
        `  ${rel(linkPath)} is a directory, so it is a snapshot of ${rel(foundation.path)}\n` +
        `  taken at install time. Edits to the foundation will not reach the dev server, and\n` +
        `  the copy resolves its own @uniweb/* versions. Builds read the source directly and\n` +
        `  stay correct, which is why this hides.`,
      remedy: 'Reinstall to replace the copy with a link (e.g. pnpm install)',
    })
  } else {
    // Linked, but possibly at the wrong source.
    const target = realpathSync(linkPath)
    const expected = realpathSync(foundation.path)
    if (target !== expected) {
      findings.push({
        id: 'foundation-link-mismatch',
        severity: 'error',
        site: site.name,
        message: `The foundation "${foundation.name}" links somewhere other than the workspace source.`,
        detail: `  links to: ${rel(target)}\n  expected: ${rel(expected)}`,
        remedy: 'Reinstall, and check the site\'s package.json file: reference',
      })
    }
  }

  // What the site actually reaches, versus what the foundation asks for. These
  // agree through a link and drift through a copy — the drift is what runs.
  const foundationPkg = readJson(join(foundation.path, 'package.json'))
  const declared = { ...foundationPkg?.dependencies, ...foundationPkg?.peerDependencies }

  for (const [name, spec] of Object.entries(declared)) {
    if (!name.startsWith('@uniweb/')) continue
    // A range says "anything compatible" — only an exact pin is a promise.
    if (stripVersionRange(spec) !== spec) continue

    const reachedDir = resolvePackageDir(linkPath, name)
    if (!reachedDir) continue

    const reached = readJson(join(reachedDir, 'package.json'))?.version
    if (reached && reached !== spec) {
      findings.push({
        id: 'foundation-dep-skew',
        severity: 'error',
        site: site.name,
        message: `The foundation runs ${name} ${reached}, but declares ${spec}.`,
        detail:
          `  declared in ${rel(join(foundation.path, 'package.json'))}: ${spec}\n` +
          `  reached from ${rel(linkPath)}: ${reached}\n` +
          `  The dev server runs what it reaches. A build reads the workspace and may differ.`,
        remedy: 'Reinstall so the installed tree matches what is declared',
      })
    }
  }

  return findings
}

/**
 * Check every site in the workspace.
 *
 * @param {Array<Object>} sites - [{ name, path, foundation }]
 * @param {Array<Object>} foundations - [{ name, path }]
 * @param {string} workspaceDir
 * @returns {Array<Object>} findings
 */
export function checkWorkspaceInstall(sites, foundations, workspaceDir) {
  const findings = []

  for (const site of sites) {
    const foundation = foundations.find((f) => f.name === site.foundation)
    // An unresolvable foundation name is a different check's finding.
    if (!foundation) continue
    findings.push(...checkSiteInstall(site, foundation, workspaceDir))
  }

  return findings
}

/**
 * One-line summary for callers that only want to know whether to speak up.
 * @param {Array<Object>} findings
 * @returns {string|null}
 */
export function summarizeInstallFindings(findings) {
  if (!findings.length) return null

  const sites = [...new Set(findings.map((f) => f.site))]
  const what = findings.some((f) => f.id === 'foundation-dep-skew')
    ? 'the installed packages do not match what is declared'
    : 'the foundation is not linked to its workspace source'

  return `Install is out of date in ${sites.join(', ')} — ${what}. Run your package manager's install, or \`uniweb doctor\` for detail.`
}
