# Selected pre-launch community work — 30 October 2026

> Current continuation: [stored/reviewed flows and local integration](#coordinated-continuation--items-3-4-and-7).
> The earlier checkpoint below describes `a139204`, not the completed continuation.
> Source handoff: PR #282, `1b4c18c573b6613fda5326ff204bb36dbdf3e394`.

Kevin selected items 3, 4, 5, 6 and 7 from the seven-item discussion for today's
pre-launch roadmap. Items 1 (personal goals) and 2 (mentoring) are excluded.
Implementation is authorized on an isolated branch. Kevin subsequently targeted
a product release on October 30 and requested a whole-product gap review before
finalizing scope; WoW Forever opens November 4. Scope expansion/integration is
paused for that review and coordination with the PC release owner. Completion
and publication remain separate decisions.

## Coordination

Base: main `930ae040e3a51ce916abe302015950156fe83738`, fetched October 30.
Branch: `codex/prelaunch-community-2026-10-30`. The saved cloud checkout was clean.
No AGENTS.md or `.agents/skills` exists in this checkout or its workspace parent;
`CLAUDE.md`, current roadmap, release checkpoint and sync/privacy handoffs were read.
The authorized local release session `01a181ce-30fa-7c60-b973-c385d45d3502`
owns release preparation and its unobservable PC work must not be overwritten.

Open PR #281 owns simpler linking in Companion engine, main process, renderer,
API and addon integration. Draft PR #277 owns Companion renderer/navigation and
French labels, with a certification hold. Their descriptions, comments and file
lists were inspected. Item 6's screen/report wiring overlaps both: reserve those
files and implement isolated helpers first. No open PR owns the alert/community
service files at this checkpoint. Recheck PR/main ownership before integration.

No merges, deployment, version bump, package publishing, Store action, credentials,
network/security changes or Discord content are part of this branch. Preserve
stable 8.0.2, v8.1.0-rc.1 and Submission 5 bytes and manual publication hold.

## Existing paths and acceptance

### 3 — Targeted group/vacancy alerts

Reuse `src/services/group-alerts.ts`, `src/commands/group-alerts.ts` and the
existing group board/queue. Existing matching covers opt-in kinds, character
levels, roles, leader exclusion and per-post mention limits. It does not yet
establish personal time/expiry limits or raid-vacancy subscriptions.

- [ ] Persist explicit subscription settings; show timezone, expiry and off control.
- [ ] Match role and group start time; suppress expired/closed/full groups.
- [ ] Quiet hours handle midnight and timezone/DST transitions.
- [ ] Strict per-member cooldown/daily cap and event dedup survive retries/concurrency.
- [ ] Revalidate membership/channel access before any delivery; no new DMs.
- [ ] Disabled-by-default new delivery; audience/channel/cadence approval required.

### 4 — Cooperative guild challenges

Audit `dungeon-import.ts`, `dungeon-observations.ts`, `dungeon-participation.ts`,
`dungeon-evidence-awards.ts`, guild dungeon transactions and `community.ts`.
Existing reviewed CHALLENGE activities award points; do not route a cosmetic
cooperative challenge through that award path. Existing guild weekly reports
read dungeon runs and point transactions; a report row alone is not new proof.

- [ ] Reuse canonical run identities and existing participation eligibility.
- [ ] Scope by guild, edition, approved rules and explicit half-open time window.
- [ ] Ignore invalid/incomplete runs and duplicate/relayed observations.
- [ ] Distinct dungeon/eligible participant progress remains read-only and cosmetic.
- [ ] No scoring-policy changes, balances, automatic points or legacy baseline rewrite.
- [ ] Moderator configuration/preview and approved display remain separate gates.

### 5 — Personal weekly recap

Reuse `weekly-report.ts`'s reset window and existing signups/earned achievements.
Never expose another member's private report or add a second guild report sender.

- [ ] Private member-scoped preview of known progress, earned badges and signups.
- [ ] Explicit opt-in/off and period dedup; missing data stays unknown.
- [ ] No unselected personal-goals feature or raw chat/audio collection.
- [ ] Recurring delivery remains disabled until audience/channel/cadence approval.

### 6 — Sync status and diagnostic handoff

Reuse enabled-profile status from `companion/profile-engine.mjs` and the existing
report preview contract in `docs/DIAGNOSTIC_PRIVACY_AND_CLIENT_ACCEPTANCE.md`.
Do not infer backend acceptance from an HTTP upload or a file modification time.

- [ ] Local screen identifies edition, character and folder, freshness and next action.
- [ ] Distinguish game save, attempted/successful upload and backend acceptance.
- [ ] Unknown stages remain unknown; old clients/servers remain usable.
- [ ] Diagnostic preview uses a bounded allowlist; excludes credentials, local paths,
      account identifiers, arbitrary logs, SavedVariables and raw error text.
- [ ] Existing bug-report consent/recipient rules apply; cancel/expiry sends nothing.
- [ ] Integrate UI/IPC/report handoff only after resolving PR #277/#281 ownership.

### 7 — Weekly community question/poll

Reuse existing moderator poll permissions and `src/services/poll.ts`; existing
polls use buttons, so native Discord poll support is a separately verified option.

- [ ] Moderator-only configuration, bounded question/options and private preview.
- [ ] Off by default, explicit target channel/timezone/cadence and stop control.
- [ ] One occurrence per week, no catch-up flood or automatic chat/participation XP.
- [ ] No scheduler or actual post is activated by this implementation pass.

## Validation and delivery gates

Record focused behavior tests, full TypeScript/Vitest/ESLint and addon validation
on final source. Tests using mocks are not Discord/game/Windows acceptance.
Any migrations must be additive and applied before a client needing new fields.
No production migration is authorized here. Exact combined-source CI, packaging,
Windows installation and live gameplay remain with coordinated release work.

Implementation and final test results will be appended below; unchecked items
are outstanding, not implied complete by adding them to the roadmap.

## Implementation checkpoint and PC handoff

Scope frozen for the whole-product review at the parent's request. The later PC
coordination request authorizes pushing this branch for local full checks and
integration. No local PC work was inspected or changed from this cloud session.
The PC coordinator is session `01a18c22-fb70-7ea2-8689-7c2a85655ad7`; the existing
release owner remains `01a181ce-30fa-7c60-b973-c385d45d3502`. Reconcile those owners
before integration/publication. Main was re-fetched and still `930ae04` at handoff.

| Selected item | Backend/helper status | User interface status | Persistence/scheduler/activation |
| --- | --- | --- | --- |
| 3 Alerts | Validated opt-in draft; existing role/level matcher, availability, IANA timezone, overnight/DST quiet hours, seven-day maximum expiry, six-hour cooldown, maximum two attempts per rolling 24 hours and event dedup | Not integrated into existing alert panel | No new storage, reservation transaction or sender. Preview always returns delivery disabled. Existing legacy alerts are unchanged. |
| 4 Cooperative challenges | Read-only weekly progress from canonical valid runs, frozen v5/v6 rules and existing participation eligibility; minimum two linked guild accounts | `/dungeon together`: private EN/FR progress preview | No saved goal/configuration, cosmetic badge award or scheduler. No balance/rating writes. |
| 5 Personal recap | Authenticated actor/guild-scoped previous complete reset week, net participation entries, earned badges and next seven days' signups | `/report stats personal:true`: private EN/FR preview. Rejects simultaneous days/core filters. `/stats` is the internal command mounted under `/report`. | No recurring opt-in store, dedup/outbox or sender. Manual invocation requests only this preview. |
| 6 Sync status | Isolated local display/diagnostic model with distinct saved/uploaded/accepted evidence; diagnostic allowlist | Not integrated into Companion screen, engine, IPC or report flow | No collection or transmission. Requires stage evidence for matching snapshot revisions; legacy `synced`/`lastUpload` cannot prove acceptance. |
| 7 Weekly question/poll | Validated officer draft, proposed current channel/day/time/timezone, optional existing button-poll options | `/poll weekly-preview`: private EN/FR draft with officer and channel-access checks | Explicitly not saved/scheduled. No activity points, recurring sender or native Discord poll implementation. |

These are three usable private previews and isolated scaffolding, **not completion
of all five selected features**. No commands have been registered against Discord.
All handlers were exercised with mocked Discord, not live acceptance.

### Reuse and revision safety

`DungeonRun` has a unique guild/run reference. Existing import code also detects
near duplicates and reconciles observer reports on that row. The cooperative
projection consumes those canonical rows, not observer arrays, reporter counts
or point transactions. It uses the stored season's rules, including current-v2
integrity only when already required; it never enables a new evidence policy.
Unsupported rules are reported as unsupported. Legacy rules' eligibility is not
claimed to be new server-side anti-cheat proof.

The query is scoped to the existing guild identity (which owns its edition),
active season, linked members in that same guild and a half-open weekly/season
window. Simulated/invalid/incomplete/manual-completion rows are excluded. Run
revisions are recomputed from current data; invalidation removes progress on the
next preview. Conflicting copies of the same reference in an input are excluded
in either order. Two alts of one member cannot satisfy the cooperative threshold.
More than 2,000 candidate rows produces an explicit unavailable total, never an
inflated or silently partial completed challenge. No historical awards change.

Personal recaps exclude revoked dungeon achievements and silent community
BASELINE badges; only dated LEDGER/REVIEW badges are considered newly earned.
Corrections remain net signed participation changes, not newly minted rewards.
The implementation does not add unselected personal goals or mentoring.

### Remaining integration ownership and compatibility

PR #281 (`claude/simpler-linking-3`) owns Companion engine/main/renderer/API,
linking, addon and shared i18n files. Draft PR #277
(`codex/companion-roster-labels`) owns renderer/navigation/French labels and stays
held for Store coordination. This branch modifies none of their listed files.
The new helper `companion/sync-status.mjs` has no callers in their code yet.
Their PR IDs identify owners/scope; they are not merged by this handoff.

No schema changes or migrations are included. These previews use the existing
main schema; deploying them requires registering the updated Discord commands
with matching backend source. Existing clients/protocol 2 remain unchanged.
Future alert/recap/poll persistence needs additive migrations and backend-first
rollout. Future sync diagnostics need explicit engine stage evidence plus a
preview/cancel/send handoff using existing bug-report consent and recipient
checks; never attach the local status object containing character/folder data.

Before enabling future delivery: persist opt-in/off, atomically reserve limits
and occurrence identities across retries, count uncertain attempts, revalidate
membership and exact channel access at dispatch, and obtain the requested
audience/channel/cadence approval. Do not bolt a scheduler directly onto the pure
preview helpers or treat caller-supplied history as a durable delivery budget.

### Validation evidence and actual blocker

- All six new test files pass: **29 tests**, including private command dispatch,
  officer denial, limits/DST, canonical run revisions, actor scoping, silent
  baseline query exclusions and diagnostic minimization.
- Final full suite: **235 files passed, 121 failed to load; 1,962 tests passed,
  11 skipped** (356 files / 1,973 runnable tests). Failed imports and their mock
  wrappers resolve to the missing generated Prisma client; no failing test
  assertion was observed. This is not a green combined suite.
- Full ESLint passes. Both addon validators pass. `git diff --check` passes.
- Full TypeScript was attempted and fails because generated Prisma types are
  absent, with cascading inference errors. Independent new-helper/fixture type
  issues revealed by that run were corrected; a full type pass is still required.
- `npm ci --cache /workspace/.npm-cache` installed dependencies but postinstall
  `prisma generate` failed fetching
  `https://binaries.prisma.sh/all_commits/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/debian-openssl-3.0.x/schema-engine.sha256`:
  **403 Forbidden**. That action was stopped. No checksum bypass, alternate
  download route, credentials or network-policy changes were attempted.
- Local logs: `/tmp/guilded-npm-ci.log`, `/tmp/guilded-final-tests.log`,
  `/tmp/guilded-typecheck-final.log`, `/tmp/guilded-eslint-final.log`.

PC follow-up: ordinary dependency generation, full type/lint/tests, merged-command
shape/handler coverage, PostgreSQL checks, actual Discord mobile/member/officer
acceptance, Companion installed Windows UI and game acceptance. Published/held
artifacts are unchanged; no new packaging/publication evidence is claimed.

## Coordinated continuation — items 3, 4 and 7

The verified local integration owner requested completion of items 3/4/7 here,
and explicitly owns items 5 (recap), 6 (sync/diagnostics), correctness fixes,
combined checks, live acceptance and release. PR #281 and #277 are merged only
in its isolated `codex/oct30-release-integration` worktree, not main. This
continuation avoids Companion, addon, linking/privacy and raid-core files.
`src/main.ts` changes only the weekly-question button import/dispatch.
The cooperative frozen-rule TypeScript fix was separately pushed as `9e4e72a`.

### Usable flows

- **3 — `/dungeon watch`:** Save/Status/Off/Matches. Explicit roles, availability,
  timezone, weekdays, quiet hours, opportunity type and 1–168-hour expiry are
  stored on the existing GroupAlert. New subscriptions are excluded from the
  older direct-mention path. Matches are private and check current channel
  access, existing attempts, vacancies, signup deadlines and membership. Open
  dungeon groups are explicitly immediate; raid times come from structured
  schedules, never title parsing. Unknown raid capacities are not guessed.
- **4 — `/dungeon together`:** Officers set `goal`, explicit `season` and
  `goal-kind` (different dungeons/runs), or pause/resume. Members see aggregate
  progress and cosmetic completion. The stored scope fixes guild/edition,
  season calendar, rules hash and weekly window. Rule/edition/calendar changes
  require a new officer decision. Invalidations/revisions recompute the visual
  result; no permanent reward or balance is minted. Existing v5/v6 eligibility
  applies, with current-v2 only where already selected by that season.
- **7 — `/poll weekly-preview`:** Officers save a question or existing button
  poll with destination and proposed local day/time. `/poll weekly` reopens the
  stored draft or pauses/resumes manual review. Each private review offers
  **Post this week now / Skip this week / Pause** and expires in five minutes.
  Post rechecks the exact officer, guild, current plan revision and channel
  permissions. The ordinary Poll table/buttons handle votes. No native-poll
  engine, new XP source, automatic reward or background question sender exists.

### Delivery and activation boundaries

Targeted alert reservations use a per-guild/member PostgreSQL advisory lock and
unique canonical event identity. Attempts, cancellations and uncertain outcomes
consume the six-hour/two-per-rolling-day budget; changing preferences does not
erase history. Membership, opt-out, vacancies, quiet hours and exact destination
are rechecked before send. Existing independent role notifications are not
claimed to fall under this new personal subscription budget.

`dispatchGroupWatches` is a complete Discord adapter but **has no timer registered**.
It also requires `targetedAlertsEnabled=true` and the exact configured channel.
Both new settings default off/null; no activation command or migration turns
them on. Before registration/activation, the local owner must obtain the stated
audience/channel/cadence approval. Each pass is bounded to 100 subscriptions and
10 opportunities per configured guild; more subscribers need a reviewed paging
strategy before rollout at that size. No DMs, role mentions or fallback channels.

Weekly manual posts commit an ATTEMPTED occurrence before Discord. Concurrent
officers/replayed buttons cannot create a second occurrence. Timeout/crash states
are not automatically retried; inspect the channel before operator recovery.
Editing a draft invalidates older reviews; timezone changes cannot produce a
second immediate post (six-day backstop plus unique local week). Skip/Pause send
nothing. Paused plans require explicit resume/save; resume does not post.
Replies to a question retain existing participation rules; this feature adds no
new points and does not alter legacy earning/privacy policies.

### Migration and local-owner checks

Apply additive `20261129000000_reviewed_community_flows` before running this
backend or registering its commands. It adds GroupAlert preferences, disabled
GuildSettings gates, CooperativeGoal and weekly review/occurrence/alert-attempt
tables. No existing row, balance, score policy or protocol is rewritten. No
client update is required for these Discord commands. No migration was applied
to production here.

The new behavior tests cover concurrent/replayed delivery, uncertainty, access
loss, actor/guild/expiry binding, destination edits, off/pause/skip and frozen
cooperative scope. The actual SQL migration/default/unique/check constraints are
also exercised through embedded PostgreSQL (the already-locked PGlite dependency).
This is not a multi-connection server test.

`scripts/verify-reviewed-community.ts` is now invoked by the existing guarded
`npm run test:postgres` runner. It uses the disposable localhost
`guilded_release_test` database and mocked sends to verify real concurrent
reservations and weekly uncertain-outcome deduplication. The local owner/CI must
run it with generated Prisma. The cloud checksum 403 remains in effect; no
download retry or bypass was used. The original PR CI confirms generation works
on GitHub; its initial TypeScript issue is the separately corrected `9e4e72a`.

Focused run at this continuation: **45 tests passed across 8 files**, including
the migration and stale legacy-menu/opt-out checks. Full ESLint and both addon
validators passed. Cloud typecheck remains blocked by the absent generated
Prisma module; final combined results will be recorded in the handoff/PR. Live Discord and
Windows/game evidence belongs to the local owner's Claude acceptance session.
All existing published/held package bytes and publication holds remain intact.

### Current acceptance and release handoff

| Item | Backend/persistence | User flow | Scheduler/activation | Remaining evidence |
| --- | --- | --- | --- | --- |
| 3 | Saved preferences and atomic attempt reservations implemented | `/dungeon watch` Save/Status/Off/Matches; existing alerts panel links to it and preserves opt-out | Discord dispatcher implemented, no timer; flags false/null | Live configured delivery/permissions; audience/channel/cadence approval before any timer |
| 4 | Saved target, frozen scope and recalculated canonical progress implemented | Officer goal/season/metric/pause controls; private EN/FR progress and cosmetic completion | On demand; no recurring post or award | Live imported-run correction/dispute and edition-switch acceptance |
| 5 | Initial private recap handed off | Local integration owner owns final hub/report integration | No recurring activation here | Owner's final integration evidence |
| 6 | Initial sync/diagnostic helper handed off | Local integration owner owns truthful screen/diagnostic flow | No sender activation here | Owner's Windows, browser, backend and game acceptance |
| 7 | Saved plan, expiring actor-bound reviews and durable weekly occurrence implemented | Officer preview/Post/Skip/Pause; existing poll buttons record votes | Manual only; no recurring sender | Live private review, permission loss, vote and uncertain-outcome acceptance |

- [x] Focused policy, command, delivery, correction and SQL constraint tests: 45/45.
- [x] Full ESLint and both addon static validators.
- [x] Generated-Prisma TypeScript build on GitHub at `1b4c18c` (quality run 41039305182).
- [x] Feature-branch full CI including real PostgreSQL concurrency/restore rehearsal: run 41039305182 passed at `1b4c18c`.
- [ ] Local integration with recap/sync/safety fixes and Claude live acceptance.
- [ ] Explicit audience/channel/cadence approval before automatic targeted sends.

Cloud full-suite attempt: **239 files passed, 121 failed to load; 1,985 tests
passed and 11 skipped**. Load failures trace to the missing generated Prisma
module after the original checksum HTTP 403. Cloud `tsc` is likewise blocked by
that missing module and resulting type cascades. GitHub generation and typecheck
passed without changing or bypassing this environment's network restriction.

Quality run: https://github.com/kevincaron28/Guilded/actions/runs/41039305182.
Both Linux checks and Windows packaging passed. GitHub executed **360 test files,
3,065 tests, all passed**. The PostgreSQL step explicitly reports:
`Reviewed community PostgreSQL concurrency, deduplication and uncertain-delivery checks passed; no Discord calls.`
This verifies actual concurrent advisory-lock claims and unique reservations,
not only the serialized mocks/embedded SQL tests. The CI build includes this
feature branch against main; the local owner's additional integration changes
still need their own combined-source checks. Packaging success does not replace
live installation/game acceptance or authorize publication.

The local owner can fetch this branch and integrate commits after `a139204`:
`9e4e72a` (reported TS2345 correction), then `1b4c18c` (stored/reviewed flows).
Shared integration touch points are `prisma/schema.prisma`, `src/main.ts` (one
weekly-button route/import only), and `scripts/test-postgres.mjs` (one rehearsal
call). The continuation does not touch Companion, addon, pairing, privacy or
raid-core implementation files. Apply the migration and generate Prisma before
starting the combined backend; register updated `/dungeon` and `/poll` commands.
No client/addon protocol change is required.
