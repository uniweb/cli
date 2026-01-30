# Content Recipes

Copy-paste solutions for common content patterns. Each recipe shows the markdown you write and notes on key points.

For deeper explanations, see the [Writing Content](./writing-content.md) guide.

**Note:** These recipes use generic type names (`Hero`, `Features`, `FAQ`, etc.). Your site's template may use different names — check the existing `.md` files in your site to see what types are available, and your template's documentation for details.

---

## Sections

### Hero with Image and CTA Buttons

A bold landing section with headline, description, buttons, and a hero image.

```markdown
---
type: Hero
theme: gradient
---

### Welcome to
# Acme Corp
## Build something great

We help teams ship products faster with modern tools and beautiful design.

[Get Started](/signup)
[Watch Demo](/demo)

![Hero illustration](./hero.jpg)
```

- The `### → #` pattern creates a pretitle ("Welcome to") above the title.
- Standalone links become CTA buttons. The section type decides how they look.
- The image, links, and paragraphs are ingredients — the section type arranges them.

---

### Feature Grid with Icons

A grid of feature cards, each with an icon, title, and description.

```markdown
---
type: Features
---

# Why Choose Us

We've built the tools you need.

### Lightning Fast

![](lu-zap)

Sub-second load times across all devices.

### Bank-Grade Security

![](lu-shield)

Enterprise security with end-to-end encryption.

### Easy Integration

![](lu-plug)

Connect with your existing tools in minutes.

### 24/7 Support

![](lu-headphones)

Real humans ready to help around the clock.

### Analytics Built In

![](lu-bar-chart-3)

Track everything that matters, nothing that doesn't.

### Open Source

![](lu-github)

Transparent, auditable, community-driven.
```

