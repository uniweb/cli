/**
 * The order `uniweb status`'s next steps are taken in.
 *
 * ⭐ FOLLOWED FROM THE TOP, THE LIST WORKS: each step's precondition is met by the ones above
 * it. A list of individually right steps in the wrong order is a guard that names an
 * unavailable recovery step — a push before the pull it needs is refused, and the refusal
 * then sends the reader back up. So the order is one table, not each check's own idea:
 *
 *   sign in → settle conflicts → finish a merge → take what others did (refresh, or pull)
 *   → push → push to git → go live → deploy to another host → update Uniweb → read doctor's findings
 *
 * Each check proposes steps by name (`step`); this sorts them, folds the ones another step
 * already does, and drops duplicates.
 */

const ORDER = ['login', 'conflicts', 'merge', 'refresh', 'pull', 'push', 'gitpush', 'publish', 'deploy', 'update', 'doctor']

/**
 * @param {Array<{ step: string, command: string|null, why: string, ask?: boolean }>} proposals
 * @returns {Array<{ command: string|null, why: string, ask: boolean }>}
 */
export function planNext(proposals) {
  const steps = [...proposals]
  // `refresh` is `git pull`, then the same pull: it takes the app's changes too.
  const refresh = steps.find((p) => p.step === 'refresh')
  const pull = steps.find((p) => p.step === 'pull')
  if (refresh && pull) {
    refresh.why = `${refresh.why}, and ${pull.why}`
    steps.splice(steps.indexOf(pull), 1)
  }
  // A newer release's update aligns the dependencies and AGENTS.md too: the project's own
  // CLI aligning them to its matrix is then one step too many.
  if (steps.some((p) => p.step === 'update' && p.latest)) {
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].step === 'update' && !steps[i].latest) steps.splice(i, 1)
  }
  const seen = new Set()
  return steps
    .filter((p) => ORDER.includes(p.step))
    .sort((a, b) => ORDER.indexOf(a.step) - ORDER.indexOf(b.step))
    .filter((p) => {
      const key = p.command ?? `${p.step}:${p.why}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(({ command, why, ask }) => ({ command: command ?? null, why, ask: Boolean(ask) }))
}
