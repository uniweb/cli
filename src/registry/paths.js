/**
 * Path resolution for the .unicloud/ local registry directory.
 */

import { join } from 'node:path'
import { findWorkspaceRoot } from '../utils/workspace.js'
import { homedir } from 'node:os'

/**
 * Get the .unicloud directory path.
 * Prefers workspace root; falls back to ~/.unicloud.
 */
export function getUnicloudDir(startDir = process.cwd()) {
  const root = findWorkspaceRoot(startDir)
  return root ? join(root, '.unicloud') : join(homedir(), '.unicloud')
}

/**
 * Get the auth.json path.
 */
export function getAuthPath(startDir) {
  return join(getUnicloudDir(startDir), 'auth.json')
}

/**
 * Get the registry directory path.
 */
export function getRegistryDir(startDir) {
  return join(getUnicloudDir(startDir), 'registry')
}

/**
 * Sanitize a package name for filesystem use.
 * '@org/pkg' → '@org__pkg'
 */
export function sanitizeName(name) {
  return name.replace(/\//g, '__')
}
