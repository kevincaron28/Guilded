# Guilded 8.0 launch readiness

Updated 28 October 2026. **8.0.1 is public on GitHub and live on Oracle.**
Full FR/DE/ES addon catalogues and the signed Store installation/owner French
checks are complete. [Current 8.0.1 evidence](V8_0_1_RELEASE_EVIDENCE_2026-10-28.md)
records completed Store certification/publication, the installed signed 8.0.1.0
upgrade and all ten approved, checksum-verified CurseForge files. The 8.0.0
provider/test checkpoints below retain their original publication state.
The website/online companion and authenticated origin protection are deployed.
Current implementation inventory: [final launch audit](FINAL_LAUNCH_AUDIT_2026-10-28.md).
The dated checkpoints below retain their original test counts and publication state.
Authoritative publication evidence: [V8_0_RELEASE_EVIDENCE_2026-10-28.md](V8_0_RELEASE_EVIDENCE_2026-10-28.md).
All seven requested engineering items are implemented. Final automated checks:
336 files / 2,814 tests, TypeScript, ESLint, both addon validators, packages and
exact-main PostgreSQL/Windows CI passed. All 21 public assets are checksum-verified.

The owner waived remaining hands-on acceptance; unperformed checks remain follow-up,
not passed results. Store Submission 2 (8.0.0.0) is published and all ten CurseForge
8.0 files are approved, with public downloads checksum-verified. The edition pages
are live. Message earning now covers accessible guild channels/threads, with a
private officer coverage report; deployment `4e23dac` passed exact-main CI, fresh
backup, ledger and command-registration gates. Preparation records below are historical.

## Historical preparation checkpoints

## Verified work and limitations

- Preserved Copilot's confirmation-code work and integrated the newer screenshot/officer
  reporting fixes. Strengthened code validation, attempt limits and approval concurrency.
- Protected Windows desktop credentials, validated desktop IPC callers and arguments,
  removed credentials from renderer config, and added server revocation on data removal.
  Windows clean-install/upgrade and two-PC acceptance remain required.
- Bounded addon-message queues and reject oversized messages instead of truncating them;
  counters expose drops. FIFO order is preserved for chunked sync.
- Added SavedVariables parser size/node limits and static-site security headers.
- Reproduced the full-community-leaderboard output defect in an interaction regression:
  it emitted raw mentions. Both button/slash lists now resolve names, with scoped saved
  names/fallbacks. Scores, tie ordering and identities are unchanged. Actual mobile and
  desktop Discord checks remain pending; the supplied screenshot was not directly read.
- Archived 16 root logs with a path/size/SHA-256 manifest under
  `backups/workspace-cleanup-2026-10-28/`. Preserved worktrees, stashes, backups, migrations
  and SavedVariables. Moved older agent checkpoints to `docs/archive/`.
- Baseline: 326 test files / 2,775 tests; TypeScript, lint and addon validation passed.
  Production-dependency audit returned zero vulnerabilities. Final results are recorded
  below when complete; baseline results do not certify the edits above.
- [Aiven warning investigation](AIVEN_MEMORY_REVIEW_2026-10-28.md): overnight pressure
  recovered; cause unconfirmed. Capacity under ordinary launch traffic remains a gate.

## Copilot's recovered audit scope

This inventory preserves all 20 items from the interrupted session. An existing implementation
is not automatically accepted. Open implementation/design items remain open until finished
or explicitly deferred by the owner. The owner's exception for item 6 remains in force.

