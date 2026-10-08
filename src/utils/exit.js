/**
 * Exit once everything this process wrote to stdout and stderr has left it.
 *
 * ⛔ `process.exit()` does not wait for output a pipe has not taken yet. On macOS Node writes
 * to a pipe asynchronously, and an exit drops whatever is still queued: `uniweb site list
 * --json` reached a reading process as half a JSON document, cut at 8192 bytes, and a single
 * 100 000-byte write followed by an exit delivered 65 536 — on stdout and on stderr alike
 * (measured 2026-10-07). Into a terminal or a file, or on Linux, the writes are synchronous
 * and nothing is lost, which is how it went unseen: the reader it bites is a script, `| jq`,
 * or an agent capturing the output.
 *
 * ⭐ An empty write's callback runs once every write before it on that stream has been handed
 * over, so waiting for one per stream is enough.
 *
 * Every exit in `index.js` goes through here — `test/exit-drain.test.js` holds it to that.
 *
 * @param {number} [code]
 * @returns {Promise<never>}
 */
export async function exitWhenDrained(code = 0) {
  await Promise.all([process.stdout, process.stderr].map(drained))
  process.exit(code)
}

function drained(stream) {
  return new Promise((resolve) => {
    if (!stream || stream.destroyed || stream.writableEnded) return resolve()
    stream.write('', () => resolve())
  })
}
