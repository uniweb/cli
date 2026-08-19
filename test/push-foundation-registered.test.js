/**
 * `push` brings the foundation along and sends the RESOLVABLE ref.
 *
 * [Diego, 2026-08-19] — *"A published site can only reference a registered
 * foundation. If a foundation is not registered, and the referenced version of it
 * is not registered, the publish can't proceed. In fact, not even a push can
 * because we can't preview the site in the frontend in that case."*
 *
 * ⭐ The reason this belongs on PUSH and not only on publish: push is the
 * collaboration verb — a teammate opens the site in the visual app straight after
 * — and the app can only render against foundation code the backend can serve. The
 * backend lane measured their half: resolving a local alias like `src` returns a
 * benign empty result, so the editor gets no component definitions and renders
 * nothing, silently (channel `backend-framework-787e`, 2026-08-19).
 *
 * ⇒ Two acts, and closing only the first leaves the site unpreviewable:
 *   1. REGISTER the local foundation (bring-along releases it)
 *   2. SEND the pinned `@scope/name@version` — not the local alias
 *
 * These pin (2) and the offline-preview fidelity that (2) depends on. The release
 * logic itself is `bringLocalCodeAlong`, already covered by the publish path.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { bringFoundationAlong } from '../src/backend/foundation-bring-along.js'

const quietSay = { ok() {}, info() {}, warn() {}, err() {}, dim() {} }
const noConfirm = async () => {
  throw new Error('must not prompt')
}

/** A workspace: site/ beside a sibling foundation package. */
function workspace({ name = '@acme/base', version = '1.4.2' } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'push-fnd-'))
  const site = join(ws, 'site')
  const fnd = join(ws, 'src')
  mkdirSync(site, { recursive: true })
  mkdirSync(fnd, { recursive: true })
  writeFileSync(join(site, 'site.yml'), 'name: Acme\nfoundation: src\n')
  writeFileSync(join(fnd, 'package.json'), JSON.stringify({ name, version }))
  return { ws, site }
}

