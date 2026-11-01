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

Microsoft Store Submission 5 passed certification and was published on October
30. Partner Center confirms the latest submission is available. Store CLI
updated the existing installed package to **8.2.0.0**; verification at 12:50:07 UTC
confirmed Store signature/status, the signed CMS certificate chain, and exact
installed `app.asar` equality with the submitted MSIX. The encrypted Store profile
hash is unchanged. Native activation and in-game acceptance are still unverified.
The frozen 8.2 MSIX is 165,400,751 bytes, SHA-256
`f7f23835dd097b0806b234a59c5673db0781d8913bf26aebbd25aa023e0e39ac`.
Installed/submitted application SHA-256:
`20d3f4269603234954492a73cd4a7bcc3b7904a7490f380252e63d273f6ef232`.
The old held 8.1 package was not published.

Claude's expanded UI/native Companion and screenshot assignment is now prepared
and read back in the existing session's composer by coordination, replacing the
old Retail-only draft. **It was not submitted or acknowledged**: Send failed
with unavailable coordinate geometry and screenshot capture timed out. The
remaining handoff is a manual Send in that session. No native QA completion
is claimed and no duplicate tester was started.

Available browser testing confirmed read-only connection testing, an accurate
8.2 bot version, French mobile wrapping/no horizontal overflow and Escape menu
dismissal. Three private originals and two clean browser Companion captures are
saved locally with a manifest; none was uploaded. The setup-copy issue (claiming
data is already synced before the first sync) is corrected in source by PR #287,
with 12 focused tests and full CI passing. It is deployed at `97c8d32`; live
English/French browser retesting passed at 12:26 UTC without a game-data upload.
The saved/uploaded/accepted state remained unchanged. Native delivery/retest of
that copy correction remains separate from the frozen 8.2.0 client artifacts.
These observations do not certify addon/native/offline/multi-account workflows.
Forever gameplay still awaits its November 4 opening.

Operator receipts, checksums and private QA remain in ignored `backups/` folders;
private evidence and credentials are not part of the public repository.
