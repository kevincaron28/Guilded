> **5.0 delivery note:** Publishing from the cloud was blocked by GitHub write permissions.
> If given Guilded-5.0-Stabilization.zip, follow the offline bundle import section in
> docs/V5_0_RELEASE_HANDOFF.md, then publish from the owner's authenticated local setup.
> PostgreSQL/Windows CI and real-client gates remain required.

# Working on Guilded

Discord bot (`src/`) + WoW addon (`addon/Guilded/`) + companion uploader
(`companion/`, `companion-app/`), one product shipped together (they share a
version number). TypeScript/Node/Prisma/Postgres on the bot side, Lua on the
addon side. Full context: `docs/GETTING_STARTED.md` (setup), `docs/DEPLOY_ORACLE.md`
(how the live bot gets updated), `docs/CHARACTER_PAIRING_HANDOFF.md` (one
feature's design notes, as an example of this file's format for a specific
feature).

**Open work: read `docs/V5_0_RELEASE_HANDOFF.md` first**, then `docs/V5_0_HANDOFF.md` for feature history. Version 5.0.0 is the current version (4.5.0, 4.6.0 and
5.0.0 are unpublished; 4.0.0 was never published): every 5.0 change with its files, the protocol /
saved-data / database changes, and what is left (db:update, rebuild the addon zip and companion
installer, redeploy, "Update bot messages" in `/setup`, the optional Message Content Intent for the
answer channel, the in-game checks in `RELEASE_CHECKLIST.md`, the CurseForge upload). 4.6 is in
`docs/V4_6_HANDOFF.md`, 4.5 in `docs/V4_5_HANDOFF.md`, the addon audit before it in
`docs/ADDON_AUDIT_HANDOFF.md`. Left from the roadmap after 5.0: raid-tools map drawings (`ROADMAP.md`)
and the standalone first-run path (`docs/STANDALONE_ADDON_ROADMAP.md`).

This file is for whichever agent picks this repo up next — including a cloud
session with no access to this machine's local state. If you're running
somewhere that can't reach Neon or Discord and has no `.env.local`, that's
normal; see below.

## Before you consider anything done

Run these, always — `tsc` passing is not enough on its own:

```
npx tsc --noEmit -p .
npx vitest run
npx eslint .
node addon/Guilded/validate-addon.mjs
```

Without `.env.local` (cloud sandboxes), 9 bot test files fail to load on
`src/config.ts`'s environment check, not on a code error. Run the suite with
throwaway placeholders set in the shell only (never commit them):
`DISCORD_TOKEN=placeholder DISCORD_CLIENT_ID=123 DISCORD_GUILD_ID=456 DATABASE_URL=postgresql://u:p@localhost:5432/x npx vitest run`.

Two failure modes only the test suite catches, not the type checker:

- **`/setup` and `/config` are merged into one Discord command**
  (`src/commands/index.ts`'s `MergedCommand`) that sits close to Discord's
  4000-character total-text limit across every subcommand/option/choice name
  and description combined. Adding text anywhere in `src/commands/setup.ts`
  or `src/commands/settings.ts` can push it over with no type error — only
  `tests/commands-shape.test.ts` ("keeps every command under Discord's size
  limit") catches it. If it fails, trim wording; don't just raise the limit.
- **French translations are enforced for specific files only.** Any new
  `tx(lang, "...")` / `T("...")` call in `src/commands/setup.ts`,
  `src/services/setup-status.ts`, `src/commands/craft-board.ts`,
  `src/commands/dungeon-group.ts`, `src/commands/poll.ts`,
  `src/services/raid-core.ts`, `src/commands/wcl.ts`,
  `src/services/dungeon-guide.ts`, `src/commands/group-alerts.ts` or
  `src/commands/faq.ts` needs a matching entry in `src/i18n-fr.ts`, or
  `tests/i18n-fr.test.ts` fails (the list is `SOURCES` in
  `scripts/i18n-keys.mjs`). In the addon, French lives in `Locale.lua`
  (accents as `\195\169`-style escapes: the validator rejects non-ASCII). Other files
  aren't checked (e.g. `src/commands/help.ts` keeps its own separate
  `en`/`fr` arrays, not `tx()`).

## No database or Discord access from here

This sandbox (and likely yours) can't reach the production Neon database or
the Discord API — there's no `.env.local` (it's gitignored; holds the bot
token, `DATABASE_URL`, `COMPANION_UPLOAD_TOKEN`) and no live connection even
when one is configured for local dev. Consequences:

- **Migrations are hand-written, not generated.** Don't run
  `prisma migrate dev` (needs a reachable database). Instead, add a field to
  `prisma/schema.prisma`, then hand-write
  `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql` with plain
  `ALTER TABLE` statements, using the next chronological timestamp after the
  most recent migration folder. Run `npx prisma generate` afterward so the
  TypeScript client matches (this works offline).
- **Never invent or commit a secret** to make something "work" locally —
  hardcoded tokens, a committed `.env`, a fallback credential in code. If a
  task seems to need real credentials, it needs a human with access, not a
  workaround.
- **Privileged intents break the login.** The bot asks for Message Content
  only when `MESSAGE_CONTENT_INTENT=true` (answer channel, 5.0). Never make
  a new privileged intent unconditional: if the Developer Portal switch is
  off, Discord refuses the login and the live bot stays down.
- **Never suggest running the bot itself** (`npm run dev`, `start-bot.bat`)
  from an agent session. If a real bot is already live on Oracle, a second
  instance with the same token answers every Discord command twice. Verify
  behavior through the test suite and, where relevant, the Lua test harness
  (`tests/lua/`, fengari — fully offline, no external dependencies), not by
  starting a live bot.

## Deployment and the local Claude handoff

The owner requested a one-prompt update using Claude in their local VS Code checkout.
Follow `docs/V5_0_RELEASE_HANDOFF.md` in order. Cloud sessions lack the existing Oracle SSH key;
do not request or invent it. A local agent on the owner's PC may use the already configured
key and deployment script after tests, CI, ledger preflight and backup succeed. The owner
has authorized the mechanical update work. Preserve local changes and SavedVariables.
Never start a second bot. Public release still depends on real-client checks.

Use `npm run release:prepare` for a complete build/check. The new migration refuses duplicate
ledger source refs; `npm run release:ledger-check` diagnoses them without changing data.
The shared upload token is retired: companions authenticate with personal pairing credentials.
Never reintroduce a global-token write bypass to make an old companion appear compatible.

## `package.json`'s version has a live side effect

`src/services/version-announce.ts` posts a one-time "Guilded was updated to
vX.Y.Z" notice to every guild's bot-guide channel the first time the running
version differs from what that guild was last told (checked once per bot
startup, in `src/main.ts`'s `ClientReady` handler). Don't bump the version
number incidentally (e.g. as a side effect of a dependency update) — treat it
as a real, user-facing announcement trigger, not a housekeeping field.

## Where things live (for a fresh session)

- `src/commands/` — one file per Discord slash command; `src/commands/index.ts`
  registers them and merges a few into parents (see `MergedCommand` above).
- `src/services/` — business logic, called by commands and by scheduled jobs
  in `src/main.ts`.
- `src/setup-names.ts` — the single source of truth for every channel
  `/setup` can create (name/topic in English and French, permissions,
  category). Adding a new bot-managed channel starts here.
- `companion/` — the Node/CLI half of the uploader (also embedded in
  `companion-app/`, the Electron desktop app); `companion/engine.mjs` is the
  shared logic both use.
- `addon/Guilded/Util.lua` — loaded first: shared helpers (`ns.util`) and the paced
  addon-message queue (`ns.comm`). Every module sends through `ns.comm.send`; the validator
  fails a module that calls `SendAddonMessage` directly.
- `addon/Guilded/` — the WoW Lua addon; `tests/lua/` runs the real `.lua`
  files against a mocked game client (fengari), not a JS reimplementation.
