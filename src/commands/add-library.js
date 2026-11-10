/**
 * `uniweb add library <name> [--foundation a,b] [--schemas] [--scope @org]`
 *
 * ⭐ A LIBRARY IS ANY LOCAL PACKAGE A FOUNDATION DEPENDS ON (`librariesOf`, `@uniweb/build`): the
 * components, logic and data types several foundations share, each keeping its own section types,
 * layouts and look. This makes one in the workspace and wires the foundations named, which is all a
 * library takes: a `file:` dependency in each foundation, and its stylesheet imported in each
 * foundation's, so that Tailwind reads its classes. A foundation's build bundles it, its freshness
 * counts its files, and `uniweb dev` serves it, because each finds it through that dependency.
 *
 * Placed by the rule every `add` follows (`utils/placement.js`): a bare name is a folder at the
 * workspace root, a path is that folder, and `--path` is the folder it goes in. The package is named
 * for its folder, as a foundation is, and nothing else marks it: so run on a folder that holds a
 * package already, made by hand, cloned or kept as a git submodule, this wires it without making
 * anything.
 *
 * ⭐ A library may be outside the workspace: a folder beside it, another repository say. Foundations
 * depend on it by path, and the build reads it from that folder whatever copy the package manager
 * installs (`@uniweb/build`'s `foundation/library-imports.js`). It is no package of the workspace,
 * so it is not listed in it. ⛔ Until 2026-11-10 an outside folder was refused, since the build
 * could not resolve what such a library imports.
 *
 * `--schemas` gives it a `schemas/` folder, whose files are data types its foundations name in full
 * (`@acme/plan`), under the scope in its `package.json` (`uniweb.scope`): `--scope`, or the one the
 * foundations it is wired into share.
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import prompts from 'prompts'
import { checkRegistrationScope, classifyPackage, readFoundationName, resolveFoundationSrcPath, splitFoundationName } from '@uniweb/build'
import { resolvePlacement, LIBRARY_KIND } from '../utils/placement.js'
import { registerWorkspacePackage } from '../utils/config.js'
import { discoverFoundations } from '../utils/discover.js'
import { validatePackageName } from '../utils/names.js'
import { workspacePackages } from '../utils/workspace-packages.js'
import { writeJsonPreservingStyleAsync } from '../utils/json-file.js'
import { installCmd } from '../utils/pm.js'
import { getCliPrefix, isNonInteractive } from '../utils/interactive.js'
import { getVersionsForTemplates } from '../versions.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
}
const log = (message) => console.log(message)
const info = (message) => log(`${colors.dim}${message}${colors.reset}`)
const fail = (message, ...lines) => {
  console.error(`${colors.red}✗${colors.reset} ${message}`)
  for (const line of lines) log(line)
  process.exit(1)
}

const posix = (path) => path.split(sep).join('/')

/**
 * A new library's `package.json`. Private, since foundations bundle it and npm never needs it; React
 * and kit as peers, since the foundation that bundles it provides them.
 *
 * @param {{ name: string, projectName: string, scope?: string|null, versions?: Record<string,string> }} o
 */
export function libraryManifest({ name, projectName, scope = null, versions = getVersionsForTemplates() }) {
  return {
    name,
    version: '0.1.0',
    private: true,
    description: `Components, logic and data types the foundations of ${projectName} share`,
    type: 'module',
    main: './index.js',
    exports: {
      '.': './index.js',
      './styles.css': './styles.css',
      './components/*': './components/*',
      './sections/*': './sections/*'
    },
    peerDependencies: {
      '@uniweb/kit': versions['@uniweb/kit'],
      react: versions.react
    },
    ...(scope && { uniweb: { scope } })
  }
}

// The two example lines are aligned on the longer, which the library's name decides.
const INDEX = (name) => {
  const here = `export { default as PlanCard } from './components/PlanCard.jsx'`
  const there = `import { PlanCard } from '${name}'`
  const width = Math.max(here.length, there.length) + 3
  return `// What this library shares with the foundations that depend on it. Export each component, hook
// or helper here, and a foundation imports it by the library's name:
//
//   ${here.padEnd(width)}(here)
//   ${there.padEnd(width)}(in a foundation)
//
// A component here takes ordinary props, and reads its look from the foundation's vars and the
// theme's tokens (var(--card-radius), bg-card), so each foundation that uses it keeps its own.
export {}
`
}

