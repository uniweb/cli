/**
 * handoff — RESERVED (not available on the new backend yet).
 *
 * The "create a site and hand it off to a client" flow ran against the legacy
 * platform (the PHP backend + Cloudflare Worker) the CLI no longer talks to. A
 * new-backend CLI equivalent isn't built; the command name is kept reserved so a
 * future rebuild can claim it without a breaking change.
 */

export async function handoff() {
  console.error("\x1b[31m✗\x1b[0m `uniweb handoff` isn't available on the new backend yet.")
  console.error('  The legacy site-handoff flow was retired with the PHP backend.')
  console.error('  Manage client sites from the Uniweb app for now.')
  process.exit(1)
}

export default handoff
