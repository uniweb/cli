/**
 * Deploy Command — ship a site to its resolved target.
 *
 * `uniweb deploy` resolves WHERE a site goes from deploy.yml (+ `--host` /
 * `--target`) and ships it there:
 *   - THIRD-PARTY host (`s3-cloudfront`, `cloudflare-pages`, `github-pages`,
 *     `generic-static`, …): build `dist/` in bundle mode and hand it to the
 *     host adapter for upload + invalidation.
 *   - UNIWEB hosting target (an explicit `--host=uniweb`, or a `uniweb` target
 *     in deploy.yml): DELEGATE to `uniweb publish` — the smart path (sync +
 *     dynamic hosting, brings the foundation along). So deploy.yml stays one
 *     actionable "where this site deploys" record, uniweb included.
 *
 * `uniweb publish` is the canonical direct verb for Uniweb hosting (reach for it
 * by default); `uniweb export` writes a self-contained artifact you upload
 * yourself.
 *
 * Host resolution:
 *   1. --target <name> picks a target from deploy.yml (full config)
 *   2. deploy.yml's `default:` target when no flag is given
 *   3. with no deploy.yml at all, NO host is chosen → deploy prompts for a
 *      third-party adapter (interactive) rather than assuming Uniweb;
 *      non-interactive → an actionable error pointing at `publish` / `--host`
 *   4. --host <name> is a one-off override (does NOT persist to deploy.yml)
 *
 * Usage:
 *   uniweb deploy --host <name>    Build bundle-mode dist/ + hand to the host adapter
 *   uniweb deploy --host=uniweb    Delegate to `uniweb publish` (Uniweb hosting)
 *   uniweb deploy --target <name>  Pick a target from deploy.yml
 *   uniweb deploy --dry-run        Resolve everything; upload nothing
 *   uniweb deploy --no-save        Skip the deploy.yml lastDeploy auto-save
 *
 * Escape hatch: UNIWEB_SKIP_BUILD=1 reuses an existing dist/.
 */

import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'

import { loadDeployYml, resolveTarget, recordLastDeploy } from '@uniweb/build/site'
import { promptForHost } from '../utils/host-prompt.js'
import { readFlagValue } from '../utils/args.js'
import { parseBoolEnv } from '../utils/env.js'

