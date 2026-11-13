/**
 * `uniweb doctor` — whether a push can make the site's videos smaller. A push prepares a video with
 * this machine's ffmpeg when it has libx264, and the CLI ships no encoder, so doctor says so where a
 * site has videos and there is none.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkVideoTools } from '../src/commands/doctor.js'

function site(files) {
  const dir = mkdtempSync(join(tmpdir(), 'uw-doctor-video-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

const FFMPEG = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }

test('⭐ a site with videos and no ffmpeg is told a push uploads them as they are, and how to get one', async () => {
  const dir = site({
    'pages/home/1-tour.md': '# Tour\n\n![A tour](/videos/tour.mp4){role=video}\n\n![A clip](./clip.mov){role=video poster=./clip.jpg}\n',
    'records/events/launch.yml': 'title: Launch\nvideo: /videos/launch.webm\n'
  })
  try {
    const issues = []
    await checkVideoTools({ sitePath: dir, siteName: 'site', issues, tools: null })
    assert.equal(issues.length, 1)
    assert.equal(issues[0].id, 'video-encoder-none')
    assert.equal(issues[0].type, 'info')
    assert.match(issues[0].message, /A push uploads this site's 3 videos as they are: this machine has no ffmpeg with libx264/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('nothing is said where ffmpeg is there, or where the site has no video of its own', async () => {
  const withVideo = site({ 'pages/home/1-tour.md': '![A tour](/videos/tour.mp4){role=video}\n' })
  const external = site({ 'pages/home/1-tour.md': '![A tour](https://example.com/tour.mp4){role=video}\n' })
  try {
    const issues = []
    await checkVideoTools({ sitePath: withVideo, siteName: 'a', issues, tools: FFMPEG })
    await checkVideoTools({ sitePath: external, siteName: 'b', issues, tools: null })
    assert.deepEqual(issues, [])
  } finally {
    rmSync(withVideo, { recursive: true, force: true })
    rmSync(external, { recursive: true, force: true })
  }
})
