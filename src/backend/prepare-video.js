/**
 * A VIDEO MADE READY BEFORE IT IS UPLOADED — the video half of the rule a push applies to what it
 * uploads, which only a client applies, since a host converts no video:
 *
 * 1. **H.264 at CRF 23**, 8-bit 4:2:0, with AAC-LC at 128 kbps in stereo, in an MP4 whose index comes
 *    first, so a page can start playing it before it has all of it.
 * 2. **A long edge of at most 1920**, never enlarged, with a phone's rotation applied to the pixels.
 * 3. **A bitrate ceiling** of 5 Mbps at 1080p, scaled by the frame's size (about 2.2 Mbps at 720p). An
 *    encode that comes out over it is made again at the ceiling.
 * 4. **Location and camera data are dropped**, as from a picture.
 * 5. **A video already within the rule** (H.264 with AAC or no sound, at most 1920 on its long edge, at
 *    or under the ceiling) is remuxed only: into an MP4, without its private data, its index first.
 * 6. **An HDR video** (HLG, PQ or Dolby Vision) is remuxed in its own container and kept as it is,
 *    with a note. Making one SDR needs tone mapping, and no chain for it is measured here yet.
 * 7. **With no `ffmpeg` that has `libx264`**, an MP4 or QuickTime file still loses its location and
 *    camera data: its metadata boxes are blanked in place, so nothing else in it moves
 *    (`blankVideoMetadata`). It goes up otherwise as it is, with a note when it is heavy.
 *
 * The quality target repeats byte for byte, and so does an encode at the ceiling, so a prepared video
 * has one identity wherever the same `ffmpeg` makes it. A cap during the encode (`-maxrate`) did not
 * repeat with more than one thread (measured with Homebrew's ffmpeg 8.1, 2026-11-12).
 *
 * `ffmpeg` and `ffprobe` run with their output captured, never handed ours, so a reader that leaves
 * can't stop them (`utils/closed-reader.js`).
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The rule's numbers. */
export const VIDEO_RULE = Object.freeze({
  crf: 23,
  longEdge: 1920,
  /** Bits a second at 1920×1080; the ceiling scales with the frame's area. */
  ceilingAt1080p: 5_000_000,
  audioBitrate: '128k',
})

/** Containers the rule prepares, by extension. */
const PREPARED = new Set(['mp4', 'm4v', 'mov', 'webm'])

/** Containers whose metadata boxes can be blanked in place. */
const BOXED = new Set(['mp4', 'm4v', 'mov'])

const extOf = (ext) => String(ext || '').toLowerCase().replace(/^\./, '')

/**
 * Whether the rule prepares a video with this extension.
 *
 * @param {string} ext - `mp4`, `.mov` or `MP4`
 * @returns {boolean}
 */
export function isPreparableVideo(ext) {
  return PREPARED.has(extOf(ext))
}

/** The ceiling for a frame of this size, in bits a second. */
export function ceilingFor(width, height) {
  return Math.round((VIDEO_RULE.ceilingAt1080p * width * height) / (1920 * 1080))
}

/** The frame a video is encoded to: at most `longEdge` on its long edge, its sides even. */
function encodedSize(width, height) {
  const scale = Math.min(1, VIDEO_RULE.longEdge / Math.max(width, height))
  if (scale === 1) return [width, height]
  const even = (n) => Math.max(2, Math.round((n * scale) / 2) * 2)
  return [even(width), even(height)]
}

let tools // undefined: not looked for yet; null: none here

/**
 * The `ffmpeg` and `ffprobe` this machine has, when its `ffmpeg` has `libx264` and `aac`. Some Linux
 * packages leave `libx264` out, and such a build counts as none. Looked for once.
 *
 * @returns {Promise<{ ffmpeg: string, ffprobe: string } | null>}
 */
