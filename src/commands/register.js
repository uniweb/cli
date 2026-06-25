/**
 * uniweb register — submit a foundation (and the data schemas it renders), or a
 * standalone schemas package (the data schemas alone, no foundation), to the
 * registry as one names-only `.uwx` document (uwx-format.md §5).
 *
 * `uniweb login && uniweb register`. Distinct from `uniweb publish` (which
 * targets the legacy platform) — `register` talks to the registry over HTTP at a
 * configurable endpoint.
 *
 * If the foundation's `dist/` is missing or version-stale (the baked schema
 * version differs from package.json), `register` builds it first — the same
 * build-if-stale `uniweb publish` does, so `register` is a full drop-in.
 * Preview paths (`--dry-run`, `-o`) never write to `dist/`; they require a
 * pre-built foundation.
 *
 * Run from a foundation, or from a schemas-only package — a package that exports
 * schemas (e.g. `@uniweb/schemas`, any `@org/schemas`) or a bare `schemas/*.yml`
 * folder. The schemas-only package is auto-detected and submits its data schemas
 * standalone (foundation-less); same flags, `--scope` names them.
 *
 * Usage:
 *   uniweb register                      Build the .uwx, submit it, then deliver
 *                                        the foundation's dist/ code (plan +
 *                                        upload — see utils/code-upload.js)
 *   uniweb register --scope @org         Publish under @org (resolves @/x -> @org/x).
 *                                        Default: the package's package.json "uniweb.scope".
 *   uniweb register --schema-only        Skip the code delivery (schemas land, no dist upload)
 *   uniweb register --dry-run            Print the .uwx + the code file plan; submit nothing
 *   uniweb register -o foundation.uwx    Write the .uwx to a file; submit nothing
 *   uniweb register --json               Porcelain: ONE compact JSON line on stdout
 *                                        ({ok,scope,origin,entities:[{name,uuid,version,unchanged}]}),
 *                                        all human output to stderr — for scripted callers
 *   uniweb register --backend <url>      Override the backend origin (alias: --registry)
 *   uniweb register --token <bearer>     Submit with this bearer; skips `uniweb login`
 *
 * Endpoint resolution: --backend <url> (alias --registry)  >  UNIWEB_REGISTER_URL  >
 *   the logged-in session origin  >  ~/.uniweb/config.json  >  the default (uniweb.app).
 * Auth (submit only):  --token <bearer>  >  UNIWEB_TOKEN  >  `uniweb login` session.
 */

// DEFERRED foundation-registration capabilities (the legacy `uniweb publish` had
// these; the new backend doesn't yet — captured here so the design intent isn't
// lost, and the legacy code could be removed). Implement as `register` flags (or
// backend-side policy) when the need is real:
//
//   • ACCESS POLICY — legacy `--edit-access open|restricted`. On the old platform
//     this gated who could act on the foundation in the app. Its meaning is
//     unclear for the new model: there is no editing of a foundation's code or
//     schema, so it is most likely a LICENSING / access-control concern (who may
//     use/reference the foundation), not "editing". Revisit as `--access` (or an
//     org/licensing policy on the backend) when foundation licensing lands.
//
//   • VERSION PROPAGATION — legacy `--propagate`. Opts a newly-registered version
//     into the registry's version-update walk: trusting sites whose policy allows
//     the jump (e.g. auto-patch) adopt it with no rebuild; default was "silent"
//     (stored, nothing moves). The SAME concept applies to `runtime register`
//     (legacy deploy-runtime had `--propagate` too). Implement once the backend
//     has a version-update/propagation policy; until then every register is silent.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { buildRegistryPackage, buildSchemaOnlyPackage } from '@uniweb/build/uwx'
import { classifyPackage, isSchemasPackage, collectStandaloneSchemas } from '@uniweb/build'
import { readRegistryAuth } from '../utils/registry-auth.js'
import { collectDistFiles, computeFoundationDigest } from '../utils/code-upload.js'
import { deriveScope } from '../utils/registry-orgs.js'
import { BackendClient } from '../backend/client.js'
import { writeJsonPreservingStyleAsync } from '../utils/json-file.js'
import { findWorkspaceRoot, findFoundations, promptSelect } from '../utils/workspace.js'
import { isNonInteractive, getCliPrefix } from '../utils/interactive.js'

