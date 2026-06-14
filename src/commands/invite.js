/**
 * invite — RESERVED (not available on the new backend yet).
 *
 * The foundation client-invite flow ran against the legacy platform (the PHP
 * backend + Cloudflare Worker) the CLI no longer talks to. Client onboarding is
 * handled in the Uniweb app for now; a new-backend CLI equivalent isn't built.
 * The command name is kept reserved so a future rebuild can claim it without a
 * breaking change.
 */

export async function invite() {
  console.error("\x1b[31m✗\x1b[0m `uniweb invite` isn't available on the new backend yet.")
  console.error('  The legacy client-invite flow was retired with the PHP backend.')
  console.error('  Invite clients to your foundation from the Uniweb app for now.')
  process.exit(1)
}

export default invite
