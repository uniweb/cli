/**
 * uniweb validate - Check your content against the data schemas your
 * foundation declares.
 *
 * For each section that consumes file-based data, this resolves the schema the
 * foundation bound to that input (via `meta.js` `data:`) and checks the data
 * items against it. It answers "does my data match what I promised?" — distinct
 * from `doctor`, which checks your project against framework conventions.
 *
 * It warns by default; `--strict` turns findings into a non-zero exit for CI.
 * The live render path stays tolerant — this gate runs before a site is live,
 * by choice. Dynamic (remote) inputs and entity references can't be resolved
 * without a running backend, so they're reported as deferred, never silently
 * skipped.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import yaml from 'js-yaml'
import { validateDataInputs } from '@uniweb/build'
import { discoverFoundations, discoverSites } from '../utils/discover.js'
import { findWorkspaceRoot } from '../utils/workspace.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m'
}

const log = console.log
const success = (msg) => log(`${colors.green}✓${colors.reset} ${msg}`)
const warn = (msg) => log(`${colors.yellow}⚠${colors.reset} ${msg}`)
const error = (msg) => console.error(`${colors.red}✗${colors.reset} ${msg}`)
const info = (msg) => log(`${colors.blue}→${colors.reset} ${msg}`)

/**
 * Read a flag that takes a value: `--site foo` or `--site=foo`.
 */
function flagValue(args, name) {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = args.indexOf(name)
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--'))
    return args[idx + 1]
  return null
}

function loadSiteYml(dir) {
  for (const f of ['site.yml', 'site.yaml']) {
    const p = join(dir, f)
    if (existsSync(p)) {
      try {
        return yaml.load(readFileSync(p, 'utf8'))
      } catch {
        return null
      }
    }
  }
  return null
}

/**
 * Validate one site against its local foundation.
 *
 * @returns {Promise<Object>} { site, foundation, status, report?, reason? }
 *   status: 'checked' | 'skipped'
 */
async function validateSite(site, foundations, workspaceDir) {
  const sitePath = join(workspaceDir, site.path)
  const siteYml = loadSiteYml(sitePath)
  const foundationName = siteYml?.foundation

  // No local foundation to check against → out of static scope (the schemas
  // live in the foundation; a registry-ref / URL foundation isn't on disk).
  if (!foundationName) {
    return {
      site: site.name,
      status: 'skipped',
      reason: 'no foundation declared in site.yml (runtime-loaded?)'
    }
  }
  const match = foundations.find(
    (f) => f.name === foundationName || basename(f.path) === foundationName
  )
  if (!match) {
    return {
      site: site.name,
      status: 'skipped',
      reason: `foundation "${foundationName}" is not a local workspace foundation — its schemas aren't on disk to check against`
    }
  }

  const foundationPath = join(workspaceDir, match.path)
  const report = await validateDataInputs({
    siteRoot: sitePath,
    foundationPath
  })
  return { site: site.name, foundation: match.name, status: 'checked', report }
}

/**
 * Print one site's findings in human form. Groups by the (file, schema) pair
 * so a collection feeding many sections lists its findings once, with the
 * sections that use it — every link of the chain (route › section › key › file
 * › item › field) is present, de-duped.
 */
function printSiteHuman(result) {
  log('')
  if (result.status === 'skipped') {
    warn(
      `${colors.bright}${result.site}${colors.reset} — skipped: ${result.reason}`
    )
    return
  }

  const { report, foundation } = result
  const { violations, deferred, setupErrors, summary } = report
  const header = `${colors.bright}${result.site}${colors.reset} ${colors.dim}(foundation: ${foundation})${colors.reset}`

  if (violations.length === 0 && setupErrors.length === 0) {
    success(
      `${header} — ${summary.records} record(s) / ${summary.schemas} schema(s) conform`
    )
  } else {
    info(header)
  }

  // Group violations by file+schema pair.
  const groups = new Map()
  for (const v of violations) {
    const key = `${v.file} ${v.schema}`
    if (!groups.has(key))
      groups.set(key, {
        file: v.file,
        schema: v.schema,
        users: v.users,
        findings: []
      })
    groups.get(key).findings.push(v)
  }
  for (const g of groups.values()) {
    log(
      `  ${colors.red}✗${colors.reset} ${g.file} ${colors.dim}· schema ${g.schema}${colors.reset}`
    )
    for (const u of dedupeUsers(g.users)) {
      log(
        `      ${colors.dim}used by${colors.reset} ${u.route} › ${u.section} › data.${u.key}`
      )
    }
    for (const f of g.findings) {
      log(
        `      ${colors.yellow}•${colors.reset} item ${colors.bright}"${f.item}"${colors.reset} › ${f.field} — ${f.message}`
      )
    }
  }

  for (const e of setupErrors) {
    log(`  ${colors.red}✗${colors.reset} ${e.file} — ${e.message}`)
    for (const u of dedupeUsers(e.users)) {
      log(
        `      ${colors.dim}used by${colors.reset} ${u.route} › ${u.section} › data.${u.key}`
      )
    }
  }

  if (deferred.length > 0) {
    log(`  ${colors.dim}↪ deferred (not statically checkable):${colors.reset}`)
    for (const d of deferred) {
      const extra = d.url
        ? ` ${colors.dim}(${d.url})${colors.reset}`
        : d.ref
          ? ` ${colors.dim}(${d.ref})${colors.reset}`
          : ''
      log(
        `      ${colors.dim}•${colors.reset} ${d.route} › ${d.section} › data.${d.key} — ${d.reason}${extra}`
      )
    }
  }

  log(
    `  ${colors.dim}${summary.records} record(s) · ${summary.schemas} schema(s) · ` +
      `${summary.violations} violation(s) · ${summary.deferred} deferred${colors.reset}`
  )
}

