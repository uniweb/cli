# Writing Content for Your Uniweb Site

This guide walks you through writing content for a Uniweb site. No coding experience required — if you can write a text file, you can author content.

Your content lives in the `site/pages/` folder. Each page is a folder, and each section on a page is a `.md` (markdown) file.

---

## How Content Works

When you write content in Uniweb, you provide the **ingredients** — titles, paragraphs, images, links, icons. The section type (`type:` in frontmatter) decides how those ingredients are presented.

You don't need to tell the site where to place things, how big to make them, or what colors to use. You provide the content, choose a type, and the site handles the rest.

---

## Your First Section

Open any `.md` file in your site and you'll see two parts:

```markdown
---
type: Hero
---

# Welcome to Our Site

We build things that matter.

[Get Started](/signup)
```

The part between `---` lines is called **frontmatter** — it's settings for this section. The `type:` tells the site how to display this section (as a hero banner, a feature grid, an FAQ, etc.). Everything below the frontmatter is your content.

That's the whole pattern: **settings on top, content below.**

The available types depend on the template your site uses. Look at the existing `.md` files in your site to see which types are available, and check your template's documentation for details on each one.

---

## Headings Become Structure

This is the most important concept in Uniweb content. Your headings aren't just visual sizes — they create meaning that determines how the section is built.

```markdown
# Welcome to Acme          ← becomes the title
## Build faster with us    ← becomes the subtitle

We help teams ship.        ← becomes a paragraph
```

Here's how headings map to what appears on screen:

| What you write | What it becomes |
|---------------|-----------------|
| First heading | The main title |
| Next heading after the title | The subtitle |
| Body text | Paragraphs |

You can also add a **pretitle** (small text above the title, sometimes called an "eyebrow") by putting a smaller heading before your main heading:

```markdown
### Featured                ← becomes the pretitle
# Our Latest Product        ← becomes the title
## Available now             ← becomes the subtitle
```

The system detects this automatically — any heading followed by a more important heading becomes a pretitle.

**Heading levels are relative, not absolute.** Whether you use `#` or `##` for your title, the result is the same — the visual size is determined by the section type, not by your heading level. Use headings to create the right *structure* (title, subtitle, items), not to control font size.

---

## Adding Images

Use standard markdown image syntax:

```markdown
![Team photo](./team.jpg)
```

### Path options

```markdown
![Photo](./photo.jpg)              <!-- Same folder as this .md file -->
![Logo](../shared/logo.svg)        <!-- Relative path -->
![Hero](/images/hero.jpg)          <!-- From the public/ folder -->
![External](https://example.com/photo.jpg)  <!-- External URL -->
```

That's all you need. The section type decides how to size, position, and display your images.

### Image roles

Sometimes you need to tell the site what an image is *for*. Use the `role` attribute:

```markdown
![Skyline](./skyline.jpg){role=background}
```

The most common role is `background` — it tells the section to use the image as a background rather than displaying it inline. Other roles depend on the section type.

### Clickable images

Make an image link to somewhere:

```markdown
![Product](./screenshot.jpg){href=/products/details}
```

### Build optimizations

During build, local images (PNG, JPG, GIF) are automatically converted to WebP for smaller files. SVG and WebP pass through unchanged.

---

## Adding Links

Links work like standard markdown:

```markdown
[Learn more](/about)
```

### Standalone links become buttons

When a link is the only thing on a line, it's treated as an action and typically appears as a button:

```markdown
[Get Started](/signup)
[Learn More](/docs)
```

You don't need to specify how the button looks — the section type handles that. Just provide the label and destination.

### Links inside text stay inline

When a link is part of a sentence, it shows as a normal text link:

```markdown
Visit our [about page](/about) to learn more.
```

### Opening links in a new tab

Use `{target=_blank}` when you want a link to open in a new tab (typically for external sites):

```markdown
[Visit GitHub](https://github.com/example){target=_blank}
```

### Download links

Mark a link as a download:

```markdown
[Download Report](/report.pdf){download}
```

### Stable internal links

Use the `page:` protocol for links that survive reorganization:

```markdown
[Installation Guide](page:installation)
[Contact Section](page:about#contact)
```

These resolve to the correct URL even if pages get moved around. See the [Linking guide](../linking.md) for details.

---

## Adding Icons

Icons use the image syntax with a special name format:

```markdown
![](lu-house)
```

That's it — the short code (`lu`) plus a dash plus the icon name (`house`).

