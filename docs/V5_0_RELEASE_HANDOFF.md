Rules acceptance and final Carl-bot transition: `docs/RULES_ACCEPTANCE.md`.
Self-role panels can require an existing role; clicks recheck live membership,
role permissions and bot hierarchy. Preserve Exilé → Errant, remove only the
owner-approved Errant permissions, and verify Guilded before disabling Carl.
# Guilded 5.0 stabilization — local Claude update handoff

Seasons, raid posts and attendance (2 Oct 2026): community seasons rotate monthly by default
(`CommunitySeason.monthly`), weekly raid signups open six days ahead, signup posts of past raids
are removed after 24 hours, and `/setup` gains an officers-only raid attendance channel
(`GuildSettings.attendanceChannelId`). Additive migration
`20261103090000_attendance_channel_monthly_seasons`; bot only, no client rebuild or version bump.
The existing season becomes monthly and will rotate on 1 November. Real Discord checks remain.

Clickable community hub and numbered seasons (2 Oct 2026): `docs/COMMUNITY_EXPERIENCE.md`.
Additive migration `20261102090000_community_experience`, bot/command deployment and
then the REST maintenance script refresh the existing panels without recreating the
season or touching points. Handlers must be live before publishing buttons. No version
bump. PoE2 role/channel/statistics integration proposal: `docs/POE2_DISCORD_INTEGRATION.md`.

PoE2 reader reliability and live view (2 Oct 2026): `docs/POE2_RELIABILITY.md`.
Rebuild the companion for bounded catch-up, cautious rotation recovery, file
diagnostics and local daily/current-map metrics. No migration or version bump.
Existing journals remain readable; preserve them if rolling back to an older
build. Current-patch English/French logs and Windows/PostgreSQL gates remain required.

Audit hardening (2 Oct 2026, branch `fix/audit-hardening`): `docs/AUDIT_HARDENING.md`.
Imports hold entries they cannot place instead of failing (`/import held`), `/guilded void`,
awards shared between officers in a raid, transactional decay, restart on uncaught errors and
data retention. Additive migration `20261101090000_addon_held_entries`; rebuild the addon ZIP
and the companion (both changed). Version stays 5.0.0, protocol stays 2. PostgreSQL CI and
real-client checks remain required.

Community leaderboard follow-up (2 Oct 2026): `docs/COMMUNITY_LEADERBOARD.md`.
The existing Community rankings channel is reused as `🏆・leaderboard`; the bot
refreshes its pinned bilingual podium on startup and every five minutes. Existing
seasons and points stay intact. Only unrestricted Discord seasons hosted in that
channel are published. No migration, client rebuild or version bump is required;
deploy after the usual checks, CI and verified backup gates.

Core deletion follow-up (2 Oct 2026): `/core delete` always removes the core's
linked channels (roster, signups, loot, reports, chat and voice), any additional
channels in its category, the category and its role. The former `channels` option
and default archival behavior are removed. Discord cleanup failures keep the core
record and report the failed resources so an officer can fix permissions and retry.
Existing raids/signups and the separate-point-pool deletion guard remain. Refresh
slash commands on deployment. No migration or version bump; real Discord verification
is still required.

Discord participation rewards: `docs/DISCORD_PARTICIPATION.md`. Opt-in per Discord
community season/channel; capped messages and reactions, reviewed helper nominations,
and shared voice time capped at **4 hours/day (32 points)**. Migration additive
`20261030090000_community_participation`; PostgreSQL rehearsal includes concurrency,
rollback and restore checks. Deploy only after the usual CI and backup gates, then
configure `/participation settings`. Message Content remains optional; no audio is
recorded. Real Discord checks remain required. Product version stays 5.0.0.

Branded desktop + no-install online companion: `docs/COMPANION_EXPERIENCE.md`.
Shared screens now use the owner's Guilded logo, guided setup and individual
WoW/PoE2 pages. `/companion/` supports local browser file parsing, manual sync,
standings downloads and personal map history. Build with `npm run companion:build`;
existing Oracle Caddy configurations need the new companion proxy paths during
release. Desktop pairing and online pairing currently replace the previous link.
No additional migration or version bump; real-client and release gates remain.