import {
  findWorkspaceRoot,
  findSites,
  classifyPackage,
  promptSelect,
} from '../utils/workspace.js'
import { isNonInteractive, getCliPrefix } from '../utils/interactive.js'

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  warn: (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`),
}

// ─── Main ───────────────────────────────────────────────────

export async function deploy(args = []) {
  const dryRun = args.includes('--dry-run')
  const siteDir = await resolveSiteDir(args)

  // Host dispatch. Resolution order:
  //   1. --target <name> picks a target from deploy.yml
  //   2. deploy.yml's `default:` target when no flag is given
  //   3. with no deploy.yml, the implicit default is host: 'uniweb'
  //   4. --host <name> is a one-off override (does not persist on success)
  const targetFromFlag = readFlagValue(args, '--target')
  let hostFromFlag = readFlagValue(args, '--host')
  const noSave = args.includes('--no-save')

  let deployYml
  try {
    deployYml = await loadDeployYml(siteDir)
  } catch (err) {
    say.err(err.message)
    process.exit(1)
  }
  let resolved
  try {
    resolved = resolveTarget(deployYml, targetFromFlag || null)
  } catch (err) {
    say.err(err.message)
    process.exit(1)
  }
  // --host with no value → interactive picker. Pre-selects the resolved
  // target's host so Enter does the obvious thing.
  if (hostFromFlag === null) {
    try {
      hostFromFlag = await promptForHost({ args, preselect: resolved.host })
    } catch (err) {
      say.err(err.message)
      process.exit(1)
    }
  }
  let host = hostFromFlag || resolved.host

  // A Uniweb-hosting target is `publish`'s flow. When the user EXPLICITLY chose
  // uniweb (a `--host=uniweb`, or a `uniweb` target in deploy.yml), DELEGATE to
  // `uniweb publish` so deploy.yml stays one actionable record. When NO host was
  // chosen (the implicit default with no deploy.yml), don't assume uniweb:
  // prompt for a third-party adapter (interactive) or point at publish / --host
  // (non-interactive). promptForHost lists only third-party adapters.
  if (host === 'uniweb') {
    const explicitUniweb = hostFromFlag === 'uniweb' || (resolved.fromFile && resolved.host === 'uniweb')
    if (explicitUniweb) {
      say.info('Uniweb hosting target → running `uniweb publish`.')
      console.log('')
      // publish ignores deploy's --host/--target; --dry-run/--no-save/--backend
      // /--token pass straight through.
      const { publish } = await import('./publish.js')
      const result = await publish(args)
      process.exit(result?.exitCode ?? 0)
    }
    if (isNonInteractive(args)) {
      say.err('`uniweb deploy` needs a host. For Uniweb hosting use `uniweb publish`; for a third-party host pass `--host=<adapter>`.')
      console.log('')
      say.dim('`uniweb publish`          Uniweb hosting (sync + dynamic hosting; brings the foundation along)')
      say.dim('`uniweb deploy --host=…`  Third-party host (s3-cloudfront, cloudflare-pages, github-pages, generic-static)')
      say.dim('`uniweb export`           Self-contained dist/ artifact you upload anywhere')
      process.exit(1)
    }
    say.info('`uniweb deploy` ships to a third-party host. (For Uniweb hosting, run `uniweb publish`.)')
    try {
      host = await promptForHost({ args })
    } catch (err) {
      say.err(err.message)
      process.exit(1)
    }
  }

  // Auto-save scope: 'off' from --no-save OR an ad-hoc --host override (we don't
  // want a one-off experiment to rewrite the file). A host picked interactively
  // for a bare `deploy` is NOT an override — we DO want to remember it.
  const hostOverridden = !!hostFromFlag && hostFromFlag !== resolved.host
  const autoSave = noSave || hostOverridden ? 'off' : resolved.autoSave

  await deployStaticHost(siteDir, host, resolved, {
    dryRun,
    autoSave,
    hostOverridden,
  })
}

// ─── Static-host deploy (S3+CloudFront, etc.) ─────────────────
//
// Picked when the resolved deploy.yml target (or --host override) names a
// static-host adapter registered in @uniweb/build/hosts. Always runs
// `uniweb build` (bundle mode + prerender) first, then hands dist/ to the
// adapter's deploy hook for upload + invalidation.

async function deployStaticHost(siteDir, hostName, resolved, { dryRun, autoSave, hostOverridden }) {
  let getAdapter
  try {
    ({ getAdapter } = await import('@uniweb/build/hosts'))
  } catch (err) {
    say.err('Failed to load host adapter registry from @uniweb/build/hosts.')
    say.dim(err.message)
    process.exit(1)
  }

  let adapter
  try {
    adapter = getAdapter(hostName)
  } catch (err) {
    say.err(err.message)
    say.dim('Set the host in deploy.yml or pass --host=<name>. See `uniweb deploy --help`.')
    process.exit(1)
  }

  if (typeof adapter.deploy !== 'function') {
    say.err(`Host adapter '${hostName}' does not implement a deploy step.`)
    say.dim(`Build with \`uniweb build --host=${hostName}\` and upload \`dist/\` manually,`)
    say.dim(`or use a host whose adapter ships a deploy hook (e.g., s3-cloudfront).`)
    process.exit(1)
  }

  const deployConfig = resolved.config || {}
  const distDir = join(siteDir, 'dist')

  if (dryRun) {
    say.info(`Dry run — would deploy via host adapter: ${c.bold}${adapter.name}${c.reset}`)
    say.dim(`Site dir       : ${siteDir}`)
    say.dim(`dist/          : ${existsSync(distDir) ? 'exists (would not rebuild)' : 'missing (would build)'}`)
    say.dim(`Target         : ${resolved.targetName}`)
    say.dim(`bucket         : ${deployConfig.bucket || '(unset)'}`)
    say.dim(`distributionId : ${deployConfig.distributionId || '(unset)'}`)
    say.dim(`region         : ${deployConfig.region || '(unset)'}`)
    say.dim(`profile        : ${deployConfig.profile || '(default AWS chain)'}`)
    return
  }

  // Always rebuild — the static-host flow expects fresh dist/ on every
  // deploy. UNIWEB_SKIP_BUILD env var lets CI / dev loops reuse an
  // existing build.
  const skipBuild = parseBoolEnv('UNIWEB_SKIP_BUILD')
  if (skipBuild) {
    if (!existsSync(distDir)) {
      say.err('UNIWEB_SKIP_BUILD is set but dist/ does not exist.')
      process.exit(1)
    }
    say.info('UNIWEB_SKIP_BUILD set — reusing existing dist/.')
  } else {
    say.info(`Building site (host: ${adapter.name})…`)
    console.log('')
    try {
      execSync(
        `node ${JSON.stringify(process.argv[1])} build --bundle --host ${JSON.stringify(adapter.name)}`,
        { cwd: siteDir, stdio: 'inherit' }
      )
    } catch {
      say.err('Build failed. See output above.')
      process.exit(1)
    }
    if (!existsSync(distDir)) {
      say.err('Build did not produce dist/.')
      process.exit(1)
    }
    console.log('')
  }

  // Hand off to the adapter. DeployError is the structured shape from
  // @uniweb/build/hosts/s3-cloudfront — translate to user-facing output.
  try {
    await adapter.deploy({
      distDir,
      deployConfig,
      env: process.env,
      log: (m) => console.log(m),
    })
  } catch (err) {
    if (err && err.name === 'DeployError') {
      say.err(err.message)
      if (err.hint) {
        console.log('')
        console.log(err.hint)
      }
      process.exit(1)
    }
    throw err
  }

  // Record a fresh lastDeploy.<target> entry. Skipped on --no-save and
  // on ad-hoc --host overrides — see autoSave gating in deploy().
  await persistLastDeploy(siteDir, {
    targetName: resolved.targetName,
    targetConfig: resolved.fromFile ? null : { host: hostName, ...deployConfig },
    autoSave,
    lastDeploy: {
      at: new Date().toISOString(),
      host: hostName,
      // Static hosts know their public URL only via the user's CDN config;
      // we don't have it on hand. Future: pull from a known field.
    },
  })
  if (hostOverridden && !dryRun) {
    say.dim('--host override active — did not write to deploy.yml. Edit deploy.yml to make this permanent.')
  }
}

