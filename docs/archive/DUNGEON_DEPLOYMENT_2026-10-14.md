# Dungeon fairness deployment — 14 October 2026

Deployed successfully at 16:32 UTC. Oracle source and running application both
report `27664369feffd1c61ad2502956c8950785b6a934` (PR #70). Version remains 6.1.2,
protocol 2. No schema, season, historical award or SavedVariables rewrite.

## Verified evidence

- Final combined source: 176 Vitest files / 1,482 tests passed.
- `npx tsc --noEmit -p .` and full `npm run release:prepare` passed, including
  full ESLint, addon validation, audit gates, addon ZIP, website/companion builds
  and Windows installer verification. The tested tree exactly matches the merge.
- Final main CI: https://github.com/kevincaron28/Guilded/actions/runs/38598511797
  Both PostgreSQL integration/restore and Windows packaging jobs passed.
- Cloudflare production build on the final commit succeeded:
  https://dash.cloudflare.com/c242dddfcab7f6255ba0283eb0675887/workers/services/view/guilded-wow/production/builds/36959b9e-a73b-4dd5-b9dc-a3515e30ff4b
  Earlier feature-branch builds failed; their logs remain inaccessible without
  dashboard sign-in. This did not recur in the final production build.
- Ledger preflight: all event references unique.
- Verified database/application backup:
  `/home/ubuntu/guilded-recovery/2026-10-14T16-27-06-064Z`, baseline `98c72b1`.
- Authenticated encrypted offsite backup with checksum/decryption verification:
  `C:/Users/Kev/AppData/Local/Guilded Recovery/2026-10-14T16-27-06-064Z`.
- Existing `redeploy-oracle.bat --yes` succeeded from a clean main checkout.
- Service active/running; NRestarts=0. No pending database migrations.
- Discord login confirmed in service logs at 16:32:18 UTC as Guilded#1552.
- Local health, https://guildedqc.duckdns.org/health and
  https://guilded-wow.kcaron.workers.dev/health returned ok=true, version 6.1.2,
  protocol 2 after deployment.
- Full local build and deployment logs are saved in
  `backups/dungeon-release-evidence-2026-10-14/`.

## Acceptance and scope

All review points are accounted for in DUNGEON_PARTICIPATION_2026-10-14.md.
Implemented fixes cover presence/carry eligibility, separate wing history and
records, frozen participation targets, one account award, combined rounding,
unranked explanations, scored coverage, and uncalibrated boss records.

A live dungeon upload and manual Discord `/report ping` were not performed.
The prepared bilingual player notice has not been sent. Best-N, narrower bands,
required-boss/group rules, GUID identity and calibration remain future work with
explicit design/data requirements. Across-batch late-upload award reconciliation
also remains deferred; this deployment does not rewrite previously issued points.

Concurrent unrelated local edits were preserved. Final dungeon files were synced
back to the shared checkout; previous copies are in
`backups/dungeon-fairness-before-final-sync/`. The shared checkout was not reset.
