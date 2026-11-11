/**
 * `uniweb add section <Name> --library <library> [--foundation a,b]`
 *
 * ⭐ A SECTION TYPE STAYS EACH FOUNDATION'S TO OFFER, EVEN WHEN ITS CODE IS A LIBRARY'S. Authors pick
 * a type from a foundation's `sections/`, and a library has no type of its own. So this writes the
 * type into the library, `<library>/sections/<Name>/` with the two files `add section` makes, and in
 * each foundation the two lines that pass it on: an `index.jsx` and a `meta.js`, each
 * `export { default } from '<library>/sections/<Name>/<file>'`. A foundation's editor schema then
 * carries the library's `meta.js`, so authors see the same title, params and presets in each, and a
 * change to the library's files reaches every foundation that passes them on.
 *
 * Run for a type the library holds already, it only passes it on. A foundation named that doesn't
 * depend on the library is wired to it first, as `add library` wires one. With no `--foundation`, the
 * type goes to every foundation that depends on the library. When a foundation named has a type of
 * that name of its own, nothing is written.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import prompts from 'prompts'
import { classifyPackage, librariesOf, resolveFoundationSrcPath } from '@uniweb/build'
import { discoverFoundations } from '../utils/discover.js'
import { registerWorkspacePackage } from '../utils/config.js'
import { workspacePackages } from '../utils/workspace-packages.js'
import { writeJsonPreservingStyleAsync } from '../utils/json-file.js'
import { installCmd, pmToInstall } from '../utils/pm.js'
import { getCliPrefix, isNonInteractive } from '../utils/interactive.js'
import { passOnFiles, passOnSpecifier, writeSection } from '../utils/section-files.js'
import { wireFoundation } from './add-library.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
}

const posix = (path) => path.split(sep).join('/')

const real = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

function readPackage(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Whether a package's `exports` lets another package import `subpath` (`./sections/Banner/meta.js`):
 * every file when there is no map, an exact key, or a `*` pattern that matches it. A string, an
 * array or an object of conditions is the package's `.` alone.
 *
 * @param {unknown} exports - `package.json` `exports`
 * @param {string} subpath
 */
export function exportsSubpath(exports, subpath) {
  if (exports === undefined || exports === null) return true
  if (typeof exports !== 'object' || Array.isArray(exports)) return subpath === '.'
  const keys = Object.keys(exports)
  if (!keys.some((k) => k.startsWith('.'))) return subpath === '.'
  if (Object.hasOwn(exports, subpath)) return exports[subpath] !== null
  return keys.some((key) => {
    const star = key.indexOf('*')
    if (star === -1 || exports[key] === null) return false
    const [before, after] = [key.slice(0, star), key.slice(star + 1)]
    return subpath.length >= before.length + after.length && subpath.startsWith(before) && subpath.endsWith(after)
  })
}

/**
 * `exports` with `./sections/*` added: a map gets the key; a string, an array or conditions become
 * the map's `.`.
 */
export function withSectionsExport(exports) {
  const map =
    exports && typeof exports === 'object' && !Array.isArray(exports) && Object.keys(exports).some((k) => k.startsWith('.'))
      ? { ...exports }
      : { '.': exports }
  map['./sections/*'] = './sections/*'
  return map
}

/** The library `ref` names: a folder, from the workspace's root, or a package's name. */
function findLibrary(rootDir, ref, foundations) {
  const folder = real(resolve(rootDir, ref))
  if (folder && existsSync(join(folder, 'package.json'))) {
    return { dir: folder, name: readPackage(folder)?.name || basename(folder) }
  }
  for (const rel of workspacePackages(rootDir)) {
    const dir = resolve(rootDir, rel)
    if (readPackage(dir)?.name === ref) return { dir: real(dir) ?? dir, name: ref }
  }
  for (const f of foundations) {
    const lib = librariesOf(join(rootDir, f.path)).find((l) => l.name === ref)
    if (lib) return { dir: lib.dir, name: lib.name }
  }
  return null
}

/** Whether a foundation depends on the library itself, not through another library. */
function dependsOn(foundationDir, libraryDir) {
  const from = real(foundationDir)
  return librariesOf(foundationDir).some((l) => l.dir === libraryDir && l.from === from)
}

/**
 * Add a section type to a library, and pass it on to foundations.
 *
 * @param {string} rootDir - the workspace's root
 * @param {{ name: string, library: string, foundation?: string|null, starter?: boolean, json?: boolean }} opts
 * @returns {Promise<{ sectionDir: string, starterResult: object|null }>} the library's folder for the
 *   type, and, when it was made with `--starter`, the result its declaration came from
 */
