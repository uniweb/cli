/**
 * Export Command
 *
 * Produces a self-contained, vite-built site artifact in `dist/` for
 * hosting on a third-party CDN (Netlify, Vercel, GitHub Pages, S3 +
 * CloudFront, etc.). Does NOT upload anywhere — that's `uniweb deploy`.
 *
 * The `dist/` output bundles the runtime + foundation + content into
 * concatenated packaging, with a vite-built `index.html` + `entry.js` +
 * `assets/`. The user copies it to whatever host they like.
 *
 * Internally this is `uniweb build --bundle` plus user guidance for the
 * upload step. The `--link` / `--bundle` flag pair is internal-only
 * vocabulary now (Phase 2 of the CLI ergonomics overhaul); users see
 * `uniweb deploy` (uniweb-edge) and `uniweb export` (third-party host).
 *
 * Usage:
 *   uniweb export                          Produce dist/ for static hosting
 *   uniweb export --no-prerender           Skip per-page prerendered HTML
 *   uniweb export --host <name>            Pick a host adapter for postBuild
 *                                          (e.g. cloudflare-pages, s3-cloudfront,
 *                                          github-pages, generic-static).
 *                                          Default: cloudflare-pages.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { resolveSiteDir } from './deploy.js'

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`),
}

export async function exportSite(args = []) {
  const siteDir = await resolveSiteDir(args, 'export')

  // Pass through --no-prerender and --host. Everything else is ignored.
  // `uniweb export` stays low-flag: the user picks the destination host
  // themselves outside the CLI, so there's nothing to configure beyond
  // what `uniweb build --bundle` already exposes.
  const noPrerender = args.includes('--no-prerender')
  const buildArgs = ['build', '--bundle']
  if (noPrerender) buildArgs.push('--no-prerender')

  const { readFlagValue } = await import('../utils/args.js')
  const hostFlag = readFlagValue(args, '--host')
  if (hostFlag === null) {
    // --host with no value → prompt here so the build subprocess gets
    // a concrete value (and doesn't re-prompt against its own argv).
    const { promptForHost } = await import('../utils/host-prompt.js')
    try {
      const chosen = await promptForHost({ args })
      buildArgs.push('--host', chosen)
    } catch (err) {
      say.err(err.message)
      process.exit(1)
    }
  } else if (typeof hostFlag === 'string') {
    buildArgs.push('--host', hostFlag)
  }

  say.info('Exporting site (vite build → dist/)…')
  console.log('')

  // Spawn the SAME CLI binary (process.argv[1]) — same reason as deploy.js:
  // npx walks node_modules and could resolve to a different version.
  try {
    execSync(`node ${JSON.stringify(process.argv[1])} ${buildArgs.join(' ')}`, {
      cwd: siteDir,
      stdio: 'inherit',
    })
  } catch {
    say.err('Build failed. See output above.')
    process.exit(1)
  }

  const distDir = join(siteDir, 'dist')
  if (!existsSync(distDir)) {
    say.err('Build did not produce dist/.')
    process.exit(1)
  }

  console.log('')
  say.ok('Export complete.')
  console.log('')
  console.log(`  ${c.dim}Artifact:${c.reset} ${c.cyan}${distDir}${c.reset}`)
  console.log('')
  console.log(`  ${c.dim}Upload the contents of ${c.reset}${c.cyan}dist/${c.reset}${c.dim} to your static host. Examples:${c.reset}`)
  console.log(`    ${c.dim}Netlify:${c.reset} ${c.cyan}netlify deploy --prod --dir=dist${c.reset}`)
  console.log(`    ${c.dim}Vercel:${c.reset}  ${c.cyan}vercel --prod${c.reset}`)
  console.log(`    ${c.dim}S3:${c.reset}      ${c.cyan}aws s3 sync dist/ s3://your-bucket/${c.reset}`)
  console.log('')
  console.log(`  ${c.dim}For Uniweb-hosted sites instead, use ${c.reset}${c.cyan}uniweb deploy${c.reset}${c.dim}.${c.reset}`)
}
