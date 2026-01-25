# Linking

A robust linking system that survives content reorganization and works seamlessly in single-page applications.

## The Problem with Traditional Links

In traditional websites, links are tied to URL paths:

```markdown
[Installation Guide](/docs/getting-started/installation)
[Contact Section](/about#contact-form)
```

This works until you reorganize your content. Move "Installation" under a new "Setup" section? Every link breaks. Rename a page? Broken links. Reorder sections on a page? Hash links stop working.

Documentation sites are particularly vulnerable—content restructuring is routine as projects evolve. Maintaining hundreds of internal links becomes a burden that discourages improvement.

## Stable References

Uniweb solves this with a **stable reference system** that decouples a page's identity from its location in the site hierarchy.

```markdown
[Installation Guide](page:installation)
[Contact Section](page:about#contact)
```

These links resolve to the correct URL regardless of where the content lives. Move "Installation" anywhere in your site—the link still works.

## How It Works

### Section IDs (Automatic)

Every section gets a stable ID derived from its filename:

```
pages/home/
├── 1-hero.md         → #section-hero
├── 2-features.md     → #section-features
├── 2.5-testimonials.md → #section-testimonials
└── 3-cta.md          → #section-cta
```

The numeric prefix is for ordering only—the ID comes from the name part. You can freely reorder sections (change `2-features.md` to `5-features.md`) without breaking any links to `#section-features`.

**Override when needed** via frontmatter:

```yaml
---
type: ContactForm
id: contact
---
```

### Page IDs (Optional)

By default, pages are referenced by their route path:

```markdown
[About Us](page:about)
[API Docs](page:docs/api)
```

For pages that might move, add an explicit ID in `page.yml`:

```yaml
# pages/docs/getting-started/installation/page.yml
id: installation
title: Installation Guide
```

Now `page:installation` resolves correctly even if you later move the page to `pages/setup/install/`.

## Link Syntax

The `page:` protocol supports pages, sections, and combinations:

| Syntax | Resolves To |
|--------|-------------|
| `page:about` | `/about` |
| `page:docs/api` | `/docs/api` |
| `page:about#contact` | `/about#section-contact` |
| `page:installation` | Route of page with `id: installation` |
| `page:installation#requirements` | Same page, scrolls to requirements section |

### In Markdown Content

```markdown
For setup instructions, see the [Installation Guide](page:installation).

Have questions? Visit our [contact form](page:about#contact).
```

### In Components

The `Link` component from `@uniweb/kit` handles resolution automatically:

```jsx
import { Link } from '@uniweb/kit'

function Navigation() {
  return (
    <nav>
      <Link to="page:home">Home</Link>
      <Link to="page:docs">Documentation</Link>
      <Link to="page:about#team">Our Team</Link>
    </nav>
  )
}
```

## Cross-Page Scrolling

When navigating to a page with a hash (e.g., `page:about#contact`), the runtime:

1. Navigates to the page via client-side routing
2. Waits for the page to render
3. Smoothly scrolls to the target section

This works in both SPA mode (development) and with pre-rendered pages (production).

## When to Use Explicit IDs

**Section IDs** are automatic—you rarely need to override them. Do so only when:
- The filename doesn't reflect the section's purpose
- You want a shorter/cleaner hash URL
- Multiple sections could have similar auto-generated IDs

**Page IDs** are optional. Add them when:
- The page is frequently linked to from other pages
- You anticipate reorganizing your site structure
- The page is part of a versioned documentation set
- You want URLs to survive localization (same ID across `/en/` and `/es/`)

## Comparison with Other Approaches

| Approach | Pros | Cons |
|----------|------|------|
| **Path-based links** | Simple, familiar | Break on reorganization |
| **Link checking tools** | Catch broken links | Fix after the fact, maintenance burden |
| **CMS-managed links** | Centralized | Requires CMS, vendor lock-in |
| **Uniweb stable IDs** | Automatic, survives changes | Requires `page:` protocol |

## Best Practices

1. **Use `page:` for internal links**—plain paths still work but don't get the stability benefits

2. **Let section IDs be automatic**—meaningful filenames like `2-features.md` give you `#section-features` for free

3. **Add page IDs proactively** for high-traffic pages in documentation sites

4. **Keep IDs short and descriptive**—they appear in URLs when users share links

5. **Don't change IDs** once content is published—they're part of your public API

## Technical Details

### Resolution Order

For `page:some-id`:
1. Check for page with explicit `id: some-id` in page.yml
2. Fall back to route-based lookup (`/some-id`)

### DOM IDs

Sections render with `id="section-{stableId}"`. The `section-` prefix prevents collisions with other page elements.

### Runtime vs Build

- **Development (SPA)**: Links resolve at runtime via the Website class
- **Production (SSG)**: Pre-rendered HTML includes resolved routes; runtime handles client-side navigation

### Locale Independence

The `page:` protocol is locale-agnostic. `page:about#contact` resolves to `/about#section-contact` for English users and `/es/about#section-contact` for Spanish users automatically.
