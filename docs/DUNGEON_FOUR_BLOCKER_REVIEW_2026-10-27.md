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

## Follow-up to independent review of 3bc67fc

The local branch now includes live main `fefaa569` through merge `3c3ff7e`.
Quebec Gold badge visibility and the existing access restrictions are retained.
The following are candidate repairs requiring independent review on the new head:

| Exact finding | Repair | Regression evidence |
| --- | --- | --- |
| Earlier incomplete observer replaces a qualifying start; an encounter without native provenance overwrites a native checkpoint | Reconciliation selects an intact qualifying observer's start against the combined clock. Native checkpoints win over otherwise compatible unknown-source copies. Raw reports remain separate. | Both input orders with an earlier peer missing combatAt remain eligible; native checkpoint remains native. Both full/standalone peer tests cover legacy-first, new-first, same-origin richer coverage and rejection of cross-observer splicing. |
| A later observer's newly eligible member gets rating but no participation award | Duplicate reconciliation continues through the existing eligibility and weekly-budget award path, excluding the same run from its history. Existing rule-ledger recipients are skipped under the guild lock. | Disposable PostgreSQL: each upload order gives both members 75 participation points and firstBlood; identical retries and richer checkpoint revisions give no additional points or firstBlood. |
| Same uploader/run ID and known guild publication refs suppress compatible evidence revisions | Production public storage compares evidence facts, retains bounded raw revisions with receipt times, reconciles compatible revisions and never adds a confirmation for that uploader. Guild publishing revisits provenance-bearing runs and publishes original reports, not reattributed derived intervals. | Disposable PostgreSQL: v1 and provenance-less v2 to native, and reverse order, through direct same-uploader requests and the real guild publisher; one upload row per uploader, no extra confirmation, original revision retained, identical publisher retry does nothing. |
| Dungeon summary accepts a clear with no eligible participant | Run-level current-v2 scoring requires at least one player with 80% known presence, matching character/top-run eligibility. Uncredited raw history remains stored. | EN/FR whole-page records include only the eligible run and a count of one when an otherwise valid low-presence clear is also present. |

Calendar writers now take an edition-specific exclusive transaction lock and
publish official schedule and active v2 guild endpoints atomically. Imports,
public revisions, rotation and finalization use the shared calendar lock before
touching dungeon state. Writers never acquire a guild advisory lock. Stale
rotation ticks reread the authoritative calendar inside their transaction.
Stored season boundaries override copied explanatory windows. Closed/finalized
rows are not reopened or rewritten by calendar edits.

The disposable PostgreSQL rehearsal tests a calendar writer queued behind an
import, schedule/cancel endpoint consistency, and a stale rotation after cancel.
Existing nonempty import/finalizer and exact-deadline tests remain. Finalization
winning the guild lock makes later evidence history-only, including an upload
whose request began before the deadline; there is no durable pre-lock reservation
of an upload slot. This ordering must be communicated in release guidance.

Fresh builds produced and verified ten local edition archives and the browser
Companion bundle. They retain version 7.5.0 as unpublished candidate artifacts;
do not overwrite public 7.5.0 downloads with them. Logs are
`backups/v2-followup-packages.log` and `backups/v2-followup-companion.log`.

Remaining acceptance: independent exact-head rereview and CI, real-client
event/capability validation for each edition, two observers and both-installed
suppression, and Companion acknowledgement/reload behavior for enriched reports.
No real game session or client installation was performed. Cross-observer peer
checkpoints are deliberately not pasted into a local source report; independent
observers must upload their own reports for reconciliation. A complete persistent
attempt journal, complete reviewed route catalogs, and expanded privacy-safe
diagnostics are still separate unfinished launch work. Current-v1 stays default.

## Residual P1 repairs after review of 6f306008

These repairs are a separate local candidate; they do not activate current-v2.

| Finding | Candidate repair | PostgreSQL regression |
| --- | --- | --- |
| A later low self-observation removes rating eligibility but leaves earlier participation points and firstBlood | `dungeon-evidence-awards.ts` reconciles positive and negative weekly eligibility under the existing guild/calendar locks. It appends compensating ledger rows, preserves manual awards, and reallocates the unchanged weekly budget to eligible clears. Achievement rows are retained with an audited revocation or a genuinely eligible fallback source; member shelves exclude revoked projections. Finalized and legacy award sources remain unchanged. | Both observer arrival orders, with the second eligible run arriving before or after correction: first run nets zero, the next gets 75, the third gets 25; an unrelated manual 7 remains. firstBlood is revoked or moves to the eligible second run without deleting its row. Identical and richer retries add no ledger or audit churn. |
| A late revision marks its whole uploader row history-only and can remove timely evidence from a later rebuild | `public-runs.ts` stores canonical eligibility on each retained revision. The uploader flag means it has no timely revision. First uploads and revisions check the trusted clock after calendar/run locks; an earlier request timestamp does not reserve admission before grace expires. | Timely native A, late changed A, then incomplete B with pre-cutoff receipt but post-cutoff admission: A's original revision remains eligible, late revisions stay history-only, and the complete canonical row is unchanged and still scores. A first upload admitted after grace is also history-only and unranked. |

The executable cases live in `scripts/verify-dungeon-residual-postgres.ts`,
called by the existing Lua/Companion/observed-run database rehearsal. The
additive migration `20261125230000_dungeon_achievement_revocation` adds nullable
`revokedAt`; it does not delete ledger or evidence history. It must be applied
before a future deployment of this candidate. Rolling back the application to
older code requires care: older member-shelf code does not filter revocations.
No migration has been applied to production.

The broader rehearsal also exposed a pre-existing wall-clock fixture failure:
two test clears could straddle Tuesday 15:00 UTC and correctly receive different
weekly budgets. The verifier now fixes their position inside one weekly window;
the scoring formula and reset time are unchanged.

Remaining gates: independent exact-head rereview, remote CI, explicit publication
approval, and real-client evidence. These database tests use actual capture code
with mocked game APIs, not a real game session. Diagnostics work is held separately
and no broader error/report collection is enabled. Reconciliation currently reads
the guild's valid run history; larger-history performance should be measured
before expanding beyond the currently empty launch baseline.

### Cross-policy achievement reactivation follow-up

The shared `grantRunAchievements` path now reactivates a revoked achievement
when a genuinely eligible current-v1 completion qualifies. It updates the same
row using an atomic revoked-state predicate, records the previous/new source in
AuditLog, and returns a new grant only for the successful transition. It does not
filter-and-create a duplicate or rewrite an active historical award.
The disposable PostgreSQL regression imports a real v2 evidence downgrade,
then two concurrent imports of an eligible v1 completion and a retry. The original
achievement ID becomes visible, points are not duplicated, and exactly one
reactivation audit is written. This follow-up remains local and requires rereview.
