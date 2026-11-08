/**
 * ⭐ ONE NAME IN A SCOPE IS ONE TYPE (`@uniweb/build`'s `typesDefinedTwice`, which says why): the data
 * schema names the workspace's packages of one scope each define — its foundations, extensions and
 * schemas packages — for `uniweb register` to refuse a definition that differs, and `uniweb doctor` to
 * name every one defined twice.
 */

import { join } from 'node:path'
import { classifyPackage, isSchemasPackage, typesDefinedTwice } from '@uniweb/build'
import { workspacePackages } from './workspace-packages.js'

/**
 * The names of one scope two packages of the workspace define.
 *
 * @param {string} workspaceDir
 * @param {{ dir: string, kind: 'foundation'|'schemas', scope: string }} [self] - a package whose scope
 *   was just settled, which its own files may not say yet (`register`)
 * @returns {Promise<{ ref: string, files: string[], differ: boolean }[]>}
 */
export async function workspaceTypesDefinedTwice(workspaceDir, self = null) {
  const packages = []
  for (const rel of workspacePackages(workspaceDir)) {
    const dir = join(workspaceDir, rel)
    const kind = classifyPackage(dir) === 'foundation' ? 'foundation' : isSchemasPackage(dir) ? 'schemas' : null
    if (kind) packages.push({ dir, kind })
  }
  if (self) packages.unshift(self)
  return typesDefinedTwice(packages)
}
