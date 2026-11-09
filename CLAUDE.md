> 9.1.1 (9 November 2026): the zero-setup companion finds Québec Gold: the Discord server is matched by normalised in-game guild name, the realm only a hint (#695), unsigned companions upload dungeon runs (#694), empty dungeon boards explain why (#693), Rare card art in the mobile app (#692). Bot deployed separately. Store: 9.1.1.0 package built, not submitted (Submission 13 certifying).
> 9.1.0 (9 November 2026): the zero-setup companion (#684): install it and it syncs with no Discord sign-in (device key, server picked from the in-game guild, characters shown as reported until a sign-in confirms them); Discord sign-in is optional. Migration `companion_devices`; the website Worker allow-lists `/api/v1/device/*`. Store: 9.1.0.0 package built, not submitted (Submission 13 certifying).
> 9.0.9 (9 November 2026): every guild and party Invite button is a secure `/ginvite` or `/invite` macro button (#681), uploads survive two connections sending one file (P2034 retry, queued uploads), the companion warns about a wrong server and can Remove this server (#682), members download from the website instead of GitHub (#683); bot: smaller addon-import payloads and backups (#679). Store: 9.0.9.0 package built, waits for Submission 13.
> 9.0.8 (9 November 2026): the bot confirms every received dungeon run (DungeonRunReceipt, #669) so none wait forever, uploads skip known runs (ended the P2028 timeouts), the Store companion can start with Windows; the addon's chat tab and auto-invite stop calling protected functions (login popup, #668) and map dots use Guilded's own layer (#662); bot: confirmed vs reported characters, rank roles preview, roster freshness (#667). Store: 9.0.8.0 waits for Submission 13.
> 9.0.7 (9 November 2026): Guilded Dungeons no longer taints `SlashCmdList`, so `/ginvite` works again (#655, guard test), tooltips are no longer refreshed or decorated by Guilded in combat (duel Lua error and blocked actions, #657), and every WoW Forever achievement is tracked as a generated badge (#649, companion uploads it). Website installer served from the bot's server (#653, already live). Store: submit 9.0.7.0 (companion changed).
> 9.0.6 (8 November 2026): the companion updates itself and installs the addon from the website first (GitHub second, after GitHub downloads timed out on 8 Nov, #633), and `/guilded probe achievements` reads what achievement data WoW Forever exposes (#625). Bot (already live): Guilded Clash card game server (collection, AI + PvE, matches, guild trading, friendly and ranked PvP), board channel fixes, 17 s standings deadline. Store: submit 9.0.6.0 (companion changed).
> 9.0.5 (8 November 2026): no more "Guilded has been blocked" popup at login on WoW Forever (the game refuses addon guild-note edits even on a click; officer auto notes stopped, refused guild actions remembered per client build, #618), plus the bot updates live since 9.0.4: dungeon score on run cards (#611), one group finder for dungeons and PvP (#619), readable journal notices. Companion code unchanged since 9.0.4 (Store: 9.0.4.0 submission kept).
> 9.0.4 (8 November 2026): no more "blocked action" warning at login (RosterProfessions taint, #595), several WoW accounts per member in the companion (#592, #593), plus the bot updates live since 9.0.3: character pictures, record cards, Discord polish (French, card text fits), item previews always link, WoW role button fix, addon-import failure reasons and retries, deploy guards after the 7-8 Nov freeze (#598, #601) and an uptime email. Store: submit with every companion release (owner, 7 Nov).
> 9.0.3 (7 November 2026): WoW Forever only everywhere (addons, companion, packaging, website and bot; old rows kept, stage 7 declined), world PvP board, any online guild member tagged for invites with join auto-detect, correct roles on dungeon cards, plain-letter names on cards, lighter deploys. Owner decisions: character pictures and several accounts per member approved; paid tier stays off. Store: skipped unless the owner asks.
> 9.0.2 (7 November 2026): companion redesign with automatic setup, an installer that replaces a Store install, in-game crafting orders, dungeon stats screens, world PvP stats, traced dungeon maps, profession badges, the false call-for-help fix; bot: guild activity ladder, Top crafters, craft order channels, duel scoring by level, 24h rank arrows, read-only boards, rookie of the week, countdowns removed, low-priority deploys. Store: skipped unless the owner asks (next package 9.0.2.0).
> 9.0.1 (7 November 2026): fix release after 9.0.0 — addon fixes (guild snapshot error, companion download window, roster admin window, Info and data tab, officer notes, sync relay), bot fixes (one dungeon card per run, nickname sync, race to 60 cards, Delete my data, full names) and website updates. Store: ship the companion as 9.0.1.0.
> 9.0.0 (6 November 2026): the 8.5 work shipped as 9.0 — achievements, duel and battleground ladders, race to 60 board and Hall of Fame, nickname sync, guild roster/bank/event sync, call for help, PvP finder, levelling partners, in-game raid sign-up, recruiting kit, companion setup/repair and settings-save fixes. Store: ship the companion as 9.0.0.0.
> 8.4.7 (6 November 2026): Forever dungeon final bosses and recovery of abandoned runs (#384), silent auto-update for the direct-download companion with a fixed-name `Guilded.Companion.Setup.exe` release asset (#383) on top of 8.4.6's member ledger sync (#379), live duel board (#378), companion account-folder fix (#376), combat-safe windows (#377), compact Crafted by tooltip (#375) and Forever-only focus (#380, see docs/FOREVER_ONLY_FOCUS.md). The Store requires strictly increasing versions: ship the companion as 8.4.7.0 (revision 0).
> **"Continue work" (owner, 6 November 2026):** start at ROADMAP.md "Start here — 7 November 2026". You are the coordinator: dispatch one worker session per track on the cheapest fitting model, workers report back, you merge, back up, deploy and publish. Next versions: 9.0.1 (fixes) or 9.1.0 (features); only the coordinator bumps.
> Current checkpoint: 7 November 2026, 00:45 UTC. 9.0.0 on the bot (main debbad1, with the Season 1 dungeon leniency #455), GitHub latest release, CurseForge (in review), Store 9.0.0.0 in certification (Submission 12). Check each provider live before claiming status. Companion upgrade settings and the in-game 9.0 checks still need real clients.
> Cards: `src/services/score-card.ts` renders every share card (WoW theme, roster layout); `end-cards.ts` builds the raid and battleground cards; queued Discord messages store a card definition and draw it on delivery.
> Docs: `docs/` holds living guides and design notes plus the 8.3+ release records; point-in-time handoffs, audits and older release notes live in `docs/archive/` (`docs/archive/releases/` for release notes and evidence before 8.3). Archived docs are history, not current status.
> Latest owner authorization: ALL AVAILABLE TESTING NOW. Native/game testing is assigned to Claude; avoid concurrent desktop control.
> Release evidence: `docs/V8_4_7_RELEASE_ACCEPTANCE.md` (latest), earlier 8.4.x and `docs/V8_3_0_RELEASE_ACCEPTANCE.md` beside it. Preserve published artifact bytes; never overwrite a published download.
> Keep the stored edition calendars unchanged ([EDITION_CALENDARS_2026-10-30.md](docs/archive/EDITION_CALENDARS_2026-10-30.md)); since the Forever-only removal nothing creates or edits other editions' calendars.
> No automatic messages/awards without configured opt-in. Exception (owner decision, 5 November 2026): the addon's guild-chat milestone announcements (levels, first dungeon clears, PvP and duel milestones) are ON by default for members, after a one-time local notice; members turn them off with `/guilded announce off`, and an officer's guild-wide off switch wins. Discord echoes of them stay opt-in per server. Second exception (owner decision, 6 November 2026): a member gets one Discord DM confirming which characters were linked after their first companion link (skipped quietly when DMs are closed). Third decision (owner, 6 November 2026): every new 8.5 feature is ON by default in every server, with officer and member off switches; see ROADMAP.md rule 5.

# Working on Guilded

Discord bot (`src/`) + WoW addon (`addon/Guilded/`) + companion uploader
(`companion/`, `companion-app/`), one product shipped together (they share a
version number). TypeScript/Node/Prisma/Postgres on the bot side, Lua on the
addon side. Full context: `docs/GETTING_STARTED.md` (setup), `docs/DEPLOY_ORACLE.md`
(how the live bot gets updated), `docs/CHARACTER_PAIRING_HANDOFF.md` (one
feature's design notes, as an example of this file's format for a specific
feature).

**Current status (9 November 2026): version 9.1.1, protocol 2.**
8.4.7 is on GitHub (latest release) and the bot. CurseForge has the 8.4.6 Forever files; the
Store has 8.4.4.0 live with 8.4.6.0 in certification. Check each provider live before claiming
status. WoW Forever launched 4 November 2026; its first raids open 9 December.
Production uses Aiven PostgreSQL; retained Neon configuration is historical.
Guilded supports WoW Forever only: the other WoW editions were removed on 7 November 2026
(`docs/plans/FOREVER_ONLY_REMOVAL.md`); stored rows of other editions stay readable and new uploads from them are
refused (`assertForeverEdition` in `companion/game-edition.mjs`). Message earning covers accessible guild
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

- **WoW Forever only** — the other WoW editions are removed (`docs/plans/FOREVER_ONLY_REMOVAL.md`). `companion/active-games.mjs` (PoE2 community and tracking) still decides what members see of PoE2; hidden is never deleted (`docs/FOREVER_ONLY_FOCUS.md`).
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
