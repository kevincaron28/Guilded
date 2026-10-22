# Raider.IO comparison and Guilded dungeon scoring recommendations

22 October 2026. Research and source review of the local Guilded 7.3.1 checkout; no production database inspection, score changes, season activation or deployment. Recommendations below are proposals, not accepted product decisions.

## Recommendation

Keep Guilded's best-run, per-character foundation. Prioritize consistent eligibility, frozen public season rules, credible targets and useful improvement guidance before changing the score formula. Guilded measures recorded team speed within level bands; it does not yet have retail's escalating keystone difficulty or a server-authoritative result feed. Its score should not be described as individual skill.

## What to learn from retail Raider.IO

| Retail principle | Application to Guilded |
| --- | --- |
| Best result from each dungeon contributes; repeat runs do not accumulate rating | Already implemented. Keep it; participation rewards remain separate. |
| Difficulty and completion time both matter | Guilded checks a configured difficulty ID but has no equivalent keystone ladder. Do not invent one or import retail's numerical scale. |
| Role-specific scores and an overall score | Public role filtering already selects matching player-run records before aggregation. Extend this into explicit tank/healer/DPS profile views and addon tooltips; do not sum role totals together. |
| The contributing dungeon results explain the total | Already partly present. Add next-time targets, exact potential gains and clear best-N replacement explanations. |
| Season history and population context | Keep archives; add rules identity and trustworthy sample counts before percentile badges. |

Raider.IO's [character-scoring FAQ](https://support.raider.io/kb/frequently-asked-questions/how-do-you-rank-characters-for-mythic-plus) describes best-per-dungeon aggregation and separate role scores. Its [base-score table](https://support.raider.io/kb/frequently-asked-questions/what-is-the-base-score-value-for-each-level-keystone) shows difficulty-dependent base values with time adjustments. Its [score-colour FAQ](https://support.raider.io/kb/raider-dot-io-mythic-plus-addon/what-are-the-different-colors-that-correspond-to-rating-for-raider-dot-io) describes population percentiles.

