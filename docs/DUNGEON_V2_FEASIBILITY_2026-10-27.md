# Dungeon integrity candidate: feasible launch boundary

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

Proposed trust labels, for approval before implementation:

| Label | Meaning | Suggested scoring treatment |
| --- | --- | --- |
| Observed | One valid participant report meets the existing completion, levels, clock and recorded-presence rules. | Eligible under current-v1; no fresh-instance claim. |
| Corroborated | Independent participant reports agree on the clear's established facts. | Same points, additional confidence label; no points multiplier. |
| Provisional / incomplete | Missing completion, unknown start, partial route or insufficient required evidence. | Retain history and reasons; missing optional v2 fields alone do not demote current-v1. |

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

Primary UI source reference inspected on27October:
- [Instance API declarations](https://github.com/Gethe/wow-ui-source/blob/classic_era/Interface/AddOns/Blizzard_APIDocumentationGenerated/InstanceDocumentation.lua)
- [Unit API declarations](https://github.com/Gethe/wow-ui-source/blob/classic_era/Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitDocumentation.lua)

These are Classic Era source declarations, **not confirmation of the Forever
runtime**. Instance info identifies the map; the inspected declarations do not
provide a fresh-copy attestation. `ResetInstances` has no success return contract
there. Lockout information includes completed encounters; zero completed bosses
does not establish untouched trash or an unused copy. A localized reset chat
acknowledgment is a possible observation to investigate, not presently a proven
adapter that binds a reset to the subsequently entered instance. No automated
reset, protected hook, game-memory access or invented success event was used.

Presence capture currently records the local player inside a party instance,
and conservative visible/connected/checked-range observations for others.
Missing, out-of-range or protected results remain unknown. This can undercount
distant participants and cannot yet support a universal80% same-instance proof.
The two-PC Forever acceptance check must exercise distance, death, disconnect,
replacement and reload. Other editions need their own runtime checks.

Strict v2 remains infeasible to activate now: no implemented real freshness
witness and no route marked `verification.fullRoute`. The synthetic native-reset
fixture tests a validator contract only. Do not present it as game evidence.

## Candidate repairs and their limits

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
complete role-filter parity; scheduler/calendar mutation concurrency and stale
end-window review; positive nonempty finalization/race tests in PostgreSQL;
client-facing EN/FR grace/deadline explanations and old/new/mixed client tests.
The source still intentionally forces new official snapshots to current-v1.

## Validation record

Validation on27October:318test files /2699tests pass; TypeScript and ESLint pass;
both addon validators pass; all10 edition packages and browser companion build.
The disposable PostgreSQL migration/import and backup/restore rehearsal passes.
No remote CI exists for this unpushed candidate.

See ignored backups/v2-review-* logs for the exact outcomes. New regression
tests cover different observer evidence, native-API mocked positive captures in
both addons, reload unknown gaps, strict-v2 board rejection, exact72h boundary,
late contradictory reports and idempotent empty-season finalization.

Disposable PostgreSQL verification exercises actual Lua -> SavedVariables ->
Companion -> guild/public PostgreSQL -> web/standalone scoring, observer report
retention, old-role aliases and unchanged archive snapshots. It also applies the
additive migration and rehearses database backup/restore. No production migration,
run purge, score reset, community ledger change or client overwrite occurred.

Do not publish the unversioned local package output. A final reviewed7.5.1 change
must first incorporate current main's separate badge-visibility patch, select the
approved scope, bump coordinated versions, run exact-head gates and obtain the
pending merge/package/publication authorization.
