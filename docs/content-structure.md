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
| `title` | H1 heading | Main headline |
| `pretitle` | H3 before H1 | Eyebrow/kicker text |
| `subtitle` | H2 after H1 | Secondary headline |
| `paragraphs` | Body text | Array of paragraph strings |
| `links` | `[text](url)` | Array of `{ href, label }` |
| `imgs` | `![alt](url)` | Array of `{ url, alt }` |
| `lists` | `- item` | Bullet or numbered lists |
| `items` | H3 sections | Child content groups (see below) |

## Items: Child Content Groups

The `items` array contains child content groups, typically created from H3 headings. Each item has the same field structure as the main content.

Use items when your component displays repeating content—feature cards, pricing tiers, team members, FAQ questions:

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
| **Items** (H3 sections in one file) | Repeating content within a single section |
| **Subsections** (separate files) | When children need their own component types |

Prefer items when possible—they're simpler for content authors. Use subsections when children are complex enough to warrant their own component selection.

See [Component Metadata](./meta/README.md) for how to document what content your component expects.
