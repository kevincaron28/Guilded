# Dungeon exploration rating — 13 October 2026

Owner-selected model: all tracked dungeons, 100 per distinct dungeon per season,
with fastest times displayed separately. This implements the balance recommendation
from [the timeline analysis](DUNGEON_TIMELINE_AND_BALANCE.md) without inventing speed targets.

## Rules

- Each linked guild member earns 100 for each distinct instance ID. All characters
  belonging to that member and all difficulties share that one contribution.
- Repeating one dungeon 100 times is still 100. Clearing two different dungeons is
  200. More weeks, death bonuses, guild groups and manual point awards cannot inflate
  exploration rating. Equal ratings share rank and the season champion award.
- A valid, automatically completed run (`final boss`) and at least 80% recorded
  presence are required. Manual, abandoned, invalidated and `SIM-` runs do not count.
  Only runs started after the season begins qualify; old uploads cannot seed a new season.
- No speed bonus. This measures dungeon variety, not player skill or comparable
  difficulty. Fastest clears remain separate per dungeon/difficulty. There is no level
  restriction; easier tracked dungeons are deliberately eligible in the chosen pool.
- Existing participation points and their weekly reductions remain available through
  `/dungeon leaderboard metric:participation`. Run posts label them separately and show
  each member's exploration gain and total. `/dungeon player` shows both.

## Season integrity and rollout

The additive migration introduces `DungeonSeason.ratingRules` and `finalRating`.
Null rules retain the old behavior. New seasons freeze the version-1 rules above.
Ending a rated season freezes its complete rating, names, participation ledger totals
and participation configuration. Champions are determined by exploration rating.
Old seasons retain their original champions and points; no ledger is rewritten.
Officer invalidations recompute the active rating, but archived ratings remain frozen.
Rotation and invalidation use the same guild transaction lock as imports.

Deploy through the ordinary PostgreSQL/Windows CI, backup and ledger gates before
starting the owner's new season. Use `startSeason` with the expected previous season
ID so retries cannot rotate another season accidentally. Refresh the existing board;
it shows exploration first, fastest clears second, participation third. The addon feed
uses the same rating for new seasons without changing protocol 2 or version 6.0.0.

Validation includes repeat/alt/difficulty deduplication, partial presence, guild scope,
manual/SIM/pre-season exclusions, rating-versus-participation champions, frozen archives,
and PostgreSQL import/invalidation/archive/restore. Real-client acceptance remains a
fresh eligible dungeon followed by upload and inspection of the new post and rating.
