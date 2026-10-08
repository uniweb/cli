/**
 * GitHub Release fetcher - downloads official templates from GitHub releases
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
const GITHUB_API = 'https://api.github.com'

/**
 * Fetch manifest.json from one release of the official templates.
 *
 * ⛔ Always a named release — the one the CLI was published with — and never
 * `latest`: the latest templates can be newer than the packages this CLI pins
 * (templates/resolver.js, OFFICIAL_TEMPLATES_RELEASE).
 *
 * @param {Object} options - Fetch options
 * @param {string} options.version - The release tag, e.g. `v0.18.4`
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} { version, templates, downloadUrlBase }
 */
export async function fetchManifest(options = {}) {
  const { version, onProgress } = options
  if (!version) throw new Error('fetchManifest needs the release tag to read')

  onProgress?.('Fetching template manifest...')

  const releaseResponse = await fetchWithRetry(
    `${GITHUB_API}/repos/${TEMPLATES_REPO}/releases/tags/${version}`,
    { headers: getGitHubHeaders() }
  )

  if (!releaseResponse.ok) {
    if (releaseResponse.status === 404) {
      throw new Error(`Release ${version} not found for ${TEMPLATES_REPO}`)
    }
    await handleGitHubError(releaseResponse)
  }

  const release = await releaseResponse.json()

  // Find manifest.json asset
  const manifestAsset = release.assets?.find((a) => a.name === 'manifest.json')
  if (!manifestAsset) {
    throw new Error(
      `Release ${release.tag_name} does not contain manifest.json. ` +
        `This may be an older release format.`
    )
  }

  // Download manifest
  const manifestResponse = await fetchWithRetry(
    manifestAsset.browser_download_url,
    {
      headers: getGitHubHeaders()
    }
  )

  if (!manifestResponse.ok) {
    throw new Error(`Failed to download manifest: ${manifestResponse.status}`)
  }

  const manifest = await manifestResponse.json()

  return {
    version: release.tag_name,
    templates: manifest.templates || {},
    // Base URL for downloading template tarballs
    downloadUrlBase: `https://github.com/${TEMPLATES_REPO}/releases/download/${release.tag_name}`
  }
}

/**
 * Fetch a template from one release of the official templates
 *
 * @param {string} name - Template name (e.g., 'marketing')
 * @param {Object} options - Fetch options
 * @param {string} options.version - The release tag, e.g. `v0.18.4`
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} { tempDir, version, metadata }
 */
export async function fetchOfficialTemplate(name, options = {}) {
  const { version, onProgress } = options

  // Get manifest first
  const manifest = await fetchManifest({ version, onProgress })

  // Check if template exists
  const templateInfo = manifest.templates[name]
  if (!templateInfo) {
    const available = Object.keys(manifest.templates).join(', ')
    throw new Error(
      `Template "${name}" not found in release ${manifest.version}.\n` +
        `Available templates: ${available || 'none'}`
    )
  }

  onProgress?.(`Downloading ${name} template (${manifest.version})...`)

  // Download template tarball
  const tarballUrl = `${manifest.downloadUrlBase}/${name}.tar.gz`
  const tarballResponse = await fetchWithRetry(tarballUrl, {
    headers: getGitHubHeaders()
  })

  if (!tarballResponse.ok) {
    if (tarballResponse.status === 404) {
      throw new Error(
        `Template tarball not found: ${name}.tar.gz\n` +
          `The release may be incomplete or corrupted.`
      )
    }
    throw new Error(`Failed to download template: ${tarballResponse.status}`)
  }

  // Extract to temp directory
  const tempDir = await mkdtemp(join(tmpdir(), 'uniweb-template-'))

  try {
    onProgress?.('Extracting template...')

    await pipeline(
      tarballResponse.body,
      createGunzip(),
      tar.extract({ cwd: tempDir, strip: 0 })
    )

    // Tarball contains template in a subdirectory named after the template
    // e.g., marketing.tar.gz extracts to marketing/template.json
    return {
      tempDir: join(tempDir, name),
      baseTempDir: tempDir, // For cleanup
      version: manifest.version,
      metadata: templateInfo
    }
  } catch (err) {
    // Clean up on error
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

/**
 * Get GitHub API headers
 */
function getGitHubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'uniweb-cli',
    // Support private repos or higher rate limits if GITHUB_TOKEN is set
    ...(process.env.GITHUB_TOKEN && {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`
    })
  }
}

/**
 * Handle GitHub API errors
 */
async function handleGitHubError(response) {
  if (response.status === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    if (remaining === '0') {
      throw new Error(
        'GitHub API rate limit exceeded.\n' +
          'Set GITHUB_TOKEN environment variable for higher limits.'
      )
    }
  }
  throw new Error(`GitHub API error: ${response.status}`)
}

// Retry + timeout live in one place now (`../../utils/fetch-retry.js`).
// This file carried its own copy, as did the other two fetchers — three
// byte-identical implementations, and none reachable from the upload paths
// that had no retry at all. The wrapper keeps this caller's own timeout.
const fetchWithRetry = (url, options = {}, maxRetries = 3) =>
  sharedFetchWithRetry(url, { redirect: 'follow', ...options }, { retries: maxRetries, timeoutMs: 60000 })
