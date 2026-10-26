/**
 * `uniweb start` — the guide an AI agent reads first.
 *
 * ⭐ FOR AN AGENT WORKING FOR SOMEONE WHO DOES NOT USE A TERMINAL. The person asks their
 * agent for a website; the agent runs `npx uniweb@latest start` and follows what it
 * prints: create a project, read its AGENTS.md, run it, sign the person in, and bring the
 * site into the Uniweb app. The person's part is their browser — signing in, and paying
 * when the site goes live — so nothing here asks them to run a command.
 *
 * ⛔ READ-ONLY, AND SAFE ANYWHERE. It asks nothing, writes nothing and makes no request,
 * so an agent can run it in any folder, as often as it likes. That is also why
 * `index.js` answers it before the update check, which can write a cache and fetch.
 *
 * ⭐ THE TEXT SHIPS WITH THIS CLI (`partials/start.md`), so it describes the version that
 * prints it. Inside a Uniweb project (`findUniwebWorkspace`) it starts from that project
 * instead of creating one, and names that project's own package manager.
 *
 * It is answered by the CLI that was invoked, never delegated to a project's own copy
 * (`STANDALONE_COMMANDS`): an older project CLI does not have it.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Handlebars from 'handlebars'
import { findUniwebWorkspace, findWorkspaceRoot } from '../utils/workspace.js'
import { detectWorkspacePm, installCmd } from '../utils/pm.js'

const PARTIAL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'partials', 'start.md')

/**
 * The guide, as Markdown, for a command run in `cwd`.
 *
 * Outside a project, `otherProject` names a workspace of another kind that holds `cwd`:
 * `create` refuses to make a project inside one, so the guide says to create it elsewhere.
 *
 * @param {{ cwd?: string }} [o]
 * @returns {string}
 */
export function startGuide({ cwd = process.cwd() } = {}) {
  const root = findUniwebWorkspace(cwd)
  const template = Handlebars.compile(readFileSync(PARTIAL, 'utf8'), { noEscape: true })
  return template({
    project: !!root,
    root,
    // A project `create` makes has one; one already here may not.
    agents: root ? existsSync(join(root, 'AGENTS.md')) : true,
    otherProject: root ? null : findWorkspaceRoot(cwd),
    install: installCmd(root ? detectWorkspacePm(root) : 'npm')
  })
}

/**
 * @param {string[]} [args] - none are read
 * @returns {Promise<{ exitCode: number }>}
 */
export async function start(args = []) {
  console.log(startGuide())
  return { exitCode: 0 }
}
