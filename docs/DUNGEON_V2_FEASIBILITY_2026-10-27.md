# Dungeon integrity candidate: feasible launch boundary

**Current follow-up:** the impossible fresh-instance gate in the earlier
prototype described below has been replaced locally by an explicit
[native-observed candidate contract and four-blocker regression matrix](DUNGEON_FOUR_BLOCKER_REVIEW_2026-10-27.md).
Freshness is still unknown; current-v1 remains live/default. The API-source
research below remains valid. Earlier strict-v2 recommendations are historical,
not a claim that the new observed contract proves freshness or full-route coverage.

Local experimental candidate on `codex/dungeon-current-v2`; not activated,
published, installed or approved for merge. Live backend remains PR240/fefaa569,
including PR239's current-v1 scoring. No scoring curve change.

## Recommendation requiring Kevin's decision

Keep Season 1 on the current-v1 contract for launch testing. Present it as an
observed team-clear rating with provisional targets, not a fresh-instance
certificate, anti-cheat system, or measurement of individual skill. A missing
new observation must not invalidate a legitimate current-v1 run. Preserve raw
history and show explicit reasons when a run earns no official credit.

For 7.5.1, recommend the compatible observation capture, conservative unknown
handling, observer-dispute repair, reload clock preservation and evidence
retention **after review and real-client acceptance**. Do not activate strict
current-v2, its new calendar rules or its route requirement in Season 1 merely
because synthetic tests pass. The ten package builds are packaging validation,
not evidence that five live clients expose identical capabilities.

Proposed independent evidence axes, for approval before implementation:

| Axis | Values | Suggested scoring treatment |
| --- | --- | --- |
| Coverage | Partial / required checkpoints observed | Apply existing completion rules; only say full-observed for a reviewed checkpoint list actually observed. |
| Assurance | Single observer / independently corroborated | Same points, additional confidence label; no points multiplier. |
| Freshness | Unknown / specifically supported witness | Unknown remains compatible with current-v1. A full observed route is not proof of an untouched instance. |

These labels are recommendations, not implemented UI. Do not silently call a
nearby observation authoritative location or claim two uploads defeat cheating.
Fixed route pools, mixed-role overall-only ranking, and a 72-hour finality policy
can be separated into a prospective policy revision if Kevin wants them before
strict freshness is possible. That revision needs one consistent calendar,
eligibility and UI contract; it must not inherit the impossible freshness gate.

## What can be observed, and what remains unproved

The existing Forever adapter reads `GetInstanceInfo` for map/difficulty, game
combat/encounter events for timing, and participant identity/role/level APIs.
The existing Deadmines fallback uses encounter2747 in map36, documented in the
repository as previously observed by the owner. A positive test now exercises
this real adapter instead of replacing its completion function. Test globals
remain mocked: map36, difficulty0 (the recorded beta contract), level17, first
combat,1200seconds, encounter2747. It produces400points with the unchanged curve
and target2400, through both addon variants and the public/guild scoring path.
It retains `startWitness: unknown` and is correctly ineligible under strict v2.

