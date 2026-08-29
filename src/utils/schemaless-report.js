/**
 * Report queries publishing without a data schema.
 *
 * ⭐ This is a PRODUCT decision the author is making, usually without knowing:
 * entities or static files. It is reported at warn level for that reason — the
 * producer deliberately emits a structured entry rather than a prose warning so
 * this can say what the trade actually is.
 *
 * The old line said `"… — not synced"`, dim, among everything else. The data IS
 * delivered (as static files), so that read as "my data did not upload" to
 * anyone who did not skim past it. Neither reading tells an author what they
 * gave up or how to get it back.
 *
 * @param {Array<{name: string, model?: string}>} schemaless
 * @param {{ warn: (m: string) => void, dim: (m: string) => void }} out
 */
export function reportSchemalessQueries(schemaless, out) {
  if (!schemaless?.length) return
  const names = schemaless.map((c) => c.name)
  const label = names.length === 1 ? 'query' : 'queries'
  out.warn(
    `${names.length} ${label} shipping as STATIC FILES, not entities: ${names.join(', ')}`
  )
  out.dim('No queries, no editor, no detail projection — and a republish to change the data.')
  out.dim(
    `Declare a data schema to get entities. Each resolves its schema by subfolder name (${schemaless
      .map((c) => `${c.name} → ${c.model || c.name}`)
      .join(', ')}), or set \`schema:\` on the collection.`
  )
}
