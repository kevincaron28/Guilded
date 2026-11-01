# AI handoff for Claude — 24 October 2026

Read this after `CLAUDE.md`. Kevin requested an end-of-session review of everything
prepared during this Codex session. This handoff does not authorize a public release.

## Latest delivery: updated companion installed on Kevin's PC

On **24 October 2026, about 20:08 Toronto time**, Kevin explicitly requested the
new candidate installation while preserving settings/pairing and withholding
public release. Installed the verified `b755adf012e508fbc9b7662d57e2c51140d5b89b`
package (NSIS silent exit 0), then relaunched the native app. This supersedes the
older "not installed" / installed `489664a` statements below.

- Installer SHA-256: `33a037d41137bee73880e9a5a5a9ccb82d422c59d49c6be9ff92336ee64a1c6b`.
- All 18 installed app/engine/library files match the built package. This includes
  a byte comparison of the **entire app.asar**, covering renderer code/assets too.
- `config.json` is byte-identical before and after installation and startup,
  preserving pairing and all saved settings. Private backup and verification:
  `backups/companion-update-20261024-200745/`. Do not publish that configuration.
- Native accessibility confirms version 7.3.2, Account linked, Tracking paused,
  and the corrected **Selected folder** wording. The saved beta directory is
  still absent; its configured path was deliberately preserved for launch review.
- Read-only calls through the **installed engine** passed: standings connection
  sees three characters; management GET returns 200, one owned character, two
  cores and raid-leader access. No live management edits or uploads were submitted.
- Installed-engine synthetic smoke: 12 timestamp-only refreshes updated both
  generated standings files without extra success logs. A real data change logged
  once; deleting the synthetic standings file caused one logged repair. The test
  used an in-memory fetch stub, no real game files and zero network requests.
- Revalidation passed: 269 files / 2,262 tests, TypeScript, ESLint and both addon
  validators. Logs, `verification.json`, `connection-check.json`, `engine-smoke.json`
  and repeatable private verification scripts are in the backup folder above.
- Native automation is still limited: clicks return unavailable geometry and Tab
  did not change focus. Kevin was asked to choose French and open Cores et prix
  for a read-only native inspection; this is not yet recorded as a completed test.

No bot deployment, main merge, public download change or Discord notification.
Required game/two-PC/French-client, fresh-member/guild and remaining Discord
candidate interaction gates still apply. **Public release remains on hold.**

## Latest continuation: offline management acceptance

See `OFFLINE_ACCEPTANCE_2026-10-24.md` for the reproducible synthetic browser
walkthrough and five new save-recovery regressions. It found and fixed lost drafts
after refused saves, unhandled disconnected saves, and overlapping saves after a
language change. The paused folder detail now says "Selected folder"; French site
navigation now carries the language into Companion. The native installation is
still `489664a`; these newer changes are candidate source until explicitly packaged
and installed. Do not attribute them to that older installed binary.

Local validation: 269 files / 2,262 tests, TypeScript, ESLint, both addon validators
and Worker/site build passed. Source `a42e311` also passed both GitHub quality jobs
(run `40135905863`) and Cloudflare preview build `748e8a53-fa14-440e-9de7-de6d30824e49`.
The read-only bug inbox has no open member reports;
the sole historical October 19 connection-pool error has not recurred there.
Kevin restored the native window, but clicks still failed with unavailable geometry,
keyboard navigation did not change focus, and screenshot capture timed out. Native
French click-through remains incomplete. No real guild edits, Discord messages,
notifications, bot deployment, main merge or public publication were performed.
The existing public-release hold and actual game/two-PC/Discord gates still apply.

`npm run release:prepare` subsequently completed successfully. The candidate
manifest records clean source `b755adf012e508fbc9b7662d57e2c51140d5b89b`; all 2,262
tests, both audits (zero vulnerabilities), addon ZIPs, browser bundle, Windows NSIS
installer and packaged-source verification passed. Installer SHA-256:
`33a037d41137bee73880e9a5a5a9ccb82d422c59d49c6be9ff92336ee64a1c6b`.
Manifest and sums are retained in `backups/offline-management-package-2026-10-24/`.
The installer is built for later acceptance; it was **not installed or published**.
Installed source remains `489664a`, with the owner's existing settings/pairing.

