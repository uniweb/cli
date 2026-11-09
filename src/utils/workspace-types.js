/**
 * The data schema names two packages of the workspace each define under one scope — its foundations,
 * extensions and schemas packages — for `uniweb doctor` to recommend one definition, named in full
 * elsewhere (`@uniweb/build`'s `typesDefinedTwice`, which says why).
 */

import { join } from 'node:path'
import { classifyPackage, isSchemasPackage, typesDefinedTwice } from '@uniweb/build'
import { workspacePackages } from './workspace-packages.js'

/**
 * The names of one scope two packages of the workspace define.
 *
 * @param {string} workspaceDir
 * @returns {Promise<{ ref: string, files: string[], differ: boolean }[]>}
 */
export async function workspaceTypesDefinedTwice(workspaceDir) {
  const packages = []
  for (const rel of workspacePackages(workspaceDir)) {
    const dir = join(workspaceDir, rel)
    const kind = classifyPackage(dir) === 'foundation' ? 'foundation' : isSchemasPackage(dir) ? 'schemas' : null
    if (kind) packages.push({ dir, kind })
  }
  return typesDefinedTwice(packages)
}
