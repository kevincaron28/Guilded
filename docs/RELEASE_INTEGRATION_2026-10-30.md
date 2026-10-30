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

- [ ] Guild supply planner from raid signups, with voluntary crafting and contributions; no loot-point awards.
- [ ] Missed-raid catch-up with officer-authored or approved progress, decisions and preparation; no voice capture or absence judgments.
- [ ] Progressive new-member checklist using existing linking, character/roles, professions and first-event flows; optional steps must not become access gates. Implemented private professions and confirmed first-raid progress in the existing checklist, with EN/FR copy and tests; final UI acceptance pending.
- [ ] Personal calendar export using existing events, stable IDs, cancellations and DST handling.
- [ ] Versioned raid playbooks with approved assignments/resources; note export only after testing.
- [ ] Officer handover and change review using existing audit and backup surfaces.
- [ ] Read-only external evidence links, manual links first, with source and freshness; no new credentials or API registrations.
- [ ] Member data centre aggregating existing visibility, devices, history, export and retention controls; preserve existing sharing and revocation scope. Private `/me/data` implemented with session-bound visible-record export, fresh guild authorization, existing control links, bounded personal signup history, empty/error states and no sharing mutations; final UI acceptance pending.
- [ ] Explainable bench-rotation suggestions with officer override and no automatic penalties.
- [ ] Keyboard access, scalable text, contrast, explicit offline/empty/stale/permission states, consistent edition/guild/season/character context, cancellation/undo/recovery and clear first-sync onboarding across changed surfaces.
- [ ] Dungeon timing policy: **pending evidence/review**. The existing coordination chat owns one online research pass; do not duplicate it. Freeze/version approved rules prospectively, distinguish estimates from observations, never silently re-score existing season runs.
- [ ] Feature freeze after the selected work is complete and validated; subsequent work limited to reported bugs. Today's target is not evidence that release gates passed.

## Current verification

### Timing research received from coordination, October 30

Read-only Method/Jurdi research was forwarded by coordination. These October
15–21 guide ranges are **authored full-run estimates, not measured samples**.
They do not specify matching party, gear or clock controls. Presets below refer
to main `930ae040`, not a newly approved policy.

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
**Specific targets and scoring changes are not approved.** Any approved change
must be prospective and versioned; no retrospective rescoring or unperformed
Forever acceptance claim. Release notes must retain these qualifications.

### Integration checkpoints

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
