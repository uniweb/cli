/**
 * GitHub Release fetcher - downloads official templates from GitHub releases
 */

import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'

// GitHub repository for official templates
const TEMPLATES_REPO = 'uniweb/templates'
const GITHUB_API = 'https://api.github.com'

// Cache for manifest (avoid re-fetching in same session)
let manifestCache = null

/**
 * Fetch the manifest.json from the latest release
 *
 * @param {Object} options - Fetch options
 * @param {string} options.version - Specific version tag (default: latest)
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} { version, templates, downloadUrl }
 */
export async function fetchManifest(options = {}) {
  const { version, onProgress } = options

  // Return cached manifest if available and no specific version requested
  if (manifestCache && !version) {
    return manifestCache
  }

  onProgress?.('Fetching template manifest...')

  // Get release info
  const releaseUrl = version
    ? `${GITHUB_API}/repos/${TEMPLATES_REPO}/releases/tags/${version}`
    : `${GITHUB_API}/repos/${TEMPLATES_REPO}/releases/latest`

  const releaseResponse = await fetchWithRetry(releaseUrl, {
    headers: getGitHubHeaders(),
  })

  if (!releaseResponse.ok) {
    if (releaseResponse.status === 404) {
      throw new Error(
        version
          ? `Release ${version} not found for ${TEMPLATES_REPO}`
          : `No releases found for ${TEMPLATES_REPO}`
      )
    }
    await handleGitHubError(releaseResponse)
  }

  const release = await releaseResponse.json()

  // Find manifest.json asset
  const manifestAsset = release.assets?.find(a => a.name === 'manifest.json')
  if (!manifestAsset) {
    throw new Error(
      `Release ${release.tag_name} does not contain manifest.json. ` +
      `This may be an older release format.`
    )
  }

  // Download manifest
  const manifestResponse = await fetchWithRetry(manifestAsset.browser_download_url, {
    headers: getGitHubHeaders(),
  })

  if (!manifestResponse.ok) {
    throw new Error(`Failed to download manifest: ${manifestResponse.status}`)
  }

  const manifest = await manifestResponse.json()

  // Build result with download URL base
  const result = {
    version: release.tag_name,
    templates: manifest.templates || {},
    // Base URL for downloading template tarballs
    downloadUrlBase: `https://github.com/${TEMPLATES_REPO}/releases/download/${release.tag_name}`,
  }

  // Cache if this was a "latest" fetch
  if (!version) {
    manifestCache = result
  }

  return result
}

/**
 * Fetch a specific template from GitHub releases
 *
 * @param {string} name - Template name (e.g., 'marketing')
 * @param {Object} options - Fetch options
 * @param {string} options.version - Specific version tag (default: latest)
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
    headers: getGitHubHeaders(),
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
      tar.extract({ cwd: tempDir, strip: 0 }) // No strip - tarball contains template root
    )

    return {
      tempDir,
      version: manifest.version,
      metadata: templateInfo,
    }
  } catch (err) {
    // Clean up on error
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

/**
 * List available templates from the latest release
 *
 * @param {Object} options - Fetch options
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Array>} List of template metadata
 */
export async function listOfficialTemplates(options = {}) {
  try {
    const manifest = await fetchManifest(options)
    return Object.entries(manifest.templates).map(([id, info]) => ({
      id,
      ...info,
    }))
  } catch {
    // Return empty list if can't fetch
    return []
  }
}

/**
 * Clear the manifest cache
 */
export function clearManifestCache() {
  manifestCache = null
}

/**
 * Get GitHub API headers
 */
function getGitHubHeaders() {
  return {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'uniweb-cli',
    // Support private repos or higher rate limits if GITHUB_TOKEN is set
    ...(process.env.GITHUB_TOKEN && {
      'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`
    }),
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

/**
 * Fetch with retry and timeout
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        redirect: 'follow',
        signal: AbortSignal.timeout(60000), // 60s timeout
      })
      return response
    } catch (err) {
      if (attempt === maxRetries) throw err
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}
