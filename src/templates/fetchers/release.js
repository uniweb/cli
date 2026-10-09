/**
 * Release fetcher — downloads an official template from the release of the
 * templates repo this CLI was published with.
 *
 * ⭐ ONE REQUEST, AND NOT TO GITHUB'S API. The release is pinned
 * (templates/resolver.js, OFFICIAL_TEMPLATES_RELEASE) and a release's files sit
 * at fixed URLs, so the template's tarball is downloaded from its release URL
 * directly. The name was checked against this CLI's own roster before anything
 * is fetched, and a tarball the release lacks answers 404.
 *
 * ⛔ Until 2026-10-08 a `create` first asked the REST API for the release, to find
 * its manifest.json, then downloaded the manifest to check the name, then the
 * tarball: three requests, the first counted against the API's anonymous limit of
 * 60 an hour per address — which a shared network or a CI runner can spend, and
 * `create` then failed with "rate limit exceeded".
 */

import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { fetchWithRetry as sharedFetchWithRetry } from '../../utils/fetch-retry.js'

// GitHub repository for official templates
const TEMPLATES_REPO = 'uniweb/templates'

/**
 * The URL a release serves one template's tarball at.
 *
 * @param {string} name - Template name (e.g., 'marketing')
 * @param {string} version - The release tag, e.g. `v0.18.6`
 */
export function officialTemplateUrl(name, version) {
  return `https://github.com/${TEMPLATES_REPO}/releases/download/${version}/${name}.tar.gz`
}

/**
 * Fetch a template from one release of the official templates
 *
 * @param {string} name - Template name (e.g., 'marketing')
 * @param {Object} options - Fetch options
 * @param {string} options.version - The release tag, e.g. `v0.18.6`
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} { tempDir, baseTempDir, version }
 */
export async function fetchOfficialTemplate(name, options = {}) {
  const { version, onProgress } = options
  if (!version) throw new Error('fetchOfficialTemplate needs the release tag to download from')

  onProgress?.(`Downloading ${name} template (${version})...`)

  const response = await fetchWithRetry(officialTemplateUrl(name, version), {
    headers: { 'User-Agent': 'uniweb-cli' }
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Release ${version} of ${TEMPLATES_REPO} has no template "${name}".`)
    }
    throw new Error(`Could not download the ${name} template (HTTP ${response.status}).`)
  }

  // Extract to temp directory
  const tempDir = await mkdtemp(join(tmpdir(), 'uniweb-template-'))

  try {
    onProgress?.('Extracting template...')

    await pipeline(response.body, createGunzip(), tar.extract({ cwd: tempDir, strip: 0 }))

    // The tarball holds the template in a folder named after it:
    // marketing.tar.gz extracts to marketing/template.json
    return {
      tempDir: join(tempDir, name),
      baseTempDir: tempDir, // For cleanup
      version
    }
  } catch (err) {
    // Clean up on error
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

// Retry + timeout live in one place now (`../../utils/fetch-retry.js`).
// This file carried its own copy, as did the other two fetchers — three
// byte-identical implementations, and none reachable from the upload paths
// that had no retry at all. The wrapper keeps this caller's own timeout.
const fetchWithRetry = (url, options = {}, maxRetries = 3) =>
  sharedFetchWithRetry(url, { redirect: 'follow', ...options }, { retries: maxRetries, timeoutMs: 60000 })
