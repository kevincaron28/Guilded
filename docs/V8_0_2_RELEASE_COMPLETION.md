# Guilded 8.0.2 release completion — 28 October 2026

The final 8.0.1 audit found an unbounded participation status read and an in-game
spreadsheet export path that did not guard formula-like text. The database fix
merged in PR #256; its PostgreSQL/restore and Windows CI passed. A fresh ledger,
database/application and encrypted off-server recovery check passed. Deployment
of that intermediate source was deferred when the client export issue was found.

Because 8.0.1 is already published, the client correction ships deliberately as
8.0.2. All product version fields move together. Existing release bytes, ledger
history, points, profiles, privacy defaults and frozen scoring policies are kept.
This version will use the normal one-time guild update notice after deployment.

## Required gates

Local release preparation passed **341 files / 2,859 tests**, TypeScript, ESLint,
both addon validators, zero-vulnerability dependency audits, browser/site builds,
Windows installer packaging and packaged-source verification. Publication
manifests are refreshed again on clean merged main before any release upload.

- Full tests, TypeScript, ESLint, both addon validators, metadata/locale contracts,
  dependency audits and browser/site builds.
- Exact-source PR and merged-main Linux/PostgreSQL/restore and Windows packaging CI.
- Ten edition packages, Windows installer and reserved-identity Store MSIX;
  source/manifest/hash verification on clean main.
- New GitHub 8.0.2 release and anonymous download hashes; no asset replacement.
- Ten matching CurseForge files with correct edition tags, approval and download
  hashes; published 8.0.1 files remain available.
- Store submission, certification/publication and installed update/signature,
  submitted application bytes and encrypted-profile preservation verified separately.
- Fresh ledger and verified recovery backup, then one pinned bot deployment;
  public health/commands/origin, read-only production summary and matching browser assets.
- Provider records only advance after verified publication; EN/FR edition links
  and final exact-main CI are rechecked.

Actual receipts live privately in `backups/release-8.0.2/`. The final audit inventory
and acceptance limits remain in [the audit](FINAL_8_0_1_AUDIT_2026-10-28.md).
No independent native-speaker or universal accessibility certification is claimed.
Remaining Forever API/encounter/loot data and representative live calibration
require the game. Existing manual-testing waivers are preserved as waivers.
