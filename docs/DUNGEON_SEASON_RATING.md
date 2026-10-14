# Dungeon-time rating and separate boss records

Candidate on `codex/guild-dungeon-scores`, 13 October 2026. This supersedes the
100 + 20 proposal after the owner chose a wider dungeon-time rating and separate
boss records. No live reset, installation or deployment has happened. The bridge
checkout, installed addon, OfficerBridge.lua and SeasonSync.lua are untouched.
The worktree now has independent dependencies and its own generated Prisma client.

## New season scoring (version 3)

For an eligible run with benchmark T and duration t (seconds):

`score = clamp(round(200 * T / t), 50, 400)`

200 is the score at the dungeon benchmark, not an award for every completion.
The season total sums each member's best score per distinct instance ID. Linked
alts and repetitions share that slot. Slower repeats cannot reduce the total.
Boss times award no extra points: they have their own records, avoiding counting
the same time saving twice.

Illustrative benchmark 30 minutes (not a researched dungeon timer):

| Duration | Points |
| --- | ---: |
| 40 minutes | 150 |
| 30 minutes | 200 |
| 25 minutes | 240 |
| 20 minutes | 300 |
| 15 minutes or less | 400 |

No configured benchmark means zero competitive points and an explicit calibration
label. Recorded completions remain visible. Historical version 1 (100 distinct)
and version 2 (100 + 20) snapshots retain their original rules and totals.

## Carry protection

Version 3 requires a frozen per-dungeon minimum level, maximum level and difficulty.
Every recorded participant must have observed minimum and maximum levels within
that range, including outsiders and replacements. A high-level guest makes the
whole run unranked. Missing levels, wrong difficulty or missing configuration also
make the run unranked; the UI explains why. No retroactive guesses from a player's
current level. Addon observations are evidence, not cryptographic anti-cheat.
A character leveling during the run retains the lowest and highest observed levels.
Scaling is not inferred: effective-level scaling would need separate verified support.

Existing run eligibility also requires a valid automatic final-boss completion,
positive duration, at least 80% presence for the member, no simulation reference,
and start/end inside the season. Manual participation awards remain separate.

## Boss records and presentation

The importer now persists observed levels and encounter timestamps in nullable
DungeonRun.competitionData. A forward-only migration adds this JSONB field; old
runs have no evidence. Only successful encounters with a real start/end inside
an eligible run produce boss records. Kill-to-kill intervals are never fight times.
A member's fastest eligible boss kill can come from a different run than their
best full-dungeon score. Season finalRating freezes both when archived.

The game group finder has a Guilded scores button and addon-owned score pane with
per-dungeon cards, progress bars, current/past season navigation and boss tooltips.
A Guilded-window fallback opens the same pane. Guild rankings use the current game
roster. Old snapshots lacking breakdowns explicitly say unavailable.

The companion serializes detailed personal profiles and dungeon catalogs. Members
without the full snapshot request their selected season over the separate
GuildedRating prefix. Officer replies are targeted whispers with bounded chunks,
request nonces, sender checks, total/equation checks and bounded retries. The older
bridge and season protocols are unchanged. Old officers cannot serve new details.

## Benchmark calibration and research

Raider.IO sums the best run from each dungeon and adjusts scores for time and
keystone difficulty. Its retail score scale is not a direct fit for this beta:

- https://support.raider.io/kb/frequently-asked-questions/how-do-you-rank-characters-for-mythic-plus
- https://support.raider.io/kb/frequently-asked-questions/what-is-the-base-score-value-for-each-level-keystone

Update: the owner approved explicitly provisional targets for the short beta.
See [the researched preset and launch handoff](DUNGEON_BETA_PRESET_2026-10.md).
Its fixed design targets supersede the wait-for-calibration guidance below for
this season only.

The search found dungeon metadata but no verified, comparable full-run baseline
set for the current Forever beta. Do not ship invented Classic-to-Forever timers.
Suggested calibration policy: use a documented route/difficulty reference where
available, blend with the median of eligible guild samples from the same build
and level range, cap the guild weight at 50%, and freeze before the season.
Without a reference, gather comparable samples first. Cap repeated samples from
the same crew/day so farming cannot dominate. This calibration policy is a
recommendation, not an implemented automatic estimator. Baselines and level bands
still need verified inputs before a competitive season can be opened meaningfully.
DPS/HPS/tanking are deliberately outside the rating: raw totals reward different
roles, gear and opportunities, and the current data does not support fair comparison.

## October 22 fresh season and rollout

Owner authorized a fresh competition after this work, and allowed old results to
be erased. Proposed cutoff is end of 22 October 2026 in America/Toronto:
`2026-10-23T00:00:00-04:00` = `2026-10-23T04:00:00Z` (exclusive).
The season-start command accepts an explicit ends_at timestamp; rating queries
exclude finishes at/after that instant, and participation awards also respect it.
It does not automatically create a new season or destroy history on expiry.

Before executing the reset: verify the Quebec Gold guild ID, back up the database
and SavedVariables, preserve calibration evidence, configure verified targets and
level bands, and complete deployment gates. A new season starts its score at zero;
physical deletion is not necessary. Any removal of old displayed history must be
scoped to this guild's dungeon competition, never other guild or product data.
No live reset has been executed. The cutoff is prepared, not scheduled in production.

Officer configuration: `/dungeon admin target` accepts minutes plus min_level,
max_level and difficulty together; these copy into the next season's rules.
`/dungeon admin season-start` accepts name and ends_at with an explicit timezone.
Target/range edits do not retroactively move the goalposts in the current season.

Deployment requires the migration, bot, rebuilt companion and addon together.
The combined release now intentionally uses product version 6.1.0. Offline checks do not prove real-client UI layout,
level availability, encounter events or two-PC delivery. PostgreSQL migration/
restore CI, Windows packaging and real-client checks remain separate gates.

## Offline verification, 13 October 2026

- TypeScript: `npx tsc --noEmit -p .` passed.
- Full Vitest suite: 173 files / 1,424 tests passed (placeholder environment only).
- `npx eslint .`, addon static validation and `git diff --check` passed.
- Addon ZIP verified (41 files); browser companion build passed.
- Candidate ZIP: `dist/Guilded-dungeon-scores-candidate-2026-10-13.zip`.
- Added tests cover carry/unknown-level exclusion, ratio bounds, independent boss
  bests, legacy archives, detailed companion/relay data, level wire metadata and
  a finish exactly at the season cutoff.
- PostgreSQL migration/restore verification was extended but not executed here.
  No live client, deployment, reset or installation is claimed.