Source caution: Raider.IO's [2021 announcement](https://raider.io/news/245-raiderio-and-the-new-mythic-rating-system-what-to-expect) records adoption of Blizzard's rating and explicitly describes the then-current Tyrannical/Fortified combination. Its older [run-ranking FAQ](https://support.raider.io/kb/frequently-asked-questions/how-do-you-rank-mythic-plus-keystone-runs) still describes an exponential curve. These are not interchangeable current formula specifications. This review uses the durable design principles; it does not assert a verified October 2026 retail formula or propose copying the old two-affix model.

## What Guilded already does

The current time formula is `clamp(round(200 * targetSeconds / durationSeconds), 50, 400)`, followed by any applicable overlevel penalty. The best eligible result per route contributes to a character's best-N total. Slower repeats do not lower it; corrections and invalidations can.

Rules v6 support the agreed brackets: 15-29/best 5, 30-44/best 5, 45-59/best 4, and 60/best 8. However, the current provisional factory includes only brackets with enough observed routes: 15-29 and 30-44. Supporting level 60 in the schema does not mean launch endgame routes are ready. Version 5 separately supports strict level-60 routes with encounter evidence.

Guild scoring checks individual presence of at least 80%, recorded party level ranges, route/difficulty requirements and season bounds. Version 6 normally permits up to three levels above a route's band with a 10% penalty per level. Boss records and account participation rewards are separate. Public profiles, role filters, confirmation labels, weekly boards, season history and the addon score panel already exist.

Evidence: `src/services/dungeon-rating.ts`, `dungeon-november-rules.ts`, `dungeon-bracket-season.ts`, `public-score.ts`, `public-leaderboard.ts`, and `docs/DUNGEON_SEASON_BRACKETS.md`. The older documents describe earlier models; source takes precedence for current behavior.

## Highest-value improvements

### 1. Make public and guild eligibility equally credible

The public path currently has weaker evidence than the guild path:

- `public-runs.ts:checkPublicRun` checks completion state, time plausibility and uploader membership, but does not require `completedBy === "final boss"`.
- `summarize` drops individual `presentSec`, `minLevel`, completion method and the encounter checklist after extracting the public route key. Consequently `public-score.ts:scoreRun` cannot enforce the guild's full presence, minimum-level and route-evidence policy.
- Public agreement compares duration, end time and overlapping character names; it does not compare route, difficulty, levels or completion evidence. Multiple agreeing uploads increase confidence, but are not authoritative anti-cheat.

Recommendation: retain the evidence needed for competitive eligibility and use a shared evaluator returning both eligibility and reason codes. Distinguish accepted activity from a ranked result. Historical rows lacking evidence should remain visible with an explicit status rather than receiving invented evidence. Keep party confirmation as a trust badge, not a score multiplier. Distinguish independent player reports from the same report arriving through guild and personal uploads.

This is a source-level finding, not a claim that actual public standings have been exploited.

### 2. Freeze public scoring rules by season

`publicRules()` caches `provisionalSeasonRules().rules` from the current code. Public profile history recalculates old runs through that current rules provider. There is no season-specific rule argument in those default history calls. A future catalog or target change can therefore change past public ratings after a deployment.

Guild seasons already retain their own rules and frozen final ratings. Give official public seasons an immutable rules snapshot and identifier too. Share the evaluation engine, while preserving the distinction between a public season and a guild's custom season. Show the scope and rules version when the two scores differ.

Also fix aggregation before public adoption grows: `prismaLeaderboardStore` currently retrieves only the fastest 5,000 public runs, latest 500 character runs, or latest 2,000 guild runs before calculating ratings. Once those limits are reached, valid personal bests can disappear from the input; global selection also favors shorter dungeons. Compute complete per-character/per-route bests in the database or a maintained projection, then paginate display rows. This is a latent scaling risk; this review did not measure production volume.

### 3. Improve calibration before making scores more elaborate

The provisional recalibration flow allows an officer-selected target after three qualifying runs, and suggests their median. It does not require distinct crews or days. One crew can dominate that sample. The permission to enter a target is not constrained to the suggested median.

Target errors translate directly into score errors before rounding/caps: a target 20% too generous awards roughly 20% too many points. Best-N selection then favors the generous routes.

The flat 10%-per-overlevel penalty is also a design choice, not demonstrated power normalization. Measure whether penalized groups still systematically outperform in-band groups. Preserve the current social/helper behavior; consider a clearly separate strict in-band competitive view if launch evidence supports it, rather than guessing a stronger multiplier.

Proposed calibration policy, to validate with launch data:

- Require comparable route, difficulty, build and level-band evidence.
- Start with a review threshold such as 20 eligible samples, at least five substantially different crews and three days; these numbers are proposed guardrails, not established statistical guarantees.
- Limit a crew's daily influence; report sample spread and uncertainty, not only a median. The same population mix must be used across routes.
- Separate provisional calibration from official competition. Freeze competitive targets at the season boundary. If a serious correction is essential, publish a separate rules revision/competition segment.

The existing prospective recalibration deliberately preserves earlier scores. That avoids taking earned points away, but it can compare unlike conditions: a 25-minute run scores 240 under a 30-minute target and 200 under a 25-minute target. The earlier score remains the best even if the later run is equally fast. Keep this historical behavior intact; use a clearer policy for a future official season.

### 4. Make improvement actionable

Add a small "Best next improvement" section to the score panel/profile:

- Current route best, frozen target, selected bracket and whether the route counts.
- A target completion time and exact projected seasonal gain.
- Which route would be displaced from best N.
- Eligibility/trust status and a plain-language explanation when there is no gain.

Example under today's formula, without a penalty: target 30 minutes; current route best 180; a 25-minute run scores 240. If that route already contributes, the gain is 60. If it is a new route and the weakest of eight counted routes is 210, the gain is only 30. The planner must recompute the entire best-N selection, not subtract one route score blindly. A positive route improvement can still yield zero total improvement.

Compute exact time thresholds using the same integer rounding and penalty functions as scoring. Label suggested times as scenarios, not predictions of player ability. Existing announcements already contain score/record information; build on them.

### 5. Reassess the curve using real runs

Illustrative target of 30 minutes; no penalty:

| Clear time | Current points |
| --- | ---: |
| 40:00 | 150 |
| 30:00 | 200 |
| 25:00 | 240 |
| 20:00 | 300 |
| 15:00 | 400 |
| 12:00 | 400 |

Two tradeoffs need measurement. First, the curve increasingly rewards each second saved as runs get faster until the cap. Second, any run at half the target reaches the cap; further improvement is visible only in the time record. This may be intentional accessibility, or it may flatten serious competition too early.

Retain the formula for the next integrity-focused change. Replay real comparable runs offline against the current curve and alternatives: a bounded linear time adjustment, or a damped ratio such as `200 * sqrt(target/time)` with explicit caps. The latter would give approximately 283 instead of 400 at half-target time, but would also give slower clears more points. Neither candidate is a validated replacement.

Compare cap frequency, route selection concentration, rank changes, rounding ties and player-facing clarity. Change only in a newly versioned season after reviewing those results. Faster-time records can remain separate even when rating ties; do not compare raw seconds across different dungeons as a total-score tiebreaker.

### 6. Clarify breadth, roles and progression

Best eight from a large catalog gives players choice, but lets them skip difficult or poorly calibrated routes. A fixed eight-route pool creates stronger common comparisons and a clearer missing-dungeon checklist, at the cost of less freedom. Preserve the owner's existing best-N choice initially; consider a separate fixed-pool challenge after enough verified routes exist. Do not quietly replace the main board.

Expose existing per-run role filtering as visible role-specific profile totals, based only on runs in that role. Unknown roles remain unknown; a current specialization should not rewrite old runs. Show overall score, relevant dungeon experience and previous-season context together.

Use clear milestones and coverage badges first. Percentiles should specify bracket, season, rules, eligible population and sample size; hide them when the population is too small. Do not mix best-4, best-5 and best-8 totals in a single raw-score ranking. Do not introduce DPS/HPS points, extra death deductions, additive repeat-run points or speculative gear normalization into the primary rating.

## Delivery order and acceptance

1. **Integrity and history:** preserve public evidence, share eligibility evaluation, snapshot official-season rules, and calculate complete bests before display pagination. Highest priority; requires coordinated database/importer/companion work and backward-compatible handling of old runs.
2. **Player guidance:** best-N-aware improvement planner, explicit role profile views and consistent score explanations in English/French. Reuse current profiles and addon panels.
3. **Launch calibration:** verify missing routes and timer behavior, gather diverse samples, freeze official targets. A standard start trigger must be specified and recorded: the addon currently starts on first observed combat or a manual start, and excludes pre-combat travel.
4. **Later scoring experiment:** replay alternatives, review outcomes, then introduce a separate rules version or optional fixed-pool challenge if justified.

Acceptance should include public/guild parity for equivalent rules and evidence; manual or insufficient-presence completions remaining unranked; old public seasons surviving target/catalog changes unchanged; personal bests surviving histories beyond current query limits; duplicate confirmations not inflating confidence; exact best-N improvement math with ties/penalties; role switching; season cutoffs; and real-client tests for first combat, manual starts, replacements, reconnects and route completion.

Offline checks cannot establish what the launch client actually observes. Follow `CLAUDE.md` for full validation and release gates; after shared dungeon Lua changes, sync the standalone addon with `npm run dungeons:sync`. Do not change existing season results as part of this analysis.

## Validation of this analysis-only change

Only this report was added. On 22 October 2026, TypeScript checking, ESLint, both addon static validators and the full Vitest suite passed (255 files, 2,152 tests). Tests used shell-only placeholder service credentials. No application code, scores, settings or product versions were changed. The test pass establishes the existing offline baseline; it does not prove the proposed changes or real-client behavior.

## Implementation status

Item 1 (integrity and history) was built on 22 October 2026 on branch `feat/public-score-integrity`:

- Public runs keep their evidence (completion method, boss kills, start levels, presence). Ranked
  results use the guild seasons' check (`dungeon-rating.ts` `bracketedVerdict`, `completionReason`,
  `presentEnough`, called by `public-score.ts` `rateRun`), and tests compare both paths on the same runs.
- Unranked runs stay visible with their reason. Rows uploaded before the change keep the older
  check and are labelled; no evidence was invented for them.
- Each official season freezes its public rules when it starts (`OfficialSeason.rules`). It can still
  gain routes and brackets that did not exist (the level-60 launch routes), but no existing target,
  band, best-N or penalty can change until the next season.
- Confirmations count independent reports: a guild copy and the same member's own upload count once.
- Boards and profiles read every matching run in pages of 5,000, sorted after loading, in place of
  the fastest-5,000 / latest-500 / latest-2,000 limits.

Not done in that change: a database-side best-per-route projection (whole reads are fine at today's
volume; build the projection if a board's read becomes slow); comparing route, difficulty or levels
when two uploads are checked for agreement; replacing a run's stored evidence when a later
agreeing upload saw the final boss and the first did not (the first upload's evidence stays); and
items 2 to 4.