function dedupeUsers(users) {
  const seen = new Set()
  const out = []
  for (const u of users || []) {
    const k = `${u.route} ${u.section} ${u.key}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(u)
  }
  return out
}

export async function validate(args = []) {
  const asJson = args.includes('--json')
  const strict = args.includes('--strict')
  const siteFilter = flagValue(args, '--site')
  const positional = args.find(
    (a, i) => !a.startsWith('--') && args[i - 1] !== '--site'
  )

  const target = positional ? resolve(process.cwd(), positional) : process.cwd()
  const workspaceDir = findWorkspaceRoot(target)

  if (!workspaceDir) {
    if (asJson)
      log(
        JSON.stringify(
          { ok: false, error: 'not in a Uniweb workspace' },
          null,
          2
        )
      )
    else
      error(
        'Not in a Uniweb workspace. Run this from a project root or a site directory.'
      )
    return { exitCode: 2 }
  }

  const [sites, foundations] = await Promise.all([
    discoverSites(workspaceDir),
    discoverFoundations(workspaceDir)
  ])

  // Select which sites to check: --site filter, an explicitly targeted site
  // directory, or all sites in the workspace.
  let selected = sites
  if (siteFilter) {
    selected = sites.filter(
      (s) => s.name === siteFilter || basename(s.path) === siteFilter
    )
    if (selected.length === 0) {
      const names = sites.map((s) => s.name).join(', ') || '(none)'
      if (asJson)
        log(
          JSON.stringify(
            {
              ok: false,
              error: `site "${siteFilter}" not found`,
              sites: sites.map((s) => s.name)
            },
            null,
            2
          )
        )
      else error(`Site "${siteFilter}" not found. Available: ${names}`)
      return { exitCode: 2 }
    }
  } else if (target !== workspaceDir) {
    const match = sites.find((s) => join(workspaceDir, s.path) === target)
    if (match) selected = [match]
  }

  if (selected.length === 0) {
    if (asJson)
      log(
        JSON.stringify({ ok: true, sites: [], note: 'no sites found' }, null, 2)
      )
    else warn('No sites found in this workspace.')
    return { exitCode: 0 }
  }

  // The data pipeline (collectSiteContent / processQueries) prints progress
  // via console.log. Route that to stderr while the engine runs so stdout stays
  // clean — pure JSON for `--json`, just the report otherwise. `log` captured
  // the original stdout writer at module load, so our own output is unaffected.
  const results = []
  const origConsoleLog = console.log
  console.log = (...a) => process.stderr.write(a.join(' ') + '\n')
  try {
    for (const site of selected) {
      try {
        results.push(await validateSite(site, foundations, workspaceDir))
      } catch (err) {
        results.push({ site: site.name, status: 'error', reason: err.message })
      }
    }
  } finally {
    console.log = origConsoleLog
  }

  const totalViolations = results.reduce(
    (n, r) => n + (r.report?.violations.length || 0),
    0
  )
  const totalSetupErrors = results.reduce(
    (n, r) => n + (r.report?.setupErrors.length || 0),
    0
  )
  const hadError = results.some((r) => r.status === 'error')

  if (asJson) {
    const payload = {
      ok: totalViolations === 0 && !hadError,
      strict,
      sites: results.map((r) => ({
        site: r.site,
        foundation: r.foundation || null,
        status: r.status,
        reason: r.reason || null,
        ...(r.report || {})
      })),
      summary: {
        sites: results.length,
        violations: totalViolations,
        setupErrors: totalSetupErrors,
        deferred: results.reduce(
          (n, r) => n + (r.report?.deferred.length || 0),
          0
        )
      }
    }
    log(JSON.stringify(payload, null, 2))
  } else {
    log('')
    log(`${colors.blue}${colors.bright}Uniweb Validate${colors.reset}`)
    log(
      `${colors.dim}Checking content against the data schemas your foundation declares…${colors.reset}`
    )
    for (const r of results) {
      if (r.status === 'error') {
        log('')
        error(
          `${colors.bright}${r.site}${colors.reset} — could not check: ${r.reason}`
        )
      } else {
        printSiteHuman(r)
      }
    }

    log('')
    log('─'.repeat(50))
    if (totalViolations === 0 && !hadError) {
      log('')
      success(`${colors.bright}All data conforms.${colors.reset}`)
      if (!strict && totalSetupErrors === 0) {
        // nothing more to say
      }
      log('')
    } else {
      log('')
      if (totalViolations > 0) {
        const mode = strict
          ? `${colors.red}error${colors.reset}`
          : `${colors.yellow}warning${colors.reset}`
        log(
          `${totalViolations} violation(s) — reported as ${mode}${strict ? '' : ` ${colors.dim}(pass --strict to fail CI)${colors.reset}`}`
        )
      }
      if (hadError)
        log(`${colors.red}Some sites could not be checked.${colors.reset}`)
      log('')
    }
  }

  // Exit semantics: 2 = couldn't run; 1 = violations under --strict; 0 = clean
  // or warn-only (the live path stays tolerant, so findings don't fail by
  // default). Setup/read failures are surfaced but don't fail the build.
  if (hadError) return { exitCode: 2 }
  if (totalViolations > 0 && strict) return { exitCode: 1 }
  return { exitCode: 0 }
}
