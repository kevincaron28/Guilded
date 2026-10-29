# Guilded launch audit and November 4 plan

Audit date: 29 October 2026 (America/Toronto). Published baseline: **8.0.2,
protocol 2**, client/bot source `f7ca4c4`; maintained evidence at `7e382b0`.
The owner now targets **4 November** for the next launch release, with useful
feature work before then and fixes driven by actual players on launch day.
Existing public 8.0.2 downloads remain available and immutable.

## Decision

**Feature coverage is sufficient for the intended guild-management launch;
the connected system is not yet an unconditional go.** The public browser
companion intermittently fails to load because its origin cannot be resolved.
Resolve and verify that operational blocker before promoting the launch.
Real gameplay, cross-PC acceptance and launch-traffic capacity still have
explicit evidence gaps. The owner's manual-testing waiver remains in force;
it does not turn those gaps into passes.

This is a fresh risk-based review of the addon, bot, companions, public entry
points, release evidence and support workflow, plus a current primary-source
competitive review. It is not a claim that every line, screen, guild permission
combination or live client has been independently exercised.

## Fresh findings

### P1: public companion and dynamic-page reliability — open

The public `/health` response returned 200, version 8.0.2, protocol 2 and
`commands: ok`. Sampled English Forever and French Retail edition pages returned
200 with the correct release links and CSP. However, an initial companion page
request returned 530. A separate ten-request series against
`/companion/web-bundle.js` returned **six 530 failures and four 200 responses**.
The failed body was `error code: 1016`. A successful health request therefore
does not establish that a player can load the companion.

