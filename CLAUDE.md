> CURRENT RELEASE — 8.0.1; remaining Forever data/calibration require the game.
> Client release: 8.0.1, source cdc1a51. Preserve published bytes.
> Bot runtime also includes the final-audit participation summary read correction.
> Follow docs/V8_0_1_LAUNCH_COMPLETION.md for completion and provider gates.
> Current release tag/source: cdc1a51; prior 8.0 tag/configuration: 0daa31d.
> Publication evidence: docs/V8_0_1_RELEASE_EVIDENCE_2026-10-28.md.
> Store Submission 3 (8.0.1.0) is published; all ten CurseForge 8.0.1 files are approved
> and their anonymous downloads match the GitHub release hashes. Edition pages are live.
> Bot-only message-channel coverage correction deployed at 4e23dac; /participation channels
> is registered. Client artifacts remain unchanged.
> Current final feature audit: docs/FINAL_8_0_1_AUDIT_2026-10-28.md.
> The owner waived remaining hands-on tests; keep unperformed checks as follow-up.
> 8.0.1 (28 October 2026): full DE/ES addon catalogue and language review.
> 8.0.0 (28 October 2026): security/reliability, versioned Retail overtime scoring,
> French indexing, accessibility, lossless storage compaction and Core extraction.
> Protocol remains 2. Frozen scoring/evidence policies and ledger history are retained.
> Historical checkpoints: docs/archive/AGENT_STATUS_HISTORY_2026-10-28.md.

# Working on Guilded

Discord bot (`src/`) + WoW addon (`addon/Guilded/`) + companion uploader
(`companion/`, `companion-app/`), one product shipped together (they share a
version number). TypeScript/Node/Prisma/Postgres on the bot side, Lua on the
addon side. Full context: `docs/GETTING_STARTED.md` (setup), `docs/DEPLOY_ORACLE.md`
(how the live bot gets updated), `docs/CHARACTER_PAIRING_HANDOFF.md` (one
feature's design notes, as an example of this file's format for a specific
feature).

**Current status (28 October 2026): version 8.0.1 Release, protocol 2.** WoW Forever launches
4 November 2026 (beta closed 21 October); its first raids open 9 December.
Production uses Aiven PostgreSQL; retained Neon configuration is historical.
The bot, online companion, GitHub and CurseForge releases are 8.0.1. Microsoft
Store publishes 8.0.1.0. Its actual install/upgrade, signature/certificate chain,
submitted application bytes and encrypted-profile preservation passed on this PC.
Owner Overview/French checks passed; the optional standalone EXE remains unsigned.
Current per-provider evidence: `docs/V8_0_1_RELEASE_EVIDENCE_2026-10-28.md`.
The WoW edition pages are live. Message earning covers accessible guild channels/threads;
officers can inspect coverage with `/participation channels`. See `docs/PARTICIPATION_CHANNEL_COVERAGE_2026-10-28.md`.
Use the release evidence for each published artifact; historical 7.4.0 approval records
are not evidence for a new 8.0 upload. Current work: `docs/V8_0_LAUNCH_READINESS.md`.
Both addons have
Forever, Era, TBC, Mists and Retail builds; the Windows companion supports all.
See `docs/SESSION_HANDOFF_2026-10-25.md` for current delivery and unfinished work.
Follow `docs/LAUNCH_READINESS_2026-10-24.md` before acting on older holds or
unchecked historical lists. The owner authorized publication on 25 October; retain pending game checks as follow-up.
Do not overwrite published 7.3.2 downloads or bump the version incidentally.
Read `docs/UPDATE_ALL_2026-10-14.md`,
`docs/DUNGEON_DEPLOYMENT_2026-10-14.md` and
`docs/V6_2_STANDALONE_AND_GAMES.md` for current evidence and pending acceptance.
Read `docs/V5_0_RELEASE_HANDOFF.md` first for deployment gates, then
`docs/V6_1_RELEASE_NOTES.md` for the published client. The 6.0 records are historical.
The owner reports the addon installed on both PCs. Fresh-guild setup is being
rehearsed locally; see `docs/FRESH_INSTALL_REHEARSAL.md` and `docs/QUICK_START.md`.
Use `npm run setup:check` to check a new owner's configuration without starting
the bot. Live deployment, final-commit CI and stable publication remain separate gates.

Raid tools were removed from Guilded v6 and archived in
`docs/archive/raid-tools/README.md` for a future standalone addon. Preserve
SavedVariables. The 5.0/4.6/4.5 handoffs describe feature history, not current
version or release status. Standalone first-run work is tracked in
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

## Published public redesign and pending companion release — 19 October 2026

Read `docs/WEBSITE_AND_COMPANION_HANDOFF_2026_10_19.md` before the next deployment.
Both public sites already use PR156 assets revision `be58843`; preserve the ribbon KC,
fresh sanitized screenshots and completed private owner behavior. Integrate PR156 before
building from an older checkout so the next deployment cannot revert the published design.
The normal Worker build matches the active preserved module exactly. Main merges trigger
Cloudflare site builds/deploys, but no installer or bot release. Companion source integration
does not satisfy its real-client release gates. PR151 error-origin reporting was integrated in
7.2.1 (`src/services/report-context.ts`). Never bump the shared
product version incidentally or deploy unrelated unaccepted backend changes to ship styling.
Codex's local coordination notes from 19 October (PR156/PR164 rollout records) are archived in
`docs/archive/CODEX_COORDINATION_2026-10-19.md`.
