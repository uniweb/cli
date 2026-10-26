/**
 * The README a new project starts with — what a developer reads first.
 *
 * It leads with what sets Uniweb apart: one site, edited in files by its developers and in
 * the Uniweb app by its authors, kept in sync. Its table lists the packages the project
 * holds — a content template's own placement, a clone's lone site, a blank workspace's none —
 * never a fixed picture of `src/` and `site/`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffoldWorkspace } from '../src/utils/scaffold.js'

const STANDARD = [
  { path: 'src', foundation: true },
  { path: 'site', site: true }
]

/** The README `scaffoldWorkspace` writes for `context`. */
async function readme(context) {
  const dir = mkdtempSync(join(tmpdir(), 'uw-readme-'))
  try {
    await scaffoldWorkspace(dir, { projectName: 'shop', workspaceGlobs: ['site', 'src'], scripts: {}, ...context })
    return readFileSync(join(dir, 'README.md'), 'utf8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('leads with sync: the project and the app, two interfaces to one website', async () => {
  const text = await readme({ packages: STANDARD })
  assert.match(text, /^# shop\n/)
  assert.ok(text.includes('**Developers define the vocabulary. Authors compose with it. Uniweb keeps both sides in sync.**'))
  assert.ok(text.includes('two interfaces to the same website'))
  for (const command of ['pnpm uniweb login', 'pnpm uniweb push', 'pnpm uniweb pull', 'pnpm uniweb sync', 'pnpm uniweb publish']) {
    assert.ok(text.includes(command), command)
  }
  // Connecting the app comes first; the framework on its own follows it.
  const connect = text.indexOf('## Connect the authoring app')
  assert.ok(connect > 0)
  assert.ok(connect < text.indexOf('## Other ways to use it'))
})

test('the table lists the packages the project holds, by kind', async () => {
  const standard = await readme({ packages: STANDARD })
  assert.match(standard, /\| `src\/` \| a foundation: /)
  assert.match(standard, /\| `site\/` \| a site: /)
  assert.match(standard, /\| `AGENTS\.md` \| the manual for this project/)

  const placed = await readme({
    packages: [
      { path: 'docs/src', foundation: true },
      { path: 'docs/site', site: true },
      { path: 'effects', extension: true }
    ]
  })
  assert.match(placed, /\| `docs\/src\/` \| a foundation: /)
  assert.match(placed, /\| `docs\/site\/` \| a site: /)
  assert.match(placed, /\| `effects\/` \| an extension: /)
  assert.doesNotMatch(placed, /\| `src\/` \|/, 'a folder the project does not have')
})

test('a blank workspace says how to grow it', async () => {
  const text = await readme({ packages: [], workspaceGlobs: [] })
  assert.ok(text.includes('npx uniweb add project <name>'))
  assert.doesNotMatch(text, /^pnpm dev/m, 'a blank workspace has no dev script')
  assert.doesNotMatch(text, /\| `src\/` \||\| `site\/` \|/)
})

test('a clone says it is in sync with the app already', async () => {
  const cloned = await readme({ packages: [{ path: 'site', site: true }], workspaceGlobs: ['site'], cloned: true })
  assert.match(cloned, /cloned from a site in the Uniweb app/)
  assert.doesNotMatch(cloned, /\| `src\/` \|/)
  // CONTROL — a project made by `create` says nothing of the kind.
  assert.doesNotMatch(await readme({ packages: STANDARD }), /cloned from/)
})

test('⛔ none of what the README used to get wrong', async () => {
  for (const packages of [STANDARD, []]) {
    const text = await readme({ packages })
    assert.doesNotMatch(text, /localhost:5173/, 'the dev server takes a free port and says which')
    assert.doesNotMatch(text, /cd foundation|dist\/foundation\.js/, 'the foundation is src/, and builds dist/entry.js')
    assert.doesNotMatch(text, /content \|\| \{\}/, 'content arrives in a guaranteed shape')
    assert.doesNotMatch(text, /github\.com\/uniweb\/docs\)/, 'the documentation is at uniweb.io/docs')
    assert.doesNotMatch(text, /\{\{|\}\}/, 'rendered whole')
  }
})
