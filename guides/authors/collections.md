# Working with Collections

Collections let you manage repeating content — blog posts, team members, products, case studies — as a set of markdown files. You write each item in its own file, tell the site where to find them, and they appear wherever you need them.

This guide covers everything you need to know as a content author. No coding required.

---

## What Collections Are

Most of your content lives in `pages/` — one folder per page, with markdown files for each section. Collections are different. They live in `library/` and hold **items that share the same structure**.

Think of it like a filing cabinet. Pages are the rooms of your site. The library is where you keep organized sets of things — articles, team bios, products — that pages can pull from.

```
site/
├── pages/             ← Your site's pages
│   ├── home/
│   ├── about/
│   └── blog/
├── library/           ← Your collections
│   ├── articles/
│   │   ├── getting-started.md
│   │   ├── design-tips.md
│   │   └── our-roadmap.md
│   └── team/
│       ├── alice.md
│       ├── bob.md
│       └── carol.md
└── site.yml
```

Each markdown file in a collection folder becomes one item. The file `getting-started.md` becomes the article "Getting Started." The file `alice.md` becomes the team member "Alice."

---

## When to Use Collections

Collections and items-in-a-section can both show repeating content. Here's how to choose:

| | Items in a section | Collection |
|---|---|---|
| **Where content lives** | All in one `.md` file | Each item in its own `.md` file |
| **Best for** | A few items that belong together (3–6 features, a short FAQ) | Many items that grow over time (blog posts, team members) |
| **Individual pages** | No | Yes — each item can have its own URL |
| **Sorting and filtering** | No | Yes — by date, tags, or any field |
| **Example** | Feature cards on a landing page | Blog articles with their own pages |

**Rule of thumb:** If you'll keep adding items over weeks and months, use a collection. If it's a fixed set that belongs to one section, use items in a single markdown file.

---

## Writing Collection Items

Each collection item is a markdown file with two parts: **frontmatter** (the metadata at the top) and **body content** (the text below).

### The Frontmatter

Frontmatter is the block between `---` lines at the top of the file. It holds structured information about the item — things like the title, date, and tags.

| Field | What it does | Example |
|-------|-------------|---------|
| `title` | The item's display name | `title: Getting Started` |
| `date` | When it was published | `date: 2025-03-15` |
| `tags` | Categories or labels | `tags: [tutorial, beginner]` |
| `image` | A thumbnail or hero image | `image: ./hero.jpg` |
| `description` | A short summary | `description: Learn the basics` |
| `published` | Whether to include it (default: yes) | `published: false` |
| `author` | Who wrote it | `author: Sarah Chen` |

You can add any other fields you need — `price`, `role`, `location`, `order` — whatever makes sense for your content. The site will pass them through.

### The Body Content

Below the frontmatter, write standard markdown — the same kind you use for page sections. Headings, paragraphs, images, links, lists — it all works.

### A Complete Example

Here's a blog article:

```markdown
---
title: Design Tips for Small Teams
date: 2025-06-10
author: Alice Park
tags: [design, teams]
image: ./design-tips-cover.jpg
description: Practical advice for teams without a dedicated designer.
---

# Design Tips for Small Teams

You don't need a full design team to ship something that looks good.

## Start with Constraints

Pick one font, two colors, and a consistent spacing scale. Constraints make decisions easier.

## Borrow Patterns, Not Pixels

Look at sites you admire. Notice how they handle navigation, cards, and whitespace — then adapt those patterns to your own content.

![Spacing example](./spacing-diagram.svg)

## Ship and Iterate

Don't wait for perfection. Ship something simple, get feedback, and improve.
```

And here's a team member:

```markdown
---
title: Alice Park
role: Lead Designer
image: ./alice.jpg
order: 1
---

Alice leads the design team. She specializes in design systems and accessibility.

Previously at Figma and Google. Speaker at Config and SmashingConf.
```

Notice the differences: the article has `date`, `tags`, and `author`; the team member has `role` and `order`. Each collection uses whatever fields make sense for its content.

---

## Declaring Collections in site.yml

Your site needs to know about your collections. You declare them in `site.yml`.

### Simple form

If you just need to point to a folder:

```yaml
collections:
  articles: library/articles
```

That's it. Every markdown file in `library/articles/` becomes an item in the `articles` collection.

### With options

For more control, use the extended form:

