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

### 2. Extract Translatable Strings

```bash
uniweb i18n extract
```

This scans your content and generates `locales/manifest.json` with all translatable strings keyed by content hash.

### 3. Provide Translations

Create translation files for each locale:

```
locales/
├── manifest.json       # Auto-generated
├── es.json             # Spanish translations
└── fr.json             # French translations
```

Each locale file maps content hashes to translations:

```json
{
  "a1b2c3d4": "Bienvenido a Nuestra Empresa",
  "e5f6g7h8": "Aprende Más"
}
```

### 4. Build

```bash
uniweb build
```

The build merges translations and generates locale-specific content.

### 5. Build a Language Switcher

```jsx
import { useWebsite } from '@uniweb/kit'

function LanguageSwitcher() {
  const { website } = useWebsite()

  if (!website.hasMultipleLocales()) return null

  const locales = website.getLocales()
  const active = website.getActiveLocale()

  return (
    <div>
      {locales.map(locale => (
        <a
          key={locale.code}
          href={website.getLocaleUrl(locale.code)}
          className={locale.code === active ? 'active' : ''}
        >
          {locale.label}
        </a>
      ))}
    </div>
  )
}
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

Automatically discovers locales from the `locales/` folder.

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

## Content Structure

You write content once, in your default locale:

```
pages/about/
├── page.yml
└── 1-intro.md    # Content in default language
```

The i18n system extracts translatable text from these files and merges translations at build time.

---

## Translation Workflow

Uniweb uses a hash-based translation system for managing translations at scale.

### 1. Extract Translatable Strings

```bash
uniweb i18n extract
```

Generates `locales/manifest.json` with all translatable content:

```json
{
  "units": {
    "a1b2c3d4": {
      "source": "Welcome to Our Company",
      "field": "title",
      "contexts": [{ "page": "/about", "section": "intro" }]
    }
  }
}
```

### 2. Provide Translations

Create locale files with translations keyed by hash:

```json
// locales/es.json
{
  "a1b2c3d4": "Bienvenido a Nuestra Empresa"
}
```

For strings that appear in multiple contexts and need different translations:

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

### 3. Build

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

### 4. Sync Changes

After content updates:

```bash
uniweb i18n sync    # Detect changes, update manifest
uniweb i18n status  # Check translation coverage
```

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

## Complete Example

### site.yml

```yaml
name: Global Company
description: Serving customers worldwide

i18n:
  defaultLocale: en
  locales:
    - code: en
      label: English
    - code: es
      label: Español
    - code: fr
      label: Français

pages: [home, products, about, contact]

search:
  enabled: true
```

### Header with Language Switcher

```jsx
import { useWebsite, getLocaleLabel } from '@uniweb/kit'

export function Header({ content }) {
  const { website } = useWebsite()

  return (
    <header>
      <nav>
        {/* Links receive localized labels from content */}
        {content.links.map(link => (
          <a key={link.href} href={link.href}>{link.label}</a>
        ))}
      </nav>

      {website.hasMultipleLocales() && (
        <LocaleSwitcher />
      )}
    </header>
  )
}

function LocaleSwitcher() {
  const { website } = useWebsite()
  const locales = website.getLocales()
  const active = website.getActiveLocale()

  return (
    <div className="locale-switcher">
      {locales.map(locale => (
        <a
          key={locale.code}
          href={website.getLocaleUrl(locale.code)}
          className={locale.code === active ? 'active' : ''}
        >
          {getLocaleLabel(locale)}
        </a>
      ))}
    </div>
  )
}
```

---

## Key Concepts

### No Runtime Translation Lookup

Unlike traditional i18n libraries, there is no `t()` function or `useLocale` hook. Components receive content already translated via the `content` prop.

### Full Page Reload for Switching

When users switch languages, they navigate to a new URL (e.g., `/es/about`), which triggers a full page reload. This keeps the architecture simple and SEO-friendly.

### Static Build Per Locale

Each locale generates its own static HTML files with embedded content. There's no client-side translation—each page is pre-rendered in the correct language.

---

## Best Practices

1. **Write in default locale first**: Complete content in your default language, then extract and translate

2. **Use descriptive contexts**: The manifest shows where each string appears—use this to provide accurate translations

3. **Test all locales**: Check that layouts work with longer/shorter text in different languages

4. **Consider RTL**: For Arabic, Hebrew, etc., you may need additional CSS for right-to-left layout

5. **Keep translations in sync**: Run `uniweb i18n sync` after content changes to update the manifest

---

## See Also

- [Site Configuration](./site-configuration.md) — i18n settings in site.yml
- [Content Structure](./content-structure.md) — How content flows to components
- [Site Search](./search.md) — Locale-specific search indexes