| # | Item | Current disposition / remaining evidence |
|---|---|---|
| 1 | Credential storage, rotation, revocation | Storage/revocation hardened. Existing member and personal credential issuance revoke previous credentials transactionally (`character-pairing.ts`, `personal-pairing.ts`). Real Windows migration/removal pending. |
| 2 | Typed browser confirmation | PR #245 plus local attempt/concurrency fixes; automated tests pass. Real sign-in pending. |
| 3 | HTTPS, IPC schemas, CSP | HTTPS already enforced; IPC validation/redaction added. Desktop/browser acceptance pending. |
| 4 | Authenticode and signed update manifest | Requires owner-controlled signing identity; not implemented or claimed signed. |
| 5 | Inbound addon authorization/replay envelope | Common Transport.lua boundary now used by both addons; existing per-module role, session, revision and stable-ID checks retained. Protocol 2. |
| 6 | Two independent uploaders before scoring | Explicitly deferred by owner because the initial population is small. Do not silently enable. |
| 7 | Canonical character/realm/edition identity | Existing implementation/tests; cross-edition, accented-name and two-PC acceptance pending. |
| 8 | Dungeon event sequence validation | Existing observations/validation; reset/reload/wings/spoof acceptance pending. |
| 9 | Provisional benchmark confidence | Existing `dungeon-calibration.ts` requires 20 crew/day samples, five independent crews, three days and matching build/timer convention; reports median/quartiles/exclusions. Real observations still needed. |
| 10 | Distinct scores and ranking explanations | Existing score panels; review each surface for clear labels and acceptance. Current-v1 stays active. |
| 11 | Retail depleted-key partial credit / affix treatment | New Retail snapshots use versioned guilded-keystone-v2 overtime policy; stored v1 rules and current-v1 evidence policy remain immutable. EN/FR explanations and regressions added. |
| 12 | EN/FR, Retail/Classic, two-PC tests | Owner can test both clients. Checklist below; no successful gameplay claim yet. |
| 13 | Bounded prioritized communication | Implemented: 1,024 total slots, 16 reserved for explicit interactive packets; four interactive sends then a bulk turn. Ledger notices use the interactive lane. Snapshot/chunk traffic remains FIFO on the default lane. Tests cover reserve, ordering and fairness. |
| 14 | Ledger retention/compaction | Lossless storage compactor previews by default, preserves all IDs/history/voids/legacy positions, verifies a full backup and detects concurrent writes. No history pruning. See V8_0_ENGINEERING.md for limits. |
| 15 | Durable upload/retry/parser safeguards | Added bounded streaming reads (32 MB) for guild/personal SavedVariables, normalized JSON and standings identity validation, including growth during reading. Oversized neighbor files now surface errors. Restart regression proves earlier and newer ledger entries recover after an offline failure. Existing PoE journal remains durable. Real disk-full/Windows acceptance pending. |
| 16 | Edge rate limits/security headers | Implemented native Cloudflare limits: 120 API writes and 20 pairing starts per IP/minute, separate budgets, 429/Retry-After, fail-closed on limiter errors. Worker and preview URLs disabled in config; static headers included. Dry-run verifies bindings. Deployed Worker checks passed; see the release evidence. |
| 17 | Private origin/tunnel or mutual TLS | Worker-only upstream credential, optional Caddy gate and retired-host companion migration implemented. Candidate config validates on Oracle. Production activated; direct origin rejects while public routes work, as recorded in the release evidence. |
| 18 | Canonical/hreflang/structured data/sitemaps | Server-rendered French content/metadata/links, canonical alternatives and bilingual sitemaps implemented; native workerd tests verify HTML before JavaScript. |
| 19 | Accessibility/mobile/error states | Rendered axe, accessibility-tree, keyboard and phone/reflow audit completed for recorded states, with limitations and unperformed native screen-reader checks disclosed in V8_0_ACCESSIBILITY.md. |
| 20 | Core.lua decomposition and edition/spoof matrix | Spreadsheet serialization and roll parsing extracted into CorePresentation.lua. Existing public behavior retained; offline edition/spoof matrix runs in the full suite. |

## Carry-forward product scope

Retain the delivered roster/crafters/teams/history/groups, bulk editing, opt-in availability,
Retail keys, GRM local history, buff coverage, standalone setup/backup/restore, dungeon
observations/badges/loot/privacy, community activities/honors and report screenshots.
Their prior source is `SESSION_HANDOFF_2026-10-25.md`, `V7_4_0_GAME_CHECKLIST.md`,
`RELEASE_GAPS_2026-10-25.md`, `STANDALONE_ADDON_ROADMAP.md` and the current code.