```yaml
collections:
  articles:
    path: library/articles
    sort: date desc
    filter: published != false
    limit: 100
```

| Option | What it does | Example |
|--------|-------------|---------|
| `path` | Folder containing the markdown files | `library/articles` |
| `sort` | Order items by a field | `date desc` (newest first) |
| `filter` | Include only matching items | `published != false` |
| `limit` | Maximum number of items | `100` |

**Sorting:** Add `asc` (A→Z, oldest first) or `desc` (Z→A, newest first) after the field name. For example, `sort: date desc` shows newest articles first. `sort: title asc` sorts alphabetically.

**Filtering:** Common filters:

```yaml
# Only published items (skip drafts)
filter: published != false

# Only items tagged "featured"
filter: tags contains featured

# Only items from 2025 onward
filter: date > 2025-01-01
```

### Multiple collections

A site can have as many collections as it needs:

```yaml
collections:
  articles:
    path: library/articles
    sort: date desc

  team:
    path: library/team
    sort: order asc

  products:
    path: library/products
    sort: title asc
```

---

## Displaying Collections on Pages

Once you've declared a collection, you can show its items on any page.

### The data shorthand

The simplest way is the `data:` line in `page.yml`:

```yaml
# pages/blog/page.yml
title: Blog
data: articles
```

This tells the page to load the `articles` collection. The page's section types then display those articles — as a grid of cards, a list, or however the site's design presents them.

### Showing a few items on another page

Want to show the latest three articles on your homepage? Use `fetch:` in a section's frontmatter:

```yaml
---
type: ArticleTeaser
fetch:
  collection: articles
  limit: 3
  sort: date desc
---

# Latest from the Blog
```

This pulls just three articles, sorted newest first, for a teaser section. The full blog page still shows everything.

---

## Individual Pages for Collection Items

Collections become even more useful when each item gets its own page — like `/blog/design-tips` for a blog article or `/team/alice` for a team member.

### The [slug] folder

Create a folder with square brackets in the name:

```
pages/
└── blog/
    ├── page.yml          ← The blog list page
    ├── list.md
    └── [slug]/           ← Creates a page for each article
        ├── page.yml
        └── article.md
```

```yaml
# pages/blog/page.yml
title: Blog
data: articles
```

The `[slug]` folder tells the site: "For each item in the collection, create a page." The article at `library/articles/design-tips.md` becomes the page `/blog/design-tips`. The one at `library/articles/getting-started.md` becomes `/blog/getting-started`.

The section inside `[slug]/` receives the individual item's content automatically. You don't need to do anything special in the markdown file — just set the section type:

```markdown
<!-- pages/blog/[slug]/article.md -->
---
type: Article
---
```

These generated pages don't appear in navigation menus. They're meant to be reached through the list page or direct links.

For the full blog recipe with step-by-step setup, see [Recipes](./recipes.md).

---

## Drafts and Unpublished Items

To hide an item from your site without deleting it, set `published: false` in the frontmatter:

```markdown
---
title: Upcoming Feature Announcement
date: 2025-07-01
published: false
---

This article won't appear anywhere on the site.
```

Items without a `published` field are included by default — you only need to add it when you want to hide something.

This is useful for:

- **Drafts** you're still writing
- **Scheduled content** you've prepared ahead of time
- **Archived items** you want to keep on disk but remove from the site

When you're ready to publish, change `published: false` to `published: true` or just remove the line entirely.

---

## Keeping Images with Your Content

You can store images and other files right next to your markdown files. This keeps everything for one item in the same place.

```
library/articles/
├── design-tips.md
├── design-tips-cover.jpg     ← Cover image for the article
├── spacing-diagram.svg       ← Diagram used in the article
├── getting-started.md
└── getting-started-hero.jpg
```

Reference these files with `./` in your markdown:

```markdown
---
title: Design Tips for Small Teams
image: ./design-tips-cover.jpg
---

![Spacing example](./spacing-diagram.svg)
```

The `./` means "in the same folder as this file." The build processes these references automatically — you don't need to worry about where the files end up in the final site.

**Tip:** Name your images to match the markdown file they belong to. `design-tips-cover.jpg` clearly belongs to `design-tips.md`. This keeps things organized as your collection grows.

---

## Beyond Blogs

Collections work for any repeating content, not just articles. Here are a few common patterns.

### Team directory

```
library/team/
├── alice-park.md
├── bob-silva.md
└── carol-wu.md
```

