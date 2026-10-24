# Guilded launch readiness — 24 October 2026

**Public release is on hold until the required game and two-PC checks pass.**
7.3.2 remains a candidate, protocol 2. Offline tests, CI and a successful deployment
do not approve public promotion. Use [the current game checklist](V7_3_2_GAME_CHECKLIST.md)
and record the exact package SHA-256, testers, roles, client build, language and result.

## Current baseline

- Production 7.3.2 was deployed on 23 October from `65be65d70cc3782850da1a39374d627deb6603d5`.
  The public health endpoint returned `ok: true`, protocol 2 and `commands: ok` on 24 October.
- That commit passed both [quality jobs](https://github.com/kevincaron28/Guilded/actions/runs/39995527291).
  The deployment record reports 264 test files / 2,219 tests, strict TLS and UTC checks,
  pooling/memory checks, and a fresh PostgreSQL 18 restore (96 tables / 2,825 rows).
- Isolated Windows installation, upgrade, uninstall and interrupted-install recovery were
  rehearsed. Staged Linux update/recovery checks passed, followed by a successful real update.
  Live rollback was not performed. The separate Prisma 6 contingency remains draft PR #211.
- The main PC's companion and both addons were upgraded. The second PC is still to be tested.
- Previous dungeon history was cleared with a verified backup; identities, pairing, EP/GP and
  unrelated data were preserved. Keep `DUNGEON_RUNS_NOT_BEFORE` through recovery. Do not repeat
  the reset as a launch step. Season 1 is scheduled for 4 November 2026, 23:00 UTC / 18:00 Toronto.
- The public downloads remain GitHub 7.3.1 and CurseForge 7.3.0. Local 7.3.2 packages are test
  candidates. Do not change `site/releases.json` until matching files are actually public.

This supersedes old deployment holds and already-completed implementation tasks in the
22 October audit and 23 October Prisma readiness report. It does not turn their remaining
real-client checks into passes.

## Work prepared without the game

- [Offline management acceptance](OFFLINE_ACCEPTANCE_2026-10-24.md) covers French
  draft preservation, refused/disconnected save recovery, pending-save exclusion,
  ordinary-member rendering and language-preserving Companion navigation. These
  synthetic browser checks do not replace actual member/guild or native acceptance.

- [Discord acceptance progress](DISCORD_ACCEPTANCE_2026-10-24.md) records private
  Quebec Gold command/signup checks, cleanup, the character-picker language fix,
  and remaining interaction gates. Public online scoring already uses common
  season-frozen rules; [guild-local scoring controls are now locked in candidate source](DUNGEON_SCORING_LOCK_2026-10-24.md).
- Additional candidate features and the two-minute companion log fix are described
  in [pre-launch features](PRELAUNCH_FEATURES_2026-10-24.md). The game is unavailable
  until its release: live acceptance begins then, and Guilded public promotion
  waits for the required passes. Earlier package hashes do not cover these changes.
- The companion sync regression waits for completed writes of both standings files and drives
  the polling clock in the test. It checks the conditional 304 response followed by an
  unconditional repair fetch, compressed/delta uploads, current data and absence of errors.
- Release-guide PR #189 is integrated into this preparation branch. English/French setup
  guidance uses Discord sign-in, explains officer-assisted linking, and allows Lite setup
  before full approval. Download guidance distinguishes public releases from private candidates.
- Store copy, release notes and the runbook below describe eligibility and provisional routes
  without claiming that every recorded run earns a competitive score.
- Package verification now includes the standalone ZIP, its source contents and clean accepted
  data, both addons in CI artifacts, companion source comparisons, and dirty-source reporting.
- Updated both lockfiles for the newly reported [undici advisory](https://github.com/advisories/GHSA-xjj6-f33q-929c)
  and [fast-uri advisory](https://github.com/advisories/GHSA-w74x-v6f9-j3xg). Changes retain the
  existing major versions (6.29.1 / 7.30.1 and 3.1.9); Miniflare needs a scoped override because
  its dependency was pinned. No Wrangler downgrade or product-version change is needed.
- The sync test file passed 12 consecutive local runs. The read-only bug-inbox check found no
  open member reports and one historical connection-pool timeout from 19 October on 6.7.0;
  it has not recurred in that inbox. Ledger source references were unique. The old error stays
  recorded for observation rather than being declared fixed by a test-only change.
- Build and validate the exact final commit with `npm run release:prepare`, plus Worker dry-run
  and both GitHub quality jobs. Retain logs, source commit and artifact hashes with the private
  testing kit. A previous commit's successful package is not evidence for changed source.

## Remaining gates and scope

| Gate | Required evidence / action |
| --- | --- |
| Game and two physical PCs | Complete every required section of V7_3_2_GAME_CHECKLIST.md, including standalone mode, permissions, recovery and French layout. |
| Fresh member/guild onboarding | Actual ordinary-member button clicks, role visibility and character linking; a genuinely new guild walkthrough remains distinct from fixture tests. |
| Launch client | Observe the executable's folder, build and Interface number. Test the live-folder prompt if the install moved. Do not guess compatibility. |
| Missing competitive routes | Obtain observed map/encounter/wing evidence, especially 45–59 and 60. Keep unverified routes unrated; recorded runs can still be retained. |
| Calibration | Gather representative crews/days under the recorded build and start convention. Review the guardrails and offline replay; do not change frozen targets or curves mid-season. |
| Publication | After acceptance only: promote the exact tested artifacts, update provider metadata and verify public downloads and checksums. |

Generated score-card images, new-post Components V2 raid signups and editable raid presets
are now prepared on the feature branch, pending final validation and human Discord acceptance.
Alternative scoring curves remain deferred. Verified loot/GP tables and a full two-officer
raid rehearsal belong to raid readiness. Native German/
Spanish review needs reviewers; signing needs the owner's verified signing identity/service.
Do not claim those are complete or purchase/enroll in services as part of this preparation.

## Launch runbook

1. **Before the client opens:** keep candidate metadata and the public-release hold. Review
   final-commit CI, build manifest, bug inbox and current health. Have the second-PC kit and
   private recovery records available. Do not start another bot.
2. **When the client is available:** record its executable folder and `/dump select(4, GetBuildInfo())`.
   Compare the Interface number with both addon TOCs. A necessary compatibility change requires
   a fresh package/hash and affected acceptance checks; do not relabel an untested file.
3. **Run acceptance:** back up local data, install matching packages on both PCs and follow the
   checklist. Verify member onboarding, first-combat timing, final-boss completion, duplicate
   reports, wing separation, replacements/reconnects, role guidance and French layout. Record
   failures and repeat affected steps on any rebuilt artifacts.
4. **Check the season:** `/guilded-season status` must retain 4 November, 23:00 UTC. Test history
   must not appear in November rankings. Keep the reset boundary and unknown routes disabled.
   Do not move the official calendar to simulate launch.
5. **Only after required passes:** review [publication instructions](RELEASE_CURSEFORGE.md),
   release notes and [listing copy](CURSEFORGE_COPYPASTE.md). Approve the actual hashes for
   promotion. Keep the source, bot, addons and companion compatible; no incidental version bump.
6. **Publication verification:** fetch each published asset, compare hashes, test signed-out
   download links and update `site/releases.json` with actual provider versions/URLs. Main merges
   publish website changes automatically; coordinate the guide merge and release metadata.
7. **Launch follow-up:** check health/command status, upload failures and `npm run bugs` after
   initial testing and the season start. Keep the bug inbox and backups private. Use the existing
   recovery procedure if necessary; an application rollback must preserve current configuration
   and cannot restore old database data over newer writes without a separate decision.

Launch messages in [LAUNCH_POSTS.md](LAUNCH_POSTS.md) remain drafts for the owner to post after
acceptance. No scheduled announcement, public release or score recalibration is implied here.
