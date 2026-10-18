# Dungeon season for all levels (rules version 6)

Item 3 of `docs/ROADMAP_REQUESTS_PLAN_2026-10-18.md` (PR #134). Built 18 October 2026.
Nothing here creates, activates or changes a season, and no targets are set.

## What version 6 is

`createBracketedDungeonRules({ routes, brackets })` in
`src/services/dungeon-november-rules.ts`. Version 5 (level 60 only) is unchanged
and still validated by `validNovemberRules`.

- `brackets: [{ key, min, max, bestCount }]`. Proposed default
  (`DEFAULT_DUNGEON_BRACKETS`): 15-29, 30-44, 45-59, 60, best 8 each. Brackets
  may not overlap; keys are lowercase (`15-29`).
- Each route has `competitionBand` (`{ min, max, difficultyId }`) when it is
  rated, and `null` when it is participation-only. The band must fit inside one
  bracket; `routeBracket` freezes which.
- Each bracket needs at least `bestCount` rated routes, or creation refuses.
- A stored rule set is valid only if rebuilding it from its own routes and
  brackets gives the same JSON.

## How the rating works

- A character's run goes into the bracket of **their own level during the run**
  (`competitionData.players[].level`). Rows are per character and bracket, with
  `bracket` and `bestCount` on each row, so an archive freezes each bracket.
- Ranked runs still need every participant inside the route's competition
  band, so a level-60 run on a 20-29 route is an unranked "Overlevel carry" and
  shows up (at 0) in the player's 60 row, never in the lower bracket.
- A character below every bracket gets no rating row.
- `/dungeon leaderboard` and `/dungeon season` have a `bracket` option
  (autocompleted from the season's rules). With no choice, the viewer's best
  bracket is shown; with no rows, all brackets (top 5 each).
- The hall of fame lists one champion per bracket.

## Owner decisions before a season can use it

1. Bracket limits (15-29 / 30-44 / 45-59 / 60?) and best-N per bracket.
2. Each rated route's competition band and difficulty.
3. Real timed runs for every target (the November catalog's targets are unset).
4. Whether the addon's season board should show brackets (it currently gets
   one profile per character and bracket, with no bracket label).
