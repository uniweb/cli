/**
 * `uniweb start` — the guide an AI agent reads first, when it builds a site for someone
 * who does not use a terminal.
 *
 * ⛔ The properties this file exists for:
 *   - it asks nothing, writes nothing and makes no request, in any folder;
 *   - its text never sends the person to a terminal: the agent runs every command, and the
 *     person's part is their browser — signing in, and paying;
 *   - it is answered by the CLI that was invoked, never a project's own copy, which may not
 *     have it — and before the update check, which can write a cache and fetch.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runVerb, tmp } from './helpers/run-verb.js'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js')

const { start, startGuide } = await import('../src/commands/start.js')

/** A project as `create` leaves it: a workspace whose root declares uniweb and holds AGENTS.md. */
function project({ agents = true, lock = null } = {}) {
  const root = tmp('uw-start-project-')
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'shop', private: true, workspaces: ['src', 'site'], devDependencies: { uniweb: '~1.20.0' } })
  )
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - src\n  - site\n')
  if (agents) writeFileSync(join(root, 'AGENTS.md'), '# AGENTS.md\n')
  if (lock) writeFileSync(join(root, lock), '')
  mkdirSync(join(root, 'site'))
  return root
}

// What would send the person to one. "Doesn't use a terminal" and "without a terminal" are
// the guide telling the agent so, and stay.
const TERMINAL_STEP = /\b(at|in|into|open|from|return to) (a|your|the) terminal\b/i

/** The guide's text with its line breaks folded, so a phrase is found wherever it wraps. */
const flat = (s) => s.replace(/\s+/g, ' ')

