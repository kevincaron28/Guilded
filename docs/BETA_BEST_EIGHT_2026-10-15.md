# Best 8 beta phase

Owner decision: archive the existing beta rating and start a fresh beta phase,
ahead of the first official season planned for November 4, 2026. The exact official
start time and final rules remain to be set; this change does not schedule a launch.
This document describes candidate source until the deployment evidence confirms activation.

Model 4 is opt-in through `bestEightBetaRules()`. Legacy models 1–3 keep their
calculations. Existing archives, stored runs, participation transactions and
SavedVariables are preserved. Season rotation freezes the outgoing rating and boss
records using the existing locked transition. A stale expected-season ID fails;
the activation script detects an already active preset on retry.

## Rating

- All recorded participants must remain level 30 on normal difficulty ID 0.
  This is a guild competition rule, not a claim about official dungeon ranges.
- Eleven candidates are the existing October catalogue entries whose old bands
  included level 30. The five earlier leveling routes are participation routes.
- Each character keeps one best score per route. Sum only the highest eight:
  `clamp(round(200 * targetSeconds / durationSeconds), 50, 400)`.
- Eight target-time clears give 1,600; maximum 3,200. A ninth score of 240
  replacing an eighth score of 180 adds 60. Lesser scores add zero.
- Uncounted routes and independent boss records stay visible and are archived.
  Equal contributions use the route key deterministically to choose counted slots.
  Overall equal totals still share rank. No missing-route average or catch-up bonus.
- Existing validation, detected final boss, season boundaries, all-participant
  level evidence and 80% character presence remain required.

The eleven routes and timers are **provisional design choices**, not verified
population benchmarks. Only a few real guild runs exist in production. Current
telemetry does not reliably distinguish manual timer starts or establish a universal
all-required-boss route. This beta uses detected final-boss routes, explicitly allows
trash skips, and discloses these limits. Do not describe it as certified full clears.
Add automatic-start evidence and verified route checklists before an official
competition that requires those properties; do not infer them for old runs.

## Participation

Frozen model `weekly-variety-v1`: completion 50; first weekly completion gets +25
only when eligible for full participation. Second completion gets 25; later 0.
All other point bonuses are removed from this phase; record recognition stays.
Manual completion and simulations earn no participation. Minimum presence is 50%.
Original leveling bands govern participation independently of the level-30 rating.
Helpers above the leveling band get completion-only points when a linked in-band
member has at least 50% presence. Without such a member, helpers get zero.

One award per member per run, across alts; weekly counters are member + recognized
dungeon/wing, shared across difficulties. Tuesday 15:00 UTC reset. Existing valid
detected completions this week still count across the phase boundary. No ledger
reset, extra first-ever bonus, or automatic catch-up credit. Historical rows are
filtered using recorded evidence, never current character levels.

## Calibration and delivery

Collect eligible level-30 runs per build/route/difficulty; retain raw samples.
Use at most one median observation per crew per day, then balance crews equally.
Show sample count and unique crews. Treat fewer than five crews / ten crew-days
as provisional. Compare candidate medians, cap-hit rates and route completion
rates before freezing November targets. These thresholds are design proposals,
not implemented automatic recalibration. A material patch warrants a successor
phase; never rewrite this phase or archived scores.

Use `scripts/start-best-eight-beta.ts` in dry-run mode first, then with exact guild
name, expected season ID, verified backup path and `--apply`. No database schema
migration or product version bump. Republish the existing Discord scoring pin
through `scripts/publish-dungeon-scoring.ts`; `/dungeon rules` reads the active model.
No stable 6.1.2 download is overwritten. Updated client files are preview changes.

The owner confirmed the boss-fight timer works in game and requested it remain
hidden. The floating overlay is removed; encounter recording is untouched. Live
text is opt-in inside the opened Run tab. Reload is needed after local file update.

Regression coverage includes top-eight replacement/caps, independent alts,
outsiders and level changes, 80% presence boundary, frozen archive validation,
11-route PostgreSQL rotation/restore, participation awards, manual completion,
Lua model-4 relay validation and removal of the floating timer. Full release
checks and real-client acceptance remain distinct evidence.
