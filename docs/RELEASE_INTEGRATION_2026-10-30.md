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
- [ ] Progressive new-member checklist using existing linking, character/roles, professions and first-event flows; optional steps must not become access gates.
- [ ] Personal calendar export using existing events, stable IDs, cancellations and DST handling.
- [ ] Versioned raid playbooks with approved assignments/resources; note export only after testing.
- [ ] Officer handover and change review using existing audit and backup surfaces.
- [ ] Read-only external evidence links, manual links first, with source and freshness; no new credentials or API registrations.
- [ ] Member data centre aggregating existing visibility, devices, history, export and retention controls; preserve existing sharing and revocation scope.
- [ ] Explainable bench-rotation suggestions with officer override and no automatic penalties.
- [ ] Keyboard access, scalable text, contrast, explicit offline/empty/stale/permission states, consistent edition/guild/season/character context, cancellation/undo/recovery and clear first-sync onboarding across changed surfaces.
- [ ] Dungeon timing policy: **pending evidence/review**. The existing coordination chat owns one online research pass; do not duplicate it. Freeze/version approved rules prospectively, distinguish estimates from observations, never silently re-score existing season runs.
- [ ] Feature freeze after the selected work is complete and validated; subsequent work limited to reported bugs. Today's target is not evidence that release gates passed.

## Current verification

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