### Alternative formats

These all work and are equivalent:

```markdown
![](lu-house)            <!-- Recommended: short code + dash -->
![](lu:house)            <!-- Short code + colon -->
![](lucide:house)        <!-- Full library name + colon -->
```

### Icons next to links

When an icon appears right next to a link, they're treated as a single concept — a link with an icon:

```markdown
![](lu-arrow-right) [Get Started](/signup)
```

This is one of the few cases where position matters in Uniweb content.

### Browsing available icons

The easiest way to find icon names is to browse them visually at [react-icons.github.io/react-icons](https://react-icons.github.io/react-icons/). The icon names there match the ones you use in Uniweb — just use the short code prefix with a dash.

### Supported icon families

| Code | Library |
|------|---------|
| `lu` | Lucide |
| `hi` / `hi2` | Heroicons v1 / v2 |
| `fi` | Feather |
| `pi` | Phosphor |
| `tb` | Tabler |
| `bs` | Bootstrap Icons |
| `md` | Material Design |
| `ai` | Ant Design Icons |
| `ri` | Remix Icon |
| `si` | Simple Icons |
| `io5` | Ionicons 5 |
| `bi` | Boxicons |
| `vsc` | VS Code Codicons |
| `wi` | Weather Icons |
| `gi` | Game Icons |
| `fa` / `fa6` | Font Awesome 5 / 6 |

### Using your own SVG icons

If you have custom SVG files, use them directly:

```markdown
![Logo](./logo.svg){role=icon}
```

---

## Creating Repeating Content (Items)

Items are how you create cards, features, team members, FAQ entries — anything that repeats. The pattern is simple: **headings after body content start new items.**

```markdown
# Our Features

We built this for you.

### Fast

Lightning quick response times.

### Secure

Enterprise-grade security.

### Simple

No configuration required.
```

This produces a section with the title "Our Features", an intro paragraph, and three items — each with their own title and description. The section type determines how items look: as cards, accordion panels, grid cells, etc.

### Items can have everything

Each item can have its own paragraphs, images, links, and icons — just like the main content:

```markdown
# Our Team

### Sarah Chen

![Sarah](./sarah.jpg)

Lead Engineer at Acme Corp.

[LinkedIn](https://linkedin.com/in/sarah){target=_blank}

### Alex Rivera

![Alex](./alex.jpg)

Senior Designer.

[Portfolio](https://alex.design){target=_blank}
```

The order of elements within an item (image, text, link) doesn't matter — the section type decides how to arrange them. What matters is that each item contains the right pieces of content.

### Items without headings (divider pattern)

You can also create items using horizontal rules (`---`) instead of headings:

```markdown
# Testimonials

---

> "Absolutely transformed our workflow."

**Jane Smith**, CEO at TechCo

---

> "Best tool we've adopted this year."

**Mike Johnson**, CTO at StartupX
```

### The key rule

**A new item starts when a heading appears after other content (paragraphs, images, etc.).** The heading at the top becomes the title, content follows, then each subsequent heading creates a new item.

---

## Structured Data Blocks

Some section types need structured data that doesn't fit naturally into headings and paragraphs — like form fields, pricing configuration, or navigation menus. Use tagged code blocks:

````markdown
```yaml:form
fields:
  - name: email
    type: email
    required: true
  - name: message
    type: textarea
submitLabel: Send Message
```
````

The tag after the colon (`form`) identifies the data. What tags are supported depends on the section type — check your template's documentation or existing examples for patterns.

### Supported formats

Both YAML and JSON work:

````markdown
```yaml:pricing
tiers:
  - name: Free
    price: 0
  - name: Pro
    price: 29
```
````

### Untagged code blocks

Code blocks without a tag (just `` ```js `` or `` ```python ``) are display-only — they show formatted code on the page but don't get parsed as data.

---

## Styling Text

Standard markdown formatting works:

```markdown
This is **bold text** and this is *italic text*.

This is `inline code` for technical terms.

> This is a blockquote for testimonials or callouts.
```

### Lists

```markdown
- First item
- Second item with **bold**
- Third item with a [link](/path)

1. Step one
2. Step two
3. Step three
```

### Inline text styling

You can tag a piece of text with a style using brackets and curly braces:

```markdown
This has [highlighted text]{.highlight} for emphasis.

Here's a [less prominent note]{.muted} alongside regular text.
```

The syntax is `[your text]{.stylename}`. You can combine multiple styles: `[important]{.callout .bold}`.

What styles are available and how they look depends on your template.

---

## Pages and Folders

Your site's page structure lives in the `pages/` folder. **Each folder is a page, and each page is a route.** The folder hierarchy maps directly to URLs:

```
pages/
├── home/               → / (homepage, set via index: in site.yml)
├── about/              → /about
├── docs/               → /docs
│   ├── getting-started/  → /docs/getting-started
│   └── api/              → /docs/api
└── pricing/            → /pricing
```

You can add a `page.yml` file to set the page title, description, and other settings. If you don't, the title defaults to the folder name.

```yaml
title: About Us
description: Learn about our company
```

## Sections on a Page

Each `.md` file in a page folder is a section on that page:

```
pages/home/
├── page.yml            ← page settings (optional)
├── 1-hero.md           ← first section
├── 2-features.md       ← second section
└── 3-cta.md            ← third section
```

The number before the dash sets the display order. Sections appear top to bottom.

Need to add a section between existing ones? Use decimals — `2.5-testimonials.md` goes between `2-features.md` and `3-cta.md` without renaming anything.

The number prefix doesn't appear anywhere on your site. It's just for ordering.

## Pages with Child Pages

A folder can have both its own content (`.md` files) *and* child pages (subfolders):

```
pages/docs/
├── page.yml            ← the /docs page settings
├── 1-intro.md          ← sections on /docs
├── getting-started/    ← child page at /docs/getting-started
│   └── 1-guide.md
└── api/                ← child page at /docs/api
    └── 1-reference.md
```

Both `/docs` and `/docs/getting-started` exist as independent pages — they don't conflict.

## Container Pages (No Content)

A page folder doesn't need any `.md` files. A folder without `.md` files acts as a container — it groups child pages without having its own content:

```
pages/docs/
├── page.yml
├── getting-started/
│   └── 1-guide.md
└── api/
    └── 1-reference.md
```

When someone visits `/docs`, the site shows one of the child pages (by default, the first one). You can choose which one by setting `index:` in `page.yml`:

```yaml
# pages/docs/page.yml
title: Documentation
index: getting-started
```

---

## Section Settings (Frontmatter)

The frontmatter at the top of each `.md` file controls how that section is displayed:

```yaml
---
type: Features
theme: dark
---
```

### Common settings

| Setting | What it does |
|---------|-------------|
| `type:` | How this section is displayed (required) |
| `theme:` | Visual variant (e.g., `dark`, `light`) |
| `preset:` | Apply a preset configuration |
| `id:` | Override the section's anchor ID |

### Type-specific settings

Each section type can accept its own settings. For example:

```yaml
---
type: Hero
theme: gradient
---
```

What settings are available depends entirely on the section type. The best way to find out:

1. **Look at the template examples** — the `.md` files that came with your site use the most common settings
2. **Check your template's documentation** — it describes what each type supports
3. **Ask your developer** — they know what settings are available
4. **Experiment** — try different values and see what changes in the preview

### Background settings

Some section types support background images or videos:

```yaml
---
type: Hero
theme: dark
background:
  image: /images/hero.jpg
  overlay:
    type: dark
    opacity: 0.5
---
```

Whether backgrounds are supported depends on the section type. Check your template's existing sections for examples.

---

## Tips and Common Mistakes

### Content is ingredients, not layout

You provide the content — titles, paragraphs, images, links, icons. The section type decides how to arrange and style them. You don't need to control sizes, positions, or colors. Just focus on *what* you want to say.

### Items come from headings after content, not heading level

```markdown
<!-- WRONG assumption: "H3 always creates items" -->
### This is actually the title (it's the first heading)

<!-- CORRECT understanding: items start when a heading appears after content -->
# Title

Some content here.

### This starts an item (heading after content)
### This starts another item
```

### Heading levels are semantic, not visual

Don't choose heading levels for size. `#` vs `##` vs `###` — the visual size is controlled by the section type. Use headings to create the right *structure* (title, subtitle, items).

### You don't need to fill everything

If your section doesn't have images, that's fine. If it doesn't have links, that's fine too. Sections gracefully handle whatever you provide — a section with just a title is perfectly valid.

---

## What's Next?

- **[Recipes](./recipes.md)** — Copy-paste solutions for common content patterns
- **[Linking](../linking.md)** — Stable internal links with the `page:` protocol
- **[Search](../search.md)** — Adding search to your site
