# Translating Your Site

This guide walks you through making your Uniweb site available in multiple languages. You write content once in your main language, then provide translations — the site handles everything else, from URL routing to search indexes.

No coding required. You'll work with a few terminal commands and edit JSON files.

---

## How It Works

You write your content in one language — your default language. When you're ready to translate, you run a command that extracts every translatable string from your site and puts them in a file. Then you (or a translator) provide translations in that file. When you build, the site generates a version for each language with its own URLs.

Visitors see URLs like `/about` for English and `/es/about` for Spanish. Each language gets its own pages, search index, and everything it needs. The default language has no prefix — it's just `/`.

---

## Setting Up Languages

Tell your site which languages you support in `site.yml`:

```yaml
# site.yml
i18n:
  defaultLocale: en
  locales: [en, es, fr]
```

That's it. The `defaultLocale` is whatever language your content is written in.

### Adding display names

If you want language names to appear nicely in a language switcher:

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

Without labels, the site uses built-in display names for common languages.

---

## The Translation Workflow

Here's the full process, step by step.

### 1. Build your site

```bash
uniweb build
```

The translation tools work from the built content, so you need a fresh build first.

### 2. Extract translatable strings

```bash
uniweb i18n extract
```

This creates a `locales/manifest.json` file listing every piece of text on your site — titles, paragraphs, link labels, everything. Each string gets a short code (a hash) that identifies it.

### 3. Create translation files

```bash
uniweb i18n init es fr
```

This creates `locales/es.json` and `locales/fr.json`, pre-populated with every string from your site. The values start as your original text so you can see what each entry is:

```json
{
  "a1b2c3d4": "Welcome to Our Company",
  "e5f6g7h8": "Learn More"
}
```

