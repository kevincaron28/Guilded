> CURRENT — 7.5.0 published 26 October 2026 from bda3382. Oracle healthy, protocol 2,
> commands accepted, four migrations applied, all 21 GitHub assets hash-verified.
> All ten CurseForge edition files approved and CDN hashes reverified 26 October.
> Microsoft Store Submission 1 is IN CERTIFICATION, with automatic publication
> after approval. Restricted synthetic reviewer credentials saved with owner consent.
> Read docs/SESSION_HANDOFF_2026-10-26.md for current provider status and pending tests.
> Claude's live Discord/web walkthrough and limits are recorded in
> docs/POST_RELEASE_REVIEW_2026-10-26.md. His text fixes merged in #236.
> Earlier checkpoints below are historical and their draft/local-only holds superseded.
>
> 7.5.0 (26 October 2026): combined release candidate; Claude PRs #226–#228, #230 and #231
> (launch-week addon tools) integrated; main 490d6db. With Store review polish: 311 files / 2,654 tests, TypeScript/lint/addon checks and disposable
> PostgreSQL migration/backup/restore pass. Store upload validated; preview installed,
> captured and removed with its temporary certificate. WACK completed with WARNING,
> not a clean pass. See docs/store-submission/LOCAL_VALIDATION_2026-10-26.md.
> Version chosen by Kevin via the shared coordination notes. Public/live remains 7.4.0.
> Read docs/V7_5_0_RELEASE_NOTES.md and docs/STORE_HANDOFF_2026-10-26.md.
>
> Local release-gap work (26 October): read docs/RELEASE_GAP_WORK_2026-10-26.md.
> Branch codex/release-gap-completion adds audited main/alt apply, participation,
> opt-in availability, edition events and optional Classic buffs. Not deployed.
> Owner retained the license and then authorized progressing toward Store submission;
> see docs/MICROSOFT_STORE_MSIX.md. Guilded Companion is reserved in Partner Center
> as 9N680XX3QFL9; Store-identity build verified, Submission 1 remains a draft.
> See docs/STORE_HANDOFF_2026-10-26.md for upload/certification blockers.
> Claude owns edition raid presets in qgb-claude-gaps; coordinate through
> backups/CODEX_CLAUDE_COORDINATION_2026-10-25.md before integration or restart.
>
> 7.4.0 (25 October 2026): published on GitHub and deployed to Oracle at 8837fd9.
> Both clean-main CI jobs and 2,548 local tests passed; all 21 public assets verified.
> This supersedes the earlier local-only holds below. Read docs/SESSION_HANDOFF_2026-10-25.md
> for release execution and every unfinished acceptance check. Protocol remains 2.
> Claude 816c7af and b9fd62c are included; preserve his separate checkout.

> Latest local bundle review (25 October): docs/LOCAL_BUNDLE_REVIEW_2026-10-25.md.
> 295 files / 2,548 tests passed. Added current core-interaction authorization,
> isolated forms, paginated/exact character picks, atomic backup pages and GRM edge fixes.
> Earlier fixes cover stale roster previews/scope, GRM privacy and
> import validation, availability retry privacy, report scrolling and core response timing.
> Local-only hold continues; core.ts/core-editor.ts/core-planning.ts extend Claude 816c7af.
>
> Local review continuation (25 October): native roster action plans, desktop/CLI GRM
> history migration and edition buff coverage are implemented but uncommitted. See
> docs/LOCAL_ROSTER_GRM_BUFFS_2026-10-25.md (292 files / 2,491 tests passed).
> The owner explicitly keeps this feature bundle local: no publication or version bump.
> Real-client acceptance and Forever custom spell confirmation remain pending.
> Claude 816c7af and b9fd62c changes are integrated unstaged; preserve them before any pull.

