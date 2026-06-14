/**
 * template — RESERVED (not available on the new backend yet).
 *
 * `uniweb template publish` submitted a site as a cloud template to the legacy
 * registry (the PHP backend + Cloudflare Worker) the CLI no longer talks to. A
 * new-backend equivalent isn't built; when it is, a template is REGISTERED (like
 * a foundation or a schemas package) — the verb will be `register`, not `publish`
 * (`publish` is for SITES only). The command name is kept reserved.
 *
 * (Unrelated: scaffolding FROM a template — `uniweb create --template <name>` —
 * is a separate path and is unaffected.)
 */

export async function template() {
  console.error("\x1b[31m✗\x1b[0m `uniweb template register` isn't available on the new backend yet.")
  console.error('  Submitting a site as a cloud template was retired with the PHP backend.')
  console.error('  A template is REGISTERED, like a foundation — `publish` is for sites only.')
  console.error('  (Scaffolding FROM a template still works: `uniweb create --template <name>`.)')
  process.exit(1)
}

export default template