If you prefer blank values (useful if you're sending files to a translation service), use:

```bash
uniweb i18n init --empty
```

### 4. Translate

Open each locale file and replace the values with translations:

```json
{
  "a1b2c3d4": "Bienvenido a Nuestra Empresa",
  "e5f6g7h8": "Aprende Más"
}
```

You don't need to translate everything at once. Any string you skip stays in the original language until you provide a translation.

### 5. Build with translations

```bash
uniweb build
```

The site now generates pages for each language:

```
dist/
├── index.html              ← English
├── es/
│   └── index.html          ← Spanish
└── fr/
    └── index.html          ← French
```

That's the whole cycle: **build → extract → init → translate → build**.

---

## Keeping Translations Up to Date

When you change your content — add a page, edit a title, rewrite a paragraph — you need to update the translations.

### Check what changed

```bash
uniweb build
uniweb i18n sync
```

The sync command compares your current content to the manifest and tells you what's new, what changed, and what was removed.

Use `--dry-run` to see the report without changing anything:

```bash
uniweb i18n sync --dry-run
```

### Add new strings to locale files

After syncing, run init again to add any new strings to your locale files:

```bash
uniweb i18n init es fr
```

This only adds missing strings — it never overwrites translations you've already done.

### Check translation coverage

```bash
uniweb i18n status
```

Shows how complete each language is — for example, "Spanish: 92% (43/47 strings)".

For more detail:

```bash
uniweb i18n status es              # Just Spanish
uniweb i18n status --missing       # List every untranslated string
uniweb i18n status --missing --by-page   # Group by page
```

---

## Understanding Your Translation Files

After running extract and init, your site folder looks like this:

```
site/
├── pages/              ← your content
├── site.yml
└── locales/
    ├── manifest.json   ← auto-generated: all strings with their hashes
    ├── es.json         ← Spanish translations
    └── fr.json         ← French translations
```

### The manifest

`manifest.json` is auto-generated. You never need to edit it. It maps each hash to the original text and shows where it appears on your site:

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

This context information is helpful for translators — it tells them that "Welcome to Our Company" is a title on the about page, in the intro section.

### Locale files

These are what you actually translate. Each entry maps a hash to a translated string:

```json
{
  "a1b2c3d4": "Bienvenido a Nuestra Empresa"
}
```

The hashes stay the same as long as the original text doesn't change. If you edit a title, it gets a new hash, and the old translation is no longer used.

---

## When the Same String Needs Different Translations

Sometimes the same English word should translate differently depending on where it appears. For example, "Learn More" on a pricing page might become "See Pricing" in Spanish, while on other pages it stays "Aprende Más".

Use the override format:

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

The key `/pricing:cta` matches the context shown in the manifest — page and section.

Most strings won't need this. Use it only when a word genuinely means something different in context.

---

## Cleaning Up Stale Translations

Over time, as you edit content, some translations become stale — the original text changed or was removed, so the translation isn't used anymore. These won't cause problems, but they clutter your files.

```bash
uniweb i18n audit            # See what's stale
uniweb i18n audit --clean    # Remove stale entries
```

---

## Free-Form Translations

Most of the time, the hash-based approach works well — each title, paragraph, and link gets translated individually. But sometimes a section needs a completely different version for another language. Maybe the Spanish "About" page should have different images, a different structure, or be written from scratch rather than translated.

For those cases, use free-form translations. Instead of translating individual strings, you provide a complete replacement markdown file for a section.

### Create a free-form translation

```bash
uniweb i18n init-freeform es pages/about hero
```

This creates `locales/freeform/es/pages/about/hero.md` with a copy of the original content. Edit it however you like — change the structure, swap images, rewrite completely.

### Keep it up to date

When the original content changes, the site can tell your free-form translation might be outdated:

```bash
uniweb i18n status --freeform         # Check what's stale
uniweb i18n update-hash es --all-stale   # Mark as reviewed
```

### Reorganize when pages move

If you rename or move pages, update your free-form translations to match:

```bash
uniweb i18n move pages/docs/setup pages/getting-started
uniweb i18n rename pages/about hero welcome
```

### Remove orphaned translations

If the original section no longer exists:

```bash
uniweb i18n prune --freeform --dry-run   # Preview
uniweb i18n prune --freeform             # Delete
```

Most sites won't need free-form translations. They're for the special cases where string-by-string translation isn't enough.

---

## Translating Collections

If your site has collections (blog posts, team members, product listings), those are extracted automatically alongside page content:

```bash
uniweb i18n extract
```

Collection strings get their own manifest at `locales/collections/manifest.json` and follow the same translate-and-build workflow.

To extract only collection strings (skipping pages):

```bash
uniweb i18n extract --collections-only
```

---

## Tips

### Start with one language

Don't try to add five languages at once. Get one additional language working end-to-end first. Once the workflow is comfortable, adding more languages is just repeating the same steps.

### Translate what matters first

You don't need 100% coverage to launch. Navigation, headings, and calls to action matter most. Long body paragraphs can come later.

### Use `--json` for translation tools

If you're sending strings to a translation service or using an AI tool:

```bash
uniweb i18n status --missing --json > untranslated.json
```

This exports all untranslated strings in a machine-readable format.

### Run `init` after every extract or sync

Make it a habit. The init command is safe to run any time — it only adds new strings and never overwrites existing translations.

### Test with longer text

German and Finnish text is often much longer than English. French and Spanish are moderately longer. Make sure your pages still look good with longer translations.

---

## Quick Reference

| What you want to do | Command |
|---------------------|---------|
| Extract strings from your site | `uniweb i18n extract` |
| Create or update locale files | `uniweb i18n init es fr` |
| Check translation progress | `uniweb i18n status` |
| See untranslated strings | `uniweb i18n status --missing` |
| Update manifest after content changes | `uniweb i18n sync` |
| Remove stale translations | `uniweb i18n audit --clean` |
| Create a free-form translation | `uniweb i18n init-freeform es pages/about hero` |

---

## What's Next?

- **[Writing Content](./writing-content.md)** — How to write content for sections
- **[Theming](./theming.md)** — Customize colors, fonts, and dark mode
- **[Recipes](./recipes.md)** — Copy-paste solutions for common patterns
