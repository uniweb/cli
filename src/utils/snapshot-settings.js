/**
 * `site/snapshot.yml` — how `uniweb snapshot` composes a site's preview image,
 * kept with the site so the next run reproduces the same look.
 *
 * It is the command's defaults for this site, and flags override it. Nothing else
 * reads it: the build, `push` and `pull` all leave a site's root files alone
 * unless they name them.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import yaml from 'js-yaml'

import { didYouMean } from './args.js'

export const SETTINGS_FILE = 'snapshot.yml'

/** In the order they are written. */
export const SETTING_KEYS = [
  'route',
  'layout',
  'tone',
  'gap',
  'overlap',
  'strip',
  'side',
  'frame',
  'size',
  'scale',
  'quality',
  'hide',
  'out'
]

const HEADER = [
  '# How `uniweb snapshot` composes this site\'s preview image.',
  '# Flags override these; `uniweb snapshot <flags> --save` writes them here.',
  ''
].join('\n')

export class SettingsError extends Error {}

/**
 * The settings in `<siteDir>/snapshot.yml`, or `{}` when there is none. `out` comes
 * back absolute, resolved against the site folder.
 */
export function readSnapshotSettings(siteDir) {
  const file = join(siteDir, SETTINGS_FILE)
  if (!existsSync(file)) return { file, settings: {} }

  let data
  try {
    data = yaml.load(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new SettingsError(`${SETTINGS_FILE} is not valid YAML: ${err.message.split('\n')[0]}`)
  }
  if (data === undefined || data === null) return { file, settings: {} }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new SettingsError(`${SETTINGS_FILE} should be a list of settings, like \`gap: 48\`.`)
  }

  const settings = {}
  for (const [key, value] of Object.entries(data)) {
    if (!SETTING_KEYS.includes(key)) {
      const suggestion = didYouMean(key, SETTING_KEYS)
      throw new SettingsError(
        `${SETTINGS_FILE} has an unknown setting \`${key}\`.` + (suggestion ? ` Did you mean \`${suggestion}\`?` : '')
      )
    }
    if (value === null || value === undefined) continue
    if (key === 'hide') settings.hide = Array.isArray(value) ? value.map(String) : [String(value)]
    else if (key === 'out') settings.out = resolve(siteDir, String(value))
    else settings[key] = value
  }
  return { file, settings }
}

/** Flags over the file. A gap or an overlap from the flags replaces either from the file. */
export function mergeSettings(fromFile = {}, fromFlags = {}) {
  const merged = { ...fromFile }
  if (fromFlags.gap !== undefined || fromFlags.overlap !== undefined) {
    delete merged.gap
    delete merged.overlap
  }
  for (const [key, value] of Object.entries(fromFlags)) {
    if (value !== undefined) merged[key] = value
  }
  return merged
}

/**
 * Write the flags of this run into `<siteDir>/snapshot.yml`, over what it already
 * holds. The file is rewritten in full, in `SETTING_KEYS` order, under a header.
 *
 * @returns {{ file: string, saved: string[] }} the keys this run set
 */
export function saveSnapshotSettings(siteDir, fromFlags, fromFile = readSnapshotSettings(siteDir).settings) {
  const file = join(siteDir, SETTINGS_FILE)
  const merged = mergeSettings(fromFile, fromFlags)
  const ordered = {}
  for (const key of SETTING_KEYS) {
    if (merged[key] === undefined) continue
    ordered[key] = key === 'out' ? toSitePath(siteDir, merged.out) : merged[key]
  }
  writeFileSync(file, HEADER + yaml.dump(ordered, { lineWidth: -1 }))
  return { file, saved: SETTING_KEYS.filter((key) => fromFlags[key] !== undefined) }
}

function toSitePath(siteDir, path) {
  const rel = relative(siteDir, path)
  return isAbsolute(rel) ? path : rel.split(sep).join('/')
}
