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
