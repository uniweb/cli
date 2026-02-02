# Internationalization (i18n)

Build multi-language sites with locale-aware routing and localized content.

## Overview

Uniweb uses a **Component Content Architecture (CCA)** where content arrives to components already localized. There is no runtime translation lookup—each locale is a complete static build.

Key characteristics:

- **Locale-prefixed URLs**: `/`, `/es/`, `/fr/` for different languages
- **Build-time translation**: Translations are merged during build, not runtime
- **Full page reload for switching**: Navigating to `/es/about` loads Spanish content
- **SEO-friendly**: Each locale generates separate static HTML with proper `hreflang` tags

---

## Quick Start

### 1. Configure Locales

```yaml
# site.yml
i18n:
  defaultLocale: en
  locales: [en, es, fr]
```

### 2. Build Your Site

```bash
uniweb build
```

### 3. Extract Translatable Strings

```bash
uniweb i18n extract
```

This scans your built content and generates `locales/manifest.json` with all translatable strings keyed by content hash.

### 4. Initialize Locale Files

```bash
uniweb i18n init es fr
```

Creates `locales/es.json` and `locales/fr.json` pre-populated with all manifest keys. Values default to source text so translators can see what to translate.

### 5. Translate

Edit the generated locale files, replacing source text with translations:

```json
{
  "a1b2c3d4": "Bienvenido a Nuestra Empresa",
  "e5f6g7h8": "Aprende Más"
}
```

### 6. Build with Translations

```bash
uniweb build
```

The build merges translations and generates locale-specific output.

---

## Configuration

### Basic Setup

```yaml
# site.yml
i18n:
  defaultLocale: en
  locales: [en, es, fr]
```

The default locale has no URL prefix (`/about`), while other locales get prefixed (`/es/about`, `/fr/about`).

### With Custom Labels

```yaml
i18n:
  defaultLocale: en
  locales:
    - code: en
      label: English
    - code: es
      label: Español
    - code: fr
      label: Français
```

Labels appear in language switchers. Without explicit labels, `@uniweb/kit` provides common display names.

### Auto-Discovery

```yaml
i18n:
  defaultLocale: en
  locales: '*'
```

Automatically discovers locales from the `locales/` folder. Any `.json` file in the locales directory (other than `manifest.json` and `_memory.json`) is treated as a locale.

### Custom Locales Directory

```yaml
i18n:
  localesDir: translations   # Default: locales
```

---

## How Content Arrives to Components

**Components receive content already translated.** When a user visits `/es/about`, the component receives Spanish content in `content.title`, `content.paragraphs`, etc.—there's no translation function to call.

```jsx
// Component receives localized content directly
function Hero({ content }) {
  // content.title is already in the user's language
  // No t() function, no translation lookup
  return (
    <section>
      <h1>{content.title}</h1>
      {content.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
    </section>
  )
}
```

This is the **Component Content Architecture (CCA)**—content is resolved before it reaches components.

---

## Generated Routes

For a site with pages `home` and `about`:

| Page | English (default) | Spanish | French |
|------|-------------------|---------|--------|
| Home | `/` | `/es/` | `/fr/` |
| About | `/about` | `/es/about` | `/fr/about` |

The default locale never has a prefix. Other locales always have their code as a prefix.

---

## Language Switcher

### Building a Switcher

```jsx
import { useWebsite, getLocaleLabel } from '@uniweb/kit'

function LanguageSwitcher() {
  const { website } = useWebsite()

  // Only show if site has multiple locales
  if (!website.hasMultipleLocales()) {
    return null
  }

  const locales = website.getLocales()
  const active = website.getActiveLocale()

  return (
    <select
      value={active}
      onChange={(e) => {
        // Navigate triggers full page reload with new locale content
        window.location.href = website.getLocaleUrl(e.target.value)
      }}
    >
      {locales.map(locale => (
        <option key={locale.code} value={locale.code}>
          {getLocaleLabel(locale)}
        </option>
      ))}
    </select>
  )
}
```

### Website Locale API

```js
import { useWebsite } from '@uniweb/kit'

function MyComponent() {
  const { website } = useWebsite()

  // Check if site is multilingual
  website.hasMultipleLocales()  // boolean

  // Get all locales
  website.getLocales()
  // [{ code: 'en', label: 'English', isDefault: true }, ...]

  // Get current locale
  website.getActiveLocale()  // 'en'

  // Get URL for switching locales (from current page)
  website.getLocaleUrl('es')  // '/es/about' (if currently on /about)
}
```

### Display Names Utility

When locales don't have explicit labels:

```jsx
import { getLocaleLabel, LOCALE_DISPLAY_NAMES } from '@uniweb/kit'

// From locale object with label
getLocaleLabel({ code: 'es', label: 'Spanish' })  // 'Spanish'

// From locale object without label
getLocaleLabel({ code: 'es' })  // 'Español' (built-in)

// Access built-in names directly
console.log(LOCALE_DISPLAY_NAMES.fr)  // 'Français'
```

