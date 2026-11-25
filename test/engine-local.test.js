/**
 * The engine on this machine, as the CLI keeps and finds it: its folder under `~/.uniweb/engines/`,
 * the `.env` the CLI writes, what the engine writes back (`engine.json`), how a project finds it by
 * the address its `$devBackend` names, and what `uniweb dev` registers.
 *
 * Nothing here runs Docker: the start itself is measured against a real engine, not in a unit test.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** A HOME of its own for each test, so the engines folder is the test's. */
function home() {
  const dir = mkdtempSync(join(tmpdir(), 'uw-engine-home-'))
  const saved = process.env.HOME
  process.env.HOME = dir
  return { dir, restore: () => ((process.env.HOME = saved), rmSync(dir, { recursive: true, force: true })) }
}

const local = await import('../src/engine/local.js')
const { writeDevBackend, isSolutionSite } = await import('../src/engine/setup.js')
const { devBackendAddressOf } = await import('../src/engine/verbs.js')
const { typesDigest } = await import('../src/engine/dev.js')

function engine(name, { env = '', info = null } = {}) {
  const dir = local.engineDir(name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'compose.yaml'), 'services: {}\n')
  if (env) writeFileSync(join(dir, '.env'), env)
  if (info) writeFileSync(join(dir, 'engine.json'), JSON.stringify(info))
  return dir
}

test('⭐ the .env is written key by key, keeping every other line', () => {
  const h = home()
  try {
    const dir = engine('club', { env: '# mine\nENGINE_PORT=4100\nOTHER=x\n' })
    local.writeEnv(dir, { ENGINE_PORT: 4200, ENGINE_HANDLE: 'jane' })
    assert.equal(readFileSync(join(dir, '.env'), 'utf8'), '# mine\nENGINE_PORT=4200\nOTHER=x\nENGINE_HANDLE=jane\n')
    assert.deepEqual(local.readEnv(dir), { ENGINE_PORT: '4200', OTHER: 'x', ENGINE_HANDLE: 'jane' })
  } finally {
    h.restore()
  }
})

test('⭐ a project finds its engine by the API address engine.json states, trailing slash or not', () => {
  const h = home()
  try {
    engine('club', { info: { api: 'http://localhost:4100/api' } })
    engine('shop', { info: { api: 'http://localhost:4102/api' } })
    assert.equal(local.findEngineFor('http://localhost:4102/api/')?.name, 'shop')
    assert.equal(local.findEngineFor('http://localhost:9999/api'), null)
  } finally {
    h.restore()
  }
})

test('the ports every engine is set to use are claimed, the dev server’s included', () => {
  const h = home()
  try {
    engine('club', { env: 'ENGINE_PORT=4100\nENGINE_APP_PORT=4101\nUNIWEBD_FUNCTIONS_URL=http://host.docker.internal:4300/_compute\n' })
    assert.deepEqual([...local.claimedPorts()].sort(), [4100, 4101, 4300])
  } finally {
    h.restore()
  }
})

test('a file the engine names beside engine.json is read; a name that leaves the folder is not', () => {
  const h = home()
  try {
    const dir = engine('club')
    writeFileSync(join(dir, 'cli-token'), 'tok\n')
    assert.equal(local.readEngineFile(dir, { cli_token: 'cli-token' }, 'cli_token'), 'tok')
    assert.equal(local.readEngineFile(dir, { cli_token: '../x' }, 'cli_token'), null)
  } finally {
    h.restore()
  }
})

test('an engine’s name is a compose project’s: lowercase letters, digits and dashes', () => {
  assert.equal(local.engineNameFor('My Club!'), 'my-club')
  assert.equal(local.engineNameFor('012-conference'), '012-conference')
})

describe('site.yml', () => {
  const site = (text) => {
    const dir = mkdtempSync(join(tmpdir(), 'uw-engine-site-'))
    writeFileSync(join(dir, 'site.yml'), text)
    return dir
  }
  const info = { api: 'http://localhost:4100/api', records: 'http://localhost:4100/q/{locale}' }

  test('⭐ $devBackend is replaced, with its indented lines, and every other line kept', () => {
    const dir = site('name: S\n# a note\n$devBackend:\n  backend: x\n  records: y\n\nbuild:\n  prerender: true\n')
    writeDevBackend(dir, info)
    assert.equal(
      readFileSync(join(dir, 'site.yml'), 'utf8'),
      'name: S\n# a note\n$devBackend:\n  backend: http://localhost:4100/api\n  records: http://localhost:4100/q/{locale}\n\nbuild:\n  prerender: true\n'
    )
  })

  test('the string form is replaced too, and a site with none gets the entry', () => {
    const one = site('name: S\n$devBackend: ./mock/api.js\n')
    writeDevBackend(one, info)
    assert.match(readFileSync(join(one, 'site.yml'), 'utf8'), /^\$devBackend:\n {2}backend: http:\/\/localhost:4100\/api\n/m)
    assert.doesNotMatch(readFileSync(join(one, 'site.yml'), 'utf8'), /mock/)
    const none = site('name: S\n')
    writeDevBackend(none, info)
    assert.match(readFileSync(join(none, 'site.yml'), 'utf8'), /\$devBackend:\n {2}backend: /)
  })

  test('the engine a site names: its string form, or the map’s backend, when an address', () => {
    assert.equal(devBackendAddressOf(site('$devBackend: http://localhost:4100/api\n')), 'http://localhost:4100/api')
    assert.equal(devBackendAddressOf(site('$devBackend:\n  backend: http://localhost:4100/api\n')), 'http://localhost:4100/api')
    assert.equal(devBackendAddressOf(site('$devBackend: ./mock/api.js\n')), null)
  })

  test('⭐ a solution’s site asks for a backend and has a blueprint', () => {
    const dir = site('services:\n  search: true\n  backend: true\n')
    assert.equal(isSolutionSite(dir), false)
    writeFileSync(join(dir, 'blueprint.yml'), 'signup: open\n')
    assert.equal(isSolutionSite(dir), true)
    writeFileSync(join(dir, 'site.yml'), 'services:\n  backend: false\n')
    assert.equal(isSolutionSite(dir), false)
  })
})