```markdown
---
title: Alice Park
role: Lead Designer
image: ./alice-park.jpg
order: 1
---

Alice leads the design team with a focus on accessibility and design systems.
```

```yaml
# site.yml
collections:
  team:
    path: library/team
    sort: order asc
```

### Product catalog

```
library/products/
├── starter-plan.md
├── pro-plan.md
└── enterprise-plan.md
```

```markdown
---
title: Pro Plan
price: $49/month
features: [Unlimited projects, Priority support, Custom domains]
image: ./pro-plan-icon.svg
order: 2
---

Everything you need to grow. Includes all Starter features plus priority support and custom domain mapping.
```

```yaml
# site.yml
collections:
  products:
    path: library/products
    sort: order asc
```

### Case studies

```
library/cases/
├── acme-corp.md
├── globex.md
└── initech.md
```

```markdown
---
title: Acme Corp
industry: Manufacturing
image: ./acme-logo.svg
date: 2025-04-20
tags: [enterprise, manufacturing]
---

## The Challenge

Acme needed to consolidate 12 regional websites into a single platform.

## The Solution

We built a multilingual site with dynamic routing for each region.

## Results

- 60% reduction in maintenance costs
- 3x faster content updates
```

```yaml
# site.yml
collections:
  cases:
    path: library/cases
    sort: date desc
```

---

## Excerpts

When your collection is displayed as a list — blog cards, product summaries, search results — each item needs a short preview. These are called excerpts.

**Automatic excerpts:** If you don't do anything special, the site generates an excerpt from the first ~160 characters of your content body. This works fine in most cases.

**Explicit description:** For more control, add a `description` field to your frontmatter:

```markdown
---
title: Design Tips for Small Teams
description: Practical advice for teams without a dedicated designer — constraints, borrowed patterns, and the art of shipping early.
---
```

When a `description` is present, it's used as the excerpt instead of the auto-generated one. This lets you write a polished summary rather than relying on whatever your first paragraph happens to say.

You can also configure excerpt behavior in `site.yml`:

```yaml
collections:
  articles:
    path: library/articles
    sort: date desc
    excerpt:
      maxLength: 200          # Characters (default: 160)
      field: description      # Prefer this frontmatter field
```

---

## Tips

- **Start with two or three items.** You can always add more later. Starting small lets you settle on the right frontmatter fields before writing dozens of files.

- **Filenames become URLs.** The file `design-tips.md` creates the slug `design-tips`, which becomes part of the URL (`/blog/design-tips`). Use lowercase, hyphen-separated names.

- **Keep collections flat.** Put all items directly in the collection folder — don't create subfolders. `library/articles/design-tips.md` works. `library/articles/2025/design-tips.md` does not.

- **Items vs. collections — a rule of thumb.** If you're writing content that fits naturally in one section (a few feature cards, a short FAQ), use items in a single markdown file. If the content is a growing catalog (blog posts, team members, products), use a collection.

- **Use consistent frontmatter.** If your blog articles use `date`, `author`, and `tags`, add those fields to every article — even if some are optional. Consistency makes your content predictable and easier to maintain.

- **Preview with `pnpm dev`.** Collections update automatically during development. Add a file, save it, and the site refreshes.

---

## Quick Reference

| What you want to do | How to do it |
|---------------------|-------------|
| Create a collection | Add markdown files to a folder in `library/` |
| Declare it | Add a `collections:` entry in `site.yml` |
| Sort items | `sort: date desc` or `sort: title asc` in `site.yml` |
| Filter items | `filter: published != false` in `site.yml` |
| Show on a page | `data: articles` in `page.yml` |
| Show a subset | `fetch: { collection: articles, limit: 3 }` in section frontmatter |
| Create detail pages | Add a `[slug]/` folder under the list page |
| Hide a draft | `published: false` in item frontmatter |
| Add an image | Store next to the `.md` file, reference with `./` |
| Write an excerpt | Add `description:` to item frontmatter |

---

## What's Next?

- **[Writing Content](./writing-content.md)** — How to write sections in markdown
- **[Recipes](./recipes.md)** — Copy-paste patterns including a full blog setup
- **[Site Setup](./site-setup.md)** — Site configuration, pages, locales, and more
- **[Translating Your Site](./translating-your-site.md)** — Add multiple languages

For technical details on collection processing, see [Content Collections](../../docs/content-collections.md).