const colors = {
  reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[36m',
}
// Porcelain (`--json`) mode: stdout carries ONLY the final compact JSON line, so
// all human/colored output diverts to stderr. `emitJson` writes to the REAL
// stdout (bypassing the redirect). `jsonMode`/`jsonEmitted`/`lastError` are reset
// per run by the exported `register` wrapper.
let jsonMode = false
let jsonEmitted = false
let lastError = null
const log = (...a) => (jsonMode ? console.error(...a) : console.log(...a))
const success = (m) => log(`${colors.green}✓${colors.reset} ${m}`)
const error = (m) => { lastError = String(m); console.error(`${colors.red}✗${colors.reset} ${m}`) }
const info = (m) => log(`${colors.blue}→${colors.reset} ${m}`)
const emitJson = (obj) => { jsonEmitted = true; process.stdout.write(JSON.stringify(obj) + '\n') }

function flagValue(args, name) {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('-')) return args[i + 1]
  return null
}

// The uniweb CLI version, for the `.uwx` exporter envelope. Safe fallback if the
// package.json isn't reachable.
function cliVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

// The foundation's recorded publish org, from its package.json `uniweb.scope`
// (`{ "uniweb": { "scope": "@acme" } }`) — the default when `--scope` is absent.
function readPkgScope(foundationDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(foundationDir, 'package.json'), 'utf8'))
    return pkg?.uniweb?.scope || null
  } catch {
    return null
  }
}

// Record the chosen publish scope in the foundation's package.json so it travels
// with the foundation (read back by readPkgScope on the next register). Preserves
// the file's existing JSON style.
async function writePkgScope(foundationDir, scope) {
  const path = join(foundationDir, 'package.json')
  const pkg = JSON.parse(readFileSync(path, 'utf8'))
  pkg.uniweb = { ...(pkg.uniweb || {}), scope }
  await writeJsonPreservingStyleAsync(path, pkg)
}

// The package's name from its package.json, for display. The standalone schemas
// register has no foundation `_self` to name, so it labels by package name.
function readPkgName(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))?.name || null
  } catch {
    return null
  }
}

/**
 * Resolve which foundation to register: the cwd if it's a foundation, else the
 * single foundation in the workspace, else prompt (or error in non-interactive).
 * Mirrors `uniweb publish`.
 */
async function resolveFoundationDir(args) {
  const cwd = process.cwd()
  if (classifyPackage(cwd) === 'foundation') return cwd

  const workspaceRoot = findWorkspaceRoot(cwd)
  if (workspaceRoot) {
    const foundations = await findFoundations(workspaceRoot)
    if (foundations.length === 1) return resolve(workspaceRoot, foundations[0])
    if (foundations.length > 1) {
      if (isNonInteractive(args)) {
        error('Multiple foundations found. Run register from the one you mean.')
        for (const f of foundations) log(`  ${colors.cyan || ''}cd ${f} && ${getCliPrefix()} register${colors.reset}`)
        process.exit(1)
      }
      const choice = await promptSelect('Which foundation?', foundations)
      if (!choice) { log('\nRegister cancelled.'); process.exit(0) }
      return resolve(workspaceRoot, choice)
    }
  }

  error('No foundation found. Run register from a foundation directory or a workspace that has one.')
  process.exit(1)
}

/**
 * Does the foundation's `dist/` need a (re)build before we can register it?
 *
 * Mirrors `uniweb publish`'s build-if-stale so `register` is a full drop-in
 * for the foundation-publish flow. Two staleness signals:
 *   - MISSING: no `dist/entry.js` (or the legacy `dist/foundation.js`), or no
 *     `dist/meta/schema.json` — nothing built yet.
 *   - STALE: the version baked into `dist/meta/schema.json::_self.version`
 *     differs from `package.json::version` — a version bump without a rebuild,
 *     so the artifact encodes the OLD version while the register intends the
 *     NEW one (we'd otherwise submit a schema whose version disagrees with the
 *     code we deliver).
 *
 * Returns `{ needs: false }` or `{ needs: true, reason }`.
 *
 * @param {string} targetDir  the foundation directory
 */
export function foundationNeedsBuild(targetDir) {
  const distDir = join(targetDir, 'dist')
  const schemaPath = join(distDir, 'meta', 'schema.json')
  // @uniweb/build emits dist/entry.js; older builds emitted dist/foundation.js.
  const hasArtifact = existsSync(join(distDir, 'entry.js')) || existsSync(join(distDir, 'foundation.js'))
  if (!hasArtifact || !existsSync(schemaPath)) return { needs: true, reason: 'no dist/ found' }
  let pkgVersion = null
  try {
    pkgVersion = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8'))?.version || null
  } catch {
    // No readable package.json version — fall through; a present schema with no
    // version to compare is treated as fresh (the submit path validates names).
  }
  try {
    const peek = JSON.parse(readFileSync(schemaPath, 'utf8'))
    if (peek?._self?.version && pkgVersion && peek._self.version !== pkgVersion) {
      return { needs: true, reason: `package.json version (${pkgVersion}) differs from built schema (${peek._self.version})` }
    }
  } catch {
    return { needs: true, reason: 'dist/meta/schema.json could not be parsed' }
  }
  return { needs: false }
}