---

## Translation Workflow

Uniweb uses a hash-based translation system for managing translations at scale.

### Extract Strings

```bash
uniweb i18n extract
```

Generates `locales/manifest.json` with all translatable content:

```json
{
  "version": "1.0",
  "defaultLocale": "en",
  "extracted": "2025-01-29T...",
  "units": {
    "a1b2c3d4": {
      "source": "Welcome to Our Company",
      "field": "title",
      "contexts": [{ "page": "/about", "section": "intro" }]
    }
  }
}
```

Each unit is keyed by a hash of the source string. The `contexts` array shows where the string appears, and `field` indicates the content type (title, paragraph, link label, etc.).

**Options:**
- `--verbose` — Show extracted strings in output
- `--collections-only` — Extract only collection content (skip pages)
- `--no-collections` — Skip collections (pages only)

### Initialize Locale Files

```bash
uniweb i18n init es fr
```

Creates starter locale files pre-populated with all manifest keys. By default, values are set to the source text so translators can see what needs translating.

**Behavior:**
- **File doesn't exist**: Creates it with all manifest keys
- **File exists** (no `--force`): Merges — adds only missing keys, preserves existing translations
- **File exists with `--force`**: Overwrites entirely

**Options:**
- `--empty` — Use empty strings instead of source text as placeholder values
- `--force` — Overwrite existing files entirely

If no locale codes are specified, initializes all locales configured in `site.yml`.

```bash
# Create files with source text as placeholders
uniweb i18n init es fr

# Create files with empty values (useful for translation tools)
uniweb i18n init --empty

# Overwrite existing files from scratch
uniweb i18n init es --force
```

### Translate

Edit locale files, replacing source text (or empty strings) with translations:

```json
{
  "a1b2c3d4": "Bienvenido a Nuestra Empresa",
  "e5f6g7h8": "Aprende Más"
}
```

For strings that appear in multiple contexts and need different translations, use the override format:

```json
{
  "e5f6g7h8": {
    "default": "Aprende Más",
    "overrides": {
      "/pricing:cta": "Ver Precios"
    }
  }
}
```

Override keys use the format `{page}:{section}`.

**Tips:**
- Use `uniweb i18n status --missing --json` to export untranslated strings for translation tools
- The manifest's `contexts` array helps translators understand where each string appears
- Group your translation effort by page using `uniweb i18n status --missing --by-page`

### Build

```bash
uniweb build
```

The build merges translations and generates one `site-content.json` per locale:

```
dist/
├── index.html              # English (default)
├── site-content.json       # English content
├── es/
│   ├── index.html          # Spanish
│   └── site-content.json   # Spanish content
└── fr/
    ├── index.html          # French
    └── site-content.json   # French content
```

### Sync Changes

After content updates, sync the manifest to detect additions, removals, and changes:

```bash
uniweb i18n sync
```

Reports what changed (new strings, removed strings, modified strings). Use `--dry-run` to preview without writing changes.

---

## Translation Status and Auditing

### Status

Check translation coverage for all locales or a specific one:

```bash
uniweb i18n status            # All locales
uniweb i18n status es         # Spanish only
uniweb i18n status --json     # Machine-readable output
```

**Additional options:**
- `--missing` — List all untranslated strings instead of just a summary
- `--missing --by-page` — Group missing strings by page
- `--missing --json` — Export missing strings as JSON (useful for translation tools or AI translation)
- `--freeform` — Show free-form translation status (staleness, orphans)

### Audit

Find stale translations (hashes no longer in manifest) and missing ones:

```bash
uniweb i18n audit             # Show stale and missing entries
uniweb i18n audit es          # Audit Spanish only
uniweb i18n audit --clean     # Remove stale entries from locale files
uniweb i18n audit --verbose   # Show detailed output
```

---

## Free-Form Translations

For sections that need complete content replacement (different structure, images, or layout per locale) rather than string-by-string translation, use free-form translations.

### Overview

Free-form translations replace an entire section's content with a locale-specific markdown file. This is useful for:
- Content that needs different structure per locale
- Sections with locale-specific images or media
- Marketing copy that should be rewritten, not translated

### File Structure

```
locales/
├── manifest.json
├── es.json
├── freeform/
│   └── es/
│       ├── .manifest.json                  # Staleness tracking (auto-managed)
│       ├── pages/about/hero.md             # By page route
│       ├── page-ids/installation/intro.md  # By page ID
│       └── collections/articles/getting-started.md
```

### Initialize a Free-Form Translation

```bash
uniweb i18n init-freeform es pages/about hero
uniweb i18n init-freeform es page-ids/installation intro
uniweb i18n init-freeform es collections/articles getting-started
```

Creates a markdown file pre-populated with the source content, ready for translation. Also records a source hash for staleness detection.

### Staleness Detection

When the source content changes, free-form translations become stale. Check status with:

