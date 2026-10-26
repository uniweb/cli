{{#if project}}
# Working on a Uniweb project

You're in the Uniweb project at `{{root}}`.

Its pages are markdown files, and how they look and behave comes from its foundation:
React components that the pages pick by name. The `uniweb` CLI builds and runs the
project, and brings it into the Uniweb app, where the person you're working with can keep
editing it visually.

`uniweb start` only prints this guide; `npx uniweb dev` runs the site. To start a new
project instead, run `npx uniweb@latest start` in a folder outside this one.
{{else}}
# Build a website with Uniweb

You're building a website for the person you're working with. In Uniweb, the pages are
markdown files, and how they look and behave comes from a foundation: React components
that the pages pick by name. One project holds both. The `uniweb` CLI builds and runs it,
and brings it into the Uniweb app, where the person can keep editing it visually.
{{/if}}

## The person doesn't use a terminal

Run every command yourself, and never ask them to run one. They do two things, in their
browser: sign in, and pay when the site goes live. When a command prints an address to
finish something in a browser, open it for them and say what it's for.

Uniweb needs Node.js 22.12 or later. If `node --version` shows an older one, install a
current one yourself.
{{#unless project}}

## Create the project

```bash
npx uniweb@latest create <name> --template starter
cd <name>
```

`<name>` is lowercase letters, digits and hyphens, and becomes the project's folder.
`create` asks no questions when it runs without a terminal. `starter` has one generic
section type and two short pages: a working example of each convention, to replace as
you build. `--template none` is the same project without them.
{{#if otherProject}}

Create it outside `{{otherProject}}`: that folder holds another project, and `create`
does not make one inside it.
{{/if}}
{{/unless}}

## Read the project's guide

{{#if agents}}
AGENTS.md, at the project's root, is the manual for this project and its version of
Uniweb. Read its Part 0 before writing code: it says which parts your task needs.
{{else}}
This project has no AGENTS.md, the manual for a Uniweb project. Write one with
`npx uniweb update --agents-only`, then read its Part 0 before writing code: it says
which parts your task needs.
{{/if}}

Uniweb's mistakes are quiet: an unknown section type or param builds fine and renders
wrong. AGENTS.md says how to check.

## Install and run

```bash
{{install}}
npx uniweb dev
```

Run `dev` in the background. Once the server listens, it prints
`Serving <site> at <url>`: open that address to show the person.
`npx uniweb dev --stop` stops it.

## Sign them in to Uniweb

When they want the site in the Uniweb app, to edit it there or to take it live:

```bash
npx uniweb login --browser --personal
```

This opens their browser. If they're signed in to Uniweb there, it finishes on its own;
otherwise they sign in, and it waits up to five minutes. Never ask for a password or a
token.

`--personal` puts their sites in their own workspace. If they ask for one of their
organizations instead, use `--org @<its handle>`.

## Bring the site into the app, and take it live

```bash
npx uniweb push --commit -m "<what you built>"      # to see or edit it in the app
npx uniweb publish --commit -m "<what you built>"   # to take it live
```

`push` sends the site and its foundation to their workspace, where they'll find it in
the app. `publish` does the same and then takes the site live, so it needs no push
first. `--commit` commits the site's content first: in a git repository, both send only
what is committed.

If the site needs paying for, `publish` prints an address instead of going live. Open
it for the person, tell them it's where they pay, and run `publish` again once they're
done.

## More

- Documentation index: https://uniweb.io/llms.txt
- Every command's options: `npx uniweb <command> --help`