- Each `###` heading starts a new item (card).
- Icons use the `lu-name` format (Lucide). Browse all icons visually at [react-icons.github.io/react-icons](https://react-icons.github.io/react-icons/).

---

### FAQ Section

Expandable questions and answers.

```markdown
---
type: FAQ
---

# Frequently Asked Questions

### How do I get started?

Sign up for a free account and follow our quickstart guide. You'll have your first project running in under five minutes.

### Is there a free plan?

Yes! Our free tier includes unlimited projects and up to 3 team members. No credit card required.

### Can I use my own domain?

Absolutely. Connect any custom domain in your project settings. We handle SSL certificates automatically.

### How do I cancel?

You can cancel anytime from your account settings. No questions asked, no hidden fees.
```

- Each `###` heading becomes a question. The paragraphs below it are the answer.

---

### Pricing Table

Pricing tiers with feature lists.

````markdown
---
type: Pricing
---

# Simple, Transparent Pricing

Choose the plan that's right for you.

### Starter

$9/month

Perfect for individuals and small projects.

- 5 projects
- 1 team member
- Community support
- Basic analytics

[Get Started](/signup?plan=starter)

### Pro

$29/month

For growing teams that need more.

- Unlimited projects
- 10 team members
- Priority support
- Advanced analytics
- Custom domains

[Get Started](/signup?plan=pro)

### Enterprise

Custom

For organizations with advanced needs.

- Everything in Pro
- Unlimited team members
- Dedicated support
- SLA guarantee
- SSO / SAML

[Contact Sales](/contact)

```yaml:pricing
billingToggle: true
annual:
  starter: 7
  pro: 24
  enterprise: null
```
````

- Each `###` heading is a pricing tier with its own paragraphs, lists, and links.
- The YAML data block passes structured data (like billing toggle config) to the section.

---

### Testimonials

Quote cards from customers.

```markdown
---
type: Testimonials
---

# What Our Customers Say

### Jane Smith

> "Absolutely transformed how we build websites. We shipped our redesign in half the time."

CEO at TechCo

![Jane](./jane.jpg)

### Mike Johnson

> "The best developer experience I've found. My team loves working with it."

CTO at StartupX

![Mike](./mike.jpg)

### Sarah Chen

> "Finally, a tool where our content team and engineering team don't step on each other."

VP Engineering at ScaleUp

![Sarah](./sarah.jpg)
```

- Each `###` is a person. Their quote uses blockquote syntax (`>`).
- The paragraph after the quote is their role/company.
- Images become avatars. The order of quote, role, and image within each item doesn't matter.

---

### Team Page

Photo + name + role cards.

```markdown
---
type: Team
---

# Our Team

The people behind the product.

### Sarah Chen

![Sarah](./sarah.jpg)

Lead Engineer

Building systems that scale. Previously at Google and Stripe.

[LinkedIn](https://linkedin.com/in/sarah){target=_blank}

### Alex Rivera

![Alex](./alex.jpg)

Head of Design

Crafting experiences users love. Award-winning designer.

[Portfolio](https://alex.design){target=_blank}

### Jordan Park

![Jordan](./jordan.jpg)

Product Manager

Turning ideas into shipped features. 10 years in SaaS.

[Twitter](https://twitter.com/jordan){target=_blank}
```

- Each `###` is a team member. Provide their image, role, bio, and links — the section type arranges them.

---

### Image Gallery

A collection of images displayed in a grid.

```markdown
---
type: Gallery
---

# Project Gallery

![Mountain landscape](./mountain.jpg)
![City skyline](./city.jpg)
![Ocean sunset](./ocean.jpg)
![Forest trail](./forest.jpg)
![Desert dunes](./desert.jpg)
![Lake reflection](./lake.jpg)
```

- Just list your images. The section type handles the gallery layout.
- Alt text is important for accessibility and may be used as captions.

---

### Logo Cloud

A row of partner or client logos.

```markdown
---
type: LogoCloud
---

# Trusted By

![Acme Corp](./logos/acme.svg)
![TechCo](./logos/techco.svg)
![StartupX](./logos/startupx.svg)
![ScaleUp](./logos/scaleup.svg)
![BigCorp](./logos/bigcorp.svg)
```

- Just list your logo images. Use SVG for best quality at any size.

---

### Contact Form

A form section using structured data for field configuration.

````markdown
---
type: Contact
---

# Get in Touch

We'd love to hear from you. Fill out the form below and we'll get back to you within 24 hours.

![](lu-mail)

```yaml:form
fields:
  - name: name
    label: Full Name
    type: text
    required: true
  - name: email
    label: Email Address
    type: email
    required: true
  - name: subject
    label: Subject
    type: select
    options:
      - General Inquiry
      - Technical Support
      - Partnership
  - name: message
    label: Message
    type: textarea
    required: true
submitLabel: Send Message
successMessage: Thanks! We'll be in touch soon.
```
````

- The YAML data block configures the form. The tag name (`form`) and field structure depend on what your template's Contact type expects — check your template's documentation.

---

## Navigation & Layout

### Header with Navigation

Site-wide header. This lives in `pages/@header/1-header.md`.

```markdown
---
type: Header
---

![Logo](./logo.svg){role=icon}

[Home](/)
[Products](/products)
[Docs](/docs)
[Pricing](/pricing)
[Contact](/contact)
```

- The `@header` folder makes this appear on every page.
- The icon with `role=icon` becomes the site logo.
- Standalone links become navigation items.

**Auto-navigation alternative**: Some Header types automatically build navigation from your page structure, so you may not need to list links manually. Check the header file that came with your template.

---

### Footer with Link Columns

Site-wide footer. This lives in `pages/@footer/1-footer.md`.

```markdown
---
type: Footer
---

### Product

[Features](/features)
[Pricing](/pricing)
[Changelog](/changelog)
[Roadmap](/roadmap)

### Company

[About](/about)
[Careers](/careers)
[Blog](/blog)
[Press](/press)

### Legal

[Privacy Policy](/privacy)
[Terms of Service](/terms)

---

![](lu-twitter){href="https://twitter.com/example" target=_blank}
![](lu-github){href="https://github.com/example" target=_blank}
![](lu-linkedin){href="https://linkedin.com/company/example" target=_blank}

© 2025 Acme Corp. All rights reserved.
```

- Each `###` heading creates a link column.
- Clickable icons (with `href`) become social media links.
- The final paragraph is the copyright notice.

---

## Pages & Routes

### Adding a New Page

Create a folder under `pages/` and add a `.md` file:

```
pages/
├── home/
├── about/
└── pricing/          ← new page
    └── 1-content.md
```

```markdown
---
type: Pricing
---

# Our Plans

Choose the right plan for you.
```

The page automatically appears at `/pricing` and shows up in navigation. The title defaults to the folder name.

To set a custom title, description, or ordering, add a `page.yml`:

```yaml
title: Pricing
description: Our plans and pricing
order: 3
```

**Tip**: Use `index:` in `site.yml` (not `pages:`) to set your homepage. This way new pages are auto-discovered in navigation without manually updating a list.

---

### Linking Between Pages

Use the `page:` protocol for internal links that won't break if you reorganize:

```markdown
[See our pricing](page:pricing)
[Read the docs](page:docs)
[Contact us](page:about#contact)
```

For simple cases, plain paths work too:

```markdown
[Pricing](/pricing)
```

But `page:` links survive if you move pages to different folders. For pages you link to often, add an `id` in their `page.yml`:

```yaml
# pages/docs/getting-started/installation/page.yml
id: installation
title: Installation Guide
```

Now `[Install guide](page:installation)` works no matter where the page lives.

---

### Blog with Article List and Detail Pages

Set up a blog with a list page and individual article pages.

**1. Create a collection** in `site.yml`:

```yaml
collections:
  articles:
    path: library/articles
    sort: date desc
```

**2. Add article files** in `library/articles/`:

```
library/articles/
├── hello-world.md
├── new-feature.md
└── tips-and-tricks.md
```

Each article has frontmatter:

```markdown
---
title: Hello World
date: 2025-01-15
description: Our first blog post
thumbnail: ./hello-thumb.jpg
---

Welcome to our blog! Here's what we've been building...
```

**3. Create the blog list page**:

```
pages/blog/
├── page.yml
└── 1-list.md
```

```yaml
# pages/blog/page.yml
title: Blog
data: articles
```

```markdown
<!-- pages/blog/1-list.md -->
---
type: ArticleList
---

# Blog

The latest from our team.
```

**4. Create the article detail route**:

```
pages/blog/
├── page.yml
├── 1-list.md
└── [slug]/
    └── 1-article.md
```

```markdown
<!-- pages/blog/[slug]/1-article.md -->
---
type: Article
---
```

- The `[slug]` folder creates a dynamic route (`/blog/my-post`).
- The `data: articles` in `page.yml` makes article data available to the page.
- Dynamic route pages don't appear in navigation — they're generated from data.

---

### Adding Search to Your Site

**1. Enable search** in `site.yml`:

```yaml
search:
  enabled: true
```

**2. Check your template** — most templates include search UI that works automatically once search is enabled.

That's it. The build generates a search index, and the search UI loads it on demand.

**Optional configuration**:

```yaml
search:
  enabled: true
  exclude:
    routes:
      - /admin
      - /draft
```

See the [Search guide](../search.md) for full configuration options.

---

## Content Patterns

### Hero with Background Image

Any section can have a background image — just add `background:` to the frontmatter. The simplest form is a URL:

```markdown
---
type: Hero
theme: dark
background: /images/hero-bg.jpg
---

# Transform Your Business

Start building with modern tools today.

[Get Started](/signup)
```

For busy images, add an overlay to keep text readable:

```markdown
---
type: Hero
theme: dark
background:
  image:
    src: /images/hero-bg.jpg
    position: center
  overlay:
    enabled: true
    type: dark
    opacity: 0.6
---

# Transform Your Business

Start building with modern tools today.

[Get Started](/signup)
```

- Background images appear behind the content, covering the full section.
- Overlays add a semi-transparent layer so text stays readable. Use `type: dark` or `type: light`.
- Adjust `opacity` (0 to 1) — higher values make the overlay stronger.

---

### Hero with Background Video

```markdown
---
type: Hero
theme: dark
background:
  video:
    src: /videos/hero.mp4
    poster: /images/hero-poster.jpg
  overlay:
    enabled: true
    type: dark
    opacity: 0.5
---

# See It in Action

Watch how easy it is to get started.

[Try Free](/signup)
```

- Video backgrounds automatically show a still image for users who prefer reduced motion.
- The poster image shows while the video loads.
- You can also use the simple form: `background: /videos/hero.mp4` (video detected by extension).

---

### Multi-Section Page

A complete page with several sections, each using a different type:

```
pages/home/
├── page.yml
├── 1-hero.md
├── 2-logos.md
├── 3-features.md
├── 4-testimonials.md
├── 5-pricing.md
└── 6-cta.md
```

Each file has its own `type:` in the frontmatter. The number prefix controls the order. You can freely add, remove, or reorder sections by changing the filenames.

---

## Quick Reference

### Content cheat sheet

| What you write | What it becomes |
|---------------|-----------------|
| `# Heading` (first) | Main title |
| `## Heading` (after title) | Subtitle |
| `### Heading` (before title) | Pretitle / eyebrow text |
| Paragraphs | Body text |
| `[text](url)` on its own line | Button / CTA |
| `![alt](url)` | Image |
| `![](lu-name)` | Icon |
| `> quote` | Blockquote |
| `- item` | List |
| `### After content` | New item (card, entry) |
| `` ```yaml:tag `` | Structured data |

### Icon family codes

Browse all icons visually at [react-icons.github.io/react-icons](https://react-icons.github.io/react-icons/).

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

---

## See Also

- **[Writing Content](./writing-content.md)** — Full guide to writing content
- **[Special Sections](../special-sections.md)** — Header, footer, and sidebar details
- **[Linking](../linking.md)** — Stable `page:` links
- **[Search](../search.md)** — Search configuration
