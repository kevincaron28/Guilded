# AI handoff for Claude — 24 October 2026

Read this after `CLAUDE.md`. Kevin requested an end-of-session review of everything
prepared during this Codex session. This handoff does not authorize a public release.

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
