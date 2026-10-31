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

## Run everything yourself

The person may never have used a terminal, and one who has still expects you to take this
from start to finish. Run every command yourself, and never ask them to run one. They do
two things, in their browser: sign in, and pay when the site goes live. When a command
prints an address to finish something in a browser, open it for them and say what it's
for.

Uniweb needs Node.js 22.12 or later. If `node --version` shows an older one, install a
current one yourself.

## Work with them

- Ask only what you can't decide, in plain words. A first version they can react to tells
  you more than a list of questions.
- Use what they give you: their words, their files, their current site. Don't invent facts
  about them, and say which parts are placeholders.
{{#unless project}}
- Write the site in their language, and set `defaultLanguage` in `site.yml` to its code
  (`defaultLanguage: es`). A site that doesn't say is taken to be in English.
{{/unless}}
- Keep anything they may want to change in markdown or in a param its `meta.js` declares,
  not in a component's code. That is what they can edit in the app.
- Show them the site on their computer before you ask them to sign in.
{{#unless project}}
{{#if nearby}}

## A project is already here

{{#if oneNearby}}
{{nearby}}, in this folder, is a Uniweb project.
{{else}}
{{nearby}}, in this folder, are Uniweb projects.
{{/if}}
To work on one, go there and run `npx uniweb@latest start` again. Create a new one only
if they ask for it.
{{/if}}

## Create the project

{{#if otherProject}}
```bash
npx uniweb@latest create <name> --template {{template}}
cd <name>
```

`<name>` is lowercase letters, digits and hyphens, and becomes the project's folder.
`create` asks no questions when it runs without a terminal.

Create it outside `{{otherProject}}`: that folder holds another project, and `create`
does not make one inside it.
{{else}}
In a folder set aside for this site, even one that already holds their logo or photos:

```bash
npx uniweb@latest create . --template {{template}}
```

Anywhere else, give the project a folder of its own:

```bash
npx uniweb@latest create <name> --template {{template}}
cd <name>
```

`<name>` is lowercase letters, digits and hyphens. `create .` takes its name from the
folder, or from `--name <name>`, replaces a `README.md` or `.gitignore` already there, and
stops if any other file is in its way. `create` asks no questions when it runs without a
terminal.
{{/if}}

{{#if starter}}
`starter` has one generic section type and two short pages: a working example of each
convention, to replace as you build. `--template none` is the same project without them.
{{else if none}}
`none` is a project with no section types or pages: you build them all.
{{else}}
`{{template}}` is a working site: its section types are in `src/`, its sample content in
`site/`. Keep what fits, replace all the sample content with what they asked for, and
delete what they won't use. The code is theirs, so change whatever the site needs.
{{/if}}

## If their site is already in the Uniweb app

Bring it here instead of creating a project:

```bash
npx uniweb@latest login --browser --personal    # see "Sign them in", below
npx uniweb@latest site list                     # each site, with its id
npx uniweb@latest clone <site-uuid> <name>
cd <name>
npx uniweb@latest start
```

A clone holds the site's content and uses its foundation by version: you can change its
pages, text and theme here, but not its section types.
{{/unless}}

## Read the project's guide

{{#if agents}}
AGENTS.md, at the project's root, is the manual for this project and its version of
Uniweb. It's long, so read its Part 0 before writing code, then the parts it names for
your task.
{{else}}
This project has no AGENTS.md, the manual for a Uniweb project. Write one with
`npx uniweb update --agents-only`, then read its Part 0 before writing code, and the parts
it names for your task.
{{/if}}

Uniweb's mistakes are quiet: an unknown section type or param builds fine and renders
wrong. AGENTS.md says how to check. Look at every page in a browser, wide and narrow,
before you call it ready.
{{#if project}}

## Check what changed

```bash
npx uniweb status
```

The site may have been edited in the Uniweb app since this copy last synced, by the
person or someone they work with, and Uniweb may have a newer release. `status` says so,
changes nothing, and ends with the commands to run, in order. A step it marks "ask the
person first" is theirs to decide.
{{/if}}

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
otherwise they sign in, or sign up if they're new. It waits up to five minutes, so give
the command that long or run it in the background, and run it again if it times out.
Never ask for a password or a token.

`--personal` puts their sites in their own workspace. If they ask for one of their
organizations instead, use `--org @<its handle>`.

## Bring the site into the app, and take it live

```bash
npx uniweb push --commit -m "<what you built>"      # to see or edit it in the app
npx uniweb publish --commit -m "<what you built>"   # to take it live
```

`push` sends the site and its foundation to their workspace, where they'll find it in
the app, at https://uniweb.app. `publish` does the same and then takes the site live, so
it needs no push first. Take it live only when they ask: that's the step they pay for.
`--commit` commits the site's content first: in a git repository, both send only what is
committed.

If the site needs paying for, `publish` prints an address instead of going live. Open
it for the person, tell them it's where they pay, and run `publish` again once they're
done.

When the site is in the app, tell them where to find it, and that it isn't live until they
ask you to take it live or publish it from the app.

Once the site is in the app, it can be edited there at any time. Before you change it
again, and before each push, run `npx uniweb status`: it says what changed in the app
since your last push or pull, and what to run.

## More

- Documentation index: https://uniweb.io/llms.txt
- Every command's options: `npx uniweb <command> --help`