test('⭐ what `uniweb dev` registers changes with the types and main.js, and not with a component', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uw-engine-types-'))
  mkdirSync(join(dir, 'schemas'))
  mkdirSync(join(dir, 'sections'))
  writeFileSync(join(dir, 'main.js'), "export default { name: 'x' }\n")
  writeFileSync(join(dir, 'schemas', 'a.yml'), 'fields: {}\n')
  writeFileSync(join(dir, 'sections', 'Hero.jsx'), 'export default () => null\n')
  const first = typesDigest(dir)
  writeFileSync(join(dir, 'sections', 'Hero.jsx'), 'export default () => 1\n')
  assert.equal(typesDigest(dir), first)
  writeFileSync(join(dir, 'schemas', 'a.yml'), 'fields: { t: { type: string } }\n')
  assert.notEqual(typesDigest(dir), first)
})

test('⭐ `uniweb dev` sends blueprint.yml once, named in full, and an edit after it was taken is only said', async () => {
  const h = home()
  const { createServer } = await import('node:http')
  const asked = []
  let status = 200
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      asked.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) })
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(status === 200 ? { applied: true, left_out: [] } : { title: 'Conflict' }))
    })
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    const { writeRegistryAuth } = await import('../src/utils/registry-auth.js')
    await writeRegistryAuth({ origin, token: 'TKN' })
    const { sendBlueprint } = await import('../src/engine/dev.js')
    const project = mkdtempSync(join(tmpdir(), 'uw-engine-bp-'))
    mkdirSync(join(project, 'site'))
    mkdirSync(join(project, 'src'))
    writeFileSync(join(project, 'site', 'blueprint.yml'), "signup: open\naccess:\n  '@/track':\n    all: { members: read }\n")
    writeFileSync(join(project, 'src', 'package.json'), JSON.stringify({ name: 'src', version: '0.3.0' }))
    writeFileSync(join(project, 'src', 'main.js'), "export default { name: '@jane/conference' }\n")
    const dir = engine('conf')
    const args = { siteDir: join(project, 'site'), foundationDir: join(project, 'src'), dir, info: { api: `${origin}/api` } }

    assert.equal(await sendBlueprint(args), 'sent')
    assert.equal(asked[0].url, '/dev/backend/blueprint')
    assert.equal(asked[0].auth, 'Bearer TKN')
    assert.deepEqual(asked[0].body.foundations, ['@jane/conference@0.3.0'])
    assert.deepEqual(Object.keys(asked[0].body.blueprint.access), ['@jane/track'])

    // Taken once: not sent again, and an edit is said, not sent.
    assert.equal(await sendBlueprint(args), 'held')
    writeFileSync(join(project, 'site', 'blueprint.yml'), 'signup: invite_only\n')
    assert.equal(await sendBlueprint(args), 'held')
    assert.equal(asked.length, 1)

    // An engine that already holds one (409) counts as taken.
    rmSync(join(dir, 'registered.json'))
    status = 409
    assert.equal(await sendBlueprint(args), 'held')
  } finally {
    await new Promise((done) => server.close(done))
    h.restore()
  }
})

test('⭐ the release’s images are loaded once per archive, and only for this machine', async () => {
  const h = home()
  try {
    const dir = engine('club')
    assert.deepEqual(await local.loadImages(dir), {}, 'no archive: images built or pulled another way')

    const other = process.arch === 'arm64' ? 'amd64' : 'arm64'
    writeFileSync(join(dir, `images-${other}.tar.gz`), 'x')
    assert.match((await local.loadImages(dir)).error, new RegExp(`for ${other}, not this machine`))

    // Already loaded: the marker names this archive as it is, so nothing runs.
    const mine = process.arch === 'arm64' ? 'arm64' : 'amd64'
    writeFileSync(join(dir, `images-${mine}.tar.gz`), 'y')
    const { statSync } = await import('node:fs')
    const { size, mtimeMs } = statSync(join(dir, `images-${mine}.tar.gz`))
    writeFileSync(join(dir, '.images-loaded'), `images-${mine}.tar.gz:${size}:${Math.round(mtimeMs)}\n`)
    assert.deepEqual(await local.loadImages(dir), {})
  } finally {
    h.restore()
  }
})

test('the engine’s guide is the AGENTS.md its files carry, else its README', () => {
  const h = home()
  try {
    const dir = engine('club')
    assert.equal(local.engineGuidePath(dir), null)
    writeFileSync(join(dir, 'README.md'), '# r\n')
    assert.equal(local.engineGuidePath(dir), join(dir, 'README.md'))
    writeFileSync(join(dir, 'AGENTS.md'), '# a\n')
    assert.equal(local.engineGuidePath(dir), join(dir, 'AGENTS.md'))
  } finally {
    h.restore()
  }
})