The initial Classic Era comparison is superseded by direct inspection of the
actual `forever` branch. Its head on27October is
`ca8368f2f2380cbe696854f7f2646387c278a61b`, labeled **1.60.1 (70532)**,
dated 22 October 2026. The following declarations were read at that revision:
- [Forever Instance declarations](https://github.com/Gethe/wow-ui-source/blob/ca8368f2f2380cbe696854f7f2646387c278a61b/Interface/AddOns/Blizzard_APIDocumentationGenerated/InstanceDocumentation.lua)
- [Forever Unit declarations](https://github.com/Gethe/wow-ui-source/blob/ca8368f2f2380cbe696854f7f2646387c278a61b/Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitDocumentation.lua)
- [Forever Encounter declarations](https://github.com/Gethe/wow-ui-source/blob/ca8368f2f2380cbe696854f7f2646387c278a61b/Interface/AddOns/Blizzard_APIDocumentationGenerated/EncounterInfoDocumentation.lua)
- [Forever CombatLog declarations](https://github.com/Gethe/wow-ui-source/blob/ca8368f2f2380cbe696854f7f2646387c278a61b/Interface/AddOns/Blizzard_APIDocumentationGenerated/CombatLogDocumentation.lua)
- [Forever InstanceEncounter declarations](https://github.com/Gethe/wow-ui-source/blob/ca8368f2f2380cbe696854f7f2646387c278a61b/Interface/AddOns/Blizzard_APIDocumentationGenerated/InstanceEncounterDocumentation.lua)
- [Forever System declarations](https://github.com/Gethe/wow-ui-source/blob/ca8368f2f2380cbe696854f7f2646387c278a61b/Interface/AddOns/Blizzard_APIDocumentationGenerated/SystemDocumentation.lua)

These are Blizzard-generated declarations in a source mirror, not a live dungeon
test. This is Blizzard's Forever edition, not a private-server compatibility task.
The official edition landing page returned403 to this research fetch; no contents
were inferred from that response.

| Capability in Forever70532 declarations | Safe interpretation / next check |
| --- | --- |
| GetInstanceInfo: map/difficulty and instance metadata | Use existing adapter; no unique fresh-copy token is declared. |
| ResetInstances: no return contract | Calling it is not a success witness; do not automate resets for evidence. |
| Lockout total/completed encounters | Useful partial-state signal when available; zero bosses does not prove untouched trash. |
| BOSS_KILL, ENCOUNTER_START/END | Prefer native event coverage; verify delivery and IDs per route/build. END includes optional-to-our-parser extra unit-status data with creatureID; investigate bounded ID mapping without relying on combat logs. |
| IsEncounterInProgress / ENCOUNTER_STATE_CHANGED | Can mark attaching during an active fight; cannot establish earlier boss state. |
| PLAYER_ENTERING_WORLD login/reload flags | Record observation gaps; neither flag proves an instance reset. |
| COMBAT_LOG_EVENT and UNFILTERED marked restricted | Keep current Forever no-registration guard. The inspected file has no GetCurrentEventInfo declaration; that absence alone is not a claim about every global. |
| UnitInRange marked SecretReturns | Never compare or serialize protected results. Existing adapter returns unknown; remote-presence availability may be much lower than Classic Era. |
| UnitPosition returns mapID; UnitInPartyShard and UnitIsVisible declared | Possible supporting observations, not a unique dungeon-copy identity. Test behavior before adopting; never infer freshness from same map. |

A localized reset acknowledgment remains a research candidate, not a proven
binding between reset and subsequent entry. No automated reset, protected hook,
game-memory access, secret-value extraction or invented success event was used.

Presence capture currently records the local player inside a party instance,
and conservative visible/connected/checked-range observations for others.
Missing, out-of-range or protected results remain unknown. This can undercount
distant participants and cannot yet support a universal80% same-instance proof.
The two-PC Forever acceptance check must exercise distance, death, disconnect,
replacement and reload. Other editions need their own runtime checks.

Practical next design to investigate: each addon records its own local instance
presence and sends bounded intervals with observer identity and the original run
clock. Validate against the authenticated companion character, retain conflicting
reports, and union only explicitly overlapping intervals with provenance. This
could reduce dependence on another client's secret/out-of-range APIs. It is still
client-reported evidence, not authoritative anti-cheat, and is not implemented by
the current aggregate-seconds payload. Do not simply take max/sum from all uploads.

Every future capability record should include edition, interface, full build,
declared availability, observed availability and validation scenario. For this
review, Forever70532 is source-inspected only; other editions retain their separate
existing test status. No row may be promoted to live-verified from a declaration.

Strict v2 remains infeasible to activate now: no implemented real freshness
witness and no route marked `verification.fullRoute`. The synthetic native-reset
fixture tests a validator contract only. Do not present it as game evidence.

## Candidate repairs and their limits

### Addon reference patterns and provenance

The [DBM Forever package](https://github.com/DeadlyBossMods/DBM-Dungeons/blob/a311716f4122e1a23f1173b6cf30e56798916029/DBM-Party-Forever/DBM-Party-Forever.toc)
declares interface 16001. Its
[Durgen module](https://github.com/DeadlyBossMods/DBM-Dungeons/blob/a311716f4122e1a23f1173b6cf30e56798916029/DBM-Party-Forever/HallofThanes/DurgenDirgehammer.lua)
references encounter 3496 in zone 3065. This is a route-validation lead, not a
complete independently verified checkpoint catalog. No module code was copied.

[SavedInstances reset handling](https://github.com/SavedInstances/SavedInstances/blob/a0fd182d3d750aa6de4f0da0db8569dba4d530c9/SavedInstances/Core/Core.lua)
separates a reset hook and localized success/failure messages, but its history
generation also advances on reset intent and peer messages. A similar local
counter would not prove a new server instance. Future independently written
capture should distinguish reset-requested, success-message-observed and
peer-reported events, and retain the message source rather than promoting all
three to a fresh-instance witness.

Parent research additionally identifies DBM/BigWigs callbacks as optional
encounter hints, not independent observers: callbacks can echo native events or
peer synchronization. Details actor absence is not participant absence. No
third-party source/data copying, dependency, external log upload or credential
integration is part of this candidate. Any callback adapter needs its exact
supported version, license review and runtime tests first. Raider.IO Mythic+
tracking and unverified Forever log services are not a normal-dungeon evidence
dependency.

### Implemented repairs

- Removed equality comparison of local integrity observations from public clear
  agreement. Known contradictory clock/route/level/role facts still dispute.
  Every new upload retains its own evidence JSON. Presence seconds are not
  summed, nor is a best-of-observers fictional report constructed.
- Reload and delayed tick gaps retain the original wall clock and add unknown
  seconds. A slightly earlier peer start adds unknown time instead of falsely
  marking a reset. A peer start remains labeled peer, not promoted to locally
  witnessed first combat.
- All public fastest-player, dungeon-summary and explanation checks recognize
  v2 eligibility instead of special-casing only v1. Per-season import rating
  caching avoids doubling full-season calculations for a backlog.
- Public website role filters now use the same locked-role/mixed-role decision
  as guidance and standalone snapshots under v2. Mixed or unknown roles remain
  eligible for overall points; current-v1 archives retain reported-role behavior.
  Retail Mythic+ filters retain their separate native contract.
- V2 rotation enters CLOSING without awarding champions. A scheduler finalizer
  rechecks under the import/rotation guild lock at end+72h, snapshots results and
  upserts awards once. Empty seasons create no champions. Archive/addon status
  exposes the upload grace rather than prematurely saying finalized.
- Late public reports are stored as history-only after the v2 deadline, without
  changing canonical status, confirmation count or evidence. Arrival times are
  retained and v2 scoring enforces its original season window.
- A scheduled v2 end is synchronized on the rotation tick when moved/cancelled;
  current-v1 and legacy windows retain their existing policy.

Remaining candidate work before any v2 approval: stronger per-observer provenance
and safe peer evidence improvement; per-edition real-client capability tests;
scheduler/calendar mutation concurrency and stale
end-window review; positive nonempty finalization/race tests in PostgreSQL;
client-facing EN/FR grace/deadline explanations and old/new/mixed client tests.
The source still intentionally forces new official snapshots to current-v1.

Kevin's October 27 clarification makes native boss events the primary foundation;
optional addon callbacks or external data cannot override contradictory native
observations, supply a second witness for an echo, or become a qualification
dependency for supported native-positive captures.

Two implementation boundaries remain concrete blockers, not missing API facts:

1. Peer transport currently stores/merges a run without retaining who locally
   witnessed each checkpoint. A peer callback or relayed export cannot safely
   become an additional independent witness. Preserve local reports and source
   lineage before enabling richer merges; bounded intervals must share a run
   clock and observer identity. Do not replace this with max presence or a union
   of boss events presented as one observer's complete run.
2. Calendar scheduling/cancellation changes official rows separately from guild
   seasons. Rotation later repairs endsAt, leaving an ingestion/finalization
   race. The repair needs a shared transaction/lock order for calendar mutations,
   imports and finalization, plus exact-boundary PostgreSQL concurrency tests.
   A five-minute synchronization tick is not an atomic finality guarantee.

The minimal next reviewable change should address one of these boundaries at a
time. Neither requires changing the scoring curve or enabling strict v2.

## Validation record

Validation at code checkpoint 3d70300 on 27 October: 318 test files /2699 tests pass; TypeScript and ESLint pass;
both addon validators pass; all10 edition packages and browser companion build.
The disposable PostgreSQL migration/import and backup/restore rehearsal passes.
No remote CI exists for this unpushed candidate.

See ignored backups/v2-review-* logs for the exact outcomes. New regression
tests cover different observer evidence, native-API mocked positive captures in
both addons, reload unknown gaps, strict-v2 board rejection, exact72h boundary,
late contradictory reports and idempotent empty-season finalization.

Subsequent role-parity checkpoint: 319 files / 2,703 tests pass, including four
new mixed/unknown/locked/insufficient-presence cases across EN/FR web rendering,
guidance and standalone snapshots. TypeScript, ESLint and both addon validators
pass. Logs: backups/v2-role-parity-final-tests.log, -typecheck.log, -lint.log and
-addons.log. The final full run followed the participation-filter correction;
the earlier full-run log contains the regression failure. No addon source,
Companion payload or database schema changed in this parity follow-up.

Disposable PostgreSQL verification exercises actual Lua -> SavedVariables ->
Companion -> guild/public PostgreSQL -> web/standalone scoring, observer report
retention, old-role aliases and unchanged archive snapshots. It also applies the
additive migration and rehearses database backup/restore. No production migration,
run purge, score reset, community ledger change or client overwrite occurred.

Do not publish the unversioned local package output. A final reviewed7.5.1 change
must first incorporate current main's separate badge-visibility patch, select the
approved scope, bump coordinated versions, run exact-head gates and obtain the
pending merge/package/publication authorization.
