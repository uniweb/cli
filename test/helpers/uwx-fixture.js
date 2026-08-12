/**
 * Build a real `.uwx` archive for tests.
 *
 * Shared because two suites need it and both need it to be *honest*: the pull
 * lane serves `application/vnd.uniweb.exchange.entity+zip`, and a fixture that
 * hands back JSON instead is how a JSON-parsing bug shipped with a green test
 * in front of it. A fixture is a claim about the contract; this one is built to
 * match the bytes measured off a live pull, including that entity members are
 * DEFLATED while `manifest.json` is STORED.
 */

import { deflateRawSync, crc32 } from 'node:zlib'

/**
 * @param {Array<{name: string, body: string, deflate?: boolean}>} entries
 * @returns {Buffer} a ZIP with a per-entry compression method
 */
export function makeZip(entries) {
  const locals = []
  const central = []
  let offset = 0

  for (const { name, body, deflate } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const raw = Buffer.from(body, 'utf8')
    const data = deflate ? deflateRawSync(raw) : raw
    const method = deflate ? 8 : 0
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(raw.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBuf)

    offset += local.length + nameBuf.length + data.length
  }

  const localPart = Buffer.concat(locals)
  const centralPart = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralPart.length, 12)
  eocd.writeUInt32LE(localPart.length, 16)

  return Buffer.concat([localPart, centralPart, eocd])
}

/**
 * A `.uwx` carrying one entity document, shaped like a real pull response.
 *
 * @param {object} doc
 * @returns {Buffer}
 */
export function makeUwx(doc) {
  return makeZip([
    { name: 'manifest.json', body: JSON.stringify({ version: 1 }), deflate: false },
    { name: `entities/${doc.$uuid || 'entity'}.json`, body: JSON.stringify(doc), deflate: true }
  ])
}
