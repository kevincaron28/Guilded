# Guilded 6.0 finalization — 5 October 2026

Status: deployed **6.0.0 Beta**, protocol **2**. Stable promotion requires the
remaining real-client evidence. Keep the shared version at 6.0.0; changing it
causes a guild-facing announcement. Preserve SavedVariables and personal pairing.

## Completed independently

- [x] Oracle deployment: commit `8dc106789d6261dadb554fc5dfe284af36d462f1`;
  current read-only verification shows service active/running, zero automatic
  restarts and unique ledger source references.
- [x] Website, public guides and companion share
  https://guilded-wow.kcaron.workers.dev/; companion path `/companion/`.
- [x] Live browser displays 6.0.0; an unpaired connection check reports the
  server online and clearly asks for personal pairing. Read-only HTTP checks
  confirm health 6.0.0 / protocol 2 and published owner/member guides.
- [x] Existing desktop credential successfully reads standings, management and
  PoE status through the new origin (HTTP 200). The same initialized-guild routes
  without a credential return 401; each response uses `Cache-Control: no-store`.
  An unrelated nonexistent guild returns 404. This does not establish real
  cross-guild isolation, demotion or revocation acceptance. No pairing was replaced.
- [x] Candidate `ba150d1` passed both PostgreSQL migration/restore and Windows
  packaging in [main CI](https://github.com/kevincaron28/Guilded/actions/runs/37332804668).
  Require the same jobs on any newer final source commit.
- [x] Complete local release preparation: 153 files / 1,233 tests, TypeScript,
  ESLint, addon validation, both audits (zero vulnerabilities), addon ZIP,
  browser bundle, public guides and Windows NSIS installer.
- [x] Verified private database/application backup before Oracle rollout:
  `/home/ubuntu/guilded-recovery/2026-10-05T14-53-08-925Z`; dump listing verified,
  encrypted offsite copies authenticated and hashes matched. Signed-in Neon
  dashboard confirmed a six-hour restore history window. This is not a real
  production restore; disposable PostgreSQL CI rehearses restore.
- [x] Offline fresh-source rehearsal and owner configuration preflight; see
  [FRESH_INSTALL_REHEARSAL.md](FRESH_INSTALL_REHEARSAL.md). No second bot was started.
- [x] Release packaging verification checks aligned manifests, packaged desktop
  version, TOC completeness, clean standings and exclusion of private/removed
  files; regenerates beta notes and SHA-256 sums after each Windows release build.
- [x] Removed `git log | head` from the updater: with `pipefail`, truncating logs
  could stop an otherwise valid update. `git log -10` bounds output directly.

## Existing player acceptance retained

The [testing record](V6_0_RELEASE_TESTING.md) already confirms basic pairing and
return sync at the previous origin, map visibility/privacy, automatic recipe
sharing, window persistence, popup/whisper bids and cancellation, member page
restrictions, council responses, reserve locking, selected-pool GP, duplicate
upload protection, recorded loot/attendance, GP reversal, fixed-price awards,
loot response feedback and off-spec pricing. These are passes with the recorded
scope, not proof of every edge case below.

## Remaining release gates

Record each result with date, tester, client/package version, expected vs actual
result and safe evidence. Never store pairing codes, tokens or database URLs.

- [ ] **New-origin paired round trip:** finish queued uploads before switching;
  use a disposable test member's personal `/character pair` code at `/companion/`.
  Confirm authenticated connection, upload that member's current `Guilded.lua`,
  verify the correct Discord character/pool, return `Standings.lua`, reload WoW
  and compare totals. Repeat once: no new duplicate ledger entries.
- [ ] **Real browser folder/recovery:** Chrome or Edge folder choices, browser
  reopen, renewed permission, replacement `Guilded.lua`, denied/revoked access,
  failed standings write and manual upload/download fallback. Folder mocks pass;
  real browser permission dialogs remain unverified.
- [ ] **Non-developer Windows PC:** clean install and upgrade, first pairing,
  tray/autostart, restart with queued work, temporary network loss, revoked link,
  repair and uninstall. Verify game SavedVariables are preserved. Uninstall
  intentionally clears companion settings/credentials and its autostart entry.
  The installer is unsigned; do not bypass OS security warnings in an agent session.
- [ ] **Real competing accounting:** consecutive awards, competing officers,
  simultaneous uploads and retries. Compare before/after totals and source refs;
  each intended entry appears once, with correct pool and raid association.
- [ ] **Live permission/account boundaries:** ordinary member and raid leader
  management screens, demotion, revoked pairing, cross-guild refusal, alt/shared
  account and core/pool changes. Recheck roles immediately; no data leakage.
- [ ] **Fresh independent Alliance guild:** new application/database/host and
  ordinary member, owner guide, invite/hierarchy, setup wizard, rules/role panels,
  first pairing and round trip. Record novice time and unclear instructions.
  Existing-guild tests and dummy configuration checks do not satisfy this gate.
- [ ] **Remaining game/client cases:** professions and transmute cooldowns,
  collapsed/filter restoration, competing priority, reserve roll/award/tooltip,
  multiple council votes, invites/readiness, dungeon authority, French text,
  combat/reload and backup restore. Use applicable detailed rows in
  [RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md). Document unsupported calendar
  APIs explicitly; removed Raid tools are outside v6 scope.
- [ ] **Enabled Discord/community/PoE workflows:** real role/member interactions,
  scheduled events/report/decay delivery, permission-failure recovery and current
  English/French PoE logs where enabled. Leave optional disabled integrations
  disabled; do not reset Community, PoE or guild roles to manufacture a test.
- [ ] **One real raid night:** reconcile attendance, loot, EP/GP, uploads,
  standings and reports with the officers' expected totals. Required for stable.
- [ ] **Distribution:** matching 6.0 addon, companion, source and checksums;
  verify signed-out downloads and CurseForge listing/version. A beta publication
  is allowed to retain explicit pending checks; stable publication is gated above.
- [ ] **Final evidence:** latest-source PostgreSQL/Windows CI green, every
  applicable live row passed or documented with its limitation, release notes
  match actual coverage, published download hashes match the prepared files.

## Prepared artifacts

Run `npm run release:prepare` on Windows. It builds, verifies and produces:

- `dist/Guilded-v6.0.0.zip`
- `dist/companion/Guilded Companion Setup 6.0.0.exe`
- `dist/Guilded-v6.0.0-Beta-Notes.md`
- `dist/Guilded-v6.0.0-SHA256SUMS.txt`
- `dist/Guilded-v6.0.0-Artifact-Verification.json`

The JSON records source commit, time, size, hash and limitations. Building an
installer is not installation acceptance. Publishing a beta is not stable promotion.
