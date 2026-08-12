/**
 * Minimal `.uwx` reader — for the commands that run BEFORE a project exists.
 *
 * ## Why this exists rather than importing the real one
 *
 * Every other `.uwx` reader in the CLI (`pull.js`, `site-sync.js`, `content.js`)
 * imports `readZip` from `@uniweb/build/uwx`. That is correct for them: they run
 * *inside* a project, where `@uniweb/build` resolves from the project's own
 * `node_modules`.
 *
 * **`@uniweb/build` is not a dependency of this package** (see `package.json`),
 * so a command that runs where no project exists cannot reach it — statically or
 * dynamically. `uniweb clone` is exactly that command: its whole job is to turn a
 * backend site into a local project that does not exist yet.
 *
 * So this is a deliberate second implementation, kept minimal and dependency-free
 * (`node:zlib` is a builtin), the same way `clone.js` keeps its own
 * `extractDocument` for the same reason. **Do not import this from a command that
 * runs inside a project** — use `@uniweb/build/uwx`'s `readZip` there, so the
 * producer and the consumer of a `.uwx` stay one implementation wherever they can.
 *
 * ## Two things measured on a real payload, both of which would break a naive reader
 *
 * 1. ⛔ **The archive is NOT "stored".** `pull.js` describes the format as *"our
 *    Stored ZIP"*, and that is true of `manifest.json` and false of the entity
 *    files — measured on a live pull: `manifest.json` method 0 (STORED), the
 *    entity JSON method 8 (DEFLATED). A stored-only reader silently yields the
 *    manifest and drops the document, i.e. it returns success and no entities.
 *    **Both methods are handled below and the tests cover a mixed archive.**
 * 2. The entity payload is the *only* thing wanted; `manifest.json` is skipped, as
 *    every other reader in the tree does.
 *
 * We read the **central directory** rather than walking local file headers,
 * because a local header may carry zeroed sizes when the general-purpose bit 3
 * flag defers them to a trailing data descriptor. The central directory always
 * carries the real sizes.
 */

import { inflateRawSync } from 'node:zlib'

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const METHOD_STORED = 0
const METHOD_DEFLATED = 8

/** ZIP local-file-header magic, "PK\x03\x04" — the first two bytes are enough. */
export function looksLikeZip(buf) {
  return Boolean(buf) && buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b
}

/**
 * Locate the end-of-central-directory record.
 *
 * Scanned backwards because the record is last and variable-length (it carries an
 * optional trailing comment).
 *
 * @param {Buffer} buf
 * @returns {number} offset of the EOCD, or -1
 */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  return -1
}

/**
 * Read every entry out of a ZIP as `[name, Buffer]` pairs.
 *
 * @param {Buffer} buf
 * @returns {Array<[string, Buffer]>} empty when the buffer is not a readable ZIP
 */
export function readUwxZip(buf) {
  if (!looksLikeZip(buf)) return []
  const eocd = findEocd(buf)
  if (eocd < 0) return []

  const count = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16)
  const out = []

  for (let i = 0; i < count; i++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== SIG_CENTRAL) break

    const method = buf.readUInt16LE(ptr + 10)
    const csize = buf.readUInt32LE(ptr + 20)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOff = buf.readUInt32LE(ptr + 42)
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8')

    // The local header's name/extra lengths are independent of the central
    // directory's — read them where the data actually starts, not from above.
    if (localOff + 30 <= buf.length && buf.readUInt32LE(localOff) === SIG_LOCAL) {
      const lNameLen = buf.readUInt16LE(localOff + 26)
      const lExtraLen = buf.readUInt16LE(localOff + 28)
      const start = localOff + 30 + lNameLen + lExtraLen
      const raw = buf.subarray(start, start + csize)
      try {
        if (method === METHOD_STORED) out.push([name, Buffer.from(raw)])
        else if (method === METHOD_DEFLATED) out.push([name, inflateRawSync(raw)])
        // any other method: skip rather than guess
      } catch {
        /* a corrupt entry must not lose the readable ones */
      }
    }

    ptr += 46 + nameLen + extraLen + commentLen
  }

  return out
}

/**
 * The entity `$`-documents inside a `.uwx`, or a JSON body's documents.
 *
 * Mirrors `pull.js`'s `readPullDocuments` in behaviour — including its JSON
 * fallback, so a future envelope change does not break this lane either — but
 * without the `@uniweb/build` import. See the header for why that matters.
 *
 * @param {Buffer} buf
 * @returns {object[]} parsed documents, possibly empty
 */
export function readUwxDocuments(buf) {
  if (!buf || buf.length === 0) return []

  if (looksLikeZip(buf)) {
    const docs = []
    for (const [name, data] of readUwxZip(buf)) {
      if (name === 'manifest.json' || !name.endsWith('.json')) continue
      try {
        docs.push(JSON.parse(data.toString('utf8')))
      } catch {
        /* skip a non-document entry */
      }
    }
    return docs
  }

  let payload
  try {
    payload = JSON.parse(buf.toString('utf8'))
  } catch {
    return []
  }
  if (Array.isArray(payload)) return payload.filter(Boolean)
  const list = Array.isArray(payload?.entities)
    ? payload.entities
    : Array.isArray(payload?.documents)
      ? payload.documents
      : null
  if (list) return list.filter(Boolean)
  return payload ? [payload] : []
}
