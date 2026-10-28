# Guilded 8.0 launch readiness

Updated 28 October 2026. Target: feature completion/polish by 30 October; launch 4 November.
Production remains 7.5.1 / protocol 2. Local preparation is on `codex/8.0-launch-audit`,
combining Copilot's PR #245 and main through `b610e66`. No 8.0 release is published.

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
| 5 | Inbound addon authorization/replay envelope | Existing per-module defenses need consolidation review and adversarial client checks. Protocol remains 2. |
| 6 | Two independent uploaders before scoring | Explicitly deferred by owner because the initial population is small. Do not silently enable. |
| 7 | Canonical character/realm/edition identity | Existing implementation/tests; cross-edition, accented-name and two-PC acceptance pending. |
| 8 | Dungeon event sequence validation | Existing observations/validation; reset/reload/wings/spoof acceptance pending. |
| 9 | Provisional benchmark confidence | Existing `dungeon-calibration.ts` requires 20 crew/day samples, five independent crews, three days and matching build/timer convention; reports median/quartiles/exclusions. Real observations still needed. |
| 10 | Distinct scores and ranking explanations | Existing score panels; review each surface for clear labels and acceptance. Current-v1 stays active. |
| 11 | Retail depleted-key partial credit / affix treatment | Proposed scoring change requires explicit scoring review and real observations; not silently activated. |
| 12 | EN/FR, Retail/Classic, two-PC tests | Owner can test both clients. Checklist below; no successful gameplay claim yet. |
| 13 | Bounded prioritized communication | Implemented: 1,024 total slots, 16 reserved for explicit interactive packets; four interactive sends then a bulk turn. Ledger notices use the interactive lane. Snapshot/chunk traffic remains FIFO on the default lane. Tests cover reserve, ordering and fairness. |
| 14 | Ledger retention/compaction | Needs safe replay/backup/restore design. No ledger history deleted as cleanup. |
| 15 | Durable upload/retry/parser safeguards | Added bounded streaming reads (32 MB) for guild/personal SavedVariables, normalized JSON and standings identity validation, including growth during reading. Oversized neighbor files now surface errors. Restart regression proves earlier and newer ledger entries recover after an offline failure. Existing PoE journal remains durable. Real disk-full/Windows acceptance pending. |
| 16 | Edge rate limits/security headers | Implemented native Cloudflare limits: 120 API writes and 20 pairing starts per IP/minute, separate budgets, 429/Retry-After, fail-closed on limiter errors. Worker and preview URLs disabled in config; static headers included. Dry-run verifies bindings. Deployed verification pending. |
| 17 | Private origin/tunnel or mutual TLS | Infrastructure review pending; no production networking change made. |
| 18 | Canonical/hreflang/structured data/sitemaps | Existing canonical and creator JSON-LD; complete multilingual indexing audit pending. |
| 19 | Accessibility/mobile/error states | Automated and hands-on website/companion review pending. |
| 20 | Core.lua decomposition and edition/spoof matrix | Architectural proposal remains open. Do not confuse refactoring with a required user feature; acceptance matrix remains mandatory. |

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
- Real Retail and Classic results recorded; outstanding Forever checks clearly disclosed.
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

Explicitly unfinished engineering items remain: shared inbound-envelope consolidation,
ledger compaction with retained replay/void protection, versioned Retail overtime scoring,
private-origin migration, server-rendered French indexing, the full accessibility audit,
and further Core.lua decomposition. They are not marked complete by passing existing tests.
Do not publish 8.0 as complete while these accepted audit items remain unresolved, unless
the owner explicitly changes the scope. Real gameplay, native translation review, calibration
observations and Store certification also cannot be replaced by automated test results.
