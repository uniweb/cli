/**
 * The @uniweb packages a workspace's lockfile holds, and the command that moves each one to the
 * newest version its range allows.
 *
 * ⭐ WHY `update` LIFTS THEM. `update` aligns what the workspace's package.json files declare, and
 * its install keeps every other locked version that still meets its range. So a patch to a package
 * a project reaches only through another never arrived in an existing project, though a new project
 * got it at once. Measured 2026-11-10, twice: semantic-parser 1.13.3 stayed 1.13.2, because core
 * 1.6.12's `~1.13.2` is met by the locked 1.13.2, and runtime 1.5.7 stayed 1.5.6 behind the peer pnpm
 * had installed for a root by itself. Lifted, an existing project's @uniweb packages resolve as a
 * new project's would.
 *
 * ⭐ WITH PNPM IT IS `pnpm dedupe`: it drops each older version the lockfile holds where a newer one
 * its range allows is installed, which is the case `update` leaves (its install brings the new version
 * through the packages it aligned, and keeps the old one beside it), and it leaves every other
 * resolution as it was. ⛔ Until 2026-11-11 (uniweb 1.32.0) it was `pnpm update <names> -r`, which
 * resolves every dependency of every workspace package again: a local foundation or library a
 * project takes as `file:`, whose package.json declares a peer its dependent doesn't have, came back
 * as an installed copy instead of a link, so `uniweb dev` imported the copy and never saw an edit
 * (the build says the foundation "resolves to two different directories"). Measured that day on six
 * studio projects and on a library four packages of one workspace take. In those projects `dedupe`
 * moved @uniweb versions only, but it may drop an older copy of any package the same way.
 *
 * ⛔ A package manager may also write a newer version into a range a package.json declares (pnpm's
 * `update` did: `~1.20.9` became `~1.20.10`). The caller puts those files back as `update` aligned
 * them and installs again, which keeps the newer version, since it meets the range.
 *
 * yarn is left as it is: classic yarn and berry spell this differently (`yarn upgrade`, `yarn up -R`).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

const LOCKFILES = { pnpm: 'pnpm-lock.yaml', npm: 'package-lock.json' }

/** A name that is the framework's, and not the CLI itself, which `update` aligns to the running one. */
const isUniwebPackage = (name) => typeof name === 'string' && name.startsWith('@uniweb/')

/**
 * Each @uniweb package a lockfile holds, with every version it holds of it.
 *
 * @param {string} workspaceDir
 * @param {'pnpm'|'npm'|'yarn'|null} pm
 * @returns {Map<string, string[]>|null} name → versions, sorted; null when this package manager's
 *   lockfile isn't there, can't be read, or isn't one this reads (yarn)
 */
export function lockedUniwebPackages(workspaceDir, pm) {
  const file = LOCKFILES[pm]
  if (!file) return null
  return readPackages(join(workspaceDir, file), pm, isUniwebPackage)
}

// What a package manager records of its last install, inside node_modules: pnpm a copy of the
// lockfile it installed from, npm its hidden lockfile. Each reads as the lockfile does.
const INSTALLED = { pnpm: 'node_modules/.pnpm/lock.yaml', npm: 'node_modules/.package-lock.json' }

// The framework's packages: the CLI (`uniweb`) and each `@uniweb/*`.
const isFrameworkPackage = (name) => name === 'uniweb' || isUniwebPackage(name)

/**
 * The framework's packages whose versions in the lockfile are not the ones the last install put in
 * node_modules, as the package manager records that install.
 *
 * ⭐ A `git pull` that brings a teammate's `uniweb update` moves package.json and the lockfile, and
 * leaves node_modules as it was, so the project goes on running the CLI and the packages it had.
 * `update` then finds the declared versions aligned, and it has to install all the same.
 *
 * @param {string} workspaceDir
 * @param {'pnpm'|'npm'|'yarn'|null} pm
 * @returns {Array<{ name: string, locked: string[], installed: string[] }>|null} each package that
 *   differs; [] when they agree; null when either side can't be read (nothing installed yet, yarn)
 */
export function installBehindLockfile(workspaceDir, pm) {
  const file = LOCKFILES[pm]
  if (!file || !INSTALLED[pm]) return null
  const locked = readPackages(join(workspaceDir, file), pm, isFrameworkPackage)
  const installed = readPackages(join(workspaceDir, INSTALLED[pm]), pm, isFrameworkPackage)
  if (!locked || !installed) return null
  return [...new Set([...locked.keys(), ...installed.keys()])]
    .sort()
    .map((name) => ({ name, locked: locked.get(name) || [], installed: installed.get(name) || [] }))
    .filter(({ locked, installed }) => locked.join() !== installed.join())
}

function readPackages(path, pm, keep) {
  if (!existsSync(path)) return null
  try {
    const text = readFileSync(path, 'utf8')
    return pm === 'pnpm' ? fromPnpmLock(yaml.load(text), keep) : fromNpmLock(JSON.parse(text), keep)
  } catch {
    return null
  }
}

/** `packages:` keys: `'@uniweb/core@1.6.12'` (v9), `/@uniweb/core@1.6.12(react@19.0.0)` (v6). */
function fromPnpmLock(lock, keep) {
  const found = new Map()
  for (const key of Object.keys(lock?.packages || {})) {
    const id = key.replace(/^\//, '').replace(/\(.*$/, '')
    const at = id.lastIndexOf('@')
    if (at <= 0) continue
    add(found, id.slice(0, at), id.slice(at + 1), keep)
  }
  return sorted(found)
}

/** `packages:` keys: `node_modules/@uniweb/core`, `node_modules/x/node_modules/@uniweb/core`. */
function fromNpmLock(lock, keep) {
  const found = new Map()
  for (const [key, entry] of Object.entries(lock?.packages || {})) {
    const at = key.lastIndexOf('node_modules/')
    if (at < 0 || entry?.link || !entry?.version) continue
    add(found, key.slice(at + 'node_modules/'.length), entry.version, keep)
  }
  return sorted(found)
}

function add(found, name, version, keep) {
  if (!keep(name) || !version) return
  if (!found.has(name)) found.set(name, new Set())
  found.get(name).add(version)
}

function sorted(found) {
  return new Map([...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, versions]) => [name, [...versions].sort()]))
}

/**
 * The command that moves each named package, wherever the workspace holds it, to the newest version
 * its range allows. Never `--latest`: a range is the project's promise. With pnpm it names none:
 * `dedupe` reads the lockfile whole (the header says why it is not `update -r`).
 *
 * @param {'pnpm'|'npm'} pm
 * @param {string[]} names
 * @returns {string|null} null for a package manager this doesn't lift with, or no names
 */
export function liftCommand(pm, names) {
  if (!names.length) return null
  if (pm === 'pnpm') return 'pnpm dedupe'
  if (pm === 'npm') return `npm update ${names.join(' ')}`
  return null
}

/**
 * What a lift moved: each package whose versions differ between two readings of the lockfile.
 *
 * @param {Map<string, string[]>} before
 * @param {Map<string, string[]>} after
 * @returns {Array<{ name: string, from: string[], to: string[] }>}
 */
export function liftMoves(before, after) {
  const moves = []
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const from = before.get(name) || []
    const to = after.get(name) || []
    if (from.join() !== to.join()) moves.push({ name, from, to })
  }
  return moves.sort((a, b) => a.name.localeCompare(b.name))
}
