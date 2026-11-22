/**
 * uniweb mcp — tools for an AI agent, served over the Model Context Protocol.
 *
 * A host that runs tools for its agent (Claude Desktop, Claude Code, and others) starts this
 * command and talks to it over standard input and output, one message per line. The tools work on
 * the person's sites as the person signed in to the CLI, in the CLI's workspace, through a session
 * of the agent's own (`@uniweb/agent`).
 *
 * In a project, whose files are the site's copy, the tools whose work the files already do are
 * left out: an agent there edits the files and pushes, as it does today.
 *
 *   uniweb mcp              serve the tools
 *   uniweb mcp --org @acme  in that workspace, for this run
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

// Its help is the CLI's per-command block (`printCommandHelp`, index.js), shown before this runs.

function cliVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    return JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

/**
 * @param {string[]} args
 * @returns {Promise<{ exitCode: number }>}
 */
export async function mcp(args = []) {
  // ⛔ Standard output carries the protocol, and anything else written there breaks it: every
  // other line this process prints goes to standard error.
  console.log = (...line) => console.error(...line)
  console.info = (...line) => console.error(...line)

  const { BackendClient } = await import('../backend/client.js')
  const { resolveWorkspace } = await import('../backend/workspace.js')
  const { projectSiteDir } = await import('./site.js')

  const client = new BackendClient({ args: [...args, '--non-interactive'], command: 'Serving tools to an agent' })
  const ws = await resolveWorkspace({ client, args })
  if (ws.refused) {
    console.error(`uniweb mcp: ${ws.reason}`)
    return { exitCode: 2 }
  }
  let token
  try {
    token = await client.token()
  } catch (err) {
    console.error(`uniweb mcp: ${err?.message ?? err}\nSign in with \`uniweb login\`, then start the server again.`)
    return { exitCode: 2 }
  }

  const { agentClient, cliDoor, agentTools, mcpServer, AGENT_INSTRUCTIONS } = await import('@uniweb/agent')
  const project = await projectSiteDir()
  const agent = agentClient({
    origin: client.origin,
    openSession: cliDoor({ origin: client.origin, token, workspace: ws.workspace }),
  })
  const server = mcpServer({
    name: 'uniweb',
    version: cliVersion(),
    tools: agentTools({ client: agent, project: Boolean(project.dir || project.many) }),
    instructions: AGENT_INSTRUCTIONS,
  })

  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
  const pending = new Set()
  const lines = readline.createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    if (!line.trim()) return
    let message
    try {
      message = JSON.parse(line)
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: a message is one line of JSON.' } })
      return
    }
    const work = server.handle(message).then((answer) => answer && send(answer))
    pending.add(work)
    work.finally(() => pending.delete(work))
  })
  await new Promise((resolveClosed) => lines.on('close', resolveClosed))
  await Promise.allSettled([...pending])
  await agent.end()
  return { exitCode: 0 }
}