Still open: native German/Spanish review; real GRM archive reconciliation; two-officer
raid/EPGP rehearsal; verified Forever raid loot/GP data; hosted onboarding/abuse decisions;
multi-edition permissions and concurrent edits; clean Windows install/upgrade. Main/alt
ownership suggestions remain preview-only. Separate historical proposals from committed
features before declaring the scope complete.

Recommendation for this two-day window: finish reliability, onboarding, useful diagnostics,
clear explanations and acceptance of delivered features before adding another large system.
Do not change scoring or delete ledgers to make a checklist appear complete.

## Retail and Classic acceptance — record each client separately

Initial Retail load/reload now passed on 12.1.5 build 70575, interface 120105,
with both review addons loaded and zero errors captured during that sequence.
The owner also confirmed Home, My character and Settings rendering; the following
save has empty probe errors and empty Guilded diagnostics.
French labels/layout on these pages were then confirmed; the later save has no
probe errors or Guilded diagnostics and restores automatic language.
See [the Retail evidence and remaining checks](RETAIL_ACCEPTANCE_2026-10-28.md).
This does not close visual, gameplay, upgrade, two-PC or Classic acceptance.

For each result record addon/companion version, client `GetBuildInfo()`, edition, language,
PC, steps, expected/actual behavior and error text. Back up SavedVariables first.

1. Fresh install and upgrade with existing data; open every page; EN/FR; no Lua errors.
2. In-game-only setup without companion; create/join guild configuration; verify role gates.
3. Pair companion using the typed code; cancel/retry/expired code; separate edition profiles;
   reboot/reload; migration preserves settings; secrets stay out of diagnostics.
4. Two PCs exchange roster/ledger changes; disconnect/reconnect; duplicate and reordered
   packets; full/chunked sync; no unauthorized officer writes or duplicate ledger entries.
5. Run one dungeon, abandon/reset one, reload during a run, finish a multi-wing instance
   where available; verify observations, score labels, badges and privacy. Retail: timed
   and depleted key cases. Classic: API fallback and dungeon identification.
6. Roster/crafters/team/history/groups, buffs, loot rules, opt-in availability/keys and GRM
   import/restore; confirm data and edition separation.
7. Real Discord onboarding/permissions, reports with screenshots, officer forwarding,
   community full leaderboard on mobile and desktop, ties/paging/archived seasons.
8. Backup/restore/undo and interrupted upload recovery; verify original files remain intact.

Forever-only behavior cannot be accepted in an unavailable client. Track it explicitly for
the first available game session; do not mark it passed from Retail/Classic results.

## Release gates

- All agreed feature gaps have an implemented result or an explicit owner-approved deferral.
- Final TypeScript, full tests, ESLint, both addon validators and build/package checks pass.
- Completed Retail results recorded; unperformed Classic/Forever and other manual checks explicitly waived by the owner and retained as follow-up, without marking them passed.
- Database restore rehearsal, unique-ledger preflight and verified backup pass before deploy.
- Final-commit CI on both required jobs passes; clean main deployment, health, commands and
  artifact checksums are verified. No second bot instance.