test('an offline preview still yields the PINNED ref, so it matches what a real push sends', async () => {
  // `-o` / `--dry-run` exists to be faithful. Returning no ref here would emit a
  // document naming `src` while the real push names `@acme/base@1.4.2` — the one
  // thing an offline preview must not do. It costs no network: the ref is read
  // from the foundation's own package.json.
  const { ws, site } = workspace()
  try {
    const res = await bringFoundationAlong({
      client: {
        readFoundationLatest: async () => {
          throw new Error('dry run must not touch the network')
        }
      },
      siteDir: site,
      siteYml: { foundation: 'src' },
      args: ['--non-interactive'],
      say: quietSay,
      confirm: noConfirm,
      cliBin: 'uniweb',
      dryRun: true,
      verb: 'push'
    })
    assert.equal(res.ref, '@acme/base@1.4.2')
    assert.equal(res.proceed, true)
    assert.equal(res.released, false)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('a site already naming a registry ref needs no override — site.yml rides verbatim', async () => {
  // CONTROL for the test above: `ref: null` must still be reachable, or "we got a
  // ref" would prove nothing about the local-foundation branch.
  const ws = mkdtempSync(join(tmpdir(), 'push-fnd-'))
  try {
    mkdirSync(join(ws, 'site'), { recursive: true })
    const res = await bringFoundationAlong({
      client: {},
      siteDir: join(ws, 'site'),
      siteYml: { foundation: '@acme/base@9.9.9' },
      args: [],
      say: quietSay,
      confirm: noConfirm,
      cliBin: 'uniweb',
      dryRun: true,
      verb: 'push'
    })
    assert.equal(res.ref, null)
    assert.equal(res.proceed, true)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('the message names the verb the user actually ran', async () => {
  // The strings used to say "re-run `uniweb publish`" unconditionally. Told to a
  // user who ran `push`, that is a wrong instruction, not a cosmetic slip.
  const { ws, site } = workspace()
  const lines = []
  try {
    await bringFoundationAlong({
      client: {
        // Registered, same version, digest we cannot match → the immutable-version
        // branch, which is the one that tells the user what to re-run.
        readFoundationLatest: async () => ({
          latest_version: '1.4.2',
          digest: 'sha256:something-else'
        })
      },
      siteDir: site,
      siteYml: { foundation: 'src' },
      args: ['--yes'], // skip prompts; we are asserting on the text, not the flow
      say: { ...quietSay, warn: (m) => lines.push(m), dim: (m) => lines.push(m) },
      confirm: noConfirm,
      cliBin: process.execPath,
      verb: 'push'
    })
  } catch {
    // The digest compare shells out to a foundation build, which this fixture
    // cannot run. Whatever was said before that point is what we are asserting on.
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
  const publishMentions = lines.filter((l) => l.includes('uniweb publish'))
  assert.deepEqual(publishMentions, [], 'told a `push` user to re-run `publish`')
})

// ─── code changed, version not bumped: three outcomes, not two ───────────────
// `--yes` and "no TTY" were one condition until 2026-08-19. They are opposite
// answers: a flag is a decision made in advance, an absent TTY is the ABSENCE of
// one. Conflated, the only caller that never got asked was the agent — the one
// that reports "pushed" on exit 0 and does not look again.

import { chmodSync } from 'node:fs'

/** A registered foundation whose local code differs from what the catalog holds. */
function divergedWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), 'push-diverged-'))
  const site = join(ws, 'site')
  const fnd = join(ws, 'src')
  mkdirSync(site, { recursive: true })
  mkdirSync(join(fnd, 'dist'), { recursive: true })
  writeFileSync(join(site, 'site.yml'), 'name: Acme\nfoundation: src\n')
  writeFileSync(
    join(fnd, 'package.json'),
    JSON.stringify({ name: '@acme/base', version: '1.4.2' })
  )
  // Something for the digest to hash — it will not match the registered one.
  writeFileSync(join(fnd, 'dist', 'entry.js'), 'export default {}\n')
  // `buildFoundation` re-spawns the CLI; a no-op stands in so the test stays offline.
  const cliBin = join(ws, 'fake-cli.js')
  writeFileSync(cliBin, 'process.exit(0)\n')
  chmodSync(cliBin, 0o755)
  return { ws, site, cliBin }
}

const registeredWith = (digest) => ({
  readFoundationLatest: async () => ({ latest_version: '1.4.2', digest })
})

async function runCase(args, { digest = 'sha256:something-else' } = {}) {
  const { ws, site, cliBin } = divergedWorkspace()
  const said = { warn: [], err: [], dim: [], info: [], ok: [] }
  const say = {
    ok: (m) => said.ok.push(m),
    info: (m) => said.info.push(m),
    warn: (m) => said.warn.push(m),
    err: (m) => said.err.push(m),
    dim: (m) => said.dim.push(m)
  }
  let asked = false
  try {
    const res = await bringFoundationAlong({
      client: registeredWith(digest),
      siteDir: site,
      siteYml: { foundation: 'src' },
      args,
      say,
      confirm: async () => {
        asked = true
        return false
      },
      cliBin,
      verb: 'push'
    })
    return { res, said, asked }
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

test('--yes is CONSENT: it proceeds, and warns rather than whispering', async () => {
  const { res, said, asked } = await runCase(['--yes'])
  assert.equal(res.proceed, true, '--yes must not block the push')
  assert.equal(res.released, false, 'an immutable registered version is not re-released')
  assert.equal(asked, false, 'consent given in advance must not prompt')
  // The consequence — the site will not run your local code — belongs at warn.
  // It used to print at `dim`, the level reserved for things nobody needs to read.
  assert.ok(
    said.warn.some((m) => /will NOT be live/i.test(m)),
    `expected a warn naming the consequence, got ${JSON.stringify(said)}`
  )
})

test('no TTY is ABSENCE, not consent: it refuses, and says what to run', async () => {
  const { res, said, asked } = await runCase(['--non-interactive'])
  assert.equal(res.proceed, false, 'nobody was asked — must not proceed')
  assert.equal(res.refused, true, 'a refusal is not a human declining; callers exit differently')
  assert.equal(asked, false)
  assert.ok(said.err.length, 'a refusal must be reported at error level')
  const guidance = said.dim.join('\n')
  assert.match(guidance, /Nothing was sent/, 'must say the push did not happen')
  assert.match(guidance, /bump/i, 'must offer the release path')
  assert.match(guidance, /--yes/, 'must offer the ship-anyway path as a command')
})

test('CONTROL: --yes wins over a missing TTY — the flag is checked first', async () => {
  // Both conditions are true here. If the order ever flips, an explicit --yes
  // starts failing, which is the expensive direction.
  const { res } = await runCase(['--yes', '--non-interactive'])
  assert.equal(res.proceed, true)
})

test('CONTROL: an UNVERIFIABLE digest still proceeds non-interactively', async () => {
  // Deliberately NOT changed. A backend that returns no digest is not evidence of
  // a problem, and refusing there would block every push against such a backend —
  // the wrong blast radius. This pins the scope of the change above.
  const { res } = await runCase(['--non-interactive'], { digest: null })
  assert.equal(res.proceed, true)
  assert.equal(res.refused, undefined)
})

// ─── every caller of the create must supply the PINNED ref ───────────────────
// The site-create is a THIRD writer of `info.foundation`: the sync emit stamps it
// via `injectInfo`, `publish` passes it to `ensureSiteExists`, and `push` did
// neither until 2026-08-19 — so a site created by `push` was created naming the
// authored alias (`src`), which no deployment can resolve. The site KEEPS that ref,
// so it is not self-correcting: only the create writes it.
//
// ⭐ This test is structural on purpose. A unit test of `ensureSiteExists` would have
// passed throughout — the function honours an explicit argument correctly and always
// did. The defect was a caller not passing one, which is invisible from inside the
// callee, and is the same shape as the flag-guard coverage test: a rule applied at
// the writers under discussion, with a caller nobody enumerated.
//
// Found by the backend lane enforcing their create door and watching A1 fail at the
// create step (channel backend-framework-787e).

import { readFileSync as readSrc, readdirSync } from 'node:fs'
import { dirname, join as joinPath } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The object-literal argument of a call, by brace balance. */
function callArgOf(text, from) {
  const open = text.indexOf('{', from)
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1)
  }
  return ''
}

test('every ensureSiteExists caller supplies a foundation ref', () => {
  const cmds = joinPath(dirname(fileURLToPath(import.meta.url)), '../src/commands')
  const offenders = []
  let callsFound = 0

  for (const f of readdirSync(cmds).filter((n) => n.endsWith('.js'))) {
    const text = readSrc(joinPath(cmds, f), 'utf8')
    let at = 0
    while ((at = text.indexOf('ensureSiteExists(', at)) !== -1) {
      callsFound++
      const arg = callArgOf(text, at)
      if (!/\bfoundation\b/.test(arg)) offenders.push(`${f} @ ${at}`)
      at += 1
    }
  }

  // CONTROL: a scan that finds no call sites would pass vacuously — which is exactly
  // the failure mode the backend lane hit in their own guard the same day (it matched
  // one `$model` spelling, found nothing, and reported a pass).
  assert.ok(callsFound >= 2, `expected to find the call sites, found ${callsFound}`)
  assert.deepEqual(
    offenders,
    [],
    'a create that omits the pinned ref names a foundation no deployment can resolve'
  )
})
