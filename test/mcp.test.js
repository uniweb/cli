/**
 * `uniweb mcp` serves an agent's tools over the Model Context Protocol, on standard input and
 * output, as the person signed in to the CLI.
 *
 * The CLI runs as a host runs it: a child process whose standard input takes one JSON-RPC message
 * per line, against a stand-in backend that answers the agent routes. What it must hold:
 * standard output carries nothing but protocol messages; the CLI's sign-in is traded for an agent
 * session; the agent routes are called with that session and no workspace header; and the
 * process ends when its input does.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLI = join(ROOT, 'src/index.js')

/** A stand-in for a backend that serves the agent routes; it keeps each request it was sent. */
async function standInBackend() {
  const seen = []
  const server = createServer((req, res) => {
    seen.push({ method: req.method, path: req.url.split('?')[0], authorization: req.headers.authorization ?? null, workspace: req.headers['x-uniweb-workspace'] ?? null })
    const answer = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method === 'POST' && req.url === '/dev/auth/agent') return answer(201, { token: 'agent-session', expires_at: '2999-01-01T00:00:00Z', workspace: null })
    if (req.url === '/agent/session') return answer(200, { workspace: null })
    if (req.url.startsWith('/agent/sites')) {
      return answer(200, { sites: [{ uuid: 'site-1', name: 'Maple & Rye', updated_at: '2026-11-21T00:00:00Z', deployment: { status: 'published', visitor_url: 'https://maple.example/' } }] })
    }
    return answer(404, { reason: 'not_found' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { origin: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) }
}

/** Run `uniweb mcp` with these messages on its input; answer what it wrote to each stream. */
function serve(messages, env, cwd) {
  return new Promise((resolve, reject) => {
    // Started outside any project, as a desktop host starts it: in one, the tools whose work the
    // files do are left out.
    const child = spawn(process.execPath, [CLI, 'mcp', '--personal'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    const guard = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`uniweb mcp did not end with its input. stderr: ${stderr}`))
    }, 30000)
    child.on('close', (code) => {
      clearTimeout(guard)
      resolve({ code, stdout, stderr })
    })
    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`)
    child.stdin.end()
  })
}

test('uniweb mcp answers a host on standard output alone, as the person, through an agent session', async () => {
  const backend = await standInBackend()
  const home = mkdtempSync(join(tmpdir(), 'uniweb-mcp-'))
  try {
    const { code, stdout, stderr } = await serve(
      [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_sites', arguments: {} } },
      ],
      { ...process.env, HOME: home, CI: 'true', NO_COLOR: '1', UNIWEB_SERVER: backend.origin, UNIWEB_TOKEN: 'cli-session' },
      home,
    )
    assert.equal(code, 0, `exit ${code}; stderr: ${stderr}`)
    const lines = stdout.split('\n').filter(Boolean)
    const answers = lines.map((l) => JSON.parse(l)) // every line on standard output is a protocol message
    assert.deepEqual(answers.map((a) => a.id), [1, 2, 3])
    assert.equal(answers[0].result.protocolVersion, '2025-11-25')
    assert.equal(answers[0].result.serverInfo.name, 'uniweb')
    const names = answers[1].result.tools.map((t) => t.name)
    assert.ok(names.includes('list_sites') && names.includes('read_page'), names.join(', '))
    assert.match(answers[2].result.content[0].text, /Maple & Rye — id site-1 — live at https:\/\/maple\.example\//)

    const exchange = backend.seen.find((r) => r.path === '/dev/auth/agent')
    assert.equal(exchange?.authorization, 'Bearer cli-session')
    const agentCalls = backend.seen.filter((r) => r.path.startsWith('/agent'))
    assert.ok(agentCalls.length > 0)
    for (const r of agentCalls) {
      assert.equal(r.authorization, 'Bearer agent-session', r.path)
      assert.equal(r.workspace, null, `${r.path} sent a workspace header`)
    }
  } finally {
    await backend.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('uniweb mcp --help says how a host starts it', () => {
  const home = mkdtempSync(join(tmpdir(), 'uniweb-mcp-help-'))
  try {
    const r = spawnSync(process.execPath, [CLI, 'mcp', '--help'], { encoding: 'utf8', cwd: home, env: { ...process.env, HOME: home, CI: 'true', NO_COLOR: '1' } })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /uniweb mcp/)
    assert.match(r.stdout, /a local server whose command is: {2}uniweb mcp/)
    assert.doesNotMatch(r.stdout, /Usage:\s+uniweb <command>/, 'the global help, not the command\'s')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
