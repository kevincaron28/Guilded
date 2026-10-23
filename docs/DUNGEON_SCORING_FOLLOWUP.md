# Dungeon scoring follow-up

Implementation review, 23 October 2026. Deployment remains on hold. No product
version bump, database schema change, migration, season activation or target edit.

## Report agreement and evidence

Public uploads now compare route, difficulty, shared characters and realms, known
levels/roles, presence eligibility and compatible boss observations, in addition
to clock tolerances and party overlap. Conflicts mark a run disputed. Confirmation
counts remain a trust signal, never a score multiplier or proof against cheating.

A later final-boss observation can replace an incomplete observation only when
the clocks and whole party match, known player evidence is retained, and the new
boss list contains every previously observed kill. Replacement uses the coherent
new observation; it never manufactures a merged boss checklist. Disputes remain
disputed. A transaction lock rechecks current evidence/reporters before adding a
confirmation or upgrading evidence, including concurrent copies of one report.

## Provisional calibration

Future recalibrations require 20 crew/day samples, five substantially different
crews and three UTC days. Crews sharing at least 60% of their members are grouped
transitively; a connected crew contributes one daily median. Identified guild
accounts, when available, prevent alts from manufacturing new crews. These are
conservative review guardrails, not statistical guarantees or an anti-cheat system.

Only in-band eligible runs with at least three participants, 80% presence for
every participant, the latest observed game build and a recorded first-combat
start qualify. Addon, peer summary and companion export now retain build and
timer-start metadata. Manual, encounter-only, peer-origin and unknown starts
are excluded from calibration. Peer start messages retain their existing wire
format for old clients; their trigger is honestly recorded as unknown (`peer`).
The timer still excludes travel before the first observed combat.

The review displays the effective sample, build, crews/days, median and middle
50% range. That range is not a confidence interval. Officers may apply only the
rounded crew/day median (within the existing 5–120 minute bounds). Historical
scores keep their earlier targets; fixed official seasons cannot be recalibrated.
No targets change merely by installing this code.

## Checks and remaining evidence

`scripts/verify-public-evidence-postgres.ts` exercises atomic promotion, concurrent
report deduplication, player preservation and sticky disputes in an existing local
`guilded_release_test` database. It cleans its own fixtures and runs no migration.

Launch route IDs, real first-pull/final-boss events, two-PC agreement, reconnects,
replacement players and French-client rendering still need real-client checks.
Unknown historical metadata is not backfilled. Missing 45–59 and level-60 routes
are not invented. The current formula, best-N policy and old season results remain
unchanged; any alternative curve or fixed-pool challenge needs evidence and a new
season decision.