Latest continuation: see `COMPANION_FRENCH_2026-10-24.md` for the shared French
companion, signed-out management/error fixes and mobile checks. Earlier statements
below that French translation is unfinished describe the previous source state.
Kevin subsequently signed in to Cloudflare. Its log identified npm 10.9.2 rejecting
the npm 11 lockfile's Undici override during `npm ci`. This was reproduced locally;
`package.json` now pins npm 11.13.0 using Cloudflare's supported `packageManager`
field. Hosted verification is separate from a successful local dry run.

## Cloudflare repair confirmed after sign-in

Fix commit `5c9b8b7c029d53e1e15772dca24dc599a3e1ac46` passed the actual Workers
Builds check. Build `fee77c0b-24bb-4db9-87d8-2315818fc6d0` selected npm 11.13.0,
installed dependencies, built the site and completed `npx wrangler preview`.
The dashboard and GitHub external check both report success. This supersedes
the access-blocked and unresolved Cloudflare notes retained below as history.

- Branch preview: https://codex-prelaunch-features-guilded-wow.kcaron.workers.dev
- Unique preview deployment: https://d06e930b-guilded-wow.kcaron.workers.dev
- Build evidence: `output/cloudflare-build-fixed-2026-10-24.png`.
- Local npm 10.9.2 failure reproduced in an isolated manifest copy; npm 11.13.0
  clean-install dry run passed on the same lockfile. No dependency downgrade or
  lockfile rewrite, no removal of the Undici override, and no dashboard edits.
- Local validation passed again: 268 files / 2,257 tests, TypeScript, ESLint,
  both addon validators and Worker/site build. Logs: `backups/cloudflare-npm*.log`
  and `backups/cloudflare-npm-fix-tests.log`.
- GitHub quality workflow for the fix: run 40133180553. Windows packaging passed
  when this record was written; inspect the final documentation head's checks
  before deployment or merge, as usual.
- The preview warns that production `OWNER_RESOURCES` KV is absent. This was not
  changed or granted to the preview. Owner-resource preview functionality is
  therefore limited; the warning does not fail the build. No production binding,
  routes, secrets, main branch or public downloads were changed.

The installed companion remains the verified `489664a` build; this repair changes
build-tool selection only. **Public release and real-client gates remain held.**

## Latest delivery: French companion installed

- Code/package commit: `489664aa9da79879b438b7c5b8abe3d204f1521f` on the same
  draft PR #215. The subsequent handoff commit is documentation only.