// The form kit's own stylesheet uses, which holds wherever a package manager puts the package.
const STYLES = `/* Tailwind reads this library's files wherever it is installed: each foundation that uses it imports this stylesheet. */
@source "./**/*.{js,jsx}";
`

const SCHEMAS_README = (scope) => `# Data types

Each file here is a data type the foundations share, by its full name: \`plan.yml\` is
\`${scope}/plan\`. A foundation names it in a section's \`meta.js\` (\`data: { plans: '${scope}/plan' }\`),
and a site keeps its records in \`records/${scope.slice(1)}/plan/\`. In this workspace nothing else is
configured: a package with a \`schemas/\` folder serves its scope.
`

const USES_TAILWIND = /@import\s+["']tailwindcss/

/**
 * The line that has a foundation's Tailwind read a library: an import of the library's own stylesheet
 * when it has one a foundation can import, else a `@source` to its folder.
 *
 * @param {{ libraryDir: string, libraryName: string, stylesDir: string }} o
 * @returns {string}
 */
export function libraryLine({ libraryDir, libraryName, stylesDir }) {
  let pkg = null
  try {
    pkg = JSON.parse(readFileSync(join(libraryDir, 'package.json'), 'utf8'))
  } catch {
    // no manifest to refuse the import
  }
  const exp = pkg?.exports
  // ⛔ An `exports` map without the stylesheet refuses the import, in Tailwind and in Node alike.
  const importable = !exp || typeof exp !== 'object' || Object.keys(exp).some((k) => k === './styles.css' || k === './*')
  if (existsSync(join(libraryDir, 'styles.css')) && importable) return `@import "${libraryName}/styles.css";`
  const rel = posix(relative(stylesDir, libraryDir))
  return `@source "${rel.startsWith('.') ? rel : `./${rel}`}";`
}

/**
 * A foundation's stylesheet with `line` after its last `@import`, or null when the stylesheet reads
 * the library already: by that import, or by a `@source` to its folder.
 *
 * @param {string} css
 * @param {string} line - from `libraryLine`
 * @returns {string|null}
 */
export function withLibraryLine(css, line) {
  const target = /^@(?:import|source) "(.+?)"/.exec(line)[1].replace(/\/+$/, '')
  for (const [, , written] of css.matchAll(/@(import|source)\s+["'](.+?)["']/g)) {
    if (written.replace(/\/+$/, '') === target) return null
  }
  const lines = css.split('\n')
  let last = -1
  lines.forEach((l, i) => {
    if (/^\s*@import\b/.test(l)) last = i
  })
  lines.splice(last + 1, 0, line)
  return lines.join('\n')
}

/** The name each workspace package goes by, with its folder. */
function workspacePackageNames(rootDir) {
  const names = new Map()
  for (const rel of workspacePackages(rootDir)) {
    try {
      const { name } = JSON.parse(readFileSync(join(rootDir, rel, 'package.json'), 'utf8'))
      if (name) names.set(name, rel)
    } catch {
      // no manifest: no name to collide with
    }
  }
  return names
}

/** The foundations `--foundation` names, or the one the workspace has, or the ones a person picks. */
async function foundationsToWire(rootDir, flag, relativePath) {
  const foundations = await discoverFoundations(rootDir)
  if (flag) {
    const wanted = flag.split(',').map((s) => s.trim()).filter(Boolean)
    const missing = wanted.filter((n) => !foundations.some((f) => f.name === n))
    if (missing.length) {
      fail(
        `No foundation named ${missing.map((n) => `'${n}'`).join(', ')} in this workspace.`,
        `Foundations: ${foundations.map((f) => f.name).join(', ') || 'none'}`
      )
    }
    return { wire: wanted.map((n) => foundations.find((f) => f.name === n)) }
  }
  if (foundations.length === 0) return { wire: [], note: 'No foundation in this workspace yet. Wire one with --foundation once you add it.' }
  if (foundations.length === 1) return { wire: foundations }
  if (isNonInteractive(process.argv)) {
    return {
      wire: [],
      note: `Several foundations in this workspace, so none was wired. Name them: ${getCliPrefix()} add library ${relativePath} --foundation ${foundations
        .slice(0, 2)
        .map((f) => f.name)
        .join(',')}`
    }
  }
  const { picked } = await prompts(
    {
      type: 'multiselect',
      name: 'picked',
      message: 'Which foundations use this library?',
      choices: foundations.map((f) => ({ title: f.name, description: f.path, value: f.name })),
      min: 0
    },
    { onCancel: () => process.exit(0) }
  )
  return { wire: (picked || []).map((n) => foundations.find((f) => f.name === n)) }
}

/** The scope the foundations share, from their names, or null. */
async function sharedScope(rootDir, foundations) {
  const scopes = new Set()
  for (const f of foundations) {
    try {
      scopes.add(splitFoundationName((await readFoundationName(join(rootDir, f.path))).name).scope)
    } catch {
      scopes.add(null)
    }
  }
  return scopes.size === 1 ? [...scopes][0] : null
}

/**
 * Wire one foundation to the library: its dependency, and its stylesheet's line for the library's
 * classes. Each step is skipped when it is done already, so wiring twice changes nothing.
 *
 * @returns {Promise<{ changed: boolean, notes: string[] }>} whether a file changed, and what was left
 *   as it was, and why
 */
export async function wireFoundation({ foundationDir, libraryDir, libraryName }) {
  const notes = []
  let changed = false
  const pkgPath = join(foundationDir, 'package.json')
  const src = await readFile(pkgPath, 'utf8')
  const pkg = JSON.parse(src)
  const spec = `file:${posix(relative(foundationDir, libraryDir))}`
  const has = pkg.dependencies?.[libraryName] ?? pkg.devDependencies?.[libraryName]
  if (has && has !== spec) {
    notes.push(`its package.json depends on ${libraryName} as "${has}" already, so that was left as it is`)
  } else if (!has) {
    const deps = { ...(pkg.dependencies || {}), [libraryName]: spec }
    pkg.dependencies = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)))
    await writeJsonPreservingStyleAsync(pkgPath, pkg, src)
    changed = true
  }

  const stylesDir = resolveFoundationSrcPath(foundationDir)
  const stylesPath = join(stylesDir, 'styles.css')
  if (!existsSync(stylesPath)) {
    notes.push(`it has no styles.css, so nothing reads the library's classes: add ${libraryLine({ libraryDir, libraryName, stylesDir })} to its stylesheet`)
    return { changed, notes }
  }
  const css = await readFile(stylesPath, 'utf8')
  if (!USES_TAILWIND.test(css)) {
    notes.push('its styles.css does not import Tailwind, so it reads no classes from the library')
    return { changed, notes }
  }
  const wired = withLibraryLine(css, libraryLine({ libraryDir, libraryName, stylesDir }))
  if (wired !== null) {
    await writeFile(stylesPath, wired)
    changed = true
  }
  return { changed, notes }
}

