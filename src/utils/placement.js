import { isAbsolute, relative, sep } from 'node:path'

/**
 * Package placement resolution — shared by `add` and `clone`.
 *
 * Kept dependency-free (no `@uniweb/build`, no fs) on purpose: `clone` imports
 * it and must run from a global install before any project — anything that
 * statically pulls in `@uniweb/build` would crash `npx uniweb@latest clone`
 * (the same reason `utils/workspace.js` loads the classifier lazily).
 */

// `--path` is documented as a folder INSIDE the workspace, and every consumer of
// the result treats it that way: the caller does `join(rootDir, relativePath)`
// while the workspace manifests get `relativePath` verbatim. An ABSOLUTE path
// silently satisfies neither — `join('/ws', '/tmp/x')` is `/ws/tmp/x`, so the
// directory is created in one place while `package.json::workspaces` and
// `pnpm-workspace.yaml` record `/tmp/x`. The two disagree, and the manifests are
// committed files carrying a path that exists on exactly one machine.
//
// Reported by the backend lane 2026-09-18 from a `clone --path <abs>`: the site
// landed under `company-websites/tmp/claude-502/clonetest/` and both manifests
// gained the absolute string.
//
// So: accept an absolute path when it names a folder inside the root (people type
// one, and it is unambiguous), by rewriting it to the root-relative form every
// consumer already expects. Refuse it when it escapes — a workspace package cannot
// live outside its workspace, and guessing which half the user meant is how you get
// the split above.
function normalizeParent(given, rootDir) {
  const trimmed = String(given).replace(/\/+$/, '')
  if (!isAbsolute(trimmed)) return { relative: trimmed }
  const rel = relative(rootDir || '', trimmed)
  if (!rel || rel === '..' || rel.startsWith('../')) return { outsideRoot: true, given: trimmed }
  return { relative: rel.split(sep).join('/') }
}

/** Foundation placement defaults (folder `src/`, package `src`). */
export const FOUNDATION_KIND = {
  defaultDir: 'src',
  defaultPkg: 'src',
  projectSub: 'src'
}

/** Site placement defaults (folder `site/`, package `site`). */
export const SITE_KIND = {
  defaultDir: 'site',
  defaultPkg: 'site',
  projectSub: 'site'
}

/**
 * Resolve where a foundation or site should be placed, given the user's input.
 *
 * The rule: **the user names a folder, and we create exactly that folder.**
 * No silent nesting under `foundations/` / `sites/`, no inferring layout from
 * pre-existing globs. The framework doesn't require any particular folder
 * structure (the build classifies packages by their contents, not their
 * location), so the CLI shouldn't impose one.
 *
 * Resolution priority (foundation example, same shape for site):
 *
 *   1. `--path <dir>`                   → explicit folder. Name is the path's
 *                                          last segment (used as the package
 *                                          name unless `name` was also given).
 *   2. `name` contains `/`              → treat as a path (e.g., `foundations/ui`).
 *                                          Folder = the path, package name =
 *                                          the last segment.
 *   3. `name` (no slash)                → folder = `<name>/`, package name = `<name>`.
 *   4. `--project <project>`            → folder = `<project>/<defaultSub>` and
 *                                          package name = `<project>-<defaultSub>`
 *                                          (the co-located convention; only this
 *                                          one uses the `-src` / `-site` suffix).
 *   5. (no input)                       → folder = `<defaultDir>/`, package name
 *                                          = `<defaultPkg>` (`src/` + `src`
 *                                          for foundations; `site/` + `site` for
 *                                          sites).
 *
 * @param {string} rootDir
 * @param {string|null} name - Either a bare name or a path-with-slash.
 * @param {{ path?: string, project?: string }} opts
 * @param {{ defaultDir: string, defaultPkg: string, projectSub: string }} kind
 * @returns {{ relativePath: string, packageName: string }}
 */
export function resolvePlacement(rootDir, name, opts, kind) {
  // 1. --path is a PARENT directory. The folder is `<path>/<name>` if a
  //    name was given, or `<path>` itself if not (the path's last segment
  //    is then taken as the package name).
  if (opts.path) {
    const parent = normalizeParent(opts.path, rootDir)
    if (parent.outsideRoot) return { outsideRoot: parent.given, relativePath: null, packageName: null }
    const dir = parent.relative
    if (name) {
      const last = name.split('/').filter(Boolean).pop()
      return {
        relativePath: `${dir}/${name}`.replace(/\/+/g, '/'),
        packageName: last
      }
    }
    const lastSegment = dir.split('/').filter(Boolean).pop() || dir
    return {
      relativePath: dir,
      packageName: lastSegment
    }
  }

  // 2. name contains a slash → treat as a path.
  if (name && name.includes('/')) {
    const relativePath = name.replace(/\/+$/, '')
    const lastSegment = relativePath.split('/').filter(Boolean).pop()
    return {
      relativePath,
      packageName: lastSegment
    }
  }

  // 3. Bare name.
  if (name) {
    return {
      relativePath: name,
      packageName: name
    }
  }

  // 4. --project (co-located convention with -src / -site suffix).
  if (opts.project) {
    return {
      relativePath: `${opts.project}/${kind.projectSub}`,
      packageName: `${opts.project}-${kind.projectSub}`
    }
  }

  // 5. Default placement.
  return {
    relativePath: kind.defaultDir,
    packageName: kind.defaultPkg
  }
}
