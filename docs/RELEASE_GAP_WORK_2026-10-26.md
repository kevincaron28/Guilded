# Release gap work — 26 October 2026

Owner requested all feasible gaps completed for tonight's release. Starting from
published 7.4.0 at main 3b312b2. Work branch: codex/release-gap-completion.
Preserve Claude's checkout and use the shared local coordination record.

## Implementation queue

- [x] Confirmed, audited main/alt plan application within existing linked ownership.
- [x] Evidence-based guild activity metrics and filters, with explicit coverage.
- [x] Opt-in scoped web availability, consent/revocation and bounded retention.
- [x] Edition-specific event preferences/catalogue support and source validation.
- [x] Broader sourced buff families, with optional effects separated from requirements.
- [x] GRM supported-format migration and main/alt apply; arbitrary unknown formats remain unsupported.
- [x] EN/FR additions, Store packaging preparation and remaining bug review.
- [x] Full offline checks, package/source verification and local handoff.

## External evidence still required

Raid reference data and configurable prices have been removed from Codex's queue.
Claude owns them in `qgb-claude-gaps` / `claude/raid-reference-data`. His 07:35
update reports implemented edition-filtered presets, awaiting his commit/PR.
Codex will review/integrate that PR without editing Claude's owned files.

Real game/two-PC checks, Forever custom spell confirmation, measured dungeon
calibration, real GRM backups, native language review and an owner-controlled
signing identity cannot be substituted with invented evidence. Record the precise
remaining steps and completed checks as work proceeds. No second local bot.

26 October: owner has no signing identity. A self-signed certificate is free but
does not establish public Windows trust. SignPath requires an OSI-approved license;
the current PolyForm Noncommercial license does not satisfy that requirement.
Microsoft Store MSIX signing is free after certification, but needs a separate
packaging/submission path. Keep the current installer explicitly unsigned; do not
change the project license or enroll in paid signing without the owner's choice.
Sources checked: https://signpath.org/terms.html and
https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options.

Owner subsequently chose **keep the license and prepare Microsoft Store MSIX**.
See [Store preparation](MICROSOFT_STORE_MSIX.md). A local unsigned preview built
and passed manifest/ASAR verification. Store identity, certification and real
packaged installation remain pending. No self-signed certificate was created.

Implementation details:

- Main/alt apply requires a five-minute session/actor/CSV/roster-bound confirmation,
  fresh officer access, complete snapshot and Serializable transaction. Character
  ownership and EP/GP are untouched. Before/after flags are audited atomically.
- Roster participation uses present/late records in completed non-test raids and
  valid completed guild dungeon runs. Counts deduplicate members across alts;
  filters and CSV distinguish no evidence from unavailable/unlinked records.
- `/me/availability` allows current guild members to explicitly share their own
  linked character/role for 15, 30 or 60 minutes. It never imports addon peer
  observations. Removal works after role loss; expiry hides posts immediately
  and six-hour housekeeping purges expired rows. No in-app status history.
- Event boards support Forever, Era, TBC, Mists, Retail and PoE2. Each additional
  edition has its own opt-in role/times; existing Forever/PoE preferences are
  preserved. Removing a game revokes its reminders. Role/channel HTTP checks in
  configuration now precede the database transaction. Dense board formatting
  preserves timestamps/sources within Discord's shared embed text budget.
  Delivery permission/history reads also precede the transaction; a fresh locked
  check rejects changed boards, cancelled or rescheduled reminders. History
  recovery stops after its 45-second budget without sending a duplicate.
- Classic adds nine optional resistance/totem families; Era/Forever also show
  three optional world effects. Chronoboon stored variants are excluded from
  active observations. Forever remains provisional. Sources checked 26 October:
  [LibClassicDurations](https://github.com/rgd87/LibClassicDurations/blob/master/classAbilities.lua)
  and [WeakAuras TBC](https://github.com/WeakAuras/WeakAuras2/blob/main/WeakAurasTemplates/TriggerTemplatesDataTBC.lua).
- PostgreSQL integration/restore scenarios added for concurrent main-plan apply,
  unchanged ownership/EPGP, availability scope/expiry/revocation/cascade and new
  edition event preferences. These passed with all migrations and a real
  backup/restore rehearsal on disposable local PostgreSQL 16.15. The test server
  listened only on 127.0.0.1:55439 and was stopped afterward. Production was not
  used. Both GitHub quality jobs remain required before merge/deployment.

Operational review: bug inbox refreshed 26 October: zero open member reports and
two historical error groups (community interaction expiry on 25 October; scheduled
events pool timeout on 19 October). Do not close them as live-verified from offline
tests. Claude's older fixes checkout remains at b9fd62c with no tracked modifications.
His new `qgb-claude-gaps` checkout has active raid-preset changes; the shared
coordination file records the agreed ownership. No restart or deployment occurred.

User-facing instructions: [Roster and availability](ROSTER_AND_AVAILABILITY.md).
The MSIX preview was rebuilt after correcting duplicate resource-copy operations.
The actual manifest, branded tiles, unchanged license and ASAR sources verified:
165,358,670 bytes; SHA-256
`72db3efe220c6981bb678d7f082975e71db82a414fb4582cf2f15af1f4b0481e`.
Evidence: `backups/msix-preview-verification.json`. Not installed or Store certified.

## Final local verification and next steps

The evidence below records the initial `4843298` candidate. The subsequent Store
submission preparation is recorded in [the Store handoff](STORE_HANDOFF_2026-10-26.md),
including its new package hash and 2,579 passing tests.

- All 299 test files / 2,575 tests passed (244.10 seconds), including cancellation,
  recovery deadline and concurrent board-change regressions. Log:
  `backups/release-gaps-vitest-final.log`.
- TypeScript, ESLint, both addon validators, buff catalogue generation check and
  `git diff --check` passed.
- Local PostgreSQL migrations, integration and restore passed; server stopped
  cleanly. Log: `backups/release-gaps-postgres.log`. Portable test runtime came
  from [EDB's official binaries](https://www.enterprisedb.com/download-postgresql-binaries),
  extracted under ignored `backups/pg-local-runtime`; no Windows service installed.
- Standard unpacked Windows companion also built in
  `dist/local-review-2026-10-26/win-unpacked`. It was not launched or installed.
- Claude's raid work is PR #226, commit `7aa2279`. Kevin handles its merge; the
  second branch must incorporate the first before combined release checks.
  Claude has been invited to review this implementation diff without editing it.
- No release version bump, remote push, deployment, Store submission or live
  Discord mutation was performed for this candidate. Published 7.4.0 is unchanged.

Before publication: integrate Claude's reviewed work, choose the next release
version deliberately, pass both quality jobs on the final combined commit, and
perform ledger preflight/verified backup before coordinated Oracle deployment.
Store publication separately needs Partner Center identity, listing/privacy
materials, real packaged-install checks and Microsoft certification. Game checks,
custom Forever spells, benchmark calibration, native DE/ES review and real GRM
archive acceptance remain explicit external follow-up.
