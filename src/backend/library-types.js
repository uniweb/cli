/**
 * ⭐ THE TYPES A FOUNDATION NAMES THAT A LIBRARY DEFINES ARE REGISTERED WITH IT. A foundation is
 * released only once the data types it names are registered: the registry refuses one that names a
 * Model it doesn't hold. A type a library defines is read by the foundation's build from that
 * library's `schemas/` (`workspaceTypeFiles`), so `register` in the foundation registers it from
 * there first, and `push` and `publish`, which release a site's foundation with `register`, do too
 * *[Diego, 2026-11-10: "yes, push and publish should register a library's types automatically"]*.
 *
 * A library here is what the build read the type from, in the build's order: a type
 * `schemas.config.js` routes is read from where the route says, so it is no library's; otherwise the
 * one schemas package (`isSchemasPackage`, not a foundation) that gives the type's scope and holds
 * it, bundled by the foundation, a package of its workspace, or one inside the foundation's own
 * folder. A type another FOUNDATION defines is registered when that foundation is, and a refused
 * release names it (`unregistered-types.js`).
 *
 * ⚖️ Each library sends the types the foundation names from it, the ones its types reference among
 * them, and nothing else: its other files may be another package's to register, or a copy of one the
 * foundation defines. A changed definition replaces the registered one, which every site naming the
 * type then reads, and the registry judges the change: one records of the type can't take it refuses
 * (`destructive_republish`), and the release stops there. Libraries go in the order their types
 * reference each other, a referenced one first, since the registry refuses a reference to a Model it
 * doesn't hold yet.
 *
 * ⭐ A LIBRARY'S MAPPINGS GO THE SAME WAY. A foundation carries one by naming it in its main.js
 * (`mappings: ['@acme/vehicle-to-meta']`), and names it in its `mappings` refs; the library's call
 * registers it, after the library's types, with the mappings its `keys_from` names and the library
 * types it names. The registry records, on the foundation, the version it held of each, and a site
 * backend installs that version: a library's next one reaches a site with its foundation's next.
 */

import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { collectNestedRefs } from '@uniweb/schemas/format'

const real = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** The package `file` is in: the nearest folder above it with a package.json. */
function packageDirOf(file) {
  for (let at = dirname(resolve(file)); ; at = dirname(at)) {
    if (existsSync(join(at, 'package.json'))) return at
    if (dirname(at) === at) return null
  }
}

/**
 * Libraries in an order where one whose types another's types or mappings name comes before it;
 * else as found.
 */
function referencedFirst(libraries, schemas, mappings = {}) {
  const holder = new Map()
  for (const lib of libraries) for (const ref of lib.refs) holder.set(ref, lib)
  const before = new Map(libraries.map((lib) => [lib, new Set()]))
  const after = (lib, target) => {
    const other = holder.get(target)
    if (other && other !== lib) before.get(lib).add(other)
  }
  for (const lib of libraries) {
    for (const ref of lib.refs) {
      for (const target of collectNestedRefs(schemas[ref] || {})) after(lib, target)
    }
    for (const ref of lib.mappings || []) for (const target of typesNamedBy(mappings[ref])) after(lib, target)
  }
  const out = []
  const placed = new Set()
  const place = (lib, path = new Set()) => {
    if (placed.has(lib) || path.has(lib)) return
    path.add(lib)
    for (const other of before.get(lib)) place(other, path)
    placed.add(lib)
    out.push(lib)
  }
  for (const lib of libraries) place(lib)
  return out
}

/** The types a mapping names, as its `_mappings` entry holds them (in full): its `model` and its `follow` lines'. */
export function typesNamedBy(mapping) {
  if (!mapping || typeof mapping !== 'object') return []
  const out = []
  if (typeof mapping.model === 'string') out.push(mapping.model)
  for (const line of Array.isArray(mapping.follow) ? mapping.follow : []) {
    if (!line || typeof line !== 'object') continue
    for (const spec of Object.values(line)) if (spec && typeof spec.model === 'string') out.push(spec.model)
  }
  return out
}

