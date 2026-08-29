/**
 * uniweb clone <site-uuid> — materialize a backend site as a local file project.
 *
 * The "git clone" of the site-content remote model (see
 * the site-content remote model): the backend is the remote, a
 * file project is a working clone. `clone` is the create-side sibling of
 * `uniweb pull`/`uniweb push` — it bootstraps a brand-new project from a site that
 * already lives in the backend (typically authored in the visual app).
 *
 * What it does, and a key constraint: clone runs from a GLOBAL install before any
 * project exists, so it must NOT statically import `@uniweb/build` (that would crash
 * `npx uniweb clone`, same reason utils/workspace.js loads the classifier lazily).
 * So clone does the minimum itself and delegates the heavy lifting:
 *
 *   1. read the site-content document via the backend client — pull the `foundation`
 *      ref out of that one document (no `@uniweb/build` needed for a read);
 *   2. scaffold the HARNESS — a full Vite site package whose foundation is
 *      REFERENCED (runtime-loaded), no local foundation sibling (scaffoldSite with
 *      foundationRef and no foundationPath) + AGENTS.md + deps pinned to this CLI's
 *      version matrix; placement reuses create (new workspace / in-place) and add's
 *      resolver (into an existing workspace, any shape);
 *   3. seed the site's one identity — site.yml::$uuid (a plain YAML scalar write).
 *      The folder is pulled by this same uuid, so there is no separate folder uuid to
 *      seed;
 *   4. install, then delegate the projection to the project-local `uniweb pull` (which
 *      resolves the now-installed project-local `@uniweb/build`; clone forwards
 *      `--no-collections` to it when set).
 *
 * Sites are private — authenticate with `uniweb login` first; the session carries
 * identity + the backend origin. There is no `--foundation` flag: the site carries
 * its foundation ref and clone honors it verbatim (switching a site's foundation is a
 * deliberate, high-risk operation, never a clone convenience).
 *
 * Usage:
 *   uniweb login
 *   uniweb clone <site-uuid> [name|.]    New workspace (or `.` in-place / a site in
 *                                        the current workspace when run inside one)
 *   uniweb clone <uuid> --path sites     Place under sites/ (segregated layout)
 *   uniweb clone <uuid> --project docs   Co-located docs/site
 *   uniweb clone <uuid> --no-collections Pull pages only; skip collection records
 *
 * Backend: via BackendClient (the site-content pull lane). Origin from
 *   --registry  >  UNIWEB_REGISTER_URL  >  the local default (internal dev overrides;
 *   not the user-facing path — `uniweb login` determines the origin).
 * Auth:  --token  >  UNIWEB_TOKEN  >  `uniweb login` session.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, basename, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { scaffoldWorkspace, scaffoldSite } from '../utils/scaffold.js'
import { resolvePlacement, SITE_KIND } from '../utils/placement.js'
import { findWorkspaceRoot } from '../utils/workspace.js'
import { addWorkspaceGlob } from '../utils/config.js'
import { detectWorkspacePm, installCmd } from '../utils/pm.js'
import { BackendClient } from '../backend/client.js'
import { isNonInteractive, getCliPrefix } from '../utils/interactive.js'
import { extractFoundationRef } from '../utils/site-content-refs.js'
import { readUwxDocuments } from '../utils/uwx-read.js'
import { recordWritten } from '../utils/pull-written.js'
import { checkFlags } from '../utils/flag-guard.js'
import { recordSiteBackend } from '../utils/site-identity.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  cyan: '\x1b[36m'
}
const log = console.log
const success = (m) => log(`${colors.green}✓${colors.reset} ${m}`)
const error = (m) => console.error(`${colors.red}✗${colors.reset} ${m}`)
const info = (m) => log(`${colors.blue}→${colors.reset} ${m}`)
const note = (m) => log(`  ${colors.dim}${m}${colors.reset}`)

function flagValue(args, name) {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('-'))
    return args[i + 1]
  return null
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Tolerant single-entity document extraction (mirrors pull.js; duplicated rather
// than imported because pull.js statically imports @uniweb/build).
export function extractDocument(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (payload.$model || payload.$id || payload.info) return payload
  return payload.document || payload.entity || null
}

// Unwrap a possibly-localized scalar (a `{ <locale>: value }` map) to a plain string.
function unwrapScalar(v) {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const first = Object.values(v).find((x) => typeof x === 'string')
    if (first) return first
  }
  return null
}

/**
 * Read the seeds clone needs out of a site-content `$`-document:
 *  - foundationRef: the `foundation` ref (a URL or our `@ns/name@ver`) — written
 *    verbatim into site.yml so the runtime loads it as a federated module;
 *  - name: a display name for the new project.
 *
 * No folder uuid is read: the site holds one identity (its site-content uuid), and
 * the folder is pulled by that same uuid — the framework never holds a folder uuid.
 */
