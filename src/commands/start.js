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
 *
 * ⭐ `--template <name>` names the template the guide creates the project from, so a prompt
 * for a kind of site can say which one and the first command is still this read-only one.
 * The name goes into the guide as given: `create`, which the guide tells the agent to run,
 * is what says when a template does not exist.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Handlebars from 'handlebars'
import { readFlagValue } from '../utils/args.js'
import { findUniwebWorkspace, findWorkspaceRoot } from '../utils/workspace.js'
import { detectWorkspacePm, installCmd } from '../utils/pm.js'

const PARTIAL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'partials', 'start.md')

/**
 * The Uniweb projects directly inside `cwd`, by folder name. `create <name>` puts a project
 * one level below the folder an agent was opened in, and a later session opened in the same
 * folder has to be told it is there rather than to create another.
 *
 * @param {string} cwd
 * @returns {string[]}
 */
function projectsIn(cwd) {
  return readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => entry.name)
    .filter((name) => findUniwebWorkspace(join(cwd, name)) === join(cwd, name))
    .sort()
}

/**
 * The guide, as Markdown, for a command run in `cwd`.
 *
 * Outside a project, `otherProject` names a workspace of another kind that holds `cwd`:
 * `create` refuses to make a project inside one, so the guide says to create it elsewhere.
 *
 * @param {{ cwd?: string, template?: string|null }} [o] - `template`: what to create the
 *   project from, `starter` when none is named
 * @returns {string}
 */
export function startGuide({ cwd = process.cwd(), template = null } = {}) {
  const root = findUniwebWorkspace(cwd)
  const nearby = root ? [] : projectsIn(cwd)
  const name = template || 'starter'
  const guide = Handlebars.compile(readFileSync(PARTIAL, 'utf8'), { noEscape: true })
  return guide({
    project: !!root,
    root,
    // A project `create` makes has one; one already here may not.
    agents: root ? existsSync(join(root, 'AGENTS.md')) : true,
    otherProject: root ? null : findWorkspaceRoot(cwd),
    nearby: nearby.map((folder) => `\`${folder}\``).join(', '),
    oneNearby: nearby.length === 1,
    template: name,
    starter: name === 'starter',
    none: name === 'none',
    paste: name === 'paste',
    install: installCmd(root ? detectWorkspacePm(root) : 'npm')
  })
}

/**
 * @param {string[]} [args] - `--template <name>`
 * @returns {Promise<{ exitCode: number }>}
 */
export async function start(args = []) {
  console.log(startGuide({ template: readFlagValue(args, '--template') }))
  return { exitCode: 0 }
}
