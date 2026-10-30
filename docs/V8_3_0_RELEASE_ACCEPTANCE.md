# Guilded 8.3.0 acceptance

## Current checkpoint — October 30 14:03 UTC

The owner's latest direction authorizes all available testing now, superseding
the earlier timing waiver. Claude acknowledged the expanded handoff and is
testing native Companion 8.3 on an isolated profile; Retail addons are still
8.2 until separately installed and verified. No unobserved game, native or
authenticated multi-account acceptance is claimed. Forever needs November 4.

- Merged source: `2602e673864687dd7356f7800991d77495fb5ed0`, PR #292.
  Main CI `41064825203` passed, including PostgreSQL concurrency, migrations,
  restore and Windows packaging. Exact artifact verification passed cleanly.
- Backend and website deployed. Public `/health` reports 8.3.0, protocol 2,
  commands `ok`. Worker version: `c9fffed3-daba-4ce5-b83d-e41f3da040d0`.
- Read-only production check at 13:59:44 UTC confirms both BG planning and
  opt-in automation migrations completed; zero enabled recaps, question plans
  or vacancy approvals. All six selected season rows are unchanged.
- GitHub stable v8.3.0 published: all 23 anonymous downloads returned HTTP 200
  with matching hashes and verified tag commit. Published bytes are frozen.
- Ten CurseForge 8.3 edition archives submitted, processing; public availability
  and download hashes remain to be verified. No duplicate uploads are needed.
- Store Submission 6 (`1152921505702277828`) is in certification with manual
  publishing hold. Installed Store remains verified 8.2.0.0, not 8.3 acceptance.
- Final browser evidence: 23 CUA captures in
  `backups/ui-qa-2026-10-30/final-8.3/MANIFEST.md`. Populated leaderboards use
  synthetic data; these are not live gameplay or authenticated acceptance.
- Recovery backup and encrypted offsite decryption/checksums passed before
  deployment. Local receipts are in `backups/release-8.3.0/`.
- Remaining approved BG recorder, cards/history and statistics work continues
  separately on `codex/bg-recorder-history-oct30`; it is not shipped in 8.3.

## Historical prepublication checklist (superseded by checkpoint above)

- [ ] Exact integrated source TypeScript, Vitest, ESLint and addon validation.
- [ ] Clean PostgreSQL migrations, concurrent BG/automation claims, pause and
  permission races, uncertain-send holds, restore rehearsal.
- [ ] Exact-source full CI and Windows package inspection.
- [ ] Final non-game desktop/mobile EN/FR browser checks and local screenshots.
  Frontend worker tested French Home/guide navigation/Web sync at 390×844 and
  54 focused tests before integration. This is not final release acceptance.
- [ ] Fresh verified recovery backup, coordinated backend/website deployment,
  health, private-route authorization and member/officer smoke checks.
- [ ] New immutable GitHub/CurseForge/Store artifacts and truthful provider status.
  Never replace published 8.2.0 files. Store certification timing is external.
- [ ] Actual Store installation, signature/application/profile preservation checks.
- [ ] Native activation and addon/game/multi-account acceptance — NOT RUN,
  at this historical checkpoint. Claude has since acknowledged the expanded
  handoff and begun testing. Forever requires November 4 availability.

No recurring external sends are enabled merely by deployment. Explicit saved
channel/audience/schedule or personal recap opt-in is required. Unknown BG queue
rules remain gated; no capture/leaderboard acceptance is inferred from organization.

Baseline novice QA ZIP: Library `libfile_f80a84c36ad8819183f9043647b01e8e`,
version 0, expected 499,952 bytes/nine entries. Materialization is blocked: the routing session used the official Library
transfer helper, which failed with “library file transfer failed: download failed”.
No local ZIP exists and the nine entries are not locally verified. The
reference is preserved locally; no guessed URL or public upload was used.

## Prepublication checkpoint - October 30 13:30 UTC

Integrated checkpoint 16b47f6 passed both full CI runs, including PostgreSQL
concurrency/migrations/restore and Windows packaging. Local release preparation
passed 3,145 tests in 374 files, TypeScript, ESLint, addon validation and both
dependency audits; installer/addon inspection passed. Its initial manifest was
dirty while final browser findings were corrected and is not publishable.
Final fixes cover French guide persistence/anchors, accurate in-time versus
overtime scoring copy, and standard-record empty wording. Focused tests pass;
exact final-source CI and clean regenerated manifests remain required.
Fresh production ledger check and encrypted offsite backup verification passed.
Synthetic populated leaderboard QA is separate from production/player evidence.
