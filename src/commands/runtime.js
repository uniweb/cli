/**
 * uniweb runtime register — upload a built `@uniweb/runtime` to the backend so it
 * can serve the runtime version. The runtime is a SYSTEM artifact: registering it
 * requires **@std membership** (a non-@std bearer 403s). Foundations pin a runtime
 * version (`dist/runtime-pin.json`); that version must be registered, or `uniweb
 * register` of such a foundation fails.
 *
 * Contract AGREED with the backend (2026-06-14): `POST /dev/runtime`, @std-gated,
 * manifest-last. Wire + the two-half artifact set (SPA + ssr-edge isolate, the
 * orchestrator stays platform-owned): utils/runtime-upload.js.
 *
 * Usage:
 *   uniweb runtime register                  From framework/runtime (or --path <dir>)
 *   uniweb runtime register --path <dir>     The @uniweb/runtime package dir
 *   uniweb runtime register --version <v>    Override dist/app/manifest.json's version
 *   uniweb runtime register --backend <url>  Override the backend origin
 *   uniweb runtime register --token <bearer> Auth bearer (skips `uniweb login`)
 *   uniweb runtime register --dry-run        Print the version + file plan; upload nothing
 */

import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

import { BackendClient } from '../backend/client.js'
import { collectRuntimeFiles, hasWorkerRuntime, hasShims } from '../utils/runtime-upload.js'
import { readFlagValue } from '../utils/args.js'

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  warn: (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`),
}

// The runtime package dir: --path, else the cwd when it IS @uniweb/runtime.
function resolveRuntimeDir(args) {
  const pathFlag = readFlagValue(args, '--path')
  if (pathFlag) return resolve(pathFlag)
  try {
    if (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).name === '@uniweb/runtime') {
      return process.cwd()
    }
  } catch {
    // no readable package.json — fall through
  }
  return null
}

export async function runtime(args = []) {
  const sub = args[0]
  if (sub !== 'register') {
    say.err(sub ? `Unknown subcommand: runtime ${sub}` : 'Usage: uniweb runtime register')
    say.dim('uniweb runtime register — upload the built @uniweb/runtime to the backend (@std only).')
    return { exitCode: sub ? 1 : 0 }
  }
  const rest = args.slice(1)
  const dryRun = rest.includes('--dry-run')

  const runtimeDir = resolveRuntimeDir(rest)
  if (!runtimeDir) {
    say.err('Not an @uniweb/runtime package.')
    say.dim('Run from framework/runtime, or pass --path <dir>.')
    return { exitCode: 2 }
  }
  const distDir = join(runtimeDir, 'dist')
  const files = collectRuntimeFiles(distDir)
  if (!files.length) {
    say.err('No built runtime found (dist/app/).')
    say.dim('Build it first: `pnpm build` in framework/runtime.')
    return { exitCode: 2 }
  }

  // Version from the SPA build's manifest (the backend keys the version on it);
  // --version overrides, parity with the backend's runtime install --version.
  let version = readFlagValue(rest, '--version')
  if (!version) {
    try {
      version = JSON.parse(readFileSync(join(distDir, 'app', 'manifest.json'), 'utf8')).version
    } catch (err) {
      say.err(`Could not read dist/app/manifest.json: ${err.message}`)
      return { exitCode: 2 }
    }
    if (!version) {
      say.err('dist/app/manifest.json has no "version" field — rebuild the runtime.')
      return { exitCode: 2 }
    }
  }
  // The ssr-edge artifact is a SET: worker-runtime.js + its shims/*.js. Warn when
  // the set is absent or incomplete (a worker without shims can't resolve react).
  if (!hasWorkerRuntime(files)) {
    say.warn("dist/worker-runtime.js is missing — the SSR isolate bundle won't be uploaded.")
    say.dim('Build it first: `pnpm build:worker` in @uniweb/runtime (after `pnpm build`).')
  } else if (!hasShims(files)) {
    say.warn('dist/worker-runtime.js is present but dist/shims/ is missing — the SSR isolate set is incomplete.')
    say.dim('The isolate resolves react/jsx-runtime/@uniweb/core through those shims; re-run `pnpm build:worker`.')
  }

  if (dryRun) {
    say.info(`Would register ${c.bold}@uniweb/runtime@${version}${c.reset} (${files.length} files):`)
    for (const f of files) say.dim(`${f.path}  ${f.size} bytes  ${f.content_type}`)
    return { exitCode: 0 }
  }

  const client = new BackendClient({
    originFlag: readFlagValue(rest, '--backend') || readFlagValue(rest, '--registry'),
    token: readFlagValue(rest, '--token') || undefined,
    args: rest,
    command: 'Registering the runtime',
  })

  say.info(`Registering ${c.bold}@uniweb/runtime@${version}${c.reset} → ${c.dim}${client.origin}${c.reset} (${files.length} files)…`)
  let result
  try {
    result = await client.uploadRuntime({ version, distDir, files, onProgress: (m) => say.dim(m) })
  } catch (err) {
    if (err.status === 403) {
      say.err('Not authorized — registering a runtime version requires @std membership.')
      return { exitCode: 1 }
    }
    say.err(`Runtime registration failed: ${err.message}`)
    say.dim('Set the origin with --backend <url>; auth with `uniweb login` or --token <bearer>.')
    return { exitCode: 1 }
  }
  if (result.failed.length) {
    say.err(`${result.failed.length} file(s) failed to upload:`)
    for (const f of result.failed) say.dim(`${f.path} — HTTP ${f.status} ${f.detail}`)
    say.dim('Re-run `uniweb runtime register` to resume — completed files dedupe.')
    return { exitCode: 1 }
  }
  console.log('')
  say.ok(`Registered ${c.bold}@uniweb/runtime@${version}${c.reset} (${result.uploaded.length} files, ${result.mode} mode)`)
  if (result.serveBase) say.dim(`served at ${result.serveBase}`)
  return { exitCode: 0 }
}

export default runtime
