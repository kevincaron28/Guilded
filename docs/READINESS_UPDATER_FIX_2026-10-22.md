# Raid readiness and companion update repair — 22 October 2026

## Observed problems

The Discord report used the addon's equipment status directly, without a level
or freshness gate. Read-only verification found Espionne at level 30 with an
empty-finding READY snapshot from October 14 (Toronto time); Highpriest at level
18 had an older NOT_READY snapshot with missing head/shoulder/off-hand findings.
Neither is a level-60 raid candidate.

The installed companion was 7.2.0. Its updater discarded new installer metadata
when the bot had already announced that same release version. The fallback opened
a browser download page and returned `ok: true`; the renderer interpreted every
successful response as "Installing". There was no installer process or downloaded
installer in the app's temp directory. These two code paths reproduce the symptom.

## Changes

- Raid assessments require level 60 and a check no older than 24 hours. Missing
  levels, incomplete statuses and invalid/future timestamps cannot certify readiness.
- Both the board and individual readiness replies apply the eligibility check.
- The board separates action-needed candidates, gear-ready candidates, levelling
  characters and checks needing refresh. It shows check times, consolidates missing
  uploads and explains the scope of gear/attunement/consumable checks.
- The command link is `/lead readiness-raid`; oversized reports retain their full
  content across private reply chunks and disclose truncation in the daily summary.
- The updater refreshes same-version metadata, retries the release lookup on click,
  distinguishes opening a page from installing, catches asynchronous spawn errors,
  blocks another handoff while exiting, and records stages in Activity.

The live-data preview reads **0 gear ready, 0 need attention, 2 levelling and 11
need sync**. No database records or existing Discord messages were changed.

## Local recovery

Downloaded the published 7.3.0 installer from its GitHub release and verified
SHA-256 `3c09cdc139a27d02f1d4e1f84754ec60da975968bc2e894443ebe7e319963bf3`.
Backed up companion configuration, then ran the upgrade with `/S --updated
--force-run`. Exit code was 0, installed version is 7.3.0, configuration remained
byte-identical, and one Electron main process restarted with its normal children.
No game files were modified. Private backups, installer metadata, report preview
and test/build logs are in ignored `backups/readiness-updater-20261022/`.

This recovery installs the existing public release. The updater source fixes
still need a new companion release; the report fixes need bot deployment. Do not
replace the published 7.3.0 assets with a locally rebuilt package of the same name.

## Validation

- Full Vitest suite: 249 files, 2,104 tests passed.
- Final focused tests after update logging/test refinements: 4 files, 25 tests passed.
- TypeScript, ESLint and both addon validators passed.
- Windows unpacked companion packaging passed; no installer from this branch was published.
- Regenerated the stale Prisma client locally; no schema changes or migrations.

The tests execute the actual Electron entry point with mocked platform services
to reproduce bot-first metadata arrival, download-page fallback, launch failure,
retry and duplicate handoff protection. Renderer tests distinguish fallback from
installation. A real future-version one-click upgrade with this new source is
still an acceptance check for the next release.