```bash
uniweb i18n status --freeform
```

After reviewing changes, update the recorded hash:

```bash
uniweb i18n update-hash es pages/about hero       # Specific section
uniweb i18n update-hash es --all-stale             # All stale at once
```

### Move and Rename

When pages are reorganized:

```bash
uniweb i18n move pages/docs/setup pages/getting-started
uniweb i18n rename pages/about hero welcome
```

These commands update all locales and their manifests.

### Prune Orphaned Translations

Remove free-form translations whose source content no longer exists:

```bash
uniweb i18n prune --freeform --dry-run   # Preview what would be removed
uniweb i18n prune --freeform             # Remove orphaned files
```

---

## Collections i18n

Collection data is translated alongside page content by default. The `extract` command processes both pages and all collection JSON — whether generated from `library/` collections or hand-written.

### Extract Collection Strings

```bash
uniweb i18n extract                      # Pages + collections (default)
uniweb i18n extract --collections-only   # Collections only
uniweb i18n extract --no-collections     # Pages only
```

Collection strings are stored in a separate manifest at `locales/collections/manifest.json`. Extraction covers all collection data using schema-guided or heuristic field detection. Provide a companion `.schema.js` file for precise control over which fields are translatable.

---

## Context-Specific Overrides

When the same source string appears in multiple places and needs different translations depending on context, use the override format:

```json
{
  "e5f6g7h8": {
    "default": "Learn More",
    "overrides": {
      "/pricing:cta": "See Pricing",
      "/about:intro": "Discover Our Story"
    }
  }
}
```

The `default` value is used everywhere except the specified overrides. Override keys use the format `{page}:{section}` matching the `contexts` in the manifest.

---

## SEO Considerations

### Automatic hreflang Tags

The build generates proper `hreflang` tags for each page:

```html
<link rel="alternate" hreflang="en" href="https://example.com/about" />
<link rel="alternate" hreflang="es" href="https://example.com/es/about" />
<link rel="alternate" hreflang="fr" href="https://example.com/fr/about" />
<link rel="alternate" hreflang="x-default" href="https://example.com/about" />
```

### HTML lang Attribute

Each locale's HTML includes the correct `lang` attribute:

```html
<html lang="es">
```

---

## Search Index

With i18n enabled, separate search indexes are generated per locale:

```
dist/
├── search-index.json      # English
├── es/
│   └── search-index.json  # Spanish
└── fr/
    └── search-index.json  # French
```

The search client automatically uses the correct index for the active locale.

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `uniweb i18n extract` | Extract translatable strings to `manifest.json` |
| `uniweb i18n init [locales]` | Generate starter locale files from manifest |
| `uniweb i18n sync` | Update manifest with content changes |
| `uniweb i18n status [locale]` | Show translation coverage |
| `uniweb i18n audit [locale]` | Find stale and missing translations |
| `uniweb i18n init-freeform <locale> <path> <id>` | Create free-form translation |
| `uniweb i18n update-hash <locale> [<path> <id>]` | Update hash after source changes |
| `uniweb i18n move <old> <new>` | Move free-form translations |
| `uniweb i18n rename <path> <old-id> <new-id>` | Rename free-form translation |
| `uniweb i18n prune --freeform` | Remove orphaned free-form translations |

| Option | Applies to | Description |
|--------|-----------|-------------|
| `-t, --target <path>` | All | Specify site directory |
| `--verbose` | extract, sync, audit | Detailed output |
| `--dry-run` | sync, prune | Preview without writing |
| `--empty` | init | Empty strings instead of source text |
| `--force` | init | Overwrite existing files |
| `--clean` | audit | Remove stale entries |
| `--missing` | status | List missing strings |
| `--by-page` | status --missing | Group by page |
| `--freeform` | status, prune | Free-form translation mode |
| `--json` | status | Machine-readable output |
| `--collections-only` | extract | Collections only |
| `--no-collections` | extract | Skip collections (pages only) |
| `--all-stale` | update-hash | Update all stale hashes |

---

## Best Practices

1. **Write in default locale first**: Complete content in your default language, then extract and translate
2. **Use `init` for new locales**: Run `uniweb i18n init` after extracting to get pre-populated files
3. **Use descriptive contexts**: The manifest shows where each string appears—use this to provide accurate translations
4. **Test all locales**: Check that layouts work with longer/shorter text in different languages
5. **Keep translations in sync**: Run `uniweb i18n sync` after content changes to update the manifest
6. **Use `--missing --json` for AI translation**: Export untranslated strings for batch translation with AI tools
7. **Consider RTL**: For Arabic, Hebrew, etc., you may need additional CSS for right-to-left layout

---

## See Also

- [Translating Your Site](./guides/translating-your-site.md) — Content author guide (no coding required)
- [Site Configuration](./site-configuration.md) — i18n settings in site.yml
- [Content Structure](./content-structure.md) — How content flows to components
- [Site Search](./search.md) — Locale-specific search indexes
