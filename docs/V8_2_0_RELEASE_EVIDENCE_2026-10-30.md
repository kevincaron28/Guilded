# Guilded 8.2.0 — publication evidence

Published source: `eb3cb4a22aab79a3d16c8f95ee6992274c7fe371`, PRs #283 and #284.
The separate PR #285 calendar operation does not replace published client bytes.

## Verified

- Exact merged-source application tests, PostgreSQL migration/restore, Windows
  NSIS/MSIX packaging and Worker checks passed (quality run `41048494999`).
- Fresh ledger preflight, database restore-list validation and encrypted offsite
  backup decryption/checksums passed before the locked backend deployment.
- Production health reports 8.2.0, protocol 2 and accepted Discord commands.
  The four new private member/officer pages reject anonymous requests with 401;
  the online Companion returns 200 and visibly reports version 8.2.0.
- [GitHub stable 8.2.0](https://github.com/kevincaron28/Guilded/releases/tag/v8.2.0)
  contains 23 assets. Anonymous download SHA-256 checks passed for every asset;
  the tag points to the reviewed source. No older release assets were replaced.
- All ten CurseForge edition packages are approved and published. Their actual
  CDN downloads match the GitHub package hashes. Current links are recorded in
  `site/releases.json`.
- Both Retail addon folders were backed up before installing 8.2.0. Existing
  SavedVariables and personal Standings.lua were preserved. Installation is not
  proof of a successful in-game reload or acceptance test.
- Forever Season 1 retains November 4 at 23:00 UTC. The applied prospective review
  is `launch-timings-2026-10-30-v1`, rules hash
  `85e2784f398e207100f8e0e0246fc60eea5d93ebf2fc8caafd7515e146cf72f9`.
  Deadmines is 30 minutes, BFD 35 and Dalaran 40; history was not rescored.

The four non-Forever edition calendars were initialized at 12:14:41.882 UTC
on October 30 under PR #285. Independent readback verified the six snapshots
(including Era’s next quarterly boundary) and preserved Forever’s start and
freeze timestamp. See [calendar evidence](EDITION_CALENDARS_2026-10-30.md).

## Still separate

Microsoft Store still publishes 8.0.2. The held 8.1 submission was returned to
draft to accept the verified 8.2 MSIX. Package validation and save succeeded;
English/French 8.2 notes were saved. Submission 5 entered certification
pre-processing on October 30 with its manual publishing hold preserved.
The 8.2 file is 165,400,751 bytes, SHA-256
`f7f23835dd097b0806b234a59c5673db0781d8913bf26aebbd25aa023e0e39ac`.
Upload, analysis, certification, publication and installed Store verification are
distinct gates. The old held 8.1 package was not published.

Claude's expanded UI/native Companion and screenshot assignment is saved, but
receipt is **not confirmed**. Native capture timed out; subsequent desktop calls
report an active request. Owner action was requested rather than bypassing the
control boundary. The original Retail-only prepared prompt does not contain the
full new assignment. No native QA completion is claimed.

Available browser testing confirmed read-only connection testing, an accurate
8.2 bot version, French mobile wrapping/no horizontal overflow and Escape menu
dismissal. Three private originals and two clean browser Companion captures are
saved locally with a manifest; none was uploaded. The setup-copy issue (claiming
data is already synced before the first sync) is corrected in source by PR #287,
with 12 focused tests and full CI passing. Live/native retest and delivery of
that later correction remain separate from the frozen 8.2.0 client artifacts.
These observations do not certify addon/native/offline/multi-account workflows.
Forever gameplay still awaits its November 4 opening.

Operator receipts, checksums and private QA remain in ignored `backups/` folders;
private evidence and credentials are not part of the public repository.
