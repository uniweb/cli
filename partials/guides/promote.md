# Promote: getting a site found, and its posts and ads

On-demand guide (`uniweb guide promote`); AGENTS.md is assumed read. For a site published on Uniweb Cloud. Its Promote is kept by the backend you are logged in to, beside the site's Analytics in the app, and comes with that Analytics. A site on another host has no Promote; the docs' Advertising guide (`marketing/advertising.md`) is its manual path.

## Who does what

- **The person** connects each account at its network, in a browser signed in to the app; you hand them the address `uniweb promote connect <network>` prints. They turn on the site's Analytics, which carries Promote, in the app. They reconnect an account that needs it, and an admin hands on one whose person left. They decide what goes out and what is spent.
- **You** draft posts and campaigns, check the pages they link to, send and start what your person agreed to, and read what it brought. You act with their session, at the access they have; an account's tokens never pass through the CLI.

## On one screen

```bash
uniweb promote status          # getting found, accounts, posts and campaigns by id, and what needs the person
uniweb promote status --json   # the same, to read
```

Run it first. Its *Ask the person first* lines are theirs alone. It names the networks this backend can connect: claim no other. `uniweb status` carries the short form for a site that uses Promote: what needs the person, a post that failed, the posts going out this week, and each running campaign's spend.

## Getting found

```bash
uniweb promote check sitemap
```

It checks that the live site's `robots.txt` names its sitemap, and says `todo` until the site's first publish. A step the CLI can't check (Search Console, a business listing) the person does at the service and marks in the app.

## A post

A post is a file. In Markdown, its frontmatter holds its fields and its body its words. A line of `---` separates the parts of a thread (X takes several, the others one), and a picture stands alone on its line.

```markdown
---
via: x                             # the network it goes out on
page: /holiday                     # the page it links to: a route, or page:<id>
language: en                       # the site's own language if left out
send_at: 2026-11-24T09:00-05:00    # optional: when `send` posts it
---
Our holiday trays are here.

![](./tray.jpg)

---

Order by Dec 20.
```

```bash
uniweb promote post holiday.md         # the draft; the file gets its id and version back
uniweb promote send holiday.md         # now, or at its send_at; --at <time> sets one, --now posts now anyway
uniweb promote unschedule holiday.md   # a draft again, its time kept
```

- **`via`** names a network, and the post goes out through the site's account there. The first time, the CLI chooses it from your one account on that network. With several, give `via: { network: x, connection: <id> }`; the refusal lists them.
- **`page`** is a page of the site as pushed, so push a new page first. The live site must serve it in the post's language, or the send fails: publish first.
- **A picture** given as a file is uploaded as one of the site's own, in its format. An address is kept as written.
- **The words go out as written**, as plain text: Markdown formatting shows as typed.
- YAML and JSON work too: `text` and `pictures` for one part, or `parts: [{ text, pictures }]`.

## A campaign

A campaign is YAML or JSON, with its ad groups and their ads nested in it:

```yaml
name: Holiday
goal: conversions          # conversions, visits or reach
devices: all               # all, desktop or mobile
starts: 2026-12-01
ends: 2026-12-14
via: facebook              # the ad accounts it runs in: one, or a list
ad_groups:
  - name: Trays
    daily_budget: 10.00    # in the ad account's currency
    ads:
      - page: /holiday
        headlines: [Holiday trays, Order by Dec 20]
        descriptions: [Fresh from our ovens]
        text: Our holiday trays are here.   # a social ad's words, with pictures beside them
```

```bash
uniweb promote campaign holiday.yml
uniweb promote start holiday --yes     # once your person has agreed to what it says it will spend
uniweb promote pause holiday
uniweb promote resume holiday --yes
```

- **An ad runs in one of its campaign's accounts.** Name it with the ad's own `via`, or leave it out when the campaign has only one.
- **`start` and `resume` say what they will spend before they spend it:** the dates, each account's daily budgets and the most they come to, and the pages. At a terminal they ask. Without one they refuse unless given `--yes`, so show your person that summary and pass `--yes` only after they agree. The network bills the owner's ad account.
- **Once a campaign starts in an account, what runs there is fixed.** An edit to it is refused, and nothing changes. Add another ad account to its `via`, or draft a new campaign.

## Drafts stay right

- **Every command reads the site's Promote fresh.** The CLI keeps no copy, and the file keeps the `id` and `version` of what it wrote. A second run updates the same draft, and so does a teammate's copy of the file.
- **A change made since then is never written over.** If the app or another run changed the draft, your write is refused and nothing is written. `uniweb promote show <id> > file` gives you the draft as it stands, to put your change into.
- **Nothing is deleted by leaving it out.** An ad group or an ad the file doesn't hold is kept, and named. `uniweb promote delete <id>` deletes. A post's parts are its words, so the parts the file gives are the post's.
- **A post that went out isn't edited or deleted.** To post again, drop `id` and `version` and make a new draft.
- **Changing a scheduled post makes it a draft again,** its time kept, and `send` schedules it again.
- **An `<id>`** is the short one `status` shows, the file a draft was written from, or a campaign's name.

## The page it lands on

A post or an ad is only as good as the page it brings people to:

- the page carries on from what the post promised, within its first screen;
- it has its own share card: `description` and `seo.image` in its `page.yml` (content guide, *SEO and social cards*);
- a page that belongs to one campaign alone takes `hideIn: ['*']`, which keeps it out of menus.

```bash
uniweb promote check /holiday   # its card, and what the site reports for a network to hear
```

It reads the site's files, so it works on any site, a static one too, with no login. Run in the site's project, `post`, `campaign`, `start` and `resume` print the same notes for the pages they link to. Each is a note, never a gate.

## What counts, and the network hearing it

A campaign with `goal: conversions` optimizes for what its network hears back. The site reports its own conversions (services guide, *what counts*). On Uniweb Cloud, the host sends X and Meta theirs from its servers, each mapped to the network's event (`services.x`, `services.meta`, services guide). A network that hears no conversion optimizes for clicks.

## What each brought

`uniweb promote status` shows what each running campaign has spent in each ad account, as the network last reported it, in that account's currency. A day it hasn't reported is unknown, not zero. The site's Analytics, in the app, shows its visits by where they came from. When you read them:

- judge by conversions, not clicks;
- change one thing at a time;
- decide what counts as working before the first number comes in;
- read the result once, at the end.

## Every command

| command | does |
|---|---|
| `status` | the site's Promote, and what needs the person |
| `check <step>` · `check <route>` | one getting-found step (`sitemap`), or a page as a landing page |
| `connect <network>` | the address where the person connects an account |
| `post <file>` · `campaign <file>` | a draft, made or updated; `-` reads stdin |
| `show <id>` | one post or campaign as its file holds it; its state goes to stderr |
| `delete <id>` | a post, a campaign, an ad group or an ad |
| `send <post> [--at <time> \| --now]` | post it now, or at its time |
| `unschedule <post>` | a scheduled post a draft again |
| `start <campaign>` · `resume <campaign>` | spend, after saying what; `--yes` answers |
| `pause <campaign>` | wherever it runs |

All of them take `--json`; `--site <uuid>` for a site this project isn't synced to; `--org @x` or `--personal` for the workspace. A time carries its offset: `2026-11-24T09:00-05:00`.