- Version is bumped once as a deliberate release action (it triggers guild notices).
- Windows signing status is truthful; published artifacts and CurseForge approvals verified.
- Microsoft Store: use the existing [live companion listing](https://apps.microsoft.com/detail/9N680XX3QFL9),
  complete [the 8.0 update submission](store-submission/V8_0_UPDATE.md), then verify Microsoft's
  approval and actual installed version separately from GitHub. Bilingual update notes are prepared.
- Aiven capacity check and remaining live errors reviewed. No guarantee of zero future bugs.

## Final local verification

28 October checkpoint: full suite **330 files / 2,795 tests passed**. After the Store-link
follow-up, six focused files / 31 tests passed (help limits, command shape/docs, version
docs, companion i18n and site navigation). TypeScript, ESLint, both addon validators,
site build and browser-companion build passed.

Ten addon development ZIPs are available under `dist/review-8.0-20261028/`, with edition,
interface, byte size and SHA-256 manifest. The unpacked Windows companion lives in its
`companion/win-unpacked/` subfolder. Packages are labelled `8.0.0-dev.20261028`, unsigned,
local review only; they are not a final 8.0 release. ASAR and every bundled engine file
were compared with source after packaging. Real Windows/game acceptance remains pending.

The public Microsoft Store listing was verified as downloadable. Links were added to both
public sites, setup/install guides, README, companion Help and Discord help; bilingual 8.0
Store update notes and submission gates are prepared. No Store version claim was inferred
from the public page, and no 8.0 submission was made.

Local Cloudflare preview returned the CSP and nosniff headers. Browser checking caught
and fixed the creator site's pre-existing language-script module error; EN/FR switching
and the translated Store link now work without new console errors. Deployed verification
and broader accessibility/mobile review remain pending.

Raw local logs: `backups/8.0-final-tests.log`, `8.0-typecheck.log`, `8.0-eslint.log`,
`8.0-site-build.log`, `8.0-store-link-tests.log`, `8.0-desktop-verification.json`.
Nothing here substitutes for real gameplay or production deployment.

## Continued hardening — 28 October

PR #246's original head passed both Linux quality and Windows packaging CI jobs.
The next pass adds the priority lane, bounded disk reads and native edge limits described
above. The Worker dry run confirms both rate-limit bindings, and the rebuilt Windows ASAR
and bundled engines match source. Cloudflare limits are approximate per location, not a
global quota; independent bot authentication remains necessary. These changes are not deployed.

The live bug inbox contains no open member bug reports. Three bot-error groups remain:
an older expired Discord interaction, an older database-pool timeout, and a 7.5.1 raid
signup with no linked character. The latter was reproduced from its exact throw site:
the picker now shows bilingual linking instructions and returns without a signup, instead
of throwing an exception. Both fresh and previously acknowledged interactions are tested.
The error reports remain open pending deployment and live verification.

Follow-up verification: **332 test files / 2,802 tests passed**, plus TypeScript,
ESLint, both addon validators, Worker dry run and Windows package/source verification.
Logs: `backups/8.0-rest-final-tests.log`, `8.0-rest-recovery-tests.log`,
`8.0-signup-fix.log`, `8.0-rest-worker-build.log`, `8.0-rest-desktop-build.log`.
The rebuilt test packages are in `dist/review-8.0-20261028/` with START-HERE.md.

A process check found Battle.net and the existing companion, but no running WoW client.
Retail/Classic hands-on testing therefore needs the owner to open and log into a client.
No usable code-signing certificate was found in the current user's Windows certificate
store. An external signing service/certificate may exist elsewhere; none was assumed.

## Engineering completion checkpoint

The seven required engineering items now have implementations and documented limits
in [V8_0_ENGINEERING.md](V8_0_ENGINEERING.md). Origin activation and final release checks
remain operational gates; they are not inferred from local source. The full build is
running against the deliberate 8.0.0 source version. Any failing integration is fixed
before publication. Manual observations and certification remain separate evidence.

## Final 8.0 implementation validation

Commit `1c2705c` passed the full local release preparation: **335 files / 2,812 tests**,
TypeScript, ESLint, both addon validators, both dependency audits, browser/site builds,
Windows installer packaging and byte-for-byte bundled source verification. The artifact
manifest records a clean source tree. PR #246 quality run `40687410149` passed both
Linux quality/PostgreSQL integration-and-restore and Windows installer/MSIX jobs.

The hosted origin credential has been provisioned separately from source. The gated
configuration validates on Oracle but remains inactive pending Worker deployment.
Microsoft Store Submission 2 (`1152921505702255246`) is a draft update of the existing
live product, with English/French 8.0 notes saved. Its inherited package is still 7.5.0;
it must be replaced by the verified 8.0 package before certification submission.

Publication, exact-main CI, verified production recovery backup, one bot deployment,
origin activation and public provider checks remain to be recorded. This section does
not claim that preparation alone released 8.0.
