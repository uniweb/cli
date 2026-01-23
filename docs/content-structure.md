# Content Structure

This guide explains how markdown content is parsed and delivered to your components.

## The Basics

When you write markdown in a section file, the parser extracts semantic elements and organizes them into a structured object your component receives:

```markdown
---
type: Features
---

# Our Features

We built this for you.

### Fast
Lightning quick response times.

### Secure
Enterprise-grade security.

### Simple
No configuration required.
```

Your component receives:

```js
{
  title: "Our Features",
  paragraphs: ["We built this for you."],
  items: [
    { title: "Fast", paragraphs: ["Lightning quick response times."] },
    { title: "Secure", paragraphs: ["Enterprise-grade security."] },
    { title: "Simple", paragraphs: ["No configuration required."] }
  ]
}
```

## Content Fields

All content fields are available at the top level:

| Field | Source | Description |
|-------|--------|-------------|
| `title` | First heading | Main headline |
| `pretitle` | Heading before title | Eyebrow/kicker text |
| `subtitle` | Heading after title | Secondary headline |
| `paragraphs` | Body text | Array of paragraph strings |
| `links` | `[text](url)` | Array of `{ href, label }` |
| `imgs` | `![alt](url)` | Array of `{ url, alt }` |
| `lists` | `- item` | Bullet or numbered lists |
| `items` | Subsequent headings | Child content groups (see below) |

## Items: Child Content Groups

The `items` array contains child content groups. A new item starts whenever a heading appears after other content (paragraphs, images, etc.). Each item has the same field structure as the main content.

Use items when your component displays repeating content—feature cards, pricing tiers, team members, FAQ questions.

**Convention:** Use a higher-level heading for the main title and lower-level headings for items. This makes the structure clear, but the parser is flexible—any heading after content starts a new item.

```markdown
# Pricing

Choose your plan.

### Starter
$9/month

Perfect for individuals.

[Get Started](/signup?plan=starter)

### Pro
$29/month

For growing teams.

[Get Started](/signup?plan=pro)
```

This also works with H2 for items:

```markdown
# Team

Meet our leadership.

## Sarah Chen
CEO and Co-founder

## Alex Rivera
CTO and Co-founder
```

```js
// In your Pricing component
const { title, paragraphs, items } = content

items.forEach(tier => {
  console.log(tier.title)       // "Starter", "Pro"
  console.log(tier.paragraphs)  // ["$9/month", "Perfect for..."], ...
  console.log(tier.links)       // [{ href: "/signup?plan=starter", label: "Get Started" }]
})
```

## Dividers as Separators

You can also use horizontal rules (`---`) to separate items instead of headings:

```markdown
# Team

---

![](/sarah.jpg)

**Sarah Chen**

Lead Engineer

---

![](/alex.jpg)

**Alex Rivera**

Designer
```

This creates two items without requiring headings for each.

## Runtime Guarantees

The runtime guarantees all fields exist—you don't need defensive null checks:

```js
// These are always defined (empty string/array if not in content)
const { title, paragraphs, links, imgs, items } = content

// Safe to use directly
paragraphs.forEach(p => console.log(p))
items.map(item => <Card {...item} />)
```

## Items vs Subsections

There are two ways to create nested content:

| Approach | When to use |
|----------|-------------|
| **Items** (headings in one file) | Repeating content within a single section |
| **Subsections** (separate files) | When children need their own component types |

Prefer items when possible—they're simpler for content authors. Use subsections when children are complex enough to warrant their own component selection.

See [Component Metadata](./meta/README.md) for how to document what content your component expects.