export function extractCloneSeeds(document) {
  const info = document?.info || {}
  return {
    foundationRef: extractFoundationRef(info, document),
    name: unwrapScalar(info.name) ?? unwrapScalar(document?.name) ?? null
  }
}

// Insert/replace a top-level `$uuid:` scalar in a YAML file's text without
// disturbing the rest (the scaffolded site.yml is comment-heavy — don't round-trip
// through a YAML dumper). Inserts after the first `name:` line, else prepends.
function seedYamlUuid(filePath, uuid) {
  let text = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
  if (/^\$uuid:/m.test(text)) {
    text = text.replace(/^\$uuid:.*$/m, `$uuid: ${uuid}`)
  } else {
    const nameMatch = text.match(/^name:.*$/m)
    if (nameMatch) {
      const idx = nameMatch.index + nameMatch[0].length
      text = text.slice(0, idx) + `\n$uuid: ${uuid}` + text.slice(idx)
    } else {
      text = `$uuid: ${uuid}\n` + text
    }
  }
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, text)
}

// Build the package-manager argv to run the project-local `uniweb pull`.
function pullExecArgv(pm, extra) {
  // npm needs `exec --` to forward flags to the binary; pnpm/yarn don't.
  if (pm === 'npm') return ['exec', '--', 'uniweb', 'pull', ...extra]
  return ['exec', 'uniweb', 'pull', ...extra]
}

/**
 * @param {string[]} args
 * @param {object} [deps] - injectable seams for testing:
 *   fetch, getToken, skipInstall, skipPull, runInstall(projectDir, pm),
 *   runPull(siteDir, pm, extraArgs).
 */