Native Discord event syncing: `docs/DISCORD_EVENTS.md`. Raids, weekly core
occurrences and gaming nights publish linked events with edit/cancel/start/end
updates and durable recovery. Deploy additive migration
`20261029090000_discord_scheduled_events` after CI and backup, grant Create Events
(plus View Channel/Connect for voice events), then verify on real Discord.
Private events use compatible existing voice channels. Version remains 5.0.0.

PoE2 mapping journal implementation: `docs/POE2_MAPPING.md`. Disabled by default;
`/poe` adds setup, pairing, personal visits and league/mode activity summaries.
Companion supports opt-in PoE2 `Client.txt` tracking and PoE2-only setups.
Deploy additive migration `20261028090000_poe_mapping` after CI and backup, and
rebuild the companion. Log observations never award automatic completion points.
Real PoE2/Windows checks remain required; version stays 5.0.0.
PoE2 map instances follow-up (2 Oct 2026): additive migration
`20261031090000_poe_map_instances` adds the optional `instanceRef`; `/poe summary`
counts maps vs portal entries, map names are readable and league options autocomplete.
Deploy it with the PoE migration above and ship the rebuilt companion.
Class/spec display: `docs/CLASS_AND_GEAR_SIGNUPS.md`. Signup posts and core
rosters show two icons plus the selected character's localized specialization.
Provision the application-owned spec emojis, refresh existing posts, and install
the rebuilt addon for Classic talent-tree detection. No migration, version bump
or inferred character specialization is required. Real-client checks stay separate.

Community activities and Carl-bot transition: `docs/COMMUNITY_ACTIVITIES.md`.
New `/community` menus cover free/points/WoW gold/PoE currency lotteries,
gaming nights, reviewed challenges, dice/quiz games and separate season rankings.
Deploy additive migration `20261027090000_community_activities` after CI and backup.
In-game payments require organizer confirmation. Existing game roles are reused;
Carl-bot retirement and a real welcome/role-button check remain separate live gates.

WoW class icons and inspected gear in signups/rosters:
`docs/CLASS_AND_GEAR_SIGNUPS.md`. No migration; preserve existing signup
identities. Accepted inspections refresh active posts through durable jobs.
Character signups and approved WoW layout: `docs/CHARACTER_SIGNUPS.md`.
Deploy additive migration `20261026090000_character_signups`, enable Quebec
Gold's character policy and route the weekly report to its managed WoW channel.
One primary plus backups per core; no existing character assignment is guessed.

Core-only loot and WoW weekly reports: `docs/CORE_LOOT_AND_WOW_REPORTS.md`.
Deploy additive migration `20261025090000_core_loot_wow_report`, then enable
Quebec Gold's policy and explicitly route its WoW report after backing up.

Weekly core scheduling: `docs/CORE_WEEKLY_RAIDS.md`. Owner chose a rolling **7-day**
signup window; deploy additive migration `20261024090000_core_weekly_schedule`.
Existing display-only core schedules are not automatically enabled.

Latest audit follow-up: `docs/SYSTEM_POLISH_2026-09-30.md` (database-backed Discord retries, officer sync dashboard, explicit calendar raid IDs, frozen season archives/Hall of Fame and encrypted offsite recovery). PoE 2 planning: `docs/POE2_GUILD_COMPETITION_PLAN.md`. Product stays 5.0.0/protocol 2; deploy migration `20260930180000_system_delivery_archive`, rebuild both client packages and reinstall while preserving pairing/SavedVariables. Real-client gates remain outstanding.

Latest core raid, full setup reset and dungeon results changes: `docs/CORE_RAIDS_AND_DUNGEON_RESULTS.md`.

Read this first, then `CLAUDE.md`. This supersedes the deployment order in older handoffs.
Keep version **5.0.0**: it is not publicly released. Do not claim the live server, Windows install,
or real-game checks have passed just because unit tests pass.