During this audit the shared checkout advanced to the separate website branch,
commit `34ca71e`, now [PR #262](https://github.com/kevincaron28/Guilded/pull/262).
Its `docs/SITE_RELIABILITY_2026-10-29.md` independently records
the same origin-DNS failure and proposes retries, an unavailable page and a
stable origin hostname in the owner's DNS zone. That source is **not evidence
of successful deployment**. Audit fixes were moved to an isolated worktree
based on `7e382b0`, leaving the website work intact.

Completion criteria:

1. Review and pass CI for the website/Worker change; activate the stable origin
   and its certificate using the existing deployment/backup gates.
2. Preserve origin authentication: direct unauthenticated access must remain
   rejected, while the public Worker can reach the service.
3. Probe health, companion HTML **and JavaScript**, leaderboards, guild directory
   and sign-in entry across repeated samples. Record individual failures before
   retries; do not report only the eventual successful request.
4. Require at least 20 consecutive successful samples for the critical entry
   points, then continued observation during ordinary use. This is a smoke
   acceptance threshold, not a statistical uptime or capacity guarantee.

### P2: automatic errors could hide player reports — corrected in this branch

`loadInbox` previously selected the newest 1,000 unresolved rows across both
automatic errors and player submissions. An error flood could push an older
player report out of the result and render "None open" for member reports.
There was no truncation warning, so grouped counts could look complete.

The correction gives member reports and automatic errors separate bounded
budgets, fetches one extra row to detect overflow, and explicitly labels an
incomplete inbox and sampled counts/first-seen times. Ordering has an ID
tiebreaker. The CLI warns as well. Regression cases cover 1,100 automatic errors
plus an older player report, overflowing member reports, exactly 1,000 records
and an empty inbox. No reports are resolved or deleted by this correction.
The default 30-day window remains explicit; older retained incidents can be
requested with `npm run bugs -- --days 60` (up to 365).

### Remaining launch risks

| Area | Evidence and remaining action |
| --- | --- |
| Real game behavior | Earlier partial Retail EN/FR rendering passed. Full Forever/Classic gameplay, two-PC sync, disconnect/reload and officer demotion/revocation need real testers. Remain waived follow-ups, not certified behavior. |
| Database capacity | October 28 evidence records recovery from earlier memory pressure and ordinary activity, not a launch-load test. Record memory available, connection count and request latency during normal tester activity; do not stress the free production database or raise billing automatically. |
| New game data | Verify actual Forever build/API, dungeon identifiers and loot data when available. Unsupported runs remain unrated; calibration still requires 20 samples, five crews and three days. Preserve frozen season rules. |
| Release coordination | Store certification and CurseForge moderation can finish after submission. Prepare candidates early; November 4 is the release target, not a guarantee of simultaneous provider approval. Never relabel a pending submission as published. |
| Accessibility/languages | FR/DE/ES addon catalogues exist; model-assisted language review is not independent native review. Native screen-reader and broader in-game layouts remain unperformed. |
| Support coverage | A scheduled check can find reports between active sessions; it is not continuous human support or automatic gameplay testing. Keep error-report intake and a named human tester available. |

## System coverage reviewed

| Surface | Existing implementation and review evidence | Launch action |
| --- | --- | --- |
| Addon foundation | Five edition packages; standalone setup; optional modules; shared transport length/channel checks; role checks at write boundaries; paced queues. `Transport.lua`, TOCs, module guide and Lua tests. | Test published edition against the actual client; record build and module conflicts. |
| Guild/raid tools | Roster, mains/alts, teams/trials/bench, crafting, readiness, availability, map, attendance, summaries, backups and restore. Local GRM migration is present but does not guarantee arbitrary archive compatibility. | Fresh-member and officer walkthrough; real archive only with a backup and preview. |
| Loot | EPGP, bidding, soft reserves, priority and council responses **and officer voting** exist. Council session recovery, history and TMB/softres imports are already implemented. | Exercise awards once, then reload/retry/undo and reconcile both officers' ledgers. |
| Dungeons/community | Run evidence, versioned scoring, seasons, consent, participation caps/reversals and bounded participation summaries. | Actual completion/abandon/reset cases; distinguish local observations from accepted results. |
| Bot/web access | Session HMAC, CSRF and same-origin checks; bounded forms; guild-scoped services and personal credentials. Upload references and reversals preserve ledger history. | Ordinary member cannot perform officer writes or read another guild; revocation must take effect. |
| Desktop/browser companion | HTTPS/redirect policy, typed sign-in, profiles, encrypted desktop credentials, IPC sender/schema checks, 32 MB saved-file stream cap, retries and manual browser alternative. | Fresh install, account pairing, edition folder, offline retry and restart. Browser access currently has the P1 above. |
| Release/recovery | Previous exact-source Linux/PostgreSQL/restore and Windows CI, 21 GitHub assets, ten approved CurseForge files and installed Store 8.0.2.0 are recorded in release evidence. | Repeat gates for the actual launch candidate; prior artifacts do not certify later changes. |
| Support | `/report bug`, consented screenshots, private developer inbox and grouped service failures. Fresh read: zero member reports and four historical groups; latest recorded occurrence October 28, before 8.0.2 deployment. | Keep groups open until live evidence confirms the fixes; use the overflow-safe inbox. |

Security, correctness and performance controls are present in the inspected
boundaries. The concrete new issue was support completeness; the operational
P1 is the strongest reason to withhold a blanket readiness claim. No additional
confirmed security defect was established by this review.

## Competition and feature gaps

Sources checked 29 October. These are documented vendor capabilities, not
hands-on quality scores. Do not infer support on every WoW edition from a
vendor's generic feature list. Weight first-run success, data integrity and
guild coordination above total feature count.

| Alternative | Documented advantage | Guilded coverage and actual gap | Decision |
| --- | --- | --- | --- |
| [Guild Roster Manager](https://www.curseforge.com/wow/addons/guild-roster-manager) | Shared roster history, main/alt groups, former members, rejoin/ban notices and detailed dates/notes. | Guilded has roster review, history, mains/alts, staged admin and local GRM conversion. It is not a proven replacement for every GRM archive or its synchronized social metadata. | Prioritize migration rehearsal; full GRM parity is not a launch prerequisite. |
| [Gargul](https://www.curseforge.com/wow/addons/gargul) | Loot/trade convenience, automated loot rules, roll variants, GDKP and external priority imports. | Guilded already handles its four loot workflows, softres and TMB imports. No comparable automatic trade-delivery workflow or general Gargul awarded-history importer was found. | A reviewed history importer is a useful candidate; new automated awards/trading are too risky to rush. GDKP is not an established product requirement. |
| [RCLootCouncil](https://www.curseforge.com/wow/addons/rclootcouncil) | Configurable council responses, trade UI, history and session automation. | Guilded has officer voting, responses and loot history already. Native RCLC award-history ingestion and comparable trade UI are gaps. | Favor coexistence/history import over rebuilding the entire specialist tool. |
| [That's My BiS](https://thatsmybis.com/wiki/getting-started) | Wishlists/priorities, attendance and imports of externally recorded loot. | Guilded already has wishlists, priorities, attendance and TMB priority import. Importing RCLC/Gargul awarded history is the clearest interoperability gap. | Candidate feature with preview, identity validation, provenance and deduplication. |
| [Raid-Helper](https://raid-helper.dev/documentation/advanced) and [guides](https://www.raid-helper.dev/documentation/guides) | Scheduling, Discord events and customizable signup templates. | Guilded already has weekly repeat raids, cores, signups, waitlists, presets and reminders. A polished arbitrary-template builder is not established parity. | Verify existing repeat/deadline flows; do not add a second scheduling system. Primary pages are JS-rendered; feature evidence here includes indexed official documentation. |
| [Raider.IO](https://raider.io/addon) | Broad ecosystem data, route creation and dungeon replay. | Guilded supplies community dungeon records, score explanations, profiles and keys. Its provisional score is separate; it lacks equivalent replay/routes and global dataset coverage. | Keep clear labels and coexist. No need to recreate global rankings before launch. |
| [Method Raid Tools](https://www.curseforge.com/wow/addons/method-raid-tools) | Encounter notes, reminders, raid inspection and specialized raid utilities, with edition-specific limits. | Guilded covers readiness, attendance and grouping; encounter execution tooling belongs to the separate Pullscript scope. | Do not reintroduce removed raid tooling to chase parity. |
| [GuildHall](https://guildhall.run/features) | Advertises integrated roster/events, RCLC history, wishlist sim gains, vault tracking and raid analytics. | Guilded overlaps in teams, signups, loot, recruitment and Discord. RCLC interoperability, Droptimizer integration and a Retail vault board are not established in Guilded. | Watch as a direct integrated competitor. Its vendor claims are not independently validated; Retail-specific features are secondary to Forever launch. |

**Conclusion:** no missing core guild-management feature was demonstrated that
must be built for November 4. The meaningful competitive opportunity is making
Guilded easy to adopt beside existing tools. Reliability and a successful first
guild session are currently more valuable than another large subsystem.

## Work queue through November 4

| Priority | Work | Done when |
| --- | --- | --- |
| P1 | Finish public-origin reliability | Reviewed deployment, private origin rejection and successful repeated critical-route probes, followed by ordinary-use observation. |
| P2 | Overflow-safe bug inbox | Regressions and full checks pass; reviewable PR; operator uses corrected checkout. No bot deployment is required just to run this developer CLI. |
| P2 | Fresh-player and officer launch rehearsal | Install the correct edition, open the addon, pair optionally, select the saved-file folder, upload/retry, inspect standings and submit a consented test report. Record actual results with owner/tester input. |
| P2 | Two-PC data/recovery rehearsal | Original backup retained; duplicate upload is harmless; authorized changes survive reload and reconnect; revoked/officer-demoted credentials fail; restore/undo is demonstrated. |
| P3 candidate | RCLC/Gargul loot-history import | Obtain a representative export/schema; implement preview-only review first; explicit guild/edition/name mapping; repeated import is idempotent; do not fabricate GP or edit prior awards; malformed input cannot run code; real export accepted. Only start after P1 and launch rehearsals are under control. |
| P3 candidate | Retail vault / wishlist sim integration | Require concrete user demand, a supported data source and privacy/freshness design. Defer from the initial Forever launch unless that evidence appears. |

The owner permits useful feature additions until launch. Work one coherent
change at a time; existing data, privacy choices and season policies remain
protected. November 3 should produce a stable candidate, but a small justified
feature may still be accepted with its full checks. Avoid an incidental version
bump: the shared version triggers guild update notices.

## Launch day and bug response

Blizzard's [official roadmap](https://worldofwarcraft.blizzard.com/en-us/news/24303862/world-of-warcraft-forever-whats-next)
states November 4 at 3 p.m. PST: **6 p.m. Toronto/Montréal, 23:00 UTC**.
Daylight saving time ends before launch. Earlier articles have inconsistent
PDT/PST labels; retain the project's 23:00 UTC schedule and recheck the official
announcement before publishing. First new raids are scheduled December 9.

- **Morning:** final candidate source/CI, release notes, provider submissions,
  install instructions, health/companion checks, fresh ledger and recovery backup.
- **Before opening:** publish/verify the intended launch artifacts when their
  gates pass. Record pending provider approval honestly. Keep the prior version
  and an application rollback ready; never restore an old database over new play.
- **At game opening:** testers record edition/build, addon/companion version,
  language, role, steps, expected/actual outcome and Lua error/screenshot. Start
  with load/reload, member/officer access, pairing/upload, two-PC sync, then a
  dungeon completion/abandon/reset. Test without and then with other addons.
- **As reports arrive:** capture the report reference; reproduce; prioritize
  data loss, authorization, startup and sync failures above cosmetic defects;
  add a regression; validate the fix and release the smallest necessary patch.
  Resolve the report only after the matching live correction is confirmed.
- **If critical writes fail:** stop the affected workflow, preserve evidence
  and original SavedVariables, and use reviewed rollback/disable controls.
  Do not delete ledgers, reset scores or start a second bot.

An hourly chat follow-up is scheduled through the end of November 4 to inspect
new reports/health and progress this queue. It reports meaningful changes only.
This is periodic coverage, not a promise to detect every bug instantly; live
tester reports in this chat can be handled during active work.

## Verification record

Fresh results and final PR/CI state are recorded below when validation completes.
Private local receipts: `backups/launch-audit-2026-10-29/`. They are not committed
because incident material may contain private identifiers.

- TypeScript, ESLint and both addon validators: passed on isolated audit changes.
- Root and companion dependency audits: zero reported vulnerabilities.
- Bug-inbox regression file: six tests passed in the initial focused run.
- Fresh production inbox read and public observations: recorded above.
- Full suite: pending final completion at document creation.
- New candidate PostgreSQL/restore and Windows packaging: pending CI.
- No new game acceptance, load test, Store installation or provider checksum
  sweep was performed in this pass. October 28 release receipts remain dated
  evidence, not fresh results. No launch release or production deployment was
  performed by this audit.
