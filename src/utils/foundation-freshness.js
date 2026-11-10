/**
 * ⭐ IS A LOCAL FOUNDATION'S `dist/` OLDER THAN WHAT ITS BUILD READS? One rule, for every verb that
 * uses a built foundation: `uniweb build` from a site, `export`, `deploy --host` and `dev` before
 * they use it (`ensureFoundationFresh`), and `register` before it uploads it
 * (`foundationNeedsBuild`). A build reads:
 *   - the foundation's source root, the folder `package.json::main` names (`resolveFoundationSrcPath`:
 *     the package itself when flat, `src/` when nested), and the files at its root that shape the
 *     build (`package.json`, `vite.config.js`, a legacy `foundation.js` or `meta.js`);
 *   - every library it bundles: any local package it depends on (`librariesOf`, `@uniweb/build`),
 *     wherever it is linked from.
 * Dot-folders, `node_modules`, and what a foundation's build writes into one (`dist/`, the
 * generated entry) are never sources. A library that is not a foundation keeps its `dist/`, which
 * may be what the foundation imports.
 *
 * Ties count as fresh: a build writes its output after it reads its input, so equal times mean a
 * build in the same millisecond, and on a fresh clone, where whole trees share a time, a tie
 * counted stale would rebuild every foundation once for nothing.
 *
 * ⛔ Until 2026-11-09 only the foundation's own folder was walked, and the two verbs walked it two
 * ways. Measured: with only a library's file changed, `uniweb build` kept the old `dist/`, so the
 * prerendered page showed the old component while the site's JS had the new one; and `register`
 * answered that nothing needed building. ⛔ Until 2026-10-13 `build` walked `<package>/src/`
 * whatever the layout, and a flat package's edits never made it stale.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { classifyPackage, librariesOf, resolveFoundationSrcPath } from '@uniweb/build'

// The files at a foundation's root that shape its build, when its sources are in `src/`.
const ROOT_FILES = ['package.json', 'vite.config.js', 'foundation.js', 'meta.js']

// What a foundation's build writes into the foundation.
const BUILD_OUTPUT = new Set(['dist', '_entry.generated.js'])

/** The first file under `dir` newer than `builtAt`, or null. */
function newerUnder(dir, builtAt, { skipOutput }) {
  const stack = [dir]
  while (stack.length) {
    const at = stack.pop()
    let entries
    try {
      entries = readdirSync(at, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || (skipOutput && BUILD_OUTPUT.has(e.name))) continue
      const full = join(at, e.name)
      if (e.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!e.isFile()) continue
      try {
        if (statSync(full).mtimeMs > builtAt) return full
      } catch {
        // unreadable: not newer
      }
    }
  }
  return null
}

/**
 * The first file a foundation's build reads that is newer than `builtAt`, and the library it is
 * in; null when every one is as old as the build or older.
 *
 * @param {string} foundationDir
 * @param {number} builtAt - the built entry's mtime, epoch ms
 * @returns {{ file: string, library: string|null }|null}
 */
export function newerInput(foundationDir, builtAt) {
  for (const f of ROOT_FILES) {
    const p = join(foundationDir, f)
    try {
      if (existsSync(p) && statSync(p).mtimeMs > builtAt) return { file: p, library: null }
    } catch {
      // unreadable: not newer
    }
  }
  const own = newerUnder(resolveFoundationSrcPath(foundationDir), builtAt, { skipOutput: true })
  if (own) return { file: own, library: null }
  for (const { name, dir } of librariesOf(foundationDir)) {
    const file = newerUnder(dir, builtAt, { skipOutput: classifyPackage(dir) === 'foundation' })
    if (file) return { file, library: name }
  }
  return null
}