## Delivery status and offline import

The cloud workspace completed 781 tests across 101 files, TypeScript, ESLint, addon static
validation, both npm audits (zero reported vulnerabilities), and the 36-file addon ZIP.
GitHub rejected publishing with HTTP 403 "Resource not accessible by integration".
No remote branch/PR was created, no CI run occurred, and no production deployment was attempted.
PostgreSQL migration/restore and Windows installer checks are still REQUIRED.

If this arrives as **Guilded-5.0-Stabilization.zip**, the owner only needs to download it.
Local Claude should locate that exact archive in Downloads, extract it to a temporary directory,
read START-HERE.md, and verify SHA256SUMS.json before importing the included git bundle.
The bundle contains only changes after base commit
`5a3c88f005a57cee53dc94a829d98a8eb34b4db5`; it needs that base in the local repository.

In the owner's existing Guilded repo, preserve current work, fetch origin, and run:
```text
git bundle verify <extracted>/guilded-v5-stabilization.bundle
git fetch <extracted>/guilded-v5-stabilization.bundle refs/heads/fix/v5-release-stabilization:refs/heads/review/guilded-v5-stabilization
```
Use a separate worktree on `review/guilded-v5-stabilization` if the main checkout has edits.
If that branch already exists, compare it; never force-update it. Review the changes and merge
current origin/main into the review branch if needed, resolving conflicts while preserving newer
work. Push it with the owner's EXISTING GitHub access, open a PR to main, and require both
`Guilded quality` jobs to pass before continuing the local update order below. Do not treat
this document's local test results as proof that Windows/PostgreSQL CI passed.

## User's requested outcome

The owner asked for all review fixes and a one-prompt local update from Claude in VS Code.
Implement/review/build work is authorized. The local agent should do the mechanical update steps
using the owner's existing configuration, without asking them to type commands. Never reset a dirty
checkout, discard changes, print secrets, start a second live bot, or invent credentials. Public
CurseForge/GitHub release publication is a separate release gate, after the manual checks below.

## Raid helper and guild map follow-up

- Raid target icons, secure floor-marker buttons and boss plans are in the addon TOC/package.
- Shift-click the Guilded minimap coin to open Raid tools directly. Alt-click opens the world map
  and requests fresh guild positions. Existing left-click menu/right-click gear behavior is kept.
- The map module keeps its update timer when enabled after login. Parent-map rectangle projection
  supports world/continent views when world conversion is unavailable. Classic minimap coordinates
  now derive map width/height without assuming the game's world axes are east/north.
- Position requests/replies are rate limited; sharing off stays private. Pin frames sit above their
  map parent. English/French help includes the shortcuts and map diagnostics.
- `/guilded map check` explains module/share/show state, available player position and received peers.
  If the module is off, use `/guilded modules on guildmap` first. Both players need the updated addon
  and `/guilded map share on`; the viewer needs `/guilded map show on`. Guild tracking does not
  reveal players without Guilded or positions hidden by the client (including instances).
- Local Claude must install the updated addon for BOTH test players. Real-client test: stand nearby
  outdoors, Alt-click the coin, verify named dots on the minimap and M zone map, then zoom out to
  the continent/world map. Walk north/east and rotate/zoom the minimap; dots should follow correctly.
  Test sharing off/on and module off/on, then confirm Shift-click, target icons and floor markers
  as raid leader/assistant. Floor markers remain subject to the actual client's supported commands.
- The exact cause on the owner's live client cannot be confirmed until this build is installed
  and the above two-player test runs; do not describe the fixes as a completed in-game verification.

## Removed addon group finder

At the owner's request, the standalone in-game group finder has been removed: no Groups page,
LFG posting/alerts, module switch, slash commands or GuildedLFG message receiver. Dungeon run
tracking and scores remain; scores have their own Scores page. Discord group creation, signups
and alerts remain unchanged. Use the game's built-in finder for in-game groups.

