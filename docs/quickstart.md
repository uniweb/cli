# Quickstart

Create your first Uniweb site in 5 minutes.

## Create a Project

```bash
npx uniweb@latest create my-site --template marketing
cd my-site
pnpm install
```

This creates a workspace with:

```
my-site/
├── foundation/          # Your React components
│   └── src/components/
├── site/                # Your content
│   ├── pages/
│   └── site.yml
└── pnpm-workspace.yaml
```

## Start Development

```bash
pnpm dev
```

Open http://localhost:5173. You'll see a working marketing site with Hero, Features, Pricing, and more.

## How It Works

Open `site/pages/home/hero.md`:

```markdown
---
type: Hero
theme: gradient
---

# Build Something Great

Create stunning websites with components and markdown.

[Get Started](/docs)
[Learn More](/about)
```

This content renders through the `Hero` component in `foundation/src/components/Hero/`.

**The pattern:**
- `type: Hero` — Which component renders this section
- `theme: gradient` — Configuration passed to the component
- The markdown body — Content the component receives

## Edit Content

Change the headline in `hero.md`:

```markdown
# Your New Headline Here
```

Save. The page updates instantly.

## Edit a Component

Open `foundation/src/components/Hero/index.jsx`. The component receives:

```jsx
export function Hero({ content, params }) {
  // content.title = "Your New Headline Here"
  // content.paragraphs = ["Create stunning websites..."]
  // content.links = [{ href: "/docs", label: "Get Started" }, ...]
  // params.theme = "gradient"
}
```

Make a change—add a class, tweak the layout. Save. It updates.

## Add a Page

Create a new page folder:

```bash
mkdir -p site/pages/contact
```

Create `site/pages/contact/page.yml`:

```yaml
title: Contact Us
description: Get in touch
```

Create `site/pages/contact/hero.md`:

```markdown
---
type: Hero
theme: light
---

# Contact Us

We'd love to hear from you.

[Email Us](mailto:hello@example.com)
```

Visit http://localhost:5173/contact. Your new page is live.

## Add a Section

Add another section to the contact page. Create `site/pages/contact/2-form.md` (the numeric prefix controls ordering when a page has multiple sections):

```markdown
---
type: TextSection
---

## Send a Message

Fill out the form below and we'll get back to you within 24 hours.

Our team is available Monday through Friday, 9am to 5pm.
```

When a page has multiple sections, they render in order by their numeric prefix (`1-`, `2-`, etc.). Single-section pages don't need a prefix — `hero.md` works fine on its own. You can rename the first section to `1-hero.md` later if you add more.

## Understand the Content Flow

```
Markdown (what you write)
    │
    ▼
┌───────────────────────────┐
│  ---                      │
│  type: Hero               │  ← Which component
│  theme: gradient          │  ← Configuration (params)
│  ---                      │
│                           │
│  # Headline               │  ← content.title
│                           │
│  Description paragraph.   │  ← content.paragraphs[0]
│                           │
│  [Button](/path)          │  ← content.links[0]
└───────────────────────────┘
    │
    ▼
Component receives { content, params }
    │
    ▼
React renders the UI
```

Components don't fetch or parse. They receive structured data and render.

## Build for Production

```bash
pnpm build
```

This builds:
1. The foundation → `foundation/dist/`
2. The site → `site/dist/`

With pre-rendering enabled (`build.prerender: true` in `site.yml`), you get static HTML:

```
site/dist/
├── index.html
├── about.html
├── contact.html
└── assets/
```

## Deploy

The `site/dist/` folder is a static site. Deploy anywhere:

**Vercel:**
```bash
cd site && vercel
```

**Netlify:**
```bash
cd site && netlify deploy --prod --dir=dist
```

**Any static host:**
Upload the contents of `site/dist/`.

---

## Next Steps

| Want to... | Read |
|------------|------|
| Understand content structure | [Content Structure](./content-structure.md) |
| Create custom components | [Component Metadata](./component-metadata.md) |
| Configure your site | [Site Configuration](./site-configuration.md) |
| Add multiple languages | [Internationalization](./internationalization.md) |
| Load external data | [Data Fetching](./data-fetching.md) |
| Generate pages from data | [Dynamic Routes](./dynamic-routes.md) |

## Common Templates

```bash
# Documentation site
npx uniweb create docs-site --template docs

# Minimal starter
npx uniweb create my-project --template single

# Multi-site workspace
npx uniweb create my-workspace --template multi
```

See [CLI Commands](./cli-commands.md) for all options.