export async function findVideoTools() {
  if (tools !== undefined) return tools
  try {
    const { stdout } = await run('ffmpeg', ['-hide_banner', '-encoders'], { maxBuffer: 4 << 20 })
    await run('ffprobe', ['-version'])
    tools = / libx264 /.test(stdout) && / aac /.test(stdout) ? { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' } : null
  } catch {
    tools = null
  }
  return tools
}

/** What `ffprobe` says of a file: its first video stream, its first audio stream and its format. */
async function probe(ffprobe, path) {
  const { stdout } = await run(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { maxBuffer: 16 << 20 }
  )
  const info = JSON.parse(stdout)
  const streams = info.streams || []
  return {
    video: streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic),
    audio: streams.find((s) => s.codec_type === 'audio'),
    format: info.format || {},
  }
}

const HDR_TRANSFERS = new Set(['arib-std-b67', 'smpte2084'])

function isHdr(video) {
  if (HDR_TRANSFERS.has(video.color_transfer)) return true
  return (video.side_data_list || []).some((d) => /DOVI/i.test(d.side_data_type || ''))
}

/** A stream's bitrate, or the format's less the sound's when the stream states none. */
function videoBitrate({ video, audio, format }) {
  const own = Number(video.bit_rate)
  if (own > 0) return own
  return Math.max(0, (Number(format.bit_rate) || 0) - (Number(audio?.bit_rate) || 0))
}

/** Whether a probed video is within the rule, its container apart. */
function withinRule(probed) {
  const { video, audio } = probed
  const width = Number(video.width)
  const height = Number(video.height)
  return (
    video.codec_name === 'h264' &&
    (video.pix_fmt === 'yuv420p' || video.pix_fmt === 'yuvj420p') &&
    (!audio || audio.codec_name === 'aac') &&
    Math.max(width, height) <= VIDEO_RULE.longEdge &&
    videoBitrate(probed) <= ceilingFor(width, height)
  )
}

const QUIET = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y']
// Only the picture and the sound go, without the file's metadata, chapters or other tracks, and with
// no encoder version written, so the same input gives the same bytes.
const KEEP = ['-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1']
const FINISH = ['-movflags', '+faststart', '-fflags', '+bitexact']

// WebM has no index to move first.
const remux = (input, output, { webm = false } = {}) => [
  ...QUIET, '-i', input, ...KEEP, '-c', 'copy', ...(webm ? ['-fflags', '+bitexact'] : FINISH), output,
]

function encode(input, output, rate) {
  const edge = VIDEO_RULE.longEdge
  const fit = `scale=w=if(gte(iw\\,ih)\\,min(${edge}\\,iw)\\,-2):h=if(gte(iw\\,ih)\\,-2\\,min(${edge}\\,ih)),format=yuv420p`
  return [
    ...QUIET, '-i', input, ...KEEP,
    '-vf', fit,
    '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', ...rate,
    '-c:a', 'aac', '-b:a', VIDEO_RULE.audioBitrate, '-ac', '2',
    ...FINISH, output,
  ]
}

/**
 * Prepare a video under the rule.
 *
 * @param {string} path - the file on disk, which `ffmpeg` reads
 * @param {Buffer} bytes - the same file, for when there is no `ffmpeg`
 * @param {string} ext - its extension
 * @param {{ tools?: { ffmpeg: string, ffprobe: string } | null, onProgress?: (m: string) => void }} [options]
 *   `tools`: what `findVideoTools` found, or `null` to prepare without them
 * @returns {Promise<{ bytes: Buffer, ext: string, converted: boolean, note?: string }>} `converted`:
 *   encoded again. `note`: what to tell the author.
 */
