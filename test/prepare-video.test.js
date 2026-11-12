/**
 * prepareVideo: the video half of the rule a push applies to what it uploads. Videos are made here
 * with this machine's ffmpeg, and the tests that need one are skipped where there is none; the
 * blanking that works without ffmpeg is tested on boxes built by hand.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  prepareVideo,
  findVideoTools,
  blankVideoMetadata,
  ceilingFor,
  isPreparableVideo,
  VIDEO_RULE
} from '../src/backend/prepare-video.js'
import { uploadSiteMedia } from '../src/backend/site-media.js'

const tools = await findVideoTools()
const needsFfmpeg = { skip: tools ? false : 'no ffmpeg with libx264 on this machine' }
const sha = (b) => createHash('sha256').update(b).digest('hex')
const WHERE = '+45.4215-075.6972/'

/** A video made with ffmpeg from its test patterns: a picture, a tone, and where it was "taken". */
function makeVideo(dir, name, { size = '640x360', seconds = 1, rate = [], extra = [] } = {}) {
  const path = join(dir, name)
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...rate, '-c:a', 'aac', '-b:a', '96k', ...extra,
    '-metadata', `location=${WHERE}`, '-metadata', `com.apple.quicktime.location.ISO6709=${WHERE}`,
    '-movflags', 'use_metadata_tags', path
  ])
  return path
}

function probe(bytes, dir) {
  const path = join(dir, `probe-${sha(bytes).slice(0, 8)}.mp4`)
  writeFileSync(path, bytes)
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { encoding: 'utf8' }))
}

/** The top-level boxes, in order. */
function topBoxes(bytes) {
  const types = []
  for (let at = 0; at + 8 <= bytes.length; ) {
    const size = bytes.readUInt32BE(at)
    types.push(bytes.toString('latin1', at + 4, at + 8))
    if (size < 8) break
    at += size
  }
  return types
}

test('the rule: which containers, and a ceiling that scales with the frame', () => {
  for (const ext of ['mp4', '.MOV', 'm4v', 'webm']) assert.equal(isPreparableVideo(ext), true)
  for (const ext of ['avi', 'gif', 'mp3']) assert.equal(isPreparableVideo(ext), false)
  assert.equal(ceilingFor(1920, 1080), VIDEO_RULE.ceilingAt1080p)
  assert.equal(Math.round(ceilingFor(1280, 720) / 1e5) / 10, 2.2)
})

test('⭐ a video outside the rule is encoded to it: 1920 at most, H.264 and AAC, no location, its index first', needsFfmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uw-video-'))
  try {
    const path = makeVideo(dir, 'big.mp4', { size: '2560x1440', seconds: 2, rate: ['-b:v', '30M'] })
    const bytes = readFileSync(path)
    assert.ok(bytes.includes(Buffer.from(WHERE)))
    const out = await prepareVideo(path, bytes, 'mp4')
    assert.equal(out.ext, 'mp4')
    assert.equal(out.converted, true)
    assert.ok(!out.bytes.includes(Buffer.from(WHERE)), 'its location is gone')
    const { streams, format } = probe(out.bytes, dir)
    const video = streams.find((s) => s.codec_type === 'video')
    assert.deepEqual([video.codec_name, video.width, video.height, video.pix_fmt], ['h264', 1920, 1080, 'yuv420p'])
    assert.equal(streams.find((s) => s.codec_type === 'audio').codec_name, 'aac')
    assert.ok(Number(video.bit_rate) <= ceilingFor(1920, 1080), `${video.bit_rate} b/s is at or under the ceiling`)
    assert.ok(!JSON.stringify(format.tags || {}).includes('45.4215'))
    assert.ok(topBoxes(out.bytes).indexOf('moov') < topBoxes(out.bytes).indexOf('mdat'), 'the index comes first')
    // The same bytes make the same video, so it has one identity.
    assert.equal(sha((await prepareVideo(path, bytes, 'mp4')).bytes), sha(out.bytes))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⭐ a video within the rule is remuxed only: the same picture, without its location', needsFfmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uw-video-'))
  try {
    const path = makeVideo(dir, 'small.mp4', { rate: ['-b:v', '500k'] })
    const bytes = readFileSync(path)
    const out = await prepareVideo(path, bytes, 'mp4')
    assert.deepEqual([out.ext, out.converted], ['mp4', false])
    assert.ok(!out.bytes.includes(Buffer.from(WHERE)))
    const before = probe(bytes, dir).streams.find((s) => s.codec_type === 'video')
    const after = probe(out.bytes, dir).streams.find((s) => s.codec_type === 'video')
    assert.deepEqual([after.width, after.height, after.nb_frames], [before.width, before.height, before.nb_frames])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a QuickTime file within the rule becomes an MP4, remuxed', needsFfmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uw-video-'))
  try {
    const path = makeVideo(dir, 'clip.mov', { rate: ['-b:v', '500k'] })
    const out = await prepareVideo(path, readFileSync(path), 'mov')
    assert.deepEqual([out.ext, out.converted], ['mp4', false])
    assert.ok(topBoxes(out.bytes).includes('moov'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an HDR video stays as it is, remuxed without its location, and the author is told', needsFfmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uw-video-'))
  try {
    const path = makeVideo(dir, 'hdr.mp4', {
      rate: ['-b:v', '8M'],
      // Tagged as a phone tags HLG, in the stream itself: ffmpeg's -color_trc alone left it unknown.
      extra: ['-x264-params', 'colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc']
    })
    const out = await prepareVideo(path, readFileSync(path), 'mp4')
    assert.deepEqual([out.ext, out.converted], ['mp4', false])
    assert.match(out.note, /is HDR, so it goes up as it is/)
    assert.ok(!out.bytes.includes(Buffer.from(WHERE)))
    const video = probe(out.bytes, dir).streams.find((s) => s.codec_type === 'video')
    assert.equal(video.color_transfer, 'arib-std-b67')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── Without ffmpeg ──────────────────────────────────────────────────────────────────────────────

/** A box: its size, its type and what it holds. */
const boxOf = (type, ...parts) => {
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length + 8, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, body])
}

