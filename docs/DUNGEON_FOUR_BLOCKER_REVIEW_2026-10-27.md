# Four-blocker candidate review

Local candidate only. No PR publication, merge, 7.5.1 release, installation or
production policy change. New official snapshots still default to current-v1.
The scoring formula is unchanged. Independent review and real-client acceptance
remain required; a passing mocked capture is not a game test.

## Contract correction

The earlier, unshipped current-v2 prototype required a native reset witness and
a fullRoute flag that no real capture/catalog could provide. That would make
all ordinary runs unrankable. The candidate now implements the requested
**native-observed** contract instead:

- Native ENCOUNTER_START/END and BOSS_KILL are the foundation. Successful native
  checkpoints must satisfy the season's existing route catalog and include its
  observed completion. Optional third-party callbacks are not dependencies.
- The report names its originating observer and records entry and local combat
  timestamps. Manual starts and late attachment do not qualify. A peer start may
  align within five seconds of observed entry; it is still labeled peer.
- Freshness remains unknown. Neither native kills nor a reset request proves an
  untouched instance. The old witness field is preserved for compatibility but
  is not promoted to proof or required for observed-run points.
- Catalog coverage and confidence are separate. Provisional addon-final-boss
  routes establish only their configured final-boss completion, not every boss
  or untouched trash. The website explicitly explains this in English/French.
- Participation uses bounded timestamp intervals, not sums/maxima of observer
  totals. Self reports are preferred for their player; otherwise compatible
  local observations can contribute. These remain client reports, not anti-cheat
  evidence. Mixed roles count overall, not toward a single-role ranking.

This is an explicit design change to an inactive prototype, not a retroactive
reinterpretation of a live/frozen v2 season. Activation requires a separate
reviewed decision. No live calendar or existing standings were modified.

## Finding → repair → regression

| Claude finding | Candidate repair | Specific verification |
| --- | --- | --- |
| 1. Observer integrity differences make public runs DISPUTED | `public-runs.ts` separates local observations from shared clear facts. `dungeon-observations.ts` validates comparable intervals, unions overlaps once, prefers self observations and retains observer/basis labels. Guild/public raw reports are retained. Relays carry the original observer; same-observer contradictory roles still fail. | `dungeon-four-blockers.test.ts`: both report orders, overlapping duplicates, 50 receipt-only echoes, mismatched clocks/editions, invalid intervals. PostgreSQL: both upload orders, two independently sourced player scores, relay remains two confirmations, retries award nothing twice. |
| 2. v2 can award nothing | `dungeon-integrity.ts` uses observed start provenance; `nativeCompletionReason` requires actual native completion/catalog evidence. Unknown freshness is allowed and explained. No fabricated fullRoute/reset flag. | Both shipped Lua variants with mocked native APIs produce positive observed-policy scores through real capture/Companion/parser. Removing native events or attaching late rejects credit. PostgreSQL imports the actual Lua-exported fixture. Default snapshot remains v1. |
| 3. Peer start/reload void normal copies | Clock remains intact; peer/reload gaps become unknown intervals. Only a recorded participant can adjust the peer start. A peer END just before local native completion retains that real native event without a second announcement. Relayed intervals are not misattributed to the local observer. | Both addon variants: two-second peer start, wipe, 120-second reload gap, peer END before native END, serialize/deserialize round-trip; observed credit survives and late attachment fails. PostgreSQL confirms upload-order parity and concurrent duplicate import behavior. |
| 4. Unscored v2 runs leak into public boards | Truthy evidence-policy filters apply to ranked characters and dungeon summaries; v2 role/participant filters use the same integrity decision as guidance and standalone snapshots. Policy explanation is displayed. | Actual EN/FR whole pages include the accepted dungeon record, exclude a rejected checkpoint run from records and filtered rankings, and display current-evidence/unknown-freshness notices. Separate mixed/unknown/locked/low-presence role tests cover web and standalone. |

Regression sources:
[four findings](../tests/dungeon-four-blockers.test.ts),
[role parity](../tests/dungeon-role-policy-parity.test.ts),
[reload/finality checks](../tests/dungeon-integrity-review.test.ts),
[PostgreSQL rehearsal](../scripts/verify-dungeon-observed-postgres.ts).

The PostgreSQL rehearsal also starts finalization concurrently with a transaction
holding the guild import lock, verifies nonempty champion snapshots are created
once, and confirms late reports cannot rewrite final ratings/awards. It does not
prove atomicity of the separate official-calendar mutation path.

## Validation at this checkpoint

- Full suite: 320 files / 2,711 tests pass (267.65 seconds).
- TypeScript, ESLint and both addon validators pass; shared Lua is synchronized.
- Disposable PostgreSQL migrations, actual Lua/Companion ingestion, both observer
  upload orders, relay deduplication, concurrent nonempty finalization, late
  history preservation and backup/restore pass.
- Logs: `backups/v2-observed-final-tests.log`, `v2-observed-typecheck.log`,
  `v2-observed-lint.log`, `v2-observed-addons.log`, and
  `v2-observed-final-postgres.log`. The earlier full-run log retains the now-fixed
  same-observer contradictory-role regression.
- No new ten-package/Companion release build or remote CI was performed for this
  checkpoint. No running verification command remains after checkpointing.

## Remaining review and gameplay boundaries

- Run the final full suite, static/addon checks and disposable PostgreSQL rehearsal
  on the final candidate; record exact logs/commit in the handoff. Rebuild both
  addon families and Companion locally without publishing a 7.5.1 asset.
- Independent review must check provenance, normalization across realm/edition,
  peer transport limits and clock comparability. Intervals outside their source
  run or clocks more than 30 seconds apart cannot be merged. No inferred clock
  offset or arbitrary max-presence fallback exists.
- Explicitly review mixed old/new evidence promotion and improved peer boss
  coverage. Old captures without provenance cannot be treated as new independent
  observations merely because a later client relays them. New schema/provenance
  positive tests do not yet close every mixed-version arrival-order case.
- This is not a completed attempt journal or new complete route catalog. Reset
  intent/result, bounded timeline history and missing route/build capabilities
  remain work in the [canonical launch checklist](DUNGEON_LAUNCH_PLAN_2026-11-04.md).
- Calendar changes still synchronize guild endpoints on a tick. Atomic calendar
  mutation/import/finalization and precise in-flight cutoff semantics need their
  own review and concurrency coverage before activating the new season policy.
- No real Forever run, two-PC acceptance or live test on another edition was
  performed. Confirm event IDs, native delivery, reload/death/distance/roles,
  old/new clients and both-installed suppression with consenting players.
- Full-source/standalone/Companion synchronization is implemented. Public current
  7.5.0 assets and installed clients remain untouched; no fresh-instance proof or
  all-five-edition gameplay guarantee is claimed.
- Broader diagnostic collection remains off pending redaction and explicit
  recipient/consent handling. The current `/report bug` also notifies officers.

The four-case regression matrix is evidence for review, not permission to merge
or publish. Do not close the release gate solely from a global test count.
