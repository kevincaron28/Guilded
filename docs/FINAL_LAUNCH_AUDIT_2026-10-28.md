# Guilded final launch audit — 28 October 2026

> Later 8.0.1 completion supersedes this audit's outstanding language and Store
> installation statements: full FR/DE/ES catalogues, model-assisted language review,
> actual Store signature/chain validation and owner-performed Overview/French
> Setup/Help checks passed. The standalone EXE remains unsigned by the owner's
> free Store distribution decision. See [current evidence](V8_0_1_RELEASE_EVIDENCE_2026-10-28.md).

Guilded 8.0.0, protocol 2. This is the current feature inventory, read with the
[publication evidence](V8_0_RELEASE_EVIDENCE_2026-10-28.md). Earlier local/draft
checkpoints are historical. The owner explicitly waived remaining hands-on game
tests and asked for fixes based on player reports after launch. Automated checks,
backup/restore and deployment verification remain required.

## Final audit corrections

- **Edition continuity:** menu links from each edition landing page and public
  data page retain the selected WoW edition. Player links and Discord sign-in
  return paths preserve the edition and language. External links stay unchanged;
  return paths remain restricted to local supported pages. Regressions exercise
  all five editions, EN/FR and a complete mocked OAuth callback.
- **Public-season reliability:** the recorded P2028 failure exposed the default
  five-second calendar transaction budget. Routine rule checks now avoid exclusive
  calendar locks when no write is needed. Actual writes recheck under the lock and
  use bounded 30-second acquisition/execution budgets. Rules-only writes no longer
  scan/rewrite guild season cutoffs. Scheduling/cancellation still synchronize
  cutoffs transactionally; frozen values and historical scores are preserved.
  Unit tests cover no-op/unreadable snapshots and concurrent-worker revalidation;
  the disposable PostgreSQL check holds a shared lock for six seconds and verifies
  two competing writers freeze exactly once.
- **Browser-companion credentials:** fetch refuses redirects, matching the desktop
  engine's existing policy. Failed requests retain the device connection and pending
  observations. Tests cover pairing and authenticated requests.
- **Release records:** corrected stale Store/CurseForge, feature-bundle, badge,
  dungeon-integrity and event-edition status. Event boards already support all
  five WoW editions plus PoE2; no duplicate event system was needed.

These are bot, online companion, website and operator/test changes. They do not
replace published addon/installer bytes, bump the product version, reset scores,
change privacy defaults or enable new production onboarding policies.

## Agreed feature coverage

| Area | Delivered implementation and evidence |
| --- | --- |
| Five WoW editions | Forever, Era/Hardcore, TBC, Mists and Retail; distinct packages, edition/guild identity and upload validation. `game-edition`, `edition-port`, `addon-edition-packages` tests; all ten provider downloads verified. |
| Standalone guild tools | In-game setup, local cores/rosters, attendance/history, EPGP and loot, crafting/readiness, backups/restore and opt-in officer ledger sync. See `STANDALONE_ADDON_ROADMAP.md`; Lua regressions preserve permissions, permanent IDs and voids. |
| Roster and officer workflows | Search/filters/CSV, team/trial composition, main/alt preview and apply, reviewed bulk actions and local GRM migration. `roster-dashboard`, `roster-plan-apply`, `grm-migration` and Lua roster tests. Private notes remain excluded. |
| Availability, keys and crafting | Opt-in freshness/expiry, Retail key sharing, edition buff coverage, local activity heatmap and profession-window lookup. Web availability and Lua tests. Guild-wide activity-history upload was explicitly declined. |
| Raid and Discord coordination | Cores, signups/waitlist/deadlines, presets, attendance/EP proposals, recruitment/applications, guild/player directories, announcements and event reminders. Existing raid/signup/recruitment/event integration tests and recorded live walkthroughs. Pullscript remains a separate addon. |
| Community and participation | Activities, seasonal standings, honors and 100/300/500 badge shelves. Message points cover accessible guild text channels/threads; `/participation channels` reports gaps privately. Existing cooldown/cap/audience/allowlist and delete/reversal rules retained. See `PARTICIPATION_CHANNEL_COVERAGE_2026-10-28.md`. |
| Dungeons and integrity | Both addons share recording contracts, canonical roles, evidence checks, score explanations and versioned Retail overtime rules. Current-v1 remains Season 1's policy; older snapshots remain readable. `dungeon-integrity`, `public-score-integrity`, rating and PostgreSQL contract regressions. |
| Companion | Discord typed-code sign-in, separate profiles, watching/uploads, retry queues, spreadsheet export, PoE2 journals, updates and browser alternative. Credential encryption/revocation, parser limits and IPC validation are implemented. Native install acceptance remains waived. |
| Website and distribution | Dedicated edition pages, matching 8.0 GitHub/CurseForge links, Microsoft Store link, EN/FR metadata/navigation, server-rendered French, canonical/hreflang/sitemap and mobile/accessibility corrections. See `V8_0_ACCESSIBILITY.md` and site/Worker tests. |
| Seven required engineering items | Lossless ledger compaction; shared inbound Transport validation and bounded queues; frozen/versioned Retail overtime; private origin; French indexing; accessibility; CorePresentation extraction. All implemented in `V8_0_ENGINEERING.md`. |
| Operations and support | One bot service, bounded pools/background jobs, report/bug inbox, backup and authenticated off-server recovery, exact-main quality and Windows CI, origin/health probes and rollback preserving newer database writes. |