Local Claude: install the full updated addon including Guilded.toc. An old Groups.lua left by an
overlay install is not loaded by the new TOC; remove only that obsolete module file after backup.
Preserve SavedVariables; unused old lfgAlerts/module preferences are harmless. Verify the menu has
Scores and no Groups page, dungeon tracking still works, and Discord groups still work.

## What changed

- Loot: guild-price fallback works without a selected core. New local ledger events keep `coreId`.
  Effective EP/GP overlays unacknowledged events on a consistent server snapshot, including alts
  sharing an account. GP deductions use the current synced balance and the selected pool.
- Protocol **2**: standings include accepted ledger references and account identities. The bot reads
  standings and acknowledgements in one repeatable-read transaction; companion writes atomically.
  Old ledger entries without `coreId` remain in the guild pool. Do not guess historic core assignments.
- Import concurrency: per-guild PostgreSQL transaction advisory lock plus unique `(guildId, sourceRef)`
  indexes on both ledgers. Migration `20261021090000_ledger_event_uniqueness` is additive and refuses
  existing duplicate references. It NEVER deletes point history to make the migration pass.
- Access: the shared `COMPANION_UPLOAD_TOKEN` no longer authorizes uploads or standings. Each companion
  needs its existing personal credential or a new `/character pair` code. Pairing codes do not need
  a shared server secret. Every request verifies active guild membership and fresh Discord roles.
  Officers may upload guild state; other accounts upload only owned character readiness, attunements,
  recipes and cooldowns. Personal uploads auto-apply; officer uploads obey `autoApplyImports`.
  Member dungeon/peer-guild uploads are deliberately excluded from personal scope; an officer's
  companion imports guild dungeon reports. Do not re-enable arbitrary guild writes for members.
- Companion: startup reconciliation, bounded network timeouts, single upload in flight, coalescing,
  exponential retry (5 seconds to 5 minutes), cancellation on stop/reconfigure, no retries for 401,
  HTTPS except loopback, no credential-bearing redirects, separate upload/standings health, versions.
- Dependencies: Electron 44 + builder 26, patched Vitest 4; deepmerge-ts 8 override for Prisma CLI's
  transitive advisory. Prisma remains on 6 (no unrelated ORM-major migration). Recheck the override
  on future Prisma upgrades and remove it when upstream supplies the patched dependency.
- ZIP packaging uses fflate on Windows/Linux and always substitutes empty Standings.lua.
- GitHub Actions: unit/type/lint/Lua checks, security audit, local PostgreSQL migration/concurrency/
  restore rehearsal, addon ZIP, Windows installer artifacts. No deployment secrets required.

## Local agent: execute in this order

1. Inspect git status and current branch. Fetch origin. If this work is on a PR, inspect its diff and
   require the `Guilded quality` jobs to pass; merge it using the owner's GitHub access, then fast-forward
   local main. Preserve unrelated local edits (stop with an exact conflict report if necessary).
2. Use Node 24 LTS for the bot/build. Run `npm ci` and `npm ci --prefix companion-app`, then
   `npm run release:prepare`. This validates versions, generates Prisma, runs checks/audits, builds
   `dist/Guilded-v5.0.0.zip`, and on Windows builds `dist/companion/Guilded Companion Setup 5.0.0.exe`.
   Do not use `npm audit fix --force` or bump the product version as housekeeping.
3. Confirm CI's PostgreSQL job is green. To reproduce locally, start a DISPOSABLE localhost
   PostgreSQL 16 database named `guilded_release_test`, install PostgreSQL client tools, set
   `TEST_DATABASE_URL` to that database, and run `npm run test:postgres`. This command overwrites
   ONLY that named localhost test database during restore. Never point it at production/Neon.
4. Before production migration, run `npm run release:ledger-check` against the existing server
   environment (read-only). Save a real PostgreSQL custom-format backup (`pg_dump`) on the server
   outside the git checkout, mode 600, and verify `pg_restore --list` can read it. Record its path
   and current deployed commit WITHOUT printing connection strings. Confirm provider restore
   availability as an additional recovery path; do not assume the account's retention period.
   If duplicates are reported, STOP the deployment and explain which event IDs need accounting
   review. Do not remove/rename source references or delete records to evade the gate.
