# October 30 release integration

Kevin requested completion of the selected features, review fixes, small polish,
live testing and publication today. This supersedes the earlier November 4 target;
it does not turn unperformed acceptance or pending provider approval into a pass.

## Ownership and source

- Local Codex: `codex/oct30-release-integration`, isolated managed checkout;
  integration, correctness fixes, complete validation and release coordination.
- Dot community chat: `codex/prelaunch-community-2026-10-30`, PR #282;
  completing targeted vacancy preferences, cooperative progress and reviewed
  weekly questions. Initial a1392044 is previews/scaffolding, not completion.
- Claude: desktop checkout, live Discord and now available Retail acceptance;
  evidence requested in `docs/LIVE_ACCEPTANCE_2026-10-30.md`. No concurrent deployment.
- Local candidate includes main 930ae04, #281 linking and #277 navigation polish.
  These local merges are not main merges or published release evidence.

## Additional selected scope for today

Kevin's approvals forwarded through the coordination chat are additive. None of
the following is complete merely because it appears in this checklist. Local PC
Codex owns integration; existing feature owners retain their current assignments.

- [ ] Guild supply planner: implemented in `/me/raid-plans`, with officer-reviewed item targets calculated from confirmed signups, voluntary member-owned pledges/deliveries, existing crafter/request links and no point awards. New revisions require fresh pledges. Combined migration/restore and live acceptance pending.
- [ ] Missed-raid catch-up: implemented as explicitly approved member-facing recap revisions, with progress, decisions, preparation and manually dated resources. Existing private raid notes are never imported. Combined/live acceptance pending.
- [ ] Progressive new-member checklist using existing linking, character/roles, professions and first-event flows; optional steps must not become access gates. Implemented private professions and confirmed first-raid progress in the existing checklist, with EN/FR copy and tests; final UI acceptance pending.
- [ ] Personal calendar export using existing events, stable IDs, cancellations and DST handling. Private `/me/calendar` implemented for raid signups and team responses with fresh membership/channel authorization, stable per-account event IDs, UTC/DST coverage and cancellation records. Manual snapshot only; community/Discord-only events excluded and refresh limitations displayed. Focused tests pass; final UI/import acceptance pending.
- [ ] Versioned raid playbooks: implemented with signed previews, explicit officer approval, immutable revision history, stale-edit rejection and withdrawal/republication recovery. No note export or automatic addon import. Combined/live acceptance pending.
- [ ] Officer handover and change review using existing audit and backup surfaces. Private read-only `/me/handover` implemented with fresh officer access, seven-day audit activity (no raw metadata), pending imports/applications, next raids, scheduled-vs-retry delivery state and existing recovery procedures. No backup verification claim; focused tests pass, final UI acceptance pending.
- [ ] Read-only external evidence: manual HTTPS resources in approved plans/recaps, source name and author-reviewed date, stale-date notice and no automatic fetch or new credentials. Combined/live acceptance pending.
- [ ] Member data centre aggregating existing visibility, devices, history, export and retention controls; preserve existing sharing and revocation scope. Private `/me/data` implemented with session-bound visible-record export, fresh guild authorization, existing control links, bounded personal signup history, empty/error states and no sharing mutations; final UI acceptance pending.
- [ ] Explainable bench rotation: officer-only advice alongside raid plans, using available confirmed/waitlisted members, role capacities and recorded benches in the last eight completed raids of the same core. Stable signup-order ties, unknown-history disclosure, incomplete-list refusal, no automated selections/penalties/points; existing officer controls retain final selection. Combined/live acceptance pending.
- [ ] Keyboard access, scalable text, contrast, explicit offline/empty/stale/permission states, consistent edition/guild/season/character context, cancellation/undo/recovery and clear first-sync onboarding across changed surfaces.
- [ ] Dungeon timing policy: research received and prospective five-edition implementation SOURCE-READY; production application and final CI pending. Versioned snapshots distinguish guide-informed and retained design estimates from native Mythic+ timers. Historical season results stay unchanged.
- [ ] Feature freeze after the selected work is complete and validated; subsequent work limited to reported bugs. Today's target is not evidence that release gates passed.

## Current verification

### 8.2.0 freeze preparation

Full GitHub Actions workflow 41043971911 succeeded on `cd9c7b1`, including the
complete test suite, lint, addon validation, Windows packaging and PostgreSQL
migration/backup/restore with approved plans and pledges. The preceding `ea8f92b`
workflow also passed, including the isolated simulation pool rehearsal.