## Evidence and limits

The fresh inbox had **zero open member reports**. Four historical service-error
groups remain recorded: community acknowledgement expiry, the public-season
transaction failure addressed above, old character-signup rejection and an older
scheduled-event pool timeout. No report is automatically marked resolved by this
audit. Live behavior must corroborate the relevant fix.

At audit start the Oracle service was active, with no warning-level journal
entries since the previous deployment. The VM had roughly 502 MiB available and
53% disk use. This is **not** an Aiven memory measurement. The earlier database
maintenance spike recovered; its cause remains unconfirmed. See
[the Aiven review](AIVEN_MEMORY_REVIEW_2026-10-28.md). No paid plan, production
stress load or connection-budget increase is part of this audit.

Local validation passed **339 files / 2,849 tests**, followed by the added OAuth
callback regression and its file's **19 tests**. TypeScript, ESLint, both addon
validators, browser build, website/Worker dry-run and production-dependency audit
(zero vulnerabilities) passed. PostgreSQL and Windows packaging run in CI; no
local PostgreSQL installation was available for this audit.

The final changes must pass TypeScript, the full test suite, lint, both addon
validators, website/browser builds and Worker dry-run. Merge requires Linux
PostgreSQL/restore and Windows packaging CI; deployment additionally requires a
fresh ledger check and verified database/application/off-server backup. Actual
run IDs, source SHA and public checks are recorded with the audit PR and private
operator receipts in `backups/final-launch-audit-2026-10-28/`.

## Remaining dependencies, explicit deferrals and unperformed checks

- Real Forever dungeon/raid IDs, loot and GP data require verified game information.
  Provisional targets require representative completion evidence and the existing
  calibration thresholds; unsupported routes stay unrated. Do not invent data or
  rewrite already frozen competition rules to fill a checklist.
- Remaining Classic/Forever gameplay, two-PC, full raid, actual GRM archive,
  clean Windows/Store install and native screen-reader checks were not performed.
  Partial Retail English/French rendering and dungeon-view checks are recorded in
  `RETAIL_ACCEPTANCE_2026-10-28.md`; they do not certify other workflows.
- German/Spanish native review is outstanding. English/French are the accepted
  launch languages. Independent Authenticode/update-manifest signing needs an
  owner-controlled signing identity; Microsoft Store publication is verified,
  while the standalone EXE remains unsigned.
- The owner explicitly deferred requiring two independent uploaders for scoring.
  Alternative timer/finality policies remain proposals; hosted auto-approval is
  implemented but opt-in. Privacy/consent and officer authorization remain intact.

No additional missing implementation was identified within the agreed launch
feature set in this audit. This is an evidence-based inventory, not a guarantee
that no future player report will expose a defect.
