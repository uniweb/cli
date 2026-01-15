/**
 * GitHub fetcher - downloads templates from GitHub repositories
 */

import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'

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
  const tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`

  const tempDir = await mkdtemp(join(tmpdir(), 'uniweb-template-'))

  try {
    const response = await fetchWithRetry(tarballUrl, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'uniweb-cli',
        // Support private repos if GITHUB_TOKEN is set
        ...(process.env.GITHUB_TOKEN && {
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`
        }),
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Repository not found: ${owner}/${repo}`)
      }
      if (response.status === 403) {
        const remaining = response.headers.get('x-ratelimit-remaining')
        if (remaining === '0') {
          throw new Error(
            'GitHub API rate limit exceeded. Set GITHUB_TOKEN environment variable for higher limits.'
          )
        }
      }
      throw new Error(`GitHub API error: ${response.status}`)
    }

    onProgress?.(`Downloading and extracting...`)

    await pipeline(
      response.body,
      createGunzip(),
      tar.extract({ cwd: tempDir, strip: 1 }) // strip 'owner-repo-sha/' prefix
    )

    onProgress?.(`Extracted to ${tempDir}`)

    return {
      tempDir,
      ref: displayRef,
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
        signal: AbortSignal.timeout(60000), // 60s timeout for GitHub (can be slow)
      })
      return response
    } catch (err) {
      if (attempt === maxRetries) throw err
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}