5. On the owner's Windows PC only, use the EXISTING configured Oracle SSH key/host from
   `redeploy-oracle.bat`. Cloud agents do not have that key. Run `redeploy-oracle.bat --yes` after
   the gates above. It requires clean main equal to origin/main. Do not launch `npm run dev` or
   `start-bot.bat`; Oracle already runs the bot. Server startup applies pending migrations.
   Check the deployed commit, systemd status, and `/health` (requires Discord ready, protocol 2),
   then `/report ping` using the owner's existing Discord access if available.
6. Quit the old companion. Locate the actual WoW install and current Guilded folder from existing
   companion config; do not guess among multiple accounts. Back up `WTF/.../SavedVariables/Guilded.lua`
   and the old addon folder. Extract the new ZIP into `Interface/AddOns`. Do not delete SavedVariables.
   Run the new companion installer with `/S` for the existing per-user install, then reopen the app.
   Preserve its config and personal credential. Verify tray/window and version 5.0.0.
7. Existing paired companions should keep working. An unpaired/revoked companion must be linked with
   `/character pair` from its actual Discord account. If local Claude cannot operate that authenticated
   account, this one-time identity step needs the user; do not impersonate the account or distribute
   the old shared token. Link OFFICER accounts on PCs that upload guild ledgers.
8. Run `/setup start` > Update bot messages per guild using the user's existing authorized Discord
   session if available. Message Content Intent remains OPTIONAL; enable it in the Developer Portal
   before setting `MESSAGE_CONTENT_INTENT=true`, and only if the answer-channel feature is wanted.
9. Finish the real-client checklist below. Produce a short completion report with commit, versions,
   successful checks, backup location, deployment status and any exact remaining human actions.
   Do not claim a polished public release until those checks pass.

## Required real-client release checks (not replaceable by mocks)

- Windows: clean install AND upgrade; tray/window, startup, pairing, restart with unsent data,
  offline bot recovery, revoked pairing, uninstall and data cleanup. Test on a non-developer PC.
- Two players: award two items consecutively without reload; priority changes after the first.
  Reload/upload both companions together; points do not double. Verify a GP deduction.
- Core A has its own pool; Core B and guild pool stay unchanged after A's awards. Test an alt sharing
  the account and changing cores. Confirm each historical migration preserves existing points.
- Ordinary member: personal upload works, arbitrary ledger/other-guild access does not. Demote the
  officer/revoke its credential and verify the next request loses privilege.
- Verify every 5.0 item in `RELEASE_CHECKLIST.md`: permissions, bidding/council/reserves, roster/backup
  invites, map, raid tools, recipes, French UI, and real WoW API behavior.
- One real raid night with officer diagnostics and accurate totals before promoting Beta to Release.

## Rollback

Keep the previous code/artifacts and the verified database backup before updating. Stop the service
before restoring a database. Do not run old and new bots simultaneously. The new indexes are additive,
so a code rollback normally does not require a database rollback, but old companions/new bot are not
an authentication-compatible mix: roll the bot and companion together if rollback is necessary.
Do not undo a migration with `migrate reset` or edit applied SQL. If a migration failed, inspect
`prisma migrate status`; only mark it rolled back after verifying its partial effects were removed.
The server updater refuses detached/non-main checkouts; its normal update path is not a rollback tool.
A local agent can deploy a reviewed revert on main, or restore a saved application directory while
keeping secrets and backups. Database restore discards later writes and requires an explicit choice.

## Prompt for the owner

“Read CLAUDE.md and docs/V5_0_RELEASE_HANDOFF.md. Complete the Guilded 5.0 stabilization update on my
local Windows setup and existing Oracle deployment, following the gates and preserving my data.
Inspect and merge the stabilization PR only after CI passes, sync main, build, back up, update the
bot/addon/companion, and verify what you can. Do not start a second bot or publish the public release.
Tell me only the exact identity or in-game checks that require me.”
