/**
 * npm package fetcher - downloads and extracts templates from npm registry
 */

import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'

/**
 * Fetch a template from npm registry
 *
 * @param {string} packageName - npm package name (e.g., '@uniweb/template-marketing')
 * @param {Object} options - Fetch options
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} { tempDir, version, metadata }
 */
export async function fetchNpmTemplate(packageName, options = {}) {
  const { onProgress } = options

  onProgress?.(`Fetching package info for ${packageName}...`)

  // Query npm registry for package metadata
  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName).replace('%40', '@')}`

  const metaResponse = await fetchWithRetry(registryUrl)
  if (!metaResponse.ok) {
    if (metaResponse.status === 404) {
      throw new Error(`Package not found: ${packageName}`)
    }
    throw new Error(`npm registry error: ${metaResponse.status}`)
  }

  const pkgMeta = await metaResponse.json()
  const version = pkgMeta['dist-tags']?.latest
  if (!version) {
    throw new Error(`No published versions found for ${packageName}`)
  }

  const versionMeta = pkgMeta.versions[version]
  const tarballUrl = versionMeta?.dist?.tarball
  if (!tarballUrl) {
    throw new Error(`No tarball URL found for ${packageName}@${version}`)
  }

  onProgress?.(`Downloading ${packageName}@${version}...`)

  // Download and extract tarball
  const tempDir = await mkdtemp(join(tmpdir(), 'uniweb-template-'))

  try {
    const tarballResponse = await fetchWithRetry(tarballUrl)
    if (!tarballResponse.ok) {
      throw new Error(`Failed to download tarball: ${tarballResponse.status}`)
    }

    await pipeline(
      tarballResponse.body,
      createGunzip(),
      tar.extract({ cwd: tempDir, strip: 1 }) // strip 'package/' prefix
    )

    onProgress?.(`Extracted to ${tempDir}`)

    return {
      tempDir,
      version,
      metadata: versionMeta,
    }
  } catch (err) {
    // Clean up on error
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

/**
 * Fetch with retry and timeout
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30000), // 30s timeout
      })
      return response
    } catch (err) {
      if (attempt === maxRetries) throw err
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}