// ─── deploy.yml lastDeploy persistence ──────────────────────────

async function persistLastDeploy(siteDir, opts) {
  if (opts.autoSave === 'off') return
  try {
    const result = await recordLastDeploy(siteDir, opts)
    if (result?.created) {
      say.dim(`Wrote deploy.yml (target: ${opts.targetName})`)
    }
  } catch (err) {
    // The deploy itself succeeded — never fail the whole command on a
    // memo-write error. Surface it so the user can fix the file.
    say.dim(`Could not update deploy.yml: ${err.message}`)
  }
}

// ─── Resolve site dir ──────────────────────────────────────

// Exported so `uniweb export` / `uniweb publish` / `uniweb status` reuse the
// same site-discovery logic. `verb` is the command being run; it appears in
// the error messages so the user gets accurate guidance.
export async function resolveSiteDir(args, verb = 'deploy') {
  const cwd = process.cwd()
  const prefix = getCliPrefix()

  const type = await classifyPackage(cwd)
  if (type === 'site') return cwd

  const workspaceRoot = findWorkspaceRoot(cwd)
  if (workspaceRoot) {
    const sites = await findSites(workspaceRoot)
    if (sites.length === 1) return resolve(workspaceRoot, sites[0])
    if (sites.length > 1) {
      if (isNonInteractive(args)) {
        say.err(`Multiple sites found. Specify which one to ${verb}.`)
        console.log('')
        for (const s of sites) {
          console.log(`  ${c.cyan}cd ${s} && ${prefix} ${verb}${c.reset}`)
        }
        process.exit(1)
      }
      const choice = await promptSelect('Which site?', sites)
      if (!choice) {
        console.log(`\n${verb.charAt(0).toUpperCase() + verb.slice(1)} cancelled.`)
        process.exit(0)
      }
      return resolve(workspaceRoot, choice)
    }
  }

  say.err('No site found in this workspace.')
  if (verb === 'export') {
    say.dim('`export` produces a self-contained dist/ artifact for third-party hosting.')
  } else if (verb === 'deploy') {
    say.dim('`deploy` ships a built site to a third-party host (use `uniweb publish` for Uniweb hosting).')
  } else {
    say.dim(`\`${verb}\` operates on a site.`)
  }
  process.exit(1)
}

// The site's deploy.yml-bound backend origin (for the resolved `uniweb` target),
// or null when there's no deploy.yml, the target isn't Uniweb hosting, or no
// backend was recorded. Site verbs pass this to BackendClient as `siteBackend`
// so a site stays bound to the backend it publishes to — deploy.yml is the
// record of *where* a site is deployed (the 98% case is uniweb.app, but a B2B
// university backend is just a `backend:` on the target). Sits below --backend
// and UNIWEB_REGISTER_URL but above the logged-in session in the resolution
// ladder (see resolveBackendOrigin). Best-effort: any read/parse error → null.
export async function resolveSiteBackend(siteDir) {
  try {
    const deployYml = await loadDeployYml(siteDir)
    const resolved = resolveTarget(deployYml, null)
    return resolved.host === 'uniweb' ? (resolved.config?.backend || null) : null
  } catch {
    return null
  }
}
