/**
 * The stop before a push or publish sends pages mounted from a repository of their own that are
 * not current (`utils/mounted-repositories.js`).
 *
 * ⭐ THIS IS THE BACKEND'S GATE, FOR A MOUNT. For the site's own files, a push refused because a
 * teammate pushed first (`untakenBase`) is settled by a pull, which brings their work into the
 * files. A pull never writes into a mount, so after a teammate pushes newer docs a pull here takes
 * nothing, and a push would put the older ones back. So a push or publish stops when:
 * - a submodule is not checked out, or its checkout is not the commit the site's repository
 *   records. Behind it: a `git pull` moved the pin and left the checkout. Ahead of it: a commit
 *   made in it, which `--commit` records here as it commits the site's content;
 * - the folder has uncommitted changes, which no commit holds;
 * - the branch it follows has commits that change the folder.
 *
 * Interactive, it offers to take the latest first, and `--yes` takes it without asking.
 * Unattended, it stops and names both ways on: `npx uniweb refresh`, or `--mounts-as-is`, which
 * sends every mounted folder as it is [Diego, 2026-11-04: "we can also have a flag to publish in
 * spite of not being up-to-date, so an explicit option for that case"]. A remote that does not
 * answer is said, and the folder goes as it is.
 *
 * Its own module so the flags it reads stay out of the verbs that only read where mounts stand
 * (`status`, `refresh`, `pull`; `test/flag-guard-coverage.test.js`).
 */

import { isNonInteractive, confirm } from '../utils/interactive.js'
import {
  mountedRepositories,
  askRemote,
  standing,
  fetchTip,
  takeLatest,
  commitPin,
  describeTaken,
  mountName,
  short
} from '../utils/mounted-repositories.js'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * What stands between each mount and being sent: `{ m, line, take, commit }`, where `take` says
 * that taking the latest settles it, and `commit` that committing its pin does.
 */
async function problemsOf(mounts, { say }) {
  const problems = []
  for (const m of mounts) {
    const name = mountName(m)
    if (m.pin === 'missing') {
      problems.push({ m, take: true, line: `${name}: a submodule that is not checked out.` })
      continue
    }
    if (m.edits.length) {
      problems.push({
        m,
        take: false,
        line: `${name}: ${plural(m.edits.length, 'uncommitted change')}, which no commit holds. Commit or discard ${m.edits.length === 1 ? 'it' : 'them'} there.`
      })
    }
    const recorded = short(m.submodule?.recorded)
    if (m.pin === 'behind') {
      problems.push({ m, take: true, line: `${name}: checked out at ${short(m.head)}, behind the ${recorded} this repository records — \`git pull\` moved it, and the checkout stayed.` })
    } else if (m.pin === 'ahead') {
      problems.push({ m, take: false, commit: true, line: `${name}: checked out at ${short(m.head)}, ahead of the ${recorded} this repository records. Commit it here, or re-run with --commit.` })
    } else if (m.pin === 'diverged') {
      problems.push({ m, take: false, line: `${name}: checked out at ${short(m.head)}, which is not on the line of the ${recorded} this repository records.` })
    }
    // The remote is asked of a checkout that could move: not over changes, nor off its pin's line.
    if (m.edits.length || m.pin === 'behind' || m.pin === 'diverged' || !m.follows) continue
    const answer = await askRemote(m)
    if (!answer) {
      say.note(`${name}: ${m.follows.label} did not answer, so whether it has newer commits is unknown. It goes as it is.`)
      continue
    }
    let s = standing(m, answer.tip)
    // Only the commits can say whether they change the folder, so they are fetched.
    if (s === 'unheld') s = (await fetchTip(m, answer.branch)) ? standing(m, answer.tip) : 'newer'
    const on = answer.branch ? ` on ${answer.branch}` : ''
    if (s === 'newer') problems.push({ m, take: true, line: `${name}: ${m.follows.label} has newer commits for it${on}.` })
    if (s === 'diverged') {
      const pinned = m.submodule ? `, or name the branch it follows: \`git config -f .gitmodules submodule.${m.submodule.name ?? m.submodule.path}.branch <branch>\`` : ''
      problems.push({ m, take: false, line: `${name}: it and ${m.follows.label}${on} have each moved. Bring them together there${pinned}.` })
    }
  }
  return problems
}