/**
 * Add a library to the workspace, or wire one that is there.
 */
export async function addLibrary(rootDir, projectName, opts, pm = 'pnpm') {
  const prefix = getCliPrefix()
  if (opts.project) {
    fail(
      `A library is shared by foundations, so it goes in the folder you name, not in one project's:`,
      `  ${prefix} add library libraries/<name> --foundation <a>,<b>`
    )
  }
  let name = opts.name
  if (!name && !opts.path) {
    if (isNonInteractive(process.argv)) fail('Missing library name.', '', `Usage: ${prefix} add library <name> [--foundation <a>,<b>]`)
    const response = await prompts(
      { type: 'text', name: 'name', message: 'Library name:', validate: (v) => validatePackageName(v) },
      { onCancel: () => process.exit(0) }
    )
    name = response.name
  }
  if (name?.startsWith('@')) {
    fail(
      `A library is named for its folder, as a foundation is: name the folder, not a scoped package.`,
      `  ${prefix} add library ${name.split('/').pop()}`,
      `To give its package a scoped name, change "name" in its package.json, and the import that names it.`
    )
  }

  const placement = resolvePlacement(rootDir, name, opts, LIBRARY_KIND)
  // Outside the workspace: made or wired there, and said by its path from the workspace's root.
  const outside = !!placement.outsideRoot
  const libraryDir = outside ? resolve(rootDir, placement.outsideRoot) : join(rootDir, placement.relativePath)
  const relativePath = outside ? relative(rootDir, libraryDir).split(sep).join('/') : placement.relativePath

  let libraryName = outside ? basename(libraryDir) : placement.packageName
  let created = false
  let scope = null
  if (existsSync(libraryDir)) {
    const kind = classifyPackage(libraryDir)
    if (kind) fail(`${relativePath}/ is a ${kind}, not a library.`)
    if (!existsSync(join(libraryDir, 'package.json'))) {
      fail(`${relativePath}/ exists and holds no package.json, so it is no package to wire.`, `Pick another folder, or give it a package.json.`)
    }
    try {
      libraryName = JSON.parse(readFileSync(join(libraryDir, 'package.json'), 'utf8')).name || libraryName
    } catch {
      fail(`${relativePath}/package.json does not parse.`)
    }
  } else {
    const valid = validatePackageName(libraryName)
    if (valid !== true) fail(valid)
    const taken = workspacePackageNames(rootDir).get(libraryName)
    if (taken) {
      fail(
        `A package named ${colors.bright}${libraryName}${colors.reset} is in this workspace already, at ${taken}/.`,
        `A foundation imports a library by its name, so name this one for another folder:`,
        `  ${prefix} add library <name>`
      )
    }
  }

  const { wire, note } = await foundationsToWire(rootDir, opts.foundation, relativePath)

  if (opts.schemas || opts.scope) {
    scope = opts.scope ? `@${String(opts.scope).trim().replace(/^@/, '').replace(/\/.*$/, '')}` : await sharedScope(rootDir, wire)
    if (!scope || scope === '@') {
      fail(
        `A library's data types are named in full, under its scope (${colors.bright}@acme/plan${colors.reset}), and none is known yet.`,
        `Give it one:`,
        `  ${prefix} add library ${relativePath} --schemas --scope @<org>`
      )
    }
    const reserved = checkRegistrationScope(scope)
    if (reserved) fail(reserved)
  }

  if (!existsSync(libraryDir)) {
    await mkdir(join(libraryDir, 'components'), { recursive: true })
    const manifest = libraryManifest({ name: libraryName, projectName, scope })
    await writeFile(join(libraryDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(join(libraryDir, 'index.js'), INDEX(libraryName))
    await writeFile(join(libraryDir, 'styles.css'), STYLES)
    created = true
  } else if (scope) {
    const pkgPath = join(libraryDir, 'package.json')
    const src = await readFile(pkgPath, 'utf8')
    const pkg = JSON.parse(src)
    if (pkg.uniweb?.scope && pkg.uniweb.scope !== scope) {
      fail(`${relativePath}/package.json gives the scope ${pkg.uniweb.scope} already; its types are named under it.`)
    }
    if (!pkg.uniweb?.scope) await writeJsonPreservingStyleAsync(pkgPath, { ...pkg, uniweb: { ...(pkg.uniweb || {}), scope } }, src)
  }
  if (scope && !existsSync(join(libraryDir, 'schemas'))) {
    await mkdir(join(libraryDir, 'schemas'), { recursive: true })
    await writeFile(join(libraryDir, 'schemas', 'README.md'), SCHEMAS_README(scope))
  }

  // Listed by its path, unless a pattern the workspace lists covers it already; one outside the
  // workspace is no package of it.
  if (!outside) await registerWorkspacePackage(rootDir, relativePath)

  const wired = []
  const already = []
  const notes = []
  for (const f of wire) {
    const { changed, notes: left } = await wireFoundation({ foundationDir: join(rootDir, f.path), libraryDir, libraryName })
    ;(changed ? wired : already).push(f.name)
    for (const n of left) notes.push(`${f.name}: ${n}`)
  }

  if (created || wired.length) {
    log(
      `${colors.green}✓${colors.reset} ${created ? 'Created' : 'Wired'} library ${colors.bright}${libraryName}${colors.reset}` +
        `${created ? ` at ${relativePath}/` : ''}${wired.length ? ` → ${wired.join(', ')}` : ''}`
    )
  } else if (!already.length) {
    log(`Library ${colors.bright}${libraryName}${colors.reset} at ${relativePath}/: no foundation to wire.`)
  }
  if (already.length) log(`  ${colors.dim}${already.join(', ')}: wired to ${libraryName} already${colors.reset}`)
  for (const n of notes) log(`  ${colors.yellow}⚠ ${n}${colors.reset}`)
  if (note) log(`  ${colors.yellow}⚠ ${note}${colors.reset}`)
  if (created) {
    info(`  Export its components from ${relativePath}/index.js, and import them in a foundation: import { PlanCard } from '${libraryName}'`)
    if (scope) info(`  Its data types go in ${relativePath}/schemas/, named ${scope}/<file name>.`)
  }
  if (outside) {
    log(
      `  ${colors.dim}${relativePath}/ is outside the workspace: each foundation depends on it by its path, and builds read it from there.` +
        ` \`${prefix} update\` aligns the workspace's packages, not this one's ranges.${colors.reset}`
    )
  }
  log('')
  log(`Next: ${colors.cyan}${installCmd(pm)}${colors.reset}`)
}
