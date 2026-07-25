/**
 * Local development: is the bundler reading the foundation source you are editing?
 *
 * SCOPE — this is a check about CLI scaffolding, and only about one modality.
 * A site's `package.json`, its `file:` dependency on the foundation, and its
 * `node_modules` are not part of the site as an artifact; they are the project
 * shape the CLI hangs tooling on (see the three-ingredient model,
 * kb/framework/architecture/site-foundation-runtime-model.md, Part 1). Treating
 * that scaffolding as part of the site is where most of the confusion in this
 * area comes from, so: nothing here says anything about what a foundation *is*,
 * how it is distributed, or how it reaches a host.
 *
 * The one modality it covers is bundled dev mode against a workspace-local
 * foundation — `uniweb dev` with `foundation:` naming a sibling package. There,
 * the site imports `#foundation`, which `build/src/site/config.js` aliases to
 * the foundation's PACKAGE NAME, so Vite resolves it through node_modules. A
 * linked site (registry ref or URL) never takes that path, and neither does the
 * desktop app, unipress, or the edge — they load a built `dist/entry.js`, or
 * read a content folder directly. The check stays silent for all of them
 * because there is no node_modules entry to look at.
 *
 * What goes wrong in that one modality: a `file:` dependency can be satisfied
 * by a link to the workspace source or by a materialized copy, and a copy is a
 * snapshot carrying its own nested node_modules — so it keeps resolving
 * whatever `@uniweb/*` versions were current when it was taken.
 *
 * It hides well. `uniweb build` resolves the foundation by PATH and reads the
 * workspace source, so the build is green and the tests pass while the dev
 * server serves code from weeks ago. Cheap enough (a few lstats and JSON reads)
 * to run on every `uniweb dev` rather than waiting for someone to suspect it.
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
      id: 'dev-foundation-source-stale',
      severity: 'error',
      site: site.name,
      message: `In dev, this site builds against a copy of "${foundation.name}", not your workspace source.`,
      detail:
        `  ${rel(linkPath)} is a directory rather than a link, so it is a snapshot of\n` +
        `  ${rel(foundation.path)} taken when it was installed. Edits you make will not\n` +
        `  reach the dev server. \`uniweb build\` resolves the foundation by path and reads\n` +
        `  your source, so builds stay correct — which is why this is easy to miss.`,
      remedy: 'Reinstall so it links to the workspace source (e.g. pnpm install)',
    })
  } else {
    // Linked, but possibly at the wrong source.
    const target = realpathSync(linkPath)
    const expected = realpathSync(foundation.path)
    if (target !== expected) {
      findings.push({
        id: 'dev-foundation-source-elsewhere',
        severity: 'error',
        site: site.name,
        message: `In dev, this site resolves "${foundation.name}" somewhere other than your workspace source.`,
        detail: `  resolves to: ${rel(target)}\n  workspace source: ${rel(expected)}`,
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
        id: 'dev-foundation-dep-skew',
        severity: 'error',
        site: site.name,
        message: `In dev, "${foundation.name}" compiles against ${name} ${reached}, but declares ${spec}.`,
        detail:
          `  declared in ${rel(join(foundation.path, 'package.json'))}: ${spec}\n` +
          `  resolved from ${rel(linkPath)}: ${reached}\n` +
          `  ${name} is bundled into the foundation, so the dev server runs the version it\n` +
          `  reaches here. A build reads the workspace tree and may compile a different one.`,
        remedy: 'Reinstall so the resolved tree matches what is declared',
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