test('outside a project: create from starter, read AGENTS.md, sign in in the browser, bring it into the app', () => {
  const guide = startGuide({ cwd: tmp('uw-start-empty-') })

  assert.match(guide, /^# Build a website with Uniweb/)
  assert.ok(guide.includes('npx uniweb@latest create <name> --template starter'))
  assert.ok(guide.includes('`--template none`'))
  // Only those two: a full template is sample content to remove.
  assert.doesNotMatch(guide, /--blank|marketing|template list/)
  assert.match(guide, /AGENTS\.md, at the project's root, is the manual/)
  assert.match(guide, /Part 0/)
  assert.ok(guide.includes('npm install'))
  assert.ok(guide.includes('npx uniweb dev'))
  assert.ok(guide.includes('npx uniweb login --browser --personal'))
  assert.ok(guide.includes('npx uniweb push --commit'))
  assert.ok(guide.includes('npx uniweb publish --commit'))
  assert.ok(flat(guide).includes('prints an address instead of going live. Open it for the person'))
  assert.ok(guide.includes('https://uniweb.io/llms.txt'))
  // Rendered whole: no template syntax left over.
  assert.doesNotMatch(guide, /\{\{|\}\}/)
})

test('--template names what the guide creates the project from', () => {
  const guide = startGuide({ cwd: tmp('uw-start-empty-'), template: 'docs' })

  assert.ok(guide.includes('npx uniweb@latest create . --template docs'))
  assert.ok(guide.includes('npx uniweb@latest create <name> --template docs'))
  assert.ok(!guide.includes('--template starter'))
  assert.ok(flat(guide).includes('`docs` is a working site'))
  assert.ok(flat(guide).includes('replace all the sample content'))

  const none = startGuide({ cwd: tmp('uw-start-empty-'), template: 'none' })
  assert.ok(none.includes('create <name> --template none'))
  assert.ok(flat(none).includes('`none` is a project with no section types or pages'))
  assert.ok(!flat(none).includes('is a working site'))

  // CONTROL — with no template, the guide stays on starter and names no other.
  const plain = startGuide({ cwd: tmp('uw-start-empty-') })
  assert.ok(flat(plain).includes('`starter` has one generic section type'))
  assert.ok(!flat(plain).includes('is a working site'))
})

test('--template reaches the guide from the command line, in both spellings', async () => {
  for (const args of [['--template', 'blog'], ['--template=blog']]) {
    const r = await runVerb(tmp('uw-start-empty-'), start, args)
    assert.equal(r.exitCode, 0, r.output)
    assert.ok(r.output.includes('create <name> --template blog'), args.join(' '))
  }
  // A flag with no value is no template named.
  const r = await runVerb(tmp('uw-start-empty-'), start, ['--template'])
  assert.ok(r.output.includes('create <name> --template starter'))
})

test('--template paste says the design has to be taken apart, not only pasted', () => {
  const guide = flat(startGuide({ cwd: tmp('uw-start-empty-'), template: 'paste' }))
  assert.ok(guide.includes('create . --template paste'))
  assert.ok(guide.includes('replace `src/sections/App.jsx` with theirs'))
  assert.ok(guide.includes('they can edit in the app only what has left the code'))
  assert.ok(guide.includes('converting-existing.md'))
  assert.ok(!guide.includes('is a working site'))
})

test('Git: install it if it is missing, and commit as you go, in every variant', () => {
  for (const guide of [startGuide({ cwd: tmp('uw-start-empty-') }), startGuide({ cwd: project() })]) {
    const text = flat(guide)
    assert.ok(text.includes('Install Git too if `git --version` fails'))
    assert.ok(text.includes('Commit each time something works'))
    assert.doesNotMatch(guide, TERMINAL_STEP)
  }
})

test('a folder set aside for the site takes the project itself', () => {
  const guide = startGuide({ cwd: tmp('uw-start-empty-') })
  assert.ok(guide.includes('npx uniweb@latest create . --template starter'))
  assert.ok(flat(guide).includes('In a folder set aside for this site'))
})

test('a project one level down is named, so a later session does not create another', () => {
  const parent = tmp('uw-start-parent-')
  // A folder of the person's own, and one a project would not be found in.
  mkdirSync(join(parent, 'photos'))
  mkdirSync(join(parent, 'node_modules'))

  const none = startGuide({ cwd: parent })
  assert.ok(!none.includes('A project is already here'), 'a plain folder is not a project')

  const shop = project()
  const one = tmp('uw-start-parent-')
  renameSync(shop, join(one, 'shop'))
  const guide = flat(startGuide({ cwd: one }))
  assert.ok(guide.includes('`shop`, in this folder, is a Uniweb project.'))
  assert.ok(guide.includes('go there and run `npx uniweb@latest start` again'))

  renameSync(project(), join(one, 'blog'))
  assert.ok(flat(startGuide({ cwd: one })).includes('`blog`, `shop`, in this folder, are Uniweb projects.'))
})

test('the guide covers the person as well as the commands', () => {
  const guide = flat(startGuide({ cwd: tmp('uw-start-empty-') }))
  assert.ok(guide.includes('Ask only what you can\'t decide, in plain words.'))
  assert.ok(guide.includes('Show them the site on their computer before you ask them to sign in.'))
  assert.ok(guide.includes('set `defaultLanguage` in `site.yml`'))
  assert.ok(guide.includes('not in a component\'s code'))
  assert.ok(guide.includes('Take it live only when they ask'))
  assert.ok(guide.includes('https://uniweb.app'))
  assert.ok(guide.includes('It waits up to five minutes'))

  // A site they already have is brought here rather than created again.
  assert.ok(guide.includes('npx uniweb@latest site list'))
  assert.ok(guide.includes('npx uniweb@latest clone <site-uuid> <name>'))

  // CONTROL — a project already says what it is written in, and is not created or cloned.
  const inside = flat(startGuide({ cwd: project() }))
  assert.ok(!inside.includes('set `defaultLanguage`'))
  assert.ok(!inside.includes('clone <site-uuid>'))
  assert.ok(inside.includes('Show them the site on their computer'))
})

test('⛔ the person is never sent to a terminal — in any variant', () => {
  const variants = [
    startGuide({ cwd: tmp('uw-start-empty-') }),
    startGuide({ cwd: tmp('uw-start-empty-'), template: 'docs' }),
    startGuide({ cwd: project() }),
    startGuide({ cwd: project({ agents: false }) })
  ]
  for (const guide of variants) {
    assert.ok(flat(guide).includes('Run every command yourself, and never ask them to run one.'))
    assert.ok(flat(guide).includes('Never ask for a password or a token.'))
    assert.doesNotMatch(guide, TERMINAL_STEP)
  }
})

test('inside a project: no create step, its own package manager, and dev is what runs the site', () => {
  const root = project({ lock: 'pnpm-lock.yaml' })
  for (const cwd of [root, join(root, 'site')]) {
    const guide = startGuide({ cwd })
    assert.match(guide, /^# Working on a Uniweb project/)
    assert.ok(guide.includes(`the Uniweb project at \`${root}\``), 'names the project it found')
    assert.ok(!guide.includes('npx uniweb@latest create'), 'creates nothing inside a project')
    assert.ok(guide.includes('pnpm install'), "installs with the project's own package manager")
    assert.doesNotMatch(guide, /(^|[^p])npm install/m)
    assert.match(guide, /`uniweb start` only prints this guide; `npx uniweb dev` runs the site/)
    assert.match(guide, /AGENTS\.md, at the project's root/)
    assert.ok(guide.includes('npx uniweb login --browser --personal'))
  }
})

test('a project without AGENTS.md is told how to write one', () => {
  const guide = startGuide({ cwd: project({ agents: false }) })
  assert.match(guide, /This project has no AGENTS\.md/)
  assert.ok(guide.includes('npx uniweb update --agents-only'))
})

test('inside a workspace that is not a Uniweb project: create the project outside it', () => {
  const other = tmp('uw-start-other-')
  writeFileSync(join(other, 'package.json'), JSON.stringify({ name: 'monorepo', private: true }))
  writeFileSync(join(other, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  mkdirSync(join(other, 'packages'))

  const guide = startGuide({ cwd: join(other, 'packages') })
  assert.match(guide, /^# Build a website with Uniweb/)
  assert.ok(guide.includes(`Create it outside \`${other}\``))
  // CONTROL — a folder in no workspace says nothing of the kind.
  assert.ok(!startGuide({ cwd: tmp('uw-start-empty-') }).includes('Create it outside'))
})

test('⛔ asks nothing, writes nothing, makes no request', async () => {
  for (const dir of [tmp('uw-start-empty-'), project()]) {
    const before = readdirSync(dir).sort()
    const r = await runVerb(dir, start, [])
    assert.equal(r.exitCode, 0, r.output)
    assert.equal(r.requests, 0)
    assert.match(r.output, /^# (Build a website with Uniweb|Working on a Uniweb project)/)
    assert.deepEqual(readdirSync(dir).sort(), before)
  }
})

test('⛔ answered by the CLI that was invoked, not a project copy — and before the update check', () => {
  // A project-local CLI that would answer if `start` were delegated. Run from its source
  // path, this CLI counts as a global install, which delegates project-bound commands.
  const dir = tmp('uw-start-local-')
  mkdirSync(join(dir, 'node_modules', 'uniweb', 'src'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'uniweb', 'package.json'), JSON.stringify({ version: '0.0.1' }))
  writeFileSync(join(dir, 'node_modules', 'uniweb', 'src', 'index.js'), "console.log('DELEGATED')\n")
  const home = tmp('uw-start-home-')
  const run = (...args) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: home, CI: 'true' } })

  const r = run('start')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^# Build a website with Uniweb/)
  assert.ok(!r.stdout.includes('DELEGATED'))
  assert.ok(!existsSync(join(home, '.uniweb')), 'the update check ran: it keeps its cache in ~/.uniweb')

  const help = run('start', '--help')
  assert.equal(help.status, 0)
  assert.match(help.stdout, /uniweb start/)
  assert.match(help.stdout, /Print the guide, in Markdown/)

  // CONTROL — a project-bound command does go to the project's copy.
  assert.match(run('doctor').stdout, /DELEGATED/)
})