export async function prepareVideo(path, bytes, ext, { tools: found, onProgress } = {}) {
  const kind = extOf(ext)
  const available = found === undefined ? await findVideoTools() : found
  if (!available) return withoutTools(bytes, kind)

  let probed
  try {
    probed = await probe(available.ffprobe, path)
  } catch {
    return { ...withoutTools(bytes, kind), note: "is uploaded as it is: ffmpeg couldn't read it, so check that it plays." }
  }
  // Sound alone: nothing to encode, and its metadata blanked where its container allows.
  if (!probed.video) return { bytes: (BOXED.has(kind) && blankVideoMetadata(bytes)?.bytes) || bytes, ext: kind, converted: false }

  const dir = await mkdtemp(join(tmpdir(), 'uniweb-video-'))
  try {
    if (isHdr(probed.video)) {
      const out = join(dir, `remuxed.${kind}`)
      await run(available.ffmpeg, remux(path, out, { webm: kind === 'webm' }))
      return {
        bytes: await readFile(out),
        ext: kind,
        converted: false,
        note: "is HDR, so it goes up as it is: it can't be made SDR here. Export it as SDR (HD or 1080p) for a smaller file most browsers play.",
      }
    }
    const out = join(dir, 'prepared.mp4')
    if (withinRule(probed)) {
      await run(available.ffmpeg, remux(path, out))
      return { bytes: await readFile(out), ext: 'mp4', converted: false }
    }
    onProgress?.('making a video smaller…')
    await run(available.ffmpeg, encode(path, out, ['-crf', String(VIDEO_RULE.crf)]), { maxBuffer: 4 << 20 })
    const [width, height] = encodedSize(Number(probed.video.width), Number(probed.video.height))
    const ceiling = ceilingFor(width, height)
    const made = await probe(available.ffprobe, out)
    if (videoBitrate(made) > ceiling) {
      await run(available.ffmpeg, encode(path, out, ['-b:v', String(ceiling)]), { maxBuffer: 4 << 20 })
    }
    return { bytes: await readFile(out), ext: 'mp4', converted: true }
  } catch {
    return { ...withoutTools(bytes, kind), note: "is uploaded as it is: ffmpeg couldn't convert it, so check that it plays." }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Without `ffmpeg`: blanked in place where its container allows, and a note when it is heavy. */
function withoutTools(bytes, kind) {
  const blanked = BOXED.has(kind) ? blankVideoMetadata(bytes) : null
  const seconds = blanked?.seconds
  const heavy = seconds > 0 ? (bytes.length * 8) / seconds > VIDEO_RULE.ceilingAt1080p : !blanked
  return {
    bytes: blanked?.bytes ?? bytes,
    ext: kind,
    converted: false,
    ...(heavy
      ? { note: "is uploaded as it is: a push makes a video smaller only with ffmpeg installed, with libx264 (on a Mac: brew install ffmpeg)." }
      : {}),
  }
}

/**
 * An MP4 or QuickTime file without its location and camera data, nothing else in it moved. The
 * metadata boxes in `moov` and in each `trak` (`udta`, `meta`) become `free` boxes with their bytes
 * zeroed, so no size or offset changes and every player skips them. A timed metadata track's samples
 * are not reached, which a remux with `ffmpeg` drops.
 *
 * @param {Buffer} bytes
 * @returns {{ bytes: Buffer, seconds?: number } | null} null when the file doesn't parse as boxes.
 *   `seconds`: its duration, from `mvhd`.
 */
export function blankVideoMetadata(bytes) {
  const out = Buffer.from(bytes)
  let seconds
  const box = (at, end) => {
    if (at + 8 > end) return null
    let size = out.readUInt32BE(at)
    let head = 8
    if (size === 1) {
      if (at + 16 > end) return null
      size = Number(out.readBigUInt64BE(at + 8))
      head = 16
    } else if (size === 0) size = end - at
    if (size < head || at + size > end) return null
    return { type: out.toString('latin1', at + 4, at + 8), start: at + head, end: at + size }
  }
  const walk = (from, end, parent) => {
    for (let at = from; at < end; ) {
      const b = box(at, end)
      if (!b) return false
      if ((parent === 'moov' || parent === 'trak') && (b.type === 'udta' || b.type === 'meta')) {
        out.write('free', at + 4, 'latin1')
        out.fill(0, b.start, b.end)
      } else if (b.type === 'moov' || b.type === 'trak') {
        if (!walk(b.start, b.end, b.type)) return false
      } else if (b.type === 'mvhd' && parent === 'moov') {
        const v1 = out[b.start] === 1
        const scale = out.readUInt32BE(b.start + (v1 ? 20 : 12))
        const length = v1 ? Number(out.readBigUInt64BE(b.start + 24)) : out.readUInt32BE(b.start + 16)
        if (scale > 0) seconds = length / scale
      }
      at = b.end
    }
    return true
  }
  if (out.length < 8 || !walk(0, out.length, null)) return null
  return { bytes: out, ...(seconds ? { seconds } : {}) }
}