The source now includes local edition/character/source/action sync context,
My Guilded next-raid/sync/week shortcuts, French raid-edit replies and removal
of referenced bot-authored test signup posts. Thirty-seven focused tests passed
after those fixes. Real PostgreSQL character-correction rollback/concurrency and
dependent-record checks were added for the final CI run. Version 8.2.0 is reserved
for this build; neither existing 8.1.0 candidate assets nor Store Submission 5
will be replaced in place.

The unchecked feature rows below denote outstanding final acceptance, not missing
implementations. The owner subsequently authorized researched timings for the upcoming first
season on October 30 at 11:10 UTC. The prospective policy below supersedes the
earlier timing hold; no measured Forever samples are available.
Claude received the updated test checklist (owner confirmed sending it) and is
waiting for the installed/deployed build checkpoint. Baseline 8.0.2 observations
remain distinct from candidate acceptance. Publication has not yet occurred.

### Timing research received from coordination, October 30

Read-only Method/Jurdi research was forwarded by coordination. These October
15–21 guide ranges are **authored full-run estimates, not measured samples**.
They do not specify matching party, gear or clock controls. Presets below refer
to main `930ae040`; the approved prospective changes are recorded below.

| Route/source | Guide estimate (minutes) | Existing provisional preset |
| --- | --- | --- |
| [Deadmines](https://www.method.gg/wow-forever/dungeons/the-deadmines) | 20–30 | 40 |
| [Shadowfang Keep](https://www.method.gg/wow-forever/dungeons/shadowfang-keep) | 20–30 | 30 |
| [Stockade](https://www.method.gg/wow-forever/dungeons/the-stockade) | 15–25 | 20 |
| [Wailing Caverns](https://www.method.gg/wow-forever/dungeons/wailing-caverns) | 30–40 | 40 |
| [Blackfathom Deeps](https://www.method.gg/wow-forever/dungeons/blackfathom-deeps) | 25–35 | 40 |
| [Excavation Site: Wetlands](https://www.method.gg/wow-forever/dungeons/excavation-site-wetlands) | 20–35 | 35 |
| [City of Dalaran](https://www.method.gg/wow-forever/dungeons/city-of-dalaran) | 30–40 | 45 |

Route gaps: Deadmines guide includes Cookie/rare Miner Johnson; Wailing Caverns
includes rare Faerie Dragon and Naralex escort ending Mutanus (verify completion
is not Verdan); Stockade includes rare Bruegal/separate wing; BFD's full regular
boss list is not enforced by the current final-boss preset. Excavation's Highland
Horror is an Alliance quest boss and Relic Guardian is final; Dalaran includes
Tome-summoned Lyn and Shade of the Archmage is final. Do not require rare, quest
or secret bosses universally or count outside preparation. Guide level ranges
may exceed competition bands. No Clear Time field was found for Ragefire, Hall
of Thanes or Ruins; these remain evidence gaps.

Review Deadmines/BFD/Dalaran next, but first define the route and
first-combat-to-completion clock. Preserve the active scoring lock and existing
calibration requirement: 20 crew/day samples, five substantially different crews,
three UTC days, same build and recorded starts, eligible in-band runs with three
participants and 80% presence. No additional calibration engine is needed.
**October 30 owner authorization supersedes the earlier hold.** Review
`launch-timings-2026-10-30-v1` selects Deadmines 30, BFD 35 and Dalaran 40 minutes.
The other four researched Forever targets remain unchanged. All seven carry
guide provenance and uncontrolled-clock qualifications; every remaining ordinary
route is explicitly a retained, unverified design estimate. No retrospective
rescoring or unperformed Forever acceptance claim is permitted.

Cross-edition review retains the 26 Era routes, 58 TBC routes, 18 Mists routes and
33 ordinary Retail routes. No comparable route/difficulty/level/clock population
data was established. Mists Challenge medal times are not normal/heroic targets
([Blizzard](https://worldofwarcraft.blizzard.com/en-us/news/24221824/scenarios-challenge-modes-in-mists-of-pandaria-classic)).
The eight frozen native Retail Mythic+ timers match the October 30
[RaiderIO catalog](https://github.com/RaiderIO/raiderio-addon/blob/develop/db/db_dungeons.lua)
and remain isolated by challenge/instance/season identity. No extra edition or
mode coverage is claimed.

Implementation is SOURCE-READY, not yet installed in production.
`scripts/export-edition-rules.ts` exports all five reviewed snapshots and hashes.
`scripts/configure-launch-timings.ts` previews existing scheduled Season 1 rows;
apply requires the exact preview hash, locks all five calendars in fixed order,
and commits all editions together. It refuses missing/already-started seasons
or changed previews. Existing public fallback rules and archived snapshots stay
unchanged. Production receipt and final CI are still pending.

### Integration checkpoints

CI on `50d6747` passed the full tests, lint, addon validators and Windows packaging;
PostgreSQL rehearsal failed on an old import fixture missing its now-configured
guild identity. `81ec472` fixes the fixture and adds wrong/missing identity rejection
checks. This is not yet a passing restore rehearsal.

Claude's updated installed-8.0.2 Retail report prompted source fixes for the stale
test result card, misleading test-data upload promise, French labels/save-button
length and Classic catalog fallback on Retail. The 23 focused addon checks pass;
final installed-client verification remains pending. Test-raid rehearsal now uses
an isolated disposable core and excludes real members from simulated awards;
focused tests pass and a real PostgreSQL rehearsal has been added. Poll expiry
closes and queues its Discord refresh atomically, with retryable delivery.

Cloud handoff `1b4c18c` is merged locally: stored targeted-alert preferences,
cooperative goals and officer-reviewed weekly question Post/Skip/Pause flows.
It adds an additive migration and guarded multi-connection PostgreSQL rehearsal.
Targeted delivery remains disabled and its timer unregistered until audience,
channel and cadence are explicitly configured/approved; weekly posting is manual.

Integration draft: PR #283 (`codex/oct30-release-integration`). First CI found an
exact-optional-property type mismatch in the guild-scope guard; corrected locally
and the combined typecheck passed. Updater and localization regressions found by
the broader suite were corrected and rerun. Publication remains blocked on the
unfinished feature list and final checks, not on an approval request.

The local combined TypeScript check passed after merging cloud fix `9e4e72a`.
The latest focused companion/dungeon run passed 65 tests. Reminder and delivery
tests passed 6 tests. Full-addon loading passed with a 30-second test allowance;
the default five-second timeout was insufficient on this machine. These results
do not replace full-suite or final-client acceptance.

Implemented locally: native/browser save-upload-receipt evidence, redacted summary
preview before saving, authenticated personal-link connection checks, reminder
outbox delivery with post-send timestamps, and private-report fail-closed audience
checks. Reminder retry tests cover send failure, recovery, duplicate detection and
expiration. All remain subject to the final combined checks below.

## Existing review checklist

All fixes below require regression checks and final combined CI.

| Area | Current state |
| --- | --- |
| Dungeon sender/channel authorization, bounded/expiring summaries | Source corrected in full and standalone; tests in progress |
| Provisional character correction | Identity-preserving serializable transaction implemented; targeted existing tests pass; failure/concurrency/dependent-record acceptance still needed |
| Browser disconnect | All saved exact credentials, personal included; retain state on partial revocation and refuse silent queue discard; tests in progress |
| Update notices | Stable provider metadata only; backend version cannot advertise missing clients; targeted tests pass |
| Pairing scope | Preserve guild ID/name/edition grant metadata; multi-profile regression pending |
| Automatic sign-in | Server capability acknowledgement added; mixed-version tests pending |
| Guild realm/edition isolation and exact backup confirmation | Corrected; existing tests pass; additional cross-edition regressions pending |
| Report recipient consent/audience at send and retry | Corrected with preview-bound channel and fail-closed audience; retry regression pending |
| Roster in-place conversion and fetch-error handling | Corrected; targeted tests pass |
| Reminder delivery state and interaction deadlines | Durable reminder outbox implemented and targeted tests pass; interaction audit pending |
| Private personal recap | PR #282 preview integrated; final UX/evidence review pending |
| Truthful sync diagnostics | Native/browser evidence and user-reviewed summary implemented; focused tests pass; final UI acceptance pending |
| Next raid/sync/week shortcuts, backup history scope, signup labels, EN/FR/mobile | Pending |

## Validation and publication gates

Local npm installation and Prisma generation succeeded. Cloud's download 403 is
not a local blocker. Initial combined typecheck found a cooperative-rules type
mismatch, reported to its owner. Targeted checks are intermediate evidence only.

Before release: full TypeScript/Vitest/ESLint, both addon validators, isolated
PostgreSQL tests/restore, exact-source CI and Windows packaging; fresh ledger and
verified recovery backups before one locked backend deployment. Use a new client
version newer than installed 8.1.0 candidates, with all shared versions aligned.
Never replace v8.1.0-rc.1 or Store Submission 5 bytes. Provider submission,
approval, anonymous download verification and actual Store installation are
distinct gates. Preserve Submission 5's hold until the replacement plan is verified.

Retail is available for baseline testing as of Kevin's latest instruction.
Record actual build/addon/source/profile and data provenance. Retail tests do
not establish Forever acceptance; actual Forever November 4 tests remain pending.
Two-device and ordinary-member tests need actual participating clients/accounts.
Do not modify real balances to manufacture a pass or activate recurring sends
without their audience, cadence and opt-in configuration.
