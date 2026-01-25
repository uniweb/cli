# Documentation Versioning

A convention-based versioning system for documentation sites that keeps multiple versions of content accessible without complex configuration.

## The Problem

Documentation sites often need to maintain multiple versions:

- API documentation with breaking changes between major versions
- Framework guides that differ across releases
- Product documentation for supported versions

Traditional approaches require explicit configuration, version manifests, or CMS-level features. This adds complexity and makes content reorganization difficult.

## Scoped Versioning

Uniweb uses **scoped versioning**—versioning applies to specific subtrees of your site, not the entire site. Marketing pages stay unversioned while documentation can have multiple versions.

```
pages/
├── home/              # Not versioned (marketing)
├── about/             # Not versioned (marketing)
├── pricing/           # Not versioned (marketing)
└── docs/              # Versioned scope
    ├── v1/            # Version 1 (older)
    │   ├── intro/
    │   └── api/
    └── v2/            # Version 2 (latest)
        ├── intro/
        └── api/
```

Routes stay within their scope:
- `/docs/intro` (latest v2)
- `/docs/v1/intro` (older v1)
- `/about` (unversioned, no prefix)

## Convention-Based Detection

Versioning is triggered automatically by folder naming:

| Folder | Detected As |
|--------|-------------|
| `v1/` | Version 1 |
| `v2/` | Version 2 |
| `v1.0/` | Version 1.0 |
| `v2.1/` | Version 2.1 |
| `next/` | Not a version |
| `legacy/` | Not a version |

Versions are sorted by number, with the highest becoming the "latest" version. The latest version's content appears at the scope root (no version prefix in URL).

## How It Works

### File Structure

```
pages/docs/
├── page.yml           # Optional: version metadata
├── v1/
│   ├── intro/
│   │   ├── page.yml
│   │   └── 1-content.md
│   └── api/
│       ├── page.yml
│       └── 1-reference.md
└── v2/
    ├── intro/
    │   ├── page.yml
    │   └── 1-content.md
    └── api/
        ├── page.yml
        └── 1-reference.md
```

### Generated Routes

| Page | Route |
|------|-------|
| v2/intro (latest) | `/docs/intro` |
| v2/api (latest) | `/docs/api` |
| v1/intro | `/docs/v1/intro` |
| v1/api | `/docs/v1/api` |

### Version Metadata (Optional)

Customize version labels and mark deprecated versions in `page.yml`:

```yaml
# pages/docs/page.yml
title: Documentation

versions:
  v2:
    label: "2.0 (Current)"
    latest: true
  v1:
    label: "1.0 (Legacy)"
    deprecated: true
```

Without explicit configuration, versions are auto-detected and the highest version is marked as latest.

## Building Version Switchers

Use the `useVersion` hook to build version switching UI:

```jsx
import { useVersion } from '@uniweb/kit'

function VersionSwitcher() {
  const {
    isVersioned,
    currentVersion,
    versions,
    getVersionUrl
  } = useVersion()

  // Don't render on non-versioned pages
  if (!isVersioned) return null

  return (
    <select
      value={currentVersion?.id}
      onChange={(e) => window.location.href = getVersionUrl(e.target.value)}
    >
      {versions.map(v => (
        <option key={v.id} value={v.id}>
          {v.label}
          {v.latest && ' (latest)'}
          {v.deprecated && ' (deprecated)'}
        </option>
      ))}
    </select>
  )
}
```

### Version Hook API

```js
const {
  isVersioned,        // boolean - is current page versioned?
  currentVersion,     // { id, label, latest, deprecated } | null
  versions,           // Array of version objects
  latestVersionId,    // string - ID of latest version
  versionScope,       // string - route where versioning starts (e.g., '/docs')
  isLatestVersion,    // boolean - is current version the latest?
  isDeprecatedVersion,// boolean - is current version deprecated?
  getVersionUrl,      // (targetVersion) => string - compute URL for version switch
  hasVersionedContent,// boolean - does site have any versioned content?
  versionedScopes,    // Object - all versioned scopes in site
} = useVersion()
```

### Page-Level Access

Pages within versioned sections have version context:

```jsx
function DocPage({ block }) {
  const page = block.page

  if (page.isVersioned()) {
    const version = page.getVersion()      // Current version
    const versions = page.getVersions()    // All versions
    const url = page.getVersionUrl('v1')   // URL for v1
  }
}
```

### Website-Level Access

Access version information from the website instance:

```js
const website = block.website

// Check if route is versioned
website.isVersionedRoute('/docs/intro')  // true
website.isVersionedRoute('/about')       // false

// Get version scope for a route
website.getVersionScope('/docs/intro')   // '/docs'

// Get version metadata for a scope
website.getVersionMeta('/docs')
// { versions: [...], latestId: 'v2' }

// Compute URL for version switch
website.getVersionUrl('v1', '/docs/intro')
// '/docs/v1/intro'
```

## Deprecation Warnings

Show warnings for deprecated versions:

```jsx
function DeprecationBanner() {
  const { isDeprecatedVersion, currentVersion, getVersionUrl, latestVersionId } = useVersion()

  if (!isDeprecatedVersion) return null

  return (
    <div className="warning-banner">
      You're viewing docs for {currentVersion.label}.
      <a href={getVersionUrl(latestVersionId)}>
        View latest version
      </a>
    </div>
  )
}
```

## SSG Behavior

Version switching uses full page navigation (not SPA routing). This ensures:

1. **Correct static HTML** - Each version's pages are pre-rendered
2. **No stale content** - No risk of mixing versions via client-side state
3. **SEO-friendly** - Search engines see proper URLs per version
4. **Simple mental model** - Version switch = full reload

## Best Practices

1. **Use semantic version folders** - `v1/`, `v2/` not `version-1/`, `old/`

2. **Keep latest version at scope root** - Users get current docs by default

3. **Mark deprecated versions explicitly** - Helps users find current content

4. **Version entire sections, not individual pages** - Keeps content organization consistent

5. **Use version switcher in navigation** - Make it easy to find other versions

6. **Show deprecation banners** - Guide users to current documentation

## Technical Details

### Data Flow

1. **Build time**: `content-collector.js` detects version folders and builds version metadata
2. **Page data**: Each page within a versioned scope receives `version`, `versionMeta`, `versionScope`
3. **Site data**: `versionedScopes` map is included in site output
4. **Runtime**: `Website` class provides version APIs, `useVersion` hook provides React access

### Route Calculation

For a versioned scope at `/docs` with versions v1, v2 (latest):

| Version | Folder | Route |
|---------|--------|-------|
| v2 (latest) | `docs/v2/intro` | `/docs/intro` |
| v1 | `docs/v1/intro` | `/docs/v1/intro` |

The latest version gets no URL prefix within its scope. Older versions get their version ID as a prefix.

### Version URL Computation

`getVersionUrl(targetVersion, currentRoute)` handles the transformation:

```js
// Current: /docs/intro (latest v2)
getVersionUrl('v1', '/docs/intro')
// → '/docs/v1/intro'

// Current: /docs/v1/intro
getVersionUrl('v2', '/docs/v1/intro')
// → '/docs/intro' (latest has no prefix)
```