export async function addLibrarySection(rootDir, opts) {
  const prefix = getCliPrefix()
  const { name, library: ref } = opts
  // `--json` hands stdout to the starter's JSON, so everything said goes to stderr.
  const log = (message) => (opts.json ? console.error(message) : console.log(message))
  const fail = (message, ...lines) => {
    console.error(`${colors.red}✗${colors.reset} ${message}`)
    for (const line of lines) if (line) log(line)
    process.exit(1)
  }

  const foundations = await discoverFoundations(rootDir)
  if (!foundations.length) {
    fail(`No foundation in this workspace to offer ${name}: a library's section type is offered by foundations.`, `Make one first: ${prefix} add foundation`)
  }

  const lib = findLibrary(rootDir, ref, foundations)
  if (!lib) {
    fail(
      `No library named ${colors.bright}${ref}${colors.reset} in this workspace, by folder or by name.`,
      `Make one, and wire the foundations that offer it:`,
      `  ${prefix} add library libraries/${basename(ref)} --foundation ${foundations
        .slice(0, 2)
        .map((f) => f.name)
        .join(',')}`
    )
  }
  const libRel = posix(relative(rootDir, lib.dir)) || '.'
  const fromLibrary = relative(lib.dir, rootDir)
  if (fromLibrary === '' || (!fromLibrary.startsWith('..') && !isAbsolute(fromLibrary))) {
    fail(`A library is a package of the workspace, never the workspace's own folder or one that holds it: ${libRel}/`)
  }
  const kind = classifyPackage(lib.dir)
  if (kind) {
    fail(
      `${libRel}/ is a ${kind}, not a library.`,
      kind === 'foundation' ? `To add ${name} to it: ${prefix} add section ${name} --foundation ${lib.name}` : ''
    )
  }

  // The foundations to offer it: those named, else those that depend on the library, else the
  // workspace's one foundation, else the ones a person picks.
  let targets
  if (opts.foundation) {
    const wanted = opts.foundation.split(',').map((s) => s.trim()).filter(Boolean)
    const missing = wanted.filter((n) => !foundations.some((f) => f.name === n))
    if (missing.length) {
      fail(
        `No foundation named ${missing.map((n) => `'${n}'`).join(', ')} in this workspace.`,
        `Foundations: ${foundations.map((f) => f.name).join(', ')}`
      )
    }
    targets = wanted.map((n) => foundations.find((f) => f.name === n))
  } else {
    targets = foundations.filter((f) => dependsOn(join(rootDir, f.path), lib.dir))
    if (!targets.length && foundations.length === 1) targets = foundations
    if (!targets.length) {
      if (isNonInteractive(process.argv)) {
        fail(
          `No foundation depends on ${lib.name} yet, so none offers its section types.`,
          `Name the foundations to offer ${name}, and each is wired to ${lib.name}:`,
          `  ${prefix} add section ${name} --library ${ref} --foundation ${foundations
            .slice(0, 2)
            .map((f) => f.name)
            .join(',')}`
        )
      }
      const { picked } = await prompts(
        {
          type: 'multiselect',
          name: 'picked',
          message: `Which foundations offer ${name}?`,
          choices: foundations.map((f) => ({ title: f.name, description: f.path, value: f.name })),
          min: 1
        },
        { onCancel: () => process.exit(0) }
      )
      targets = (picked || []).map((n) => foundations.find((f) => f.name === n))
    }
  }

  // Each foundation's folder for the type, and whether it passes the library's on already. One that
  // has a type of that name of its own stops the command before anything is written.
  const files = passOnFiles(lib.name, name)
  const plans = targets.map((f) => {
    const foundationDir = join(rootDir, f.path)
    const sectionDir = join(resolveFoundationSrcPath(foundationDir), 'sections', name)
    let state = 'new'
    if (existsSync(sectionDir)) {
      const index = join(sectionDir, 'index.jsx')
      const spec = passOnSpecifier(lib.name, name, 'index.jsx')
      const text = existsSync(index) ? readFileSync(index, 'utf8') : ''
      state = text.includes(`'${spec}'`) || text.includes(`"${spec}"`) ? 'already' : 'own'
    }
    return { f, foundationDir, sectionDir, state }
  })
  const own = plans.filter((p) => p.state === 'own')
  if (own.length) {
    const others = plans.filter((p) => p.state !== 'own').map((p) => p.f.name)
    fail(
      `${own.map((p) => `${p.f.name} has a section type ${name} of its own, at ${posix(relative(rootDir, p.sectionDir))}/`).join('; ')}. Nothing was written.`,
      others.length
        ? `Rename one of them, or offer ${lib.name}'s in the others alone: --foundation ${others.join(',')}`
        : `Rename one of them, or move that one into ${lib.name} (uniweb guide foundation § Libraries).`
    )
  }

  // The type in the library: made, or taken as it is there.
  const sectionDir = join(lib.dir, 'sections', name)
  const where = `${libRel}/sections/${name}/`
  let starterResult = null
  let created = false
  if (existsSync(sectionDir)) {
    if (!existsSync(join(sectionDir, 'index.jsx'))) {
      fail(`${where} holds no index.jsx, so there is nothing to pass on.`, `Give it its component, or pick another name.`)
    }
  } else {
    starterResult = await writeSection({ name, sectionDir, starter: opts.starter })
    created = true
  }
  const hasMeta = existsSync(join(sectionDir, 'meta.js'))

  // A foundation imports the library's files by their path in the package, which its `exports`
  // has to allow (a library `add library` made exports `./sections/*`).
  const pkgPath = join(lib.dir, 'package.json')
  const pkgSource = readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(pkgSource)
  const needed = hasMeta ? ['index.jsx', 'meta.js'] : ['index.jsx']
  let exportsAdded = false
  if (!needed.every((file) => exportsSubpath(pkg.exports, `./sections/${name}/${file}`))) {
    await writeJsonPreservingStyleAsync(pkgPath, { ...pkg, exports: withSectionsExport(pkg.exports) }, pkgSource)
    exportsAdded = true
  }

  // Each foundation: wired to the library (nothing changes when it is already), then its two lines.
  const wired = []
  const notes = []
  for (const p of plans) {
    const { changed, notes: left } = await wireFoundation({ foundationDir: p.foundationDir, libraryDir: lib.dir, libraryName: lib.name })
    if (changed) wired.push(p.f.name)
    for (const n of left) notes.push(`${p.f.name}: ${n}`)
    if (p.state === 'already') continue
    await mkdir(p.sectionDir, { recursive: true })
    for (const file of needed) await writeFile(join(p.sectionDir, file), files[file])
  }
  // Listed in the workspace, as `add library` lists one, so the package manager links it.
  if (wired.length) await registerWorkspacePackage(rootDir, libRel)

  const passed = plans.filter((p) => p.state === 'new').map((p) => p.f.name)
  const already = plans.filter((p) => p.state === 'already').map((p) => p.f.name)
  const { green, dim, bright, cyan, yellow, reset } = colors
  if (created) {
    log(`${green}✓${reset} Created section '${name}' in the library ${bright}${lib.name}${reset}, at ${where}`)
    log(`  ${dim}index.jsx${reset}  — component (customize the JSX)`)
    log(`  ${dim}meta.js${reset}    — metadata (add content expectations, params, presets)`)
  } else {
    log(`${lib.name} holds ${name} already, at ${where}`)
  }
  if (passed.length) {
    log(
      `${green}✓${reset} Offered by ${passed.join(', ')}: ` +
        `${passed.length === 1 ? 'its' : "each one's"} sections/${name}/ passes on ${lib.name}'s ${needed.join(' and ')}`
    )
  }
  if (already.length) log(`  ${dim}${already.join(', ')}: ${already.length === 1 ? 'passes' : 'pass'} on ${lib.name}'s ${name} already${reset}`)
  if (wired.length) log(`  ${dim}Wired to ${lib.name}: ${wired.join(', ')} (a file: dependency, and the import of its stylesheet)${reset}`)
  if (exportsAdded) log(`  ${dim}${libRel}/package.json exports ./sections/* now, so a foundation can import the section's files${reset}`)
  for (const n of notes) log(`  ${yellow}⚠ ${n}${reset}`)
  if (!hasMeta) log(`  ${yellow}⚠ ${where} has no meta.js, so each foundation offers ${name} with none: add one there, then run this again${reset}`)
  log('')
  log(`${dim}Authors pick ${name} from each foundation that offers it. A change to ${where} reaches them all, at each one's next build.${reset}`)
  log(`${dim}To offer it differently in one of them, give that one its own meta.js: its index.jsx stays ${lib.name}'s.${reset}`)
  log('')
  if (wired.length) log(`Next: ${cyan}${installCmd(pmToInstall(rootDir))}${reset}`)
  log(`Before editing it: ${cyan}${prefix} guide foundation${reset}`)
  return { sectionDir, starterResult }
}
