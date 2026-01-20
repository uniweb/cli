/**
 * Generate Foundation Entry Point
 *
 * This script is called during postinstall to ensure the foundation
 * entry point exists before the site dev server starts.
 */

import { generateEntryPoint } from '@uniweb/build'

try {
  await generateEntryPoint('./src', './src/_entry.generated.js')
} catch (err) {
  // Silently fail during initial install if dependencies aren't ready
  console.warn('Note: Entry generation skipped (run foundation dev/build to generate)')
}