> 7.3.2 (25 October 2026): owner authorized full release before the unavailable Forever
> two-PC tests. The prior publication hold is superseded by docs/RELEASE_DECISION_2026-10-25.md.
> Game checks remain pending follow-up; benchmarks remain provisional.
> Current release gaps and operational fixes: docs/RELEASE_GAPS_2026-10-25.md.
> All ten CurseForge edition files are approved. The candidate entries below are
> historical; their publication holds are superseded by the owner's release decision.
> 25 October continuation: multi-edition connected candidate on codex/game-editions,
> PR #216 (stacked on #215/#214). Forever, Era, TBC, Mists and Retail have separate
> guild contexts in one Discord, role IDs, companion profiles, realm identities,
> public seasons and packages. Forever first/last display names retain ledger keys.
> Retail native key/affix/timer evidence and separate keystone leaderboards are implemented.
> Source-reviewed Classic/Retail routes, provisional benchmarks and Raider.IO-inspired
> seasonal Guilded scoring are prepared; see docs/DUNGEON_CATALOG_2026-10-25.md.
> Real-client acceptance and benchmark calibration remain release gates.
> Setup, validation and remaining work: docs/RELEASE_SCOPE_2026-10-25.md.
> 7.3.2 (23 October 2026): deployment candidate for UTC sessions, dungeon evidence/guidance,
> staged recovery and companion startup fixes. Real game/two-PC acceptance remains pending.
> Deployed for testing on 23 October; public release is explicitly held. Current preparation,
> completed operational checks and remaining gates: docs/LAUNCH_READINESS_2026-10-24.md.
> Claude review handoff for the 24 October Codex session: docs/AI_HANDOFF_2026-10-24.md.
> Includes companion installation, Discord evidence/cleanup, fixed shared dungeon scoring,
> exact validation state and the continuing public-release hold. Read it before continuing.
> 7.3.1 (22 October 2026): raid readiness requires level 60 and flags old checks; companion Update now
> repair (a companion on 7.2.0/7.3.0 needs one manual install). Live on the bot and GitHub; CurseForge
> has 7.3.0. Pre-release audit and recommendations: docs/PRE_RELEASE_AUDIT_2026-10-22.md.
> 7.3.0 (20 October 2026): safe-exit dungeon result card in both addons, optional cross-guild raid vacancies and companion browser, public player profiles and dungeon setup guide. See docs/V7_3_0_RELEASE_NOTES.md for deployment and pending real-client acceptance.
> 7.2.1 (20 October 2026): leaderboards-only companions read GuildedDungeons.lua AND Guilded.lua
> (companion/personal-runs.mjs); pool of 8 DB connections (src/database.ts); /health "commands" and
> deploy/update.sh stops when Discord refuses them; error reports carry their origin; official
> seasons (/guilded-season) (docs/V7_2_1_RELEASE_NOTES.md).
> 7.2.0 (19 October 2026): companion Sign in with Discord (/me/companion, src/services/companion-signin.ts),
> one-click Update now (companion-app/update-check.cjs), one site menu in site/nav.mjs (docs/V7_2_0_RELEASE_NOTES.md).
> 7.1.0 (19 October 2026): monthly dungeon seasons (/organize dungeon-seasons), weekly/monthly boards,
> Raider.IO-style leaderboards; weekly reset Tuesday 15:00 UTC (docs/V7_1_0_RELEASE_NOTES.md).
> 7.0.0 (19 October 2026): web sign-in and recruitment (/mod recruit), public dungeon leaderboards
> (/mod leaderboard), standalone Guilded Dungeons addon (addon/GuildedDungeons; after editing Guilded's
> shared dungeon Lua run `npm run dungeons:sync`), companion personal mode and CSV export, /officer export,
> startable provisional all-level season. /officer is the largest command: 3,431 of Discord's 4,000
> characters on 21 October 2026 (/character 3,346; the size test fails above 3,900). Put new
> officer subcommands elsewhere (docs/V7_0_0_RELEASE_NOTES.md).
> 6.7.0 (18 October 2026): members see only their commands; leader and officer tools under /lead,
> /officer, /organize; Integrations-visibility warning in /setup (docs/V6_7_0_RELEASE_NOTES.md).
> 6.6.0 (18 October 2026): Guilded Lite for unapproved hosted servers, dungeon rules v6 with level
> brackets (not active), `/guilded sheet` spreadsheet copy, Ko-fi links (docs/V6_6_0_RELEASE_NOTES.md).
> 6.5.2 (18 October 2026): update prompts (companion banner, self-hosted bot notice; migration
> 20261118090000_update_notice), pairing code shown first (docs/V6_5_2_RELEASE_NOTES.md).
> 6.5.1 (17 October 2026): companions connect with the pairing code alone (docs/V6_5_1_RELEASE_NOTES.md).
> 6.5.0 (17 October 2026): raid-night tools, member EP/GP history, core planning (bot; migration
> 20261117090000_core_planning) (docs/V6_5_0_RELEASE_NOTES.md).
> 6.4.0 (17 October 2026): guided guild setup, raid summary, level-aware gear check; party games only
> in Guilded Games (docs/V6_4_0_RELEASE_NOTES.md). G9 with Games passed on two PCs; companion 6.3.1->6.3.2 upgrade passed.
> 6.3.2 (17 October 2026): in-game polish pass, guided Local guild page, quieter readiness sync
> (docs/V6_3_2_RELEASE_NOTES.md). Two-PC: chat tab, member SR+ and the rest of G1 pass.
> Not run in game: G6-G8 (dungeon runs), G10 (French client), the 6.1.2 parts of G2/G12.
> 6.3.1 (16 October 2026): Forever whisper fix; G9 and the guild map pass (docs/V6_3_1_RELEASE_NOTES.md).
> G1 and G2 pass (night run).
> On WoW Forever never whisper a bare first name: use the sender text or `ns.util.address(name)`.
> 6.3.0 (16 October 2026): guild-wide sync and the fixes from the first two-PC in-game check
> (docs/V6_3_0_RELEASE_NOTES.md; results in docs/V6_2_GAME_ACCEPTANCE.md).
> 6.2.1 (16 October 2026) patches 6.2.0: guild pages, bug inbox, sync fixes (docs/V6_2_1_RELEASE_NOTES.md).
> 6.2.0 Release (16 October 2026): the owner released 6.2.0 (standalone guilds, November
> scoring preparation, companion sync from PR #84) before its real-client checks. Those
> checks in `docs/V6_2_GAME_ACCEPTANCE.md` are post-release follow-up. Release record:
> `docs/archive/V6_2_RELEASE_HANDOFF.md`.
>
> **5.0 delivery note:** The stabilization bundle (Guilded-5.0-Stabilization.zip) was merged as
> PR #4; ignore the offline bundle import section in docs/V5_0_RELEASE_HANDOFF.md. Work now goes
> through pull requests on GitHub: both `Guilded quality` jobs must pass before a merge.
> Real-client gates remain required.

# Working on Guilded

Discord bot (`src/`) + WoW addon (`addon/Guilded/`) + companion uploader
(`companion/`, `companion-app/`), one product shipped together (they share a
version number). TypeScript/Node/Prisma/Postgres on the bot side, Lua on the
addon side. Full context: `docs/GETTING_STARTED.md` (setup), `docs/DEPLOY_ORACLE.md`
(how the live bot gets updated), `docs/CHARACTER_PAIRING_HANDOFF.md` (one
feature's design notes, as an example of this file's format for a specific
feature).

**Current status (26 October 2026): version 7.5.0 release candidate, protocol 2.** WoW Forever launches
4 November 2026 (beta closed 21 October); its first raids open 9 December.
Production uses Aiven PostgreSQL; retained Neon configuration is historical.
The bot, online companion and GitHub public downloads are on 7.4.0.
All ten Guilded and Guilded Dungeons CurseForge 7.4.0 edition files are approved.
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
  Headers named `x-guilded-*` or `x-companion-*` pass through without a Worker change.

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