export async function clone(args = [], deps = {}) {
  // See utils/flag-guard.js — an unrecognized flag is invisible to a
  // literal scan, so it silently keeps the default (production, for --backend).
  const badFlag = checkFlags('clone', args)
  if (badFlag) {
    error(badFlag.message)
    return { exitCode: 2 }
  }
  const positionals = args.filter((a) => !a.startsWith('-'))
  const siteUuid = positionals[0]
  const target = positionals[1] || null // [name|.]

  if (!siteUuid) {
    error('Missing site uuid.')
    log(
      `\nUsage: ${getCliPrefix()} clone <site-uuid> [name|.] [--path <dir>] [--project <name>] [--no-collections]`
    )
    log(
      `${colors.dim}Sites are private — run \`uniweb login\` first.${colors.reset}`
    )
    return { exitCode: 2 }
  }

  const noCollections =
    args.includes('--no-collections') || args.includes('--content-only')
  const pathFlag = flagValue(args, '--path')
  const projectFlag = flagValue(args, '--project')
  const tokenFlag = flagValue(args, '--token')
  const explicitBackend =
    flagValue(args, '--backend') || flagValue(args, '--registry')
  const client = new BackendClient({
    originFlag: explicitBackend,
    token: tokenFlag,
    getToken: deps.getToken,
    fetchImpl: deps.fetch,
    args,
    command: 'Cloning'
  })

  // 1. GET the site-content document.
  //
  // ⛔ The body is a `.uwx` ZIP, not JSON — `application/vnd.uniweb.exchange.
  // entity+zip`, on `content` and `folder` pulls alike. This used to call
  // `res.json()`, which failed on the ZIP magic and reported *"Could not reach
  // the backend: Unexpected token 'P'"* — blaming the network for a body we had
  // received intact and mis-read. Decode with the local reader: this command runs
  // before a project exists, so `@uniweb/build/uwx`'s `readZip` is out of reach
  // (see `utils/uwx-read.js`).
  info(
    `Reading site ${colors.bright}${siteUuid}${colors.reset} from ${colors.dim}${client.origin}${colors.reset} …`
  )
  let documents
  try {
    const res = await client.pullSiteContent(siteUuid)
    if (res.status === 404) {
      error(`Site not found (404) — check the uuid, or you lack access.`)
      return { exitCode: 1 }
    }
    if (!res.ok) {
      error(`Could not read the site: HTTP ${res.status} ${res.statusText}`)
      if (res.status === 401 || res.status === 403)
        note('Run `uniweb login` first (or pass --token <bearer>).')
      return { exitCode: 1 }
    }
    documents = readUwxDocuments(Buffer.from(await res.arrayBuffer()))
  } catch (err) {
    error(`Could not reach the backend at ${client.origin}: ${err.message}`)
    return { exitCode: 1 }
  }

  const document =
    documents.map(extractDocument).find(Boolean) || null
  if (!document) {
    error('The site-content response carried no recognizable document.')
    return { exitCode: 1 }
  }
  const { foundationRef, name: siteDisplayName } = extractCloneSeeds(document)
  if (!foundationRef) {
    note(
      '! The pulled site declares no foundation ref — set `foundation:` in site.yml after clone.'
    )
  }

  // 2. Resolve placement (one verb, context-aware).
  const cwd = deps.cwd || process.cwd()
  const inPlace = target === '.'
  const existingRoot = inPlace ? null : findWorkspaceRoot(cwd)

  let projectDir // the package-manager root (for install)
  let siteDir // where the site package lands
  let sitePkgName
  let workspaceName
  let isNewWorkspace
  let placement = null

  if (inPlace) {
    isNewWorkspace = true
    projectDir = cwd
    workspaceName = slugify(basename(cwd)) || 'site'
    siteDir = join(projectDir, 'site')
    sitePkgName = 'site'
  } else if (existingRoot) {
    isNewWorkspace = false
    projectDir = existingRoot
    placement = resolvePlacement(
      existingRoot,
      target,
      { path: pathFlag, project: projectFlag },
      SITE_KIND
    )
    siteDir = join(existingRoot, placement.relativePath)
    sitePkgName = placement.packageName
    workspaceName = sitePkgName
  } else {
    isNewWorkspace = true
    workspaceName = target || slugify(siteDisplayName) || null
    if (!workspaceName) {
      error(
        'Could not derive a project name from the site. Pass one: `uniweb clone <uuid> <name>`.'
      )
      return { exitCode: 2 }
    }
    if (!/^[a-z0-9-]+$/.test(workspaceName)) {
      error(
        `Invalid project name "${workspaceName}" — use lowercase letters, numbers, and hyphens.`
      )
      return { exitCode: 2 }
    }
    projectDir = resolve(cwd, workspaceName)
    siteDir = join(projectDir, 'site')
    sitePkgName = 'site'
  }

  // Conflict guards.
  if (isNewWorkspace && !inPlace && existsSync(projectDir)) {
    error(`Directory already exists: ${workspaceName}`)
    return { exitCode: 1 }
  }
  if (existsSync(join(siteDir, 'site.yml'))) {
    error(`A site already exists at ${siteDir} — refusing to overwrite.`)
    return { exitCode: 1 }
  }

  // 3. Scaffold the harness (ref-only site: foundationRef, no foundationPath).
  const onProgress = (m) => note(m)
  const siteContext = {
    name: sitePkgName,
    projectName: workspaceName,
    ...(foundationRef ? { foundationRef } : {})
  }

  if (isNewWorkspace) {
    info(`Scaffolding ${colors.bright}${workspaceName}${colors.reset} …`)
    await scaffoldWorkspace(
      projectDir,
      {
        projectName: workspaceName,
        workspaceGlobs: ['site'],
        scripts: { dev: 'uniweb dev', build: 'uniweb build' }
      },
      { onProgress }
    )
    await scaffoldSite(siteDir, siteContext, { onProgress })
  } else {
    info(
      `Adding site ${colors.bright}${sitePkgName}${colors.reset} to the workspace at ${colors.dim}${placement.relativePath}/${colors.reset} …`
    )
    await scaffoldSite(siteDir, siteContext, { onProgress })
    await addWorkspaceGlob(existingRoot, placement.relativePath)
  }

  // 4. Seed the site's one identity — site.yml::$uuid. The folder is pulled by this
  // same uuid (the backend resolves the site's @uniweb/folder from it), so there is no
  // separate folder uuid to seed.
  seedYamlUuid(join(siteDir, 'site.yml'), siteUuid)
  // …and the SYNC SCOPE that makes it meaningful. `clone` is the sharpest case for it:
  // the uuid comes from whoever we read, and until now nothing on disk recorded that —
  // so a teammate who cloned this project and ran `uniweb pull` while logged in
  // elsewhere sent this backend's uuid to a different one. A no-op on the default
  // backend. (The two CREATE paths record it via `recordAndDescribeOwner`; clone seeds
  // an existing site and never reaches them, which is why it is written here too.)
  const scope = await recordSiteBackend(siteDir, client.origin)
  success(
    `Scaffolded the site harness${foundationRef ? ` (foundation: ${foundationRef})` : ''}.`
  )
  if (scope) note(`Bound to ${scope} (recorded $backend in site.yml).`)

  // 5. Install, then delegate the projection to the project-local `uniweb pull`.
  const pm = detectWorkspacePm(projectDir) || 'pnpm'

  if (deps.skipInstall) {
    note('Skipping install (test mode).')
  } else if (deps.runInstall) {
    await deps.runInstall(projectDir, pm)
  } else {
    info(`Installing dependencies (${installCmd(pm)}) …`)
    const r = spawnSync(pm, ['install'], { cwd: projectDir, stdio: 'inherit' })
    if (r.status !== 0) {
      error(
        `Install failed. Once it succeeds, run \`uniweb pull\` from ${siteDir} to fetch the content.`
      )
      return { exitCode: 1 }
    }
  }

  // Tell the delegated pull which files WE wrote, or it refuses on them.
  //
  // Pull guards against overwriting uncommitted work under the paths it rewrites,
  // and `site.yml` / `theme.yml` are exactly those paths — uncommitted here
  // because clone scaffolded them seconds ago. Without this, clone reliably ends
  // in "Refusing to pull: 2 uncommitted change(s)" on a project it just created,
  // where there is no user work to protect. The advice it prints (`--force`) is
  // both unreachable — clone does not forward that flag — and wrong, since it
  // means "discard my changes" and the changes are ours.
  //
  // ⭐ This exempts them for the RIGHT reason rather than overriding the guard.
  // `recordWritten` stores a content hash, so a file the user edits between
  // scaffold and pull no longer matches and the refusal correctly stands. The
  // guard keeps its teeth; it just stops firing on machine output, which is what
  // it already does for pull's own writes.
  //
  // Recorded AFTER the uuid seeding above — the hash has to be of the final
  // bytes on disk, not of what the scaffolder first wrote.
  recordWritten(
    siteDir,
    ['site.yml', 'theme.yml', 'head.html', 'queries.yml']
      .map((f) => join(siteDir, f))
      .filter((p) => existsSync(p))
  )

  const pullExtra = []
  if (explicitBackend) pullExtra.push('--backend', explicitBackend)
  if (tokenFlag) pullExtra.push('--token', tokenFlag)
  if (noCollections) pullExtra.push('--no-collections')

  if (deps.skipPull) {
    note('Skipping pull (test mode).')
  } else if (deps.runPull) {
    await deps.runPull(siteDir, pm, pullExtra)
  } else {
    info('Pulling content …')
    const r = spawnSync(pm, pullExecArgv(pm, pullExtra), {
      cwd: siteDir,
      stdio: 'inherit'
    })
    if (r.status !== 0) {
      error(
        `Content pull failed. Fix the issue, then run \`uniweb pull\` from ${siteDir}.`
      )
      return { exitCode: 1 }
    }
  }

  log('')
  success(
    `Cloned site into ${colors.bright}${isNewWorkspace && !inPlace ? workspaceName : siteDir}${colors.reset}`
  )
  if (isNewWorkspace && !inPlace) {
    log(
      `\nNext: ${colors.cyan}cd ${workspaceName} && uniweb dev${colors.reset}`
    )
  } else {
    log(`\nNext: ${colors.cyan}uniweb dev${colors.reset}`)
  }
  return { exitCode: 0 }
}