/**
 * The libraries that define types the foundation names, or mappings it carries, each once, with the
 * types and mappings it takes from each, in the order they register in. A type its own `schemas/` defines (`@/x`), one nothing local
 * defines, one two packages define (which the build refused) and one `schemas.config.js` routes are
 * left out.
 *
 * @param {object} o
 * @param {Record<string, object>} o.schemas - the foundation's built `dataSchemas`: every type it
 *   names, with its definition
 * @param {Record<string, object|null>} [o.mappings] - the foundation's built `_mappings`: its own
 *   (`@/x`) and the library ones its main.js carries (in full)
 * @param {Record<string, object|null>} [o.vendors] - the foundation's built `_vendors`: its own
 *   (`@/x`) and the library vendor files its main.js carries (in full)
 * @param {string} o.foundationDir
 * @returns {Promise<Array<{ dir: string, scope: string, refs: string[], mappings: string[], vendors: string[] }>>}
 *   `mappings`, `vendors`: the library mappings and vendor files it carries from that library, in full
 * @throws {Error} `code: 'BUILD_TOO_OLD'` when the installed `@uniweb/build` can't tell
 */
export async function typesFromLibraries({ schemas, mappings, vendors, foundationDir }) {
  const build = await import('@uniweb/build')
  const { workspaceTypeFiles, workspaceMappingFiles, workspaceVendorFiles, packageTypeScope, classifyPackage, isSchemasPackage, routedSchema, resolveFoundationSrcPath } = build
  if ([workspaceTypeFiles, packageTypeScope, routedSchema].some((fn) => typeof fn !== 'function')) {
    throw Object.assign(new Error('the installed @uniweb/build cannot tell which library defines a type'), { code: 'BUILD_TOO_OLD' })
  }
  const srcDir = resolveFoundationSrcPath(foundationDir)
  const own = real(foundationDir)
  const byDir = new Map()
  for (const ref of Object.keys(schemas || {})) {
    // `@uniweb` is reserved, and nothing registers under it.
    if (!/^@[^/]+\/./.test(ref) || ref.startsWith('@uniweb/')) continue
    if (await routedSchema(ref, srcDir).catch(() => false)) continue
    const files = await workspaceTypeFiles(ref, foundationDir).catch(() => [])
    if (files.length !== 1) continue
    const dir = packageDirOf(files[0])
    if (!dir || real(dir) === own) continue
    if (classifyPackage(dir) === 'foundation' || !isSchemasPackage(dir)) continue
    const scope = await packageTypeScope(dir, 'schemas')
    if (!scope) continue
    if (!byDir.has(dir)) byDir.set(dir, { dir, scope, refs: [], mappings: [], vendors: [] })
    byDir.get(dir).refs.push(ref)
  }
  // ⭐ The library mappings its main.js carries (`mappings: ['@acme/x']`, `_mappings` keys in full),
  // found by the same rule, and registered in their library's call, after its types. One no package
  // here defines is left to the registry, which refuses the foundation unless it holds it.
  if (typeof workspaceMappingFiles === 'function') {
    for (const ref of Object.keys(mappings || {})) {
      if (!/^@[^/]+\/./.test(ref) || ref.startsWith('@uniweb/')) continue
      const files = await workspaceMappingFiles(ref, foundationDir).catch(() => [])
      if (files.length !== 1) continue
      const dir = packageDirOf(files[0])
      if (!dir || real(dir) === own) continue
      if (classifyPackage(dir) === 'foundation' || !isSchemasPackage(dir)) continue
      const scope = await packageTypeScope(dir, 'schemas')
      if (!scope) continue
      if (!byDir.has(dir)) byDir.set(dir, { dir, scope, refs: [], mappings: [], vendors: [] })
      byDir.get(dir).mappings.push(ref)
    }
  }
  // ⭐ And the library vendor files its main.js carries (`vendors: ['@lib/x']`, `_vendors` keys in
  // full), found and registered the same way; their library's call is followed by their upload.
  if (typeof workspaceVendorFiles === 'function') {
    for (const ref of Object.keys(vendors || {})) {
      if (!/^@[^/]+\/./.test(ref) || ref.startsWith('@uniweb/')) continue
      const files = await workspaceVendorFiles(ref, foundationDir).catch(() => [])
      if (files.length !== 1) continue
      const dir = packageDirOf(files[0])
      if (!dir || real(dir) === own) continue
      if (classifyPackage(dir) === 'foundation' || !isSchemasPackage(dir)) continue
      const scope = await packageTypeScope(dir, 'schemas')
      if (!scope) continue
      if (!byDir.has(dir)) byDir.set(dir, { dir, scope, refs: [], mappings: [], vendors: [] })
      byDir.get(dir).vendors.push(ref)
    }
  }
  return referencedFirst([...byDir.values()], schemas || {}, mappings || {})
}
