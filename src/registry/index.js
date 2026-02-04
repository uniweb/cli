/**
 * Registry factory.
 * Returns a LocalRegistry for now. Later swaps to CloudRegistry based on config.
 */

import { LocalRegistry } from './local.js'

export function createRegistry(startDir) {
  return new LocalRegistry(startDir)
}
