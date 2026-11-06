> 8.4.7 (6 November 2026): Forever dungeon final bosses and recovery of abandoned runs (#384), silent auto-update for the direct-download companion with a fixed-name `Guilded.Companion.Setup.exe` release asset (#383) on top of 8.4.6's member ledger sync (#379), live duel board (#378), companion account-folder fix (#376), combat-safe windows (#377), compact Crafted by tooltip (#375) and Forever-only focus (#380, see docs/FOREVER_ONLY_FOCUS.md). The Store requires strictly increasing versions: ship the companion as 8.4.7.0 (revision 0).
> Next release: **9.0.0** (owner decision, 6 November 2026: the 8.5 work ships as 9.0 after in-game testing and polishing), planned track by track in `ROADMAP.md` (tracks A-M plus owner batches, file ownership and migration timestamps per track). Work one track per session; only the coordinating session bumps the version.
> Current checkpoint: 6 November 2026 (8.4.7 on GitHub and the bot; CurseForge and the Store still on 8.4.6 or earlier; check each provider live before claiming status, including which Store version has certified). Member ledger sync, duels and announcements are not yet verified with several real clients.
> Cards: `src/services/score-card.ts` renders every share card (WoW theme, roster layout); `end-cards.ts` builds the raid and battleground cards; queued Discord messages store a card definition and draw it on delivery.
> Docs: `docs/` holds living guides and design notes plus the 8.3+ release records; point-in-time handoffs, audits and older release notes live in `docs/archive/` (`docs/archive/releases/` for release notes and evidence before 8.3). Archived docs are history, not current status.
> Latest owner authorization: ALL AVAILABLE TESTING NOW. Native/game testing is assigned to Claude; avoid concurrent desktop control.
> Release evidence: `docs/V8_4_7_RELEASE_ACCEPTANCE.md` (latest), earlier 8.4.x and `docs/V8_3_0_RELEASE_ACCEPTANCE.md` beside it. Preserve published artifact bytes; never overwrite a published download.
> Keep selected edition calendars unchanged ([EDITION_CALENDARS_2026-10-30.md](docs/EDITION_CALENDARS_2026-10-30.md)).
> No automatic messages/awards without configured opt-in. Exception (owner decision, 5 November 2026): the addon's guild-chat milestone announcements (levels, first dungeon clears, PvP and duel milestones) are ON by default for members, after a one-time local notice; members turn them off with `/guilded announce off`, and an officer's guild-wide off switch wins. Discord echoes of them stay opt-in per server. Second exception (owner decision, 6 November 2026): a member gets one Discord DM confirming which characters were linked after their first companion link (skipped quietly when DMs are closed). Third decision (owner, 6 November 2026): every new 8.5 feature is ON by default in every server, with officer and member off switches; see ROADMAP.md rule 5.

# Working on Guilded

Discord bot (`src/`) + WoW addon (`addon/Guilded/`) + companion uploader
(`companion/`, `companion-app/`), one product shipped together (they share a
version number). TypeScript/Node/Prisma/Postgres on the bot side, Lua on the
addon side. Full context: `docs/GETTING_STARTED.md` (setup), `docs/DEPLOY_ORACLE.md`
(how the live bot gets updated), `docs/CHARACTER_PAIRING_HANDOFF.md` (one
feature's design notes, as an example of this file's format for a specific
feature).

**Current status (6 November 2026): version 8.4.7, protocol 2.**
8.4.7 is on GitHub (latest release) and the bot. CurseForge has the 8.4.6 Forever files; the
Store has 8.4.4.0 live with 8.4.6.0 in certification. Check each provider live before claiming
status. WoW Forever launched 4 November 2026; its first raids open 9 December.
Production uses Aiven PostgreSQL; retained Neon configuration is historical.
Both addons keep Forever, Era, TBC, Mists and Retail builds in source, but only Forever is shown
to members (`companion/active-editions.mjs`). Message earning covers accessible guild
channels/threads; officers inspect coverage with `/participation channels`
(`docs/PARTICIPATION_CHANNEL_COVERAGE_2026-10-28.md`). Loot-history import: `docs/LOOT_HISTORY_IMPORT.md`.
Battle.net developer-app setup: `docs/BATTLENET_SETUP.md`. Still-owed real-client checks are
listed under "Carried over" in `ROADMAP.md`. Use `npm run setup:check` to check a new owner's
configuration without starting the bot. Live deployment, final-commit CI and stable publication
remain separate gates. Do not bump the version incidentally.

Raid tools were removed from Guilded v6 and archived in
`docs/archive/raid-tools/README.md` for a future standalone addon. Preserve
SavedVariables. Standalone first-run work is tracked in
`docs/STANDALONE_ADDON_ROADMAP.md`.

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

`tsc` is TypeScript 7 (installed as `@typescript/native`), but the `typescript` package is
the 6.0 API (`@typescript/typescript6`, CLI `tsc6`): 7.0 ships no compiler API, and
typescript-eslint and `tests/command-handler-coverage.test.ts` need one. Keep both
aliases until typescript-eslint accepts TypeScript 7.

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
- **A version bump updates the "current" lines too.** `tests/current-version-docs.test.ts`
  fails until `README.md` ("Current version"), this file (status line and top history line),
  `ROADMAP.md` ("Current stage"), `CHANGELOG.md`, both addon `.toc` files and
  `companion-app/package.json` match `package.json`. Guides link "latest release" instead.

Two sync sharp edges (see `docs/SYNC_SPEEDUPS_2026-10-15.md`):

- **The Lua test harness (fengari) has 32-bit integers; WoW's Lua uses doubles.** Arithmetic
  that passes 2^31 (hashes, sums of hashes) gives different answers in tests than in game.
  Keep such values small (LedgerSync.lua uses a 24-bit modulus).
- **The website's Cloudflare Worker (`worker/index.mjs`) forwards only the request headers it
  lists and gives up after 20 seconds.** A new header the bot needs must be added there (and
  the bot should cope without it until the Worker is redeployed); long polls stay at 12 s.
  Headers named `x-guilded-*` or `x-companion-*` pass through without a Worker change, except `x-guilded-origin`, which only the Worker may set.

Prisma 7 (see `docs/PRISMA_7_UPGRADE.md`):

- **The client is generated TypeScript in `src/generated/prisma/` (gitignored).** `npm install`
  and `npm run db:update` regenerate it; if it is missing, run `npx prisma generate`. Import
  from `src/generated/prisma/client.js`, never from `@prisma/client`.
- **Create clients only with `createPrismaClient()` from `src/database.ts`.** Prisma 7 needs the
  node-postgres adapter, and `poolSettings()` translates `DATABASE_URL`'s Prisma 6 parameters
  (pool size, timeouts, the Aiven CA in `sslcert`) that node-postgres would misread. The CLI
  reads the URL from `prisma.config.ts`.

## No database or Discord access from here

Cloud sandboxes may not reach production Aiven or Discord and may have no
`.env.local` (gitignored; contains credentials). Check actual local access
without printing secrets; retained Neon settings do not identify production.
Consequences:

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
Never start a second bot. The 25 October release decision waived unavailable
prelaunch game checks for 7.3.2; retain them as pending post-release acceptance.

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

## Bug reports ("fix the bugs")

Members of every guild report with `/report bug` (optional screenshot) and get a short reference
such as `K3X9QZ2A`; the bot's own failures are saved the same way. They reach the developer
live in `ERROR_LOG_CHANNEL_ID` and are collected by `npm run bugs` (on the owner's PC, which
has `.env.local`): it writes `bug-inbox.md` (gitignored, holds Discord IDs: never commit or
paste it publicly) with open reports and errors grouped by cause. Work from that file, fix
through a pull request, then `npm run bugs -- resolve REF [REF...] --note "what changed"`.

## Where things live (for a fresh session)

- **Forever-only focus switches** — `companion/active-editions.mjs` (WoW editions) and `companion/active-games.mjs` (PoE2 community and tracking) decide what members see; hidden is never deleted. See `docs/FOREVER_ONLY_FOCUS.md` for how to turn each back on.
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
- `mobile/` — the Expo app for iPhone and Android (`mobile/README.md`). Public
  leaderboards, plus the companion sign-in for characters, reserves, wishlist,
  raids and on-device reminders. Store identifiers stay in `mobile/app.json`.
  It does not bump the shared product version.
- The companion is **Windows only** (Microsoft Store first, unsigned GitHub download as fallback; guidance everywhere is Store-first). The browser/online companion was removed: `/companion/` is a static download page on the site (`site/pages/companion*.md`), the Worker and bot redirect old `/companion/<asset>` paths to it, and `companion-app/renderer/ui-bundle.js` is built by `npm run companion:build` for the Electron UI only.
- `addon/Guilded/Util.lua` — loaded first: shared helpers (`ns.util`) and the paced
  addon-message queue (`ns.comm`). Every module sends through `ns.comm.send`; the validator
  fails a module that calls `SendAddonMessage` directly.
- `addon/Guilded/` — the WoW Lua addon; `tests/lua/` runs the real `.lua`
  files against a mocked game client (fengari), not a JS reimplementation.

## Website deployments

Main merges trigger Cloudflare site builds/deploys, but no installer or bot release. Never deploy
unrelated unaccepted backend changes to ship styling. History of the October redesign rollout:
`docs/archive/WEBSITE_AND_COMPANION_HANDOFF_2026_10_19.md`.
