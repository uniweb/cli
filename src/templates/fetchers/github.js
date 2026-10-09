/**
 * GitHub fetcher — downloads a template from a GitHub repository
 * (`github:owner/repo[#ref]`).
 *
 * ⭐ Without a token it downloads from GitHub's archive host —
 * `codeload.github.com/<owner>/<repo>/tar.gz/<ref>`, `HEAD` naming the default
 * branch — which is not the REST API, so the API's anonymous limit (60 requests an
 * hour per address) does not apply. With GITHUB_TOKEN set it uses the API's
 * tarball endpoint, which a private repository needs and which then counts
 * against the token's own, higher limit. ⛔ Until 2026-10-08 every download went
 * through the API, token or not.
 */

import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { fetchWithRetry as sharedFetchWithRetry } from '../../utils/fetch-retry.js'

/**
 * Where to download a repository's tarball from, and with which headers.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} [ref='HEAD'] - Branch, tag, or commit
 * @param {string|null} [token] - GITHUB_TOKEN, when set
 * @returns {{ url: string, headers: Record<string, string> }}
 */
export function githubTarballRequest(owner, repo, ref = 'HEAD', token = null) {
  if (token) {
    return {
      url: `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'uniweb-cli',
        Authorization: `Bearer ${token}`
      }
    }
  }
  return {
    url: `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`,
    headers: { 'User-Agent': 'uniweb-cli' }
  }
}

/**
 * Fetch a template from a GitHub repository
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object} options - Fetch options
 * @param {string} options.ref - Branch, tag, or commit (default: HEAD)
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} { tempDir, ref }
 */
export async function fetchGitHubTemplate(owner, repo, options = {}) {
  const { ref = 'HEAD', onProgress } = options

  const displayRef = ref === 'HEAD' ? 'latest' : ref
  onProgress?.(`Fetching ${owner}/${repo}@${displayRef} from GitHub...`)

  // GitHub provides tarballs without requiring git
  const token = process.env.GITHUB_TOKEN || null
  const { url, headers } = githubTarballRequest(owner, repo, ref, token)

  const tempDir = await mkdtemp(join(tmpdir(), 'uniweb-template-'))

  try {
    const response = await fetchWithRetry(url, { headers })

    if (!response.ok) {
      if (response.status === 404) {
        const at = ref === 'HEAD' ? '' : ` at ${ref}`
        throw new Error(
          `Repository not found: ${owner}/${repo}${at}` +
            (token ? '' : ' — a private repository needs GITHUB_TOKEN')
        )
      }
      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        throw new Error('GitHub API rate limit exceeded for this GITHUB_TOKEN.')
      }
      throw new Error(`GitHub download failed: HTTP ${response.status}`)
    }

    onProgress?.(`Downloading and extracting...`)

    await pipeline(
      response.body,
      createGunzip(),
      tar.extract({ cwd: tempDir, strip: 1 }) // the archive's one top folder: 'repo-ref/' (codeload) or 'owner-repo-sha/' (API)
    )

    onProgress?.(`Extracted to ${tempDir}`)

    return {
      tempDir,
      ref: displayRef
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
  sharedFetchWithRetry(url, { ...options }, { retries: maxRetries, timeoutMs: 60000 })
