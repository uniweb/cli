# Internationalization (i18n)

Build multi-language sites with locale-aware routing, content translation, and automatic language switching.

## Overview

Uniweb's i18n system provides:

- **Locale-prefixed URLs**: `/`, `/es/`, `/fr/` for different languages
- **Translated content**: Separate markdown files per locale
- **String translations**: JSON files for UI strings
- **Language switcher**: Built-in API for navigation between locales
- **SEO-friendly**: Proper `hreflang` tags and localized metadata

---

## Quick Start

### 1. Configure Locales

```yaml
# site.yml
i18n:
  defaultLocale: en
  locales: [en, es, fr]
```

### 2. Create Translation Files

```
site/
└── locales/
    ├── en.json
    ├── es.json
    └── fr.json
```

```json
// locales/en.json
{
  "nav.home": "Home",
  "nav.about": "About",
  "footer.copyright": "© 2025 My Company"
}
```

```json
// locales/es.json
{
  "nav.home": "Inicio",
  "nav.about": "Acerca de",
  "footer.copyright": "© 2025 Mi Empresa"
}
```

### 3. Use Translations in Components

```jsx
import { useLocale } from '@uniweb/kit'

function Footer() {
  const { t } = useLocale()

  return (
    <footer>
      <p>{t('footer.copyright')}</p>
    </footer>
  )
}
```

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

## Translation Files

### Location

```
site/
└── locales/
    ├── en.json       # English translations
    ├── es.json       # Spanish translations
    └── fr.json       # French translations
```

### Format

Flat key-value pairs:

```json
{
  "site.title": "My Website",
  "nav.home": "Home",
  "nav.about": "About Us",
  "nav.contact": "Contact",
  "hero.title": "Welcome to Our Site",
  "hero.subtitle": "Building the future",
  "cta.getStarted": "Get Started",
  "cta.learnMore": "Learn More",
  "footer.copyright": "© 2025 My Company",
  "footer.privacy": "Privacy Policy"
}
```

Use dot notation to organize keys by feature or component.

### Nested Structure (Also Supported)

```json
{
  "nav": {
    "home": "Home",
    "about": "About Us"
  },
  "footer": {
    "copyright": "© 2025 My Company"
  }
}
```

Access with dot notation: `t('nav.home')`.

---

## Using Translations

### The useLocale Hook

```jsx
import { useLocale } from '@uniweb/kit'

function Header() {
  const { t, locale, locales } = useLocale()

  return (
    <header>
      <nav>
        <a href="/">{t('nav.home')}</a>
        <a href="/about">{t('nav.about')}</a>
      </nav>
      <span>Current: {locale}</span>
    </header>
  )
}
```

### Hook Return Values

| Value | Type | Description |
|-------|------|-------------|
| `t(key)` | function | Get translation for key |
| `locale` | string | Current locale code |
| `locales` | array | All available locales |
| `isDefaultLocale` | boolean | Is current locale the default? |

### Fallback Behavior

If a translation key is missing:
1. Returns the key itself (for debugging)
2. Logs a warning in development

---

## Language Switcher

### Building a Switcher

```jsx
import { useWebsite } from '@uniweb/kit'

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
        window.location.href = website.getLocaleUrl(e.target.value)
      }}
    >
      {locales.map(locale => (
        <option key={locale.code} value={locale.code}>
          {locale.label}
        </option>
      ))}
    </select>
  )
}
```

### Website Locale API

```js
const { website } = useWebsite()

// Check if site is multilingual
website.hasMultipleLocales()  // boolean

// Get all locales
website.getLocales()
// [{ code: 'en', label: 'English', isDefault: true }, ...]

// Get current locale
website.getActiveLocale()  // 'en'

// Get URL for switching locales
website.getLocaleUrl('es')  // '/es/about' (if currently on /about)
```

### Display Names

When locales don't have explicit labels, use the kit utility:

```jsx
import { getLocaleLabel } from '@uniweb/kit'

function LocaleOption({ locale }) {
  // Returns: explicit label > built-in name > code.toUpperCase()
  const label = getLocaleLabel(locale)

  return <option value={locale.code}>{label}</option>
}
```

Built-in display names include common languages (English, Español, Français, Deutsch, etc.).

---

## Localized Content

### Option 1: Separate Content Files

Create locale-specific markdown files:

```
pages/about/
├── page.yml
├── 1-intro.md           # Default locale (English)
├── 1-intro.es.md        # Spanish
└── 1-intro.fr.md        # French
```

The system automatically serves the correct file based on the active locale.

### Option 2: Single File with Frontmatter

For simple pages, include all translations in one file:

```markdown
---
type: Hero
title: Welcome to Our Site
title_es: Bienvenido a Nuestro Sitio
title_fr: Bienvenue sur Notre Site
---
```

Access in components:

```jsx
function Hero({ content, block }) {
  const locale = block.website.getActiveLocale()
  const title = content[`title_${locale}`] || content.title

  return <h1>{title}</h1>
}
```

### Option 3: Translation Keys in Content

Reference translation keys in content:

```markdown
---
type: Hero
---

# {{t:hero.title}}

{{t:hero.subtitle}}
```

The runtime resolves `{{t:key}}` placeholders using the translation files.

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

### Localized Metadata

Page metadata adapts to locale:

```yaml
# pages/about/page.yml
title: About Us
title_es: Sobre Nosotros
title_fr: À Propos

description: Learn about our company
description_es: Conozca nuestra empresa
description_fr: Découvrez notre entreprise
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

### locales/en.json

```json
{
  "site.tagline": "Building Tomorrow",
  "nav.home": "Home",
  "nav.products": "Products",
  "nav.about": "About",
  "nav.contact": "Contact",
  "hero.cta": "Get Started",
  "footer.copyright": "© 2025 Global Company. All rights reserved.",
  "footer.privacy": "Privacy Policy",
  "footer.terms": "Terms of Service"
}
```

### locales/es.json

```json
{
  "site.tagline": "Construyendo el Mañana",
  "nav.home": "Inicio",
  "nav.products": "Productos",
  "nav.about": "Nosotros",
  "nav.contact": "Contacto",
  "hero.cta": "Comenzar",
  "footer.copyright": "© 2025 Global Company. Todos los derechos reservados.",
  "footer.privacy": "Política de Privacidad",
  "footer.terms": "Términos de Servicio"
}
```

### Header Component

```jsx
import { useLocale, useWebsite } from '@uniweb/kit'

function Header() {
  const { t } = useLocale()
  const { website } = useWebsite()

  return (
    <header>
      <nav>
        <a href="/">{t('nav.home')}</a>
        <a href="/products">{t('nav.products')}</a>
        <a href="/about">{t('nav.about')}</a>
        <a href="/contact">{t('nav.contact')}</a>
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
          {locale.label}
        </a>
      ))}
    </div>
  )
}
```

---

## Best Practices

1. **Use descriptive keys**: `nav.products` is better than `nav_item_2`

2. **Keep translations in sync**: Missing keys show the key name, which is ugly

3. **Default locale first**: Write content in the default locale, then translate

4. **Test all locales**: Check that layouts work with longer/shorter text

5. **Consider RTL**: For Arabic, Hebrew, etc., you may need additional CSS

6. **SEO per locale**: Provide unique titles and descriptions per language

---

## See Also

- [Site Configuration](./site-configuration.md) — i18n settings in site.yml
- [Navigation Patterns](./navigation-patterns.md) — Building language-aware navigation
- [Site Search](./search.md) — Locale-specific search indexes