- Both GitHub quality jobs passed on this exact source in
  [run 40132075935](https://github.com/kevincaron28/Guilded/actions/runs/40132075935).
  This includes PostgreSQL integration and Windows packaging. The push run
  40132072573 also passed both jobs. Do not confuse these with Cloudflare.
- `npm run release:prepare` completed on the clean source commit: 268 files /
  2,257 tests, typecheck, lint, addon validation, both zero-vulnerability audits,
  both addon ZIPs, site, browser companion, Windows NSIS installer and packaged
  artifact verification. Source dirty was false. Worker dry run also passed.
- Installed that package on Kevin's PC (silent installer exit 0). All 18 app/
  engine/library files checked match the build. Configuration remains
  **byte-identical**, including pairing. No reset, re-pairing or folder change.
- Installer SHA-256:
  `ccc73e742dc2d9027be2b12f70a0be50cfe35dfdbbea47e71103f11afc9c49b0`.
  Manifest: `dist/Guilded-v7.3.2-Artifact-Verification.json`; sums:
  `dist/Guilded-v7.3.2-SHA256SUMS.txt`. Private backup/verification:
  `backups/companion-french-install-2026-10-24/` (never publish its config).
- Installed app launched and its accessibility state reports Account linked,
  version 7.3.2, tracking paused. Its old beta folder remains absent. A read-only
  connection check through the installed engine succeeded with three standings
  characters; management GET returned 200 with one owned character and two cores.
  No uploads, edits or Discord notifications were triggered by those checks.
- Browser French UI, eight pages, language/reload behavior, preserved unsaved
  setup text, signed-out errors and 320 px layout were checked. Screenshot:
  `output/companion-french-2026-10-24.png`.
- Native click-through remains incomplete: accessibility could read the running
  app, but input returned `coordinate input geometry is unavailable` and capture
  returned `FrameArrived timed out`; refreshing/raising the window did not repair
  input. No native language selection was changed. Native locale/IPC/updater
  behavior has automated coverage; do not claim a completed manual Windows
  French walkthrough or authenticated management editing walkthrough.
- Cloudflare failed again for this source: build
  `e4206bbb-dcbf-4e14-b9e5-8b267c1809c7`. Existing CLI access cannot read build logs
  (403/12004), and the dashboard requires sign-in. No build settings were guessed,
  permissions expanded, secrets created, checks disabled or production deployed.
  Continue from the sign-in handoff and inspect the actual failed log.

Production bot/main/public downloads remain unchanged. Real game/two-PC checks,
remaining private Discord candidate interactions, route/calibration evidence,
loot/GP verification and signing/native-language review remain the launch gates.
The installed companion's paused folder detail still uses the old word
“Watching” alongside the explicit Paused banner; review this small copy issue
when doing the native walkthrough. **Public release remains on hold.**

## Owner decisions and boundaries

- Finish everything possible without the game or a second PC. The game is
  unavailable until release; required game/two-PC/French acceptance waits for it.
- **Keep Guilded's public release on hold until those checks pass.** No public
  downloads, version promotion, announcements or main merge were performed here.
- Quebec Gold Discord testing is authorized, but **notify nobody except Kevin**.
  Use the restricted admin channel, ephemeral replies, suppressed notifications
  and empty allowed mentions. Do not create public mirrors or reminders.
- Install the quieter companion locally while preserving settings and pairing.
  This was completed. Do not reset/re-pair it as a review step.
- Latest policy: **lock dungeon scoring settings for all guilds**. This explicitly
  includes local settings, in addition to the already shared public rules.
- Do not start a second live bot. No incidental version bump: version announcements
  notify guilds. Main merges automatically publish website changes.

## Source, deployments and packages are separate

- Current branch: `codex/prelaunch-features`, draft
  [PR #215](https://github.com/kevincaron28/Guilded/pull/215), stacked on draft
  [PR #214](https://github.com/kevincaron28/Guilded/pull/214)
  (`codex/launch-preparation`, `1d4789a1b8f08e4588ad943e804362bee55b1df1`).
- Production bot remains `65be65d70cc3782850da1a39374d627deb6603d5`, deployed
  23 October. It does **not** yet enforce this session's scoring lock or run the
  new signup layout. Public GitHub downloads remain 7.3.1; CurseForge remains 7.3.0.
- All candidate work retains product version 7.3.2 / protocol 2. Source changes
  after an installer build do not change the installed package retroactively.
- Earlier feature commit: `c7e7f31`. Discord picker/wording fix:
  `8dc97543bc6662d87c1e103db584f4a26c7746f4`. Current draft head includes the later
  scoring lock and this handoff; use `git log` / the PR head for its exact revision.

## Work completed before the scoring lock

- Fixed the intermittent companion sync regression by waiting for completed
  writes of both files and explicitly driving polling. It passed 12 repeated runs.
- Preparation branch includes release-guide PR #189, English/French setup copy,
  candidate/public-download distinctions, package verification improvements,
  standalone artifact checks, dirty-source reporting and dependency advisory fixes.
  Read `LAUNCH_READINESS_2026-10-24.md` for these earlier checks and operational evidence.
- Added editable raid planning presets: Barrow 10 (2/2/6), Hyjal 20 (2/4/14),
  Onyxia 40 (2/8/30). These are suggestions, not verified encounter compositions.
- New raid signup messages use Components V2. Existing messages retain their
  layout/links; mirrors share the same signup records. Closure removes controls.
- Added public run pages and downloadable 1200×630 score/run PNGs using Sharp,
  accepted public data, bounded rendering/cache and a bundled font. Unknown routes
  stay unrated; actual external link previews remain unverified.
- Fixed the multi-character signup picker's hardcoded French. Prompt, paging,
  confirmation and expiry now follow the guild's English/French language.
- See `PRELAUNCH_FEATURES_2026-10-24.md` and `DISCORD_ACCEPTANCE_2026-10-24.md`.

## Companion installed on this PC

The repeated two-minute “Wrote EPGP standings” entries were caused by
`publicRaids.fetchedAt` changing with the 120-second server cache refresh.
Timestamp-only refreshes now silently update both data files; actual data changes
and repairs still log as addon-data updates. Polling and vacancy freshness remain.

- Installed the `c7e7f31` 7.3.2 package at
  `%LOCALAPPDATA%\Programs\guilded-companion\Guilded Companion.exe`.
- Installer SHA-256:
  `5e9775e1ff953c41d83f3843891665f780dc7ae585cb79ab6d758e13483e457c`.
- Verified 17 packaged engine files and `app.asar` against the package.
  `%APPDATA%\Guilded Companion\config.json` stayed byte-identical; pairing and
  startup settings were preserved. Authentication still returned three characters.
- Actual-server refresh/304 checks used scratch outputs, not fabricated game data.
- The companion was paused because the configured beta SavedVariables directory
  is absent. Preserve its settings until the real launch client path can be observed.
  This is not a successful game upload or two-PC acceptance result.
- Private backup/evidence: `backups/companion-install-2026-10-24-1505/`.
  It contains sensitive local configuration; never commit or publish it.

## Real Discord checks and cleanup

Quebec Gold's restricted admin channel was used with notifications suppressed.
Real interactions passed: private `/report ping`, French `/help`, automatic choice
of the sole linked character, Tank signup, Maybe preserving its role, Absent
cancellation and full-role DPS waitlisting. Database state and a completed delivery
job confirmed the changes. No real attendance, EP/GP or dungeon points were awarded.

Earlier real Discord REST checks accepted English/French legacy/V2 messages,
fixture edits/closure and a PNG attachment. These are payload checks, not a
complete candidate interaction walkthrough. The live bot still runs older code.

The isolated raid/core were explicitly test-only, past-start, reminder-marked,
non-repeating and non-public, with only the owner participating. Their records,
signups and jobs were cleaned up. Guild settings and character links stayed
unchanged. The test post was replaced with a silent TEST COMPLETE notice.

Browser control stopped responding after the waitlist check. Two attempts timed
out; cleanup was completed via API. Do not describe promotion, role switching,
closure through live commands, multi-character selection, ordinary-member
permissions or fresh-guild onboarding as passed. Detailed private records and
the scoped cleanup script are in the backup directory above.

## Dungeon scoring lock: review these paths carefully

- Removed config editing options, the target command, all guild config setters
  and the guild recalibration writer. Cached old commands are rejected server-side
  without log posts. Configuration and calibration evidence are read-only.
- `sharedDungeonConfig()` supplies new participation awards and rule displays.
  Old stored overrides remain available only for historical decoding/snapshots.
- Official rotation uses `OfficialSeason.rules` instead of `carriedRules(active)`.
  Missing official snapshots block rotation. A guild first joining mid-season
  also receives the same frozen snapshot and official start time.
- Existing official guild seasons receive only centrally added missing routes
  after backup. Existing targets/bands/penalties/best-N and earned history stay
  frozen. Old beta rules remain readable until normal official rotation.
- Audited invalidation and manual **guild participation** corrections remain;
  these cannot change public competitive scores or scoring settings.
- Updated command help, English/French guidance and both addons; ran
  `npm run dungeons:sync`. No database schema change or live data reset.
- See `DUNGEON_SCORING_LOCK_2026-10-24.md`, `src/commands/dungeon-admin.ts`,
  `src/services/dungeon-{admin,import,rules,bracket-season}.ts` and
  `src/services/official-seasons.ts`. Regression tests cover stale commands,
  saved overrides, preservation of history, shared rotation, late joins,
  missing snapshots and additive routes. Legacy scoring tests remain readable.

## Validation and remaining work

Final scoring-lock local validation passed: **267 test files / 2,244 tests**,
TypeScript, ESLint and both addon validators. `git diff --check` passed.
Logs are in `backups/dungeon-lock-final-{tests,tsc,eslint,addon,standalone}.log`.
An initial run caught an obsolete test expecting mutable guild targets; it was
updated to assert the shared policy, and the complete suite was rerun successfully.
Final-head GitHub CI remains a separate check; do not reuse an older head's result.
Earlier `8dc9754`: 266 files / 2,234 tests, TypeScript, ESLint and both addon
validators passed; [CI run 40125999694](https://github.com/kevincaron28/Guilded/actions/runs/40125999694)
also succeeded. The packaged `c7e7f31` head passed both quality jobs and audits in
[run 40122778375](https://github.com/kevincaron28/Guilded/actions/runs/40122778375).
Those older runs do not validate the subsequent scoring lock.

For Claude's review:

1. Review the final diff against PR #214's head, especially scoring consistency,
   archive preservation, late joins and stale-command rejection. Preserve local work.
2. Check final-head CI. Before any controlled deployment, build the exact reviewed
   commit with `npm run release:prepare`, retain the manifest/hashes, run required
   preflight/backup and use the existing single-bot deployment procedure.
3. Finish the remaining private Discord walkthrough on candidate code, including
   ordinary-member permissions, two mirrors, waitlist promotion, character picker,
   closure, presets and V2 interactions. Verify reachable external link previews.
4. When the game opens, complete `V7_3_2_GAME_CHECKLIST.md`, observe actual build,
   Interface/folder, validate first-combat/final-boss evidence, French UI,
   standalone mode and two-PC sync/deduplication/recovery. Do not invent route or
   encounter data, move the season calendar, or repeat the prior history reset.
5. Missing 45–59/60 route evidence, representative calibration data, native
   German/Spanish review, signing identity, verified loot/GP tables and a full
   two-officer raid rehearsal remain separate outstanding work.

**Public release stays on hold.** A passing code suite, successful installation
or controlled bot deployment does not satisfy the real-client release gates.

## Website review and polish added later in this session

Kevin asked whether all features were present and requested a full site polish
review. The answer is: the core features exist, but acceptance and several
content/localization/distribution gaps remain. Read `SITE_REVIEW_2026-10-24.md`
for the feature matrix, live findings, fixes, evidence and limits.

- Checked the live public site and the built local candidate. Fixed French
  navigation continuity, added a complete French Features page, translated the
  home footer/title/accessibility labels and localized setup-helper messages.
- Fixed language selection reverting after reload by updating its URL query.
  Added focusable skip-link targets, public-page focus styling and larger menu
  targets. Improved module/font/extensionless-route handling in the static preview.
- Live install documentation is outdated; its corrected source is already in
  the stacked preparation branch. No public publication was performed here.
- Checked 15 built pages / 366 internal references without missing targets;
  15 public HTTP checks passed and signed-out `/me/` correctly returned 401.
  Mobile 320/390px and desktop 1280px checks passed for the reviewed layouts.
  Screenshot is privately saved as `output/site-polish-2026-10-24.png`.
- Latest local suite: 267 files / 2,250 tests, TypeScript, ESLint, both addon
  validators, site build and Worker dry-run. Logs: `backups/site-polish-final-*.log`.
- CI for `c46c10b` did **not** pass: run 40128834859's Windows job passed, but the
  PostgreSQL integration fixture still expected guild overrides to create timed
  rules. `scripts/verify-dungeon-rating-postgres.ts` now verifies overrides are
  ignored and uses explicit historical presets for its unchanged score/archive
  assertions. Check the new head's CI; never substitute an older passing run.
- The old head's external Cloudflare check failed without annotations. Local
  Worker dry-run passes, but remote check success remains separately required.
- Full French companion translation, authenticated web acceptance, external
  score-card unfurls, native language review and real-client gates remain open.
  No additional Discord notifications or production changes were made.

Latest CI observation for source head `2a209e47a442a16b66010c413a9aa0511a9c948c`:
[run 40130206176](https://github.com/kevincaron28/Guilded/actions/runs/40130206176)
passed the Linux `checks` job, including PostgreSQL integration and backup/restore.
The Windows package job was still running when recorded. The external Cloudflare
check still failed; its diagnostics URL requires a Cloudflare dashboard sign-in
in this browser, so its cause is unresolved. No dashboard settings were changed.
This final handoff update is documentation only; check the PR for subsequent
exact-head results before deployment or merge.
