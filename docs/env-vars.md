# UNIWEB_* Environment Variables — Internal Reference

**Audience:** Framework developers, the platform test team, CI authors. **Not for end users.**

The CLI exposes user choices as flags (`--dry-run`, `--no-auto-publish`, etc.). Anything that exists *only* for development, debugging, or platform-team testing is an env var instead — it stays out of `--help` and out of users' muscle memory.

This file is the canonical list. If you add a new `UNIWEB_*` env var, add it here in the same commit.

## Conventions

- Every variable is prefixed `UNIWEB_` to avoid collisions with Node's debug ecosystem and other tooling.
- Boolean-shaped variables are parsed via `parseBoolEnv` in `framework/cli/src/utils/env.js`. Truthy values: `1`, `true`, `yes` (case-insensitive). Anything else is false.
- URLs are read at command start (no live re-reads). Restart the CLI to pick up a change.
- Never use bare `DEBUG=1` — it collides with the `debug` npm package and leaks into unrelated tools. Use `UNIWEB_DEBUG=1` or a topical name (`UNIWEB_DEBUG_BUILD=1`).

## Flag-equivalents (escape hatches that used to be `--flag`)

These were once user-facing flags. They moved to env vars during the Phase 1 ergonomics overhaul because they exist for the platform test team / CI scripts, not for normal users.

| Variable | Used by | Effect |
|---|---|---|
| `UNIWEB_SKIP_BUILD=1` | `uniweb deploy` | Reuse existing `dist/` instead of rebuilding. Was `--skip-build`. |
| `UNIWEB_SKIP_ASSETS=1` | `uniweb deploy` | Skip the asset upload step. Was `--skip-assets`. |
| `UNIWEB_SKIP_BILLING=1` | `uniweb deploy` | Admin-only: bypass billing gate. Server-side admin check still applies. Was `--skip-billing`. |
| `UNIWEB_FORCE_REVIEW=1` | `uniweb deploy` | Force the browser review path even when nothing has drifted. Was `--review`. |
| `UNIWEB_ALLOW_DIRTY_FOUNDATION=1` | `uniweb deploy` | Don't treat a dirty workspace as stale (skip auto-publish on uncommitted changes). Was `--no-dirty-as-stale`. |

## Service URLs (developer overrides)

For pointing the CLI at a non-production backend or registry. Standard fallback chain: explicit flag → env var → production default.

| Variable | Read by | Fallback |
|---|---|---|
| `UNIWEB_BACKEND_URL` | `framework/cli/src/utils/config.js::getBackendUrl` | Production PHP backend URL |
| `UNIWEB_REGISTRY_URL` | `framework/cli/src/utils/config.js::getRegistryUrl`, `framework/cli/src/commands/{template,handoff,invite}.js` | Production worker URL |

## Build pipeline overrides

| Variable | Read by | Effect |
|---|---|---|
| `UNIWEB_FOUNDATION_REF` | `framework/build/src/site/config.js:254` | Override `site.yml::foundation` for the duration of a build. Used by `uniweb deploy` after auto-publishing a workspace-local foundation, so the build sees the just-published registry ref. |
| `UNIWEB_BASE` | `framework/build/src/site/config.js:261` | Override `site.yml::base` (subdirectory deployments). |
| `VITE_FOUNDATION_MODE=runtime` | `framework/build/src/site/config.js:271-272` | Force runtime-linked foundation mode for sites with a workspace-local foundation ref. Used by e2e tests (`framework/_e2e/dev-server.test.js`) and as an internal escape hatch. **Not** prefixed `UNIWEB_` because Vite loads it as a build-time `import.meta.env.VITE_*` value. |

## Debug

| Variable | Read by | Effect |
|---|---|---|
| `UNIWEB_DEBUG=1` | `framework/cli/src/commands/build.js`, `framework/build/src/prerender.js` | Print stack traces and verbose error context. |

## Things that look like env vars but aren't

- `process.env.CI` — read by `framework/cli/src/utils/interactive.js::isNonInteractive`. Standard CI-detection convention; not Uniweb-specific.
- `process.env.HOME`, `XDG_CONFIG_HOME`, etc. — used to locate `~/.uniweb/auth.json`. Standard.

## Adding a new env var

1. Pick a topical name. `UNIWEB_<COMMAND>_<EFFECT>` is a fine pattern (`UNIWEB_DEPLOY_NO_BROWSER`, `UNIWEB_BUILD_FORCE_VITE`, etc.). Don't recycle bare names like `DEBUG` or `MODE`.
2. Read the value once at command start through `parseBoolEnv` (for booleans) or directly (for strings/URLs).
3. Add a row to the right table above with the effect and the file:line that reads it.
4. If the var is also exposed in user-facing docs (rare), link from `framework/cli/partials/agents.md` to here.

## The `--dry-run` contract

Any command that accepts `--dry-run` must satisfy:

- **No HTTP requests that mutate state.** Read-only fetches (latest-version lookup, registry metadata) are fine. No `POST`, no auth-state writes, no publish-token mints.
- **No filesystem writes.** No `writeFile`, no `mkdir`, no spawn'd subprocess that itself writes (`uniweb build`, `uniweb publish`, `git push`).
- **Output ends with a "Would have…" summary.** The user should see exactly what the non-dry-run would have done, ordered the same way.
- **Exits 0** unless a precondition was violated (missing `site.yml`, unauthorized, etc.). Precondition errors are real errors; dry-run isn't a way to silence them.

The trade-off: a dry-run shows less detail than the real command, because some details (build output sizes, exact languages emitted, etc.) only exist after the build runs. Users who need that detail run the real command, or run `uniweb build` separately and then `uniweb deploy --dry-run`.

Currently honored by: `uniweb deploy`, `uniweb publish`, `uniweb i18n extract`, `uniweb i18n prune`. Other commands either don't have a `--dry-run` (because they're already read-only — `inspect`, `doctor`) or haven't been audited yet.

## Related docs

- `framework/cli/partials/agents.md` — user-facing CLI vocabulary.