export async function register(args = []) {
  jsonMode = args.includes('--json')
  jsonEmitted = false
  lastError = null
  const result = await runRegister(args)
  // Guarantee a porcelain line on stdout for every --json exit: the success path
  // emits its own; here we cover the error / early-return paths so a scripted
  // caller can always JSON.parse(stdout).
  if (jsonMode && !jsonEmitted) {
    emitJson(result?.exitCode === 0 ? { ok: true, entities: [] } : { ok: false, error: lastError || `register failed (exit ${result?.exitCode ?? 1})` })
  }
  return result
}

async function runRegister(args = []) {
  const dryRun = args.includes('--dry-run')
  const output = flagValue(args, '-o') || flagValue(args, '--output')
  const scopeFlag = flagValue(args, '--scope')
  const tokenFlag = flagValue(args, '--token')
  // Origin: --backend and --registry are aliases (matches deploy/publish + the
  // origin-selection convention); either overrides UNIWEB_REGISTER_URL / default.
  const client = new BackendClient({ originFlag: flagValue(args, '--backend') || flagValue(args, '--registry'), token: tokenFlag, args, command: 'Registering' })

  // Target: a schemas-only package (standalone data-schema register) or a
  // foundation (foundation + the schemas it renders). A schemas package is only
  // detected when the cwd isn't a foundation, so the foundation path — including
  // its workspace-scan + prompt (resolveFoundationDir) — is unchanged.
  const standalone = isSchemasPackage(process.cwd())
  const targetDir = standalone ? process.cwd() : await resolveFoundationDir(args)

  // Scope: --scope flag, else package.json `uniweb.scope`, else (real submit
  // only) derived from login membership in the bootstrap below.
  const pkgScope = readPkgScope(targetDir)
  let scope = scopeFlag || pkgScope
  let scopeSource = scopeFlag ? '--scope' : pkgScope ? 'package.json uniweb.scope' : null
  const isPreview = !!output || dryRun

  // Each path supplies a different schema source: the standalone path discovers
  // the package's own schemas; the foundation path reads its built schema.json.
  let schema = null
  let schemas = null
  if (standalone) {
    try {
      schemas = await collectStandaloneSchemas(targetDir)
    } catch (err) {
      error(`Could not read the schemas package: ${err.message}`)
      return { exitCode: 2 }
    }
    if (!schemas || Object.keys(schemas).length === 0) {
      error('No data schemas found in this package.')
      log(`  ${colors.dim}Expected a package that exports schemas (getSchema / schemas), or a schemas/ directory of *.yml files.${colors.reset}`)
      return { exitCode: 2 }
    }
  } else {
    // Build-if-stale (mirrors `uniweb publish`): a missing or version-stale
    // dist/ gets (re)built before we read its schema. Preview paths
    // (--dry-run / -o) must not write to dist/, so they require a pre-built
    // foundation and say so instead of building.
    const { needs, reason } = foundationNeedsBuild(targetDir)
    if (needs) {
      if (isPreview) {
        error(`No usable build (${reason}).`)
        log(`  Build the foundation first: ${colors.bright}uniweb build${colors.reset}`)
        return { exitCode: 2 }
      }
      info(`${reason} — building the foundation first …`)
      try {
        execSync('npx uniweb build --target foundation', { cwd: targetDir, stdio: 'inherit' })
      } catch (err) {
        error(`Build failed: ${err.message}`)
        return { exitCode: 2 }
      }
    }
    const schemaPath = join(targetDir, 'dist', 'meta', 'schema.json')
    if (!existsSync(schemaPath)) {
      error('No built schema found (dist/meta/schema.json) after build.')
      log(`  Build the foundation: ${colors.bright}uniweb build${colors.reset}`)
      return { exitCode: 2 }
    }
    try {
      schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
    } catch (err) {
      error(`Could not read ${schemaPath}: ${err.message}`)
      return { exitCode: 2 }
    }
  }

  // No scope for a real submit → derive it from login membership (list → 1 use /
  // 0 create / N pick), persist to package.json, and reuse the session token.
  if (!scope && !isPreview) {
    const token = await client.token()
    const sess = await readRegistryAuth()
    const derived = await deriveScope({ apiBase: client.origin, token, accountHandle: sess?.handle || null, args })
    if (!derived) return { exitCode: 0 }
    scope = `@${derived}`
    scopeSource = 'login'
    try {
      await writePkgScope(targetDir, scope)
      info(`Saved ${colors.bright}${scope}${colors.reset} as this ${standalone ? 'package' : 'foundation'}'s publish scope (package.json).`)
    } catch {
      log(`  ${colors.dim}(Could not save the scope to package.json — pass --scope ${scope} next time.)${colors.reset}`)
    }
  }

  // Content digest (foundation path only) — the freshness fingerprint over what
  // register ships (shipping-model.md §4.1). Rides in the foundation-schema
  // entity's info.digest; the backend stores it opaque and returns it so
  // publish/status can detect "code changed since release" with no local state.
  const digest = standalone ? null : computeFoundationDigest(join(targetDir, 'dist'))

  const exporter = { tool: 'uniweb', version: cliVersion(), instance: 'build' }
  let doc
  try {
    doc = standalone
      ? buildSchemaOnlyPackage({ schemas, scope, exporter })
      : buildRegistryPackage({ schema, foundationDir: targetDir, scope, exporter, digest })
  } catch (err) {
    error(`Could not assemble the .uwx: ${err.message}`)
    return { exitCode: 2 }
  }
  const json = JSON.stringify(doc, null, 2)

  const defined = doc.entities.filter((e) => e.model === '@uniweb/data-schema').map((e) => e.name)
  log('')
  if (standalone) {
    info(`${colors.bright}${readPkgName(targetDir) || 'schemas'}${colors.reset} ${colors.dim}(schemas-only — no foundation)${colors.reset}`)
  } else {
    info(`${colors.bright}${schema._self.name}@${schema._self.version}${colors.reset}`)
  }
  log(`  ${colors.dim}data schemas ${standalone ? 'registered' : 'defined'}: ${defined.length ? defined.join(', ') : '(none)'}${colors.reset}`)
  if (scope) log(`  ${colors.dim}scope: ${scope} (${scopeSource})${colors.reset}`)
  if (digest) log(`  ${colors.dim}digest: ${digest}${colors.reset}`)

  // Preview paths — no submit, no auth needed.
  if (output) {
    writeFileSync(resolve(output), json)
    success(`Wrote ${output} (${doc.entities.length} entities) — not submitted`)
    return { exitCode: 0 }
  }
  if (dryRun) {
    log('')
    log(json)
    log('')
    info(`Dry run — would submit to ${client.origin}`)
    if (!standalone && !args.includes('--schema-only')) {
      const distFiles = collectDistFiles(join(targetDir, 'dist'))
      log('')
      info(`Would then deliver ${distFiles.length} code file(s) (meta/ excluded):`)
      for (const f of distFiles) {
        log(`  ${colors.dim}${f.path}  ${f.size} bytes  ${f.content_type}${colors.reset}`)
      }
    }
    return { exitCode: 0 }
  }

  // Submit requires a concrete scope — the registry rejects @/… fail-closed.
  if (!scope) {
    error('No publish scope — set "uniweb.scope" in package.json, or pass --scope @org.')
    log(`  ${colors.dim}Without a scope, names stay @/… and the registry rejects them.${colors.reset}`)
    return { exitCode: 2 }
  }
  // Submit — the client carries the bearer (--token › UNIWEB_TOKEN › stored
  // session › login), resolved lazily on this first authed call.
  info(`Submitting to ${colors.dim}${client.origin}${colors.reset} …`)
  let res
  try {
    res = await client.register(json)
  } catch (err) {
    error(`Could not reach the registry at ${client.origin}: ${err.message}`)
    log(`  ${colors.dim}Set the endpoint with --backend/--registry <url> or UNIWEB_REGISTER_URL.${colors.reset}`)
    return { exitCode: 2 }
  }
  // Read the response body once: the --json success path needs it for the minted
  // entity ids; the error path shows it.
  const rawBody = await res.text().catch(() => '')
  let parsedBody = null
  try { parsedBody = rawBody ? JSON.parse(rawBody) : null } catch { parsedBody = null }
  let alreadyRegistered = false
  if (!res.ok) {
    // Resume path: a registered version is immutable, so re-running after a
    // partial code delivery hits the duplicate rejection here — a STRUCTURED
    // 409 (problem+json, title "Conflict") — and proceeds to phase 2 (the
    // code-uploads plan authorizes against the REGISTERED version; completed
    // files are idempotent no-ops).
    const isDuplicate = !standalone && res.status === 409
    if (isDuplicate) {
      alreadyRegistered = true
      info(`${colors.dim}Schema for this version is already registered — resuming code delivery.${colors.reset}`)
    } else {
      error(`Registry rejected the submission: HTTP ${res.status} ${res.statusText}`)
      if (res.status === 401 || res.status === 403) {
        log(`  ${colors.dim}The registry didn't accept your credentials — it may use different ones than \`uniweb login\`.${colors.reset}`)
        log(`  ${colors.dim}Supply a registry bearer with --token <bearer> (or UNIWEB_TOKEN); an existing one may be wrong or expired.${colors.reset}`)
      }
      if (rawBody) log(`  ${colors.dim}${rawBody.slice(0, 500)}${colors.reset}`)
      return { exitCode: 1 }
    }
  }
  if (!alreadyRegistered) {
    success(
      standalone
        ? `Registered ${defined.length} data schema(s)${scope ? ` under ${scope}` : ''}`
        : `Registered ${schema._self.name}@${schema._self.version}${defined.length ? ` + ${defined.length} data schema(s)` : ''}`
    )
  }

  // Phase 2 — deliver the foundation's code (plan → PUT-per-file, entry
  // last; contract: foundation-code-upload.md). Schemas-
  // only packages have no dist; --schema-only skips deliberately.
  if (!standalone && !args.includes('--schema-only')) {
    const distDir = join(targetDir, 'dist')
    // The registry's vocabulary is the SCOPED name (`@org/name`). A scoped
    // package name passes through; a bare one gets the chosen scope — the
    // same resolution the .uwx submission applied.
    const bareName = schema._self.name
    const name = bareName.startsWith('@') ? bareName : `${scope}/${bareName}`
    const version = schema._self.version
    info(`Delivering code for ${colors.bright}${name}@${version}${colors.reset} …`)
    try {
      const result = await client.uploadFoundationCode({
        name,
        version,
        distDir,
        onProgress: (m) => log(`  ${colors.dim}${m}${colors.reset}`),
      })
      if (result.failed.length) {
        error(`${result.failed.length} file(s) failed to upload:`)
        for (const f of result.failed) {
          log(`  ${colors.red}${f.path}${colors.reset} ${colors.dim}HTTP ${f.status} ${f.detail}${colors.reset}`)
        }
        log(`  ${colors.dim}Re-run \`uniweb register\` to resume — completed files are safe no-ops.${colors.reset}`)
        return { exitCode: 1 }
      }
      const where = result.serveBase || 'the registry gateway'
      if (result.verified === true) {
        success(`Code delivered (${result.uploaded.length} files) — entry verified live at ${colors.dim}${where}${colors.reset}`)
      } else if (result.verified === false) {
        error('Code uploaded but the entry verification fetch did not match — investigate before using this version.')
        return { exitCode: 1 }
      } else {
        success(`Code delivered (${result.uploaded.length} files, ${result.mode} mode)`)
      }
    } catch (err) {
      error(`Code delivery failed: ${err.message}`)
      log(`  ${colors.dim}The schema registration above succeeded; re-run \`uniweb register\` to deliver the code.${colors.reset}`)
      return { exitCode: 1 }
    }
  }
  if (jsonMode) {
    // Join my authoritative submitted names with the backend's minted ids. Each
    // response entry is `{ registered: { name, version, payload_model_uuid, … },
    // unchanged }` (symmetric on the new-version + unchanged branches); a flat
    // shape is tolerated as a fallback. Names from doc.entities are the spine, so
    // the porcelain always reports WHICH names landed even if a field is absent.
    const minted = {}
    const addMint = (e) => {
      if (!e || typeof e !== 'object') return
      const reg = e.registered ?? e
      if (reg.name) minted[reg.name] = { uuid: reg.payload_model_uuid ?? null, version: reg.version ?? null, unchanged: e.unchanged === true }
    }
    if (parsedBody && typeof parsedBody === 'object') {
      if (Array.isArray(parsedBody.data_schemas)) parsedBody.data_schemas.forEach(addMint)
      if (parsedBody.foundation_schema) addMint(parsedBody.foundation_schema)
    }
    const names = [
      ...doc.entities.filter((e) => e.model === '@uniweb/data-schema').map((e) => e.name),
      // The foundation-schema entity carries its `@scope/name` under `info`, not a
      // top-level `name` (that's the foundation-schema shape).
      ...doc.entities.filter((e) => e.model === '@uniweb/foundation-schema').map((e) => e.info?.name ?? e.name),
    ].filter(Boolean)
    const entities = names.map((name) => ({ name, ...(minted[name] || { uuid: null, version: null, unchanged: false }) }))
    emitJson({ ok: true, scope: scope || null, origin: client.origin, digest: digest || null, entities })
  }
  return { exitCode: 0 }
}