/**
 * The stop before a push or publish sends anything, where a mounted folder is not as it should
 * be — or, interactive or with `--yes`, the latest taken first. Returns `{ exitCode }` to stop, or
 * null to go on.
 *
 * @param {string} siteDir
 * @param {string[]} args
 * @param {{ verb: 'push'|'publish', dryRun: boolean, say: { success: Function, info: Function, error: Function, note: Function } }} opts
 */
export async function mountsBeforeSending(siteDir, args, { verb, dryRun, say }) {
  const mounts = await mountedRepositories(siteDir)
  if (!mounts.length) return null
  if (args.includes('--mounts-as-is')) {
    say.note(`${mounts.map(mountName).join(', ')}: sent as ${mounts.length === 1 ? 'it is' : 'they are'} (--mounts-as-is).`)
    return null
  }
  let problems = await problemsOf(mounts, { say })
  if (!problems.length) return null

  // A checkout ahead of its pin is the site's own change: `--commit` commits it, as it does the rest.
  if (args.includes('--commit') && problems.some((p) => p.commit)) {
    for (const p of problems.filter((p) => p.commit)) {
      if (dryRun) {
        say.info(`Dry run — would commit ${p.m.submodule.path} at ${short(p.m.head)} first.`)
        continue
      }
      const made = commitPin(siteDir, p.m)
      if (made.error) {
        say.error(`Could not commit ${p.m.submodule.path}'s new pin:`)
        for (const line of String(made.error).split('\n').slice(0, 6)) say.note(`  ${line}`)
        return { exitCode: 1 }
      }
      say.success(`Committed ${p.m.submodule.path} at ${short(p.m.head)} — ${short(made.commit)}`)
    }
    problems = problems.filter((p) => !p.commit)
    if (!problems.length) return null
  }

  const yes = args.includes('--yes')
  const canAsk = !isNonInteractive(args)
  const manyOf = (list) => new Set(list.map((p) => p.m.segment)).size > 1
  if (problems.every((p) => p.take) && (yes || canAsk)) {
    const list = [...new Set(problems.map((p) => mountName(p.m)))].join(', ')
    if (dryRun) {
      say.info(`Dry run — would ${yes ? 'take' : 'offer to take'} the latest of ${list} first.`)
      return null
    }
    for (const p of problems) say.info(p.line)
    if (yes || (await confirm(`Take the latest of ${manyOf(problems) ? 'them' : 'it'} first?`, true))) {
      for (const m of new Map(problems.map((p) => [p.m.segment, p.m])).values()) {
        const r = await takeLatest(siteDir, m)
        ;(r.error || r.left ? say.note : say.success)(describeTaken(m, r))
      }
      problems = await problemsOf(await mountedRepositories(siteDir), { say })
      if (!problems.length) return null
    }
  }

  const done = verb === 'publish' ? 'published' : 'pushed'
  const many = manyOf(problems)
  const them = many ? 'them' : 'it'
  const asIs = many ? 'as they are' : 'as it is'
  const takes = problems.filter((p) => p.take).length
  say.error(`Not ${done} — ${many ? 'page folders mounted from other repositories are' : 'a page folder mounted from another repository is'} not ready to send:`)
  for (const p of problems) say.note(`  ${p.line}`)
  const settle =
    takes === problems.length
      ? 'Take the latest with `npx uniweb refresh`'
      : takes
        ? 'Settle the rest as above, take the latest with `npx uniweb refresh`'
        : `Settle ${them} as above`
  say.note(`${settle}, then ${verb} again — or ${verb} ${them} ${asIs} with --mounts-as-is.`)
  return { exitCode: 1 }
}