/** A file's boxes as a phone writes them: its length in `mvhd`, and where it was in `udta` and `meta`. */
function phoneBoxes(seconds, payload = 64) {
  const mvhd = Buffer.alloc(100)
  mvhd.writeUInt32BE(1000, 12) // timescale
  mvhd.writeUInt32BE(seconds * 1000, 16) // duration
  const udta = boxOf('udta', boxOf('©xyz', Buffer.from(`\0\u0012\0\0${WHERE}`, 'latin1')))
  const meta = boxOf('meta', Buffer.from(`com.apple.quicktime.location.ISO6709 ${WHERE}`, 'latin1'))
  const trak = boxOf('trak', boxOf('tkhd', Buffer.alloc(84)), boxOf('meta', Buffer.from(`make PhoneMaker`, 'latin1')))
  return Buffer.concat([
    boxOf('ftyp', Buffer.from('isom\0\0\x02\0isomiso2avc1mp41', 'latin1')),
    boxOf('moov', boxOf('mvhd', mvhd), trak, udta, meta),
    boxOf('mdat', Buffer.alloc(payload, 0x5a))
  ])
}

test('⭐ with no ffmpeg, a video loses its location and camera data in place, and nothing else moves', () => {
  const bytes = phoneBoxes(20)
  const out = blankVideoMetadata(bytes)
  assert.equal(out.bytes.length, bytes.length)
  assert.equal(out.seconds, 20)
  assert.ok(!out.bytes.includes(Buffer.from(WHERE)))
  assert.ok(!out.bytes.includes(Buffer.from('PhoneMaker')))
  // Each metadata box is a `free` box of the same size, and the picture's bytes are untouched.
  assert.deepEqual(topBoxes(out.bytes), ['ftyp', 'moov', 'mdat'])
  assert.ok(out.bytes.subarray(out.bytes.length - 64).equals(bytes.subarray(bytes.length - 64)))
  assert.equal(out.bytes.toString('latin1').split('free').length - 1, 3)
})

test('with no ffmpeg, a heavy video goes up blanked with a note saying how to get ffmpeg; a light one with none', async () => {
  // 20 s of 20 MB is 8 Mbps, over the 1080p ceiling.
  const heavy = await prepareVideo('/nowhere.mp4', phoneBoxes(20, 20_000_000), 'mp4', { tools: null })
  assert.match(heavy.note, /only with ffmpeg installed, with libx264 \(on a Mac: brew install ffmpeg\)/)
  assert.ok(!heavy.bytes.includes(Buffer.from(WHERE)))
  const light = await prepareVideo('/nowhere.mp4', phoneBoxes(20, 1_000_000), 'mp4', { tools: null })
  assert.equal(light.note, undefined)
  assert.ok(!light.bytes.includes(Buffer.from(WHERE)))
})

test('a file that is not boxes is left as it is', () => {
  assert.equal(blankVideoMetadata(Buffer.from('not a video at all')), null)
})

// ── In the push ─────────────────────────────────────────────────────────────────────────────────

test('⭐ a push uploads a page\'s video as it is prepared, recording its source, and a .mov goes up as an MP4', needsFfmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uw-video-site-'))
  mkdirSync(join(dir, 'public', 'videos'), { recursive: true })
  const made = mkdtempSync(join(tmpdir(), 'uw-video-'))
  try {
    const mov = readFileSync(makeVideo(made, 'clip.mov', { rate: ['-b:v', '500k'] }))
    writeFileSync(join(dir, 'public', 'videos', 'clip.mov'), mov)
    const calls = []
    const client = {
      origin: 'http://x',
      uploadSiteAssets: async ({ files }) => {
        calls.push(files)
        return {
          failed: [],
          assetsByLocalUrl: Object.fromEntries(
            files.map((f) => [f.localUrl, { id: f.sha256, ext: f.path.split('.').pop(), serveUrl: `https://cdn/${f.sha256}` }])
          )
        }
      }
    }
    const { ids } = await uploadSiteMedia(client, dir, ['/videos/clip.mov'])
    const [sent] = calls[0]
    assert.equal(sent.path, 'videos/clip.mov.mp4')
    assert.equal(sent.content_type, 'video/mp4')
    assert.ok(!sent.bytes.includes(Buffer.from(WHERE)))
    assert.deepEqual(
      { ext: ids['/videos/clip.mov'].ext, source: ids['/videos/clip.mov'].source, size: ids['/videos/clip.mov'].size },
      { ext: 'mp4', source: sha(mov), size: sent.bytes.length }
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(made, { recursive: true, force: true })
  }
})
