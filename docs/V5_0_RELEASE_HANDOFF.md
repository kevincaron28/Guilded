# Guilded 5.0 stabilization — local Claude update handoff

Read this first, then `CLAUDE.md`. This supersedes the deployment order in older handoffs.
Keep version **5.0.0**: it is not publicly released. Do not claim the live server, Windows install,
or real-game checks have passed just because unit tests pass.

## Delivery status and offline import

The cloud workspace completed 784 tests across 101 files, TypeScript, ESLint, addon static
validation, both npm audits (zero reported vulnerabilities), and the 37-file addon ZIP.
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
  invites, map, group board, raid tools, recipes, French UI, and real WoW API behavior.
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
