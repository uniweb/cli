/**
 * `--commit` on the verbs that send a site — `push` and `publish` (and `sync`, through its
 * push). In a repository they send what is committed (`uncommittedContent`,
 * backend/site-sync.js); this is the stop where it is not, and the commit that makes it so.
 *
 * Its own module so the flags it reads stay out of the import graph of every verb that only
 * shares site-sync.js — `pull`, `status`, `refresh` take no `--commit`
 * (`test/flag-guard-coverage.test.js`).
 */

import { uncommittedContent, commitSiteContent } from './site-sync.js'

/**
 * The stop before a push or publish sends anything, where the site's content is not
 * committed — or, with `--commit`, the commit that makes it so, which a dry run only says.
 * Returns `{ exitCode }` to stop, or null to go on.
 */
export function commitBeforeSending(siteDir, args, { verb, dryRun, say }) {
  const pending = uncommittedContent(siteDir, { verb })
  if (!pending) return null
  if (!args.includes('--commit') || pending.merge) {
    say.error(pending.headline)
    for (const line of pending.lines) say.note(line)
    return { exitCode: 1 }
  }
  if (dryRun) {
    say.info(`Dry run — would commit ${pending.paths.length} file(s) of the site first.`)
    return null
  }
  const made = commitSiteContent(siteDir, { message: commitMessage(args) })
  if (made.error) {
    say.error("Could not commit the site's content:")
    for (const line of String(made.error).split('\n').slice(0, 8)) say.note(`  ${line}`)
    return { exitCode: 1 }
  }
  if (made.commit) say.success(`Committed ${made.paths.length} file(s) of the site — ${made.commit.slice(0, 7)}`)
  return null
}

/** `-m` / `--message` for `--commit`, as `git commit` takes it. */
function commitMessage(args) {
  for (const name of ['-m', '--message']) {
    const eq = args.find((a) => a.startsWith(`${name}=`))
    if (eq) return eq.slice(name.length + 1)
    const i = args.indexOf(name)
    if (i !== -1 && args[i + 1] != null) return args[i + 1]
  }
  return "Update the site's content"
}
