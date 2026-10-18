# Dungeon season for all levels (rules version 6)

Item 3 of `docs/ROADMAP_REQUESTS_PLAN_2026-10-18.md` (PR #134). Built 18 October 2026.
Nothing here creates, activates or changes a season, and no targets are set.

## What version 6 is

`createBracketedDungeonRules({ routes, brackets })` in
`src/services/dungeon-november-rules.ts`. Version 5 (level 60 only) is unchanged
and still validated by `validNovemberRules`.

- `brackets: [{ key, min, max, bestCount }]`. Default
  (`DEFAULT_DUNGEON_BRACKETS`, owner's choice on 18 October 2026): 15-29 best 5,
  30-44 best 5, 45-59 best 4, 60 best 8. The lower counts are estimates from the
  usual level ranges of the catalog's dungeons; they can change before a season
  opens. Brackets may not overlap; keys are lowercase (`15-29`).
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
- Over-level penalty (`overlevelPenalty`, default 10% per level, up to 3
  levels): a group whose highest participant is 1-3 levels above the route's
  band still scores, minus 10% per level of that participant (a 20-29 route with
  a level-31 member scores 80%). It counts in the route's bracket, and the run's
  `penaltyPercent` is kept in the archive. 4+ levels above is an unranked
  "Overlevel carry" worth 0, shown in the player's own level bracket; a
  level-60 run on a 20-29 route is always that. Anyone below the band still
  makes the run unranked. Setting the penalty to 0/0 restores the strict rule.
- A character below every bracket gets no rating row.
- `/dungeon leaderboard` and `/dungeon season` have a `bracket` option
  (autocompleted from the season's rules). With no choice, the viewer's best
  bracket is shown; with no rows, all brackets (top 5 each).
- The hall of fame lists one champion per bracket.

## In the addon

- The companion writes `brackets` on the board and `bracket` on each profile
  and row (`companion/standings-format.mjs`).
- The dungeon score panel opens on the bracket of the player's current level
  and has a button that cycles brackets; cards, totals, the best-N note and the
  guild ranking follow the chosen bracket.
- Tooltips show the score for the target's level bracket, with its label.
  `/guilded score top` lists the top five of every bracket;
  `/guilded score top 60` lists one.
- Guild sync (`SeasonSync.lua`) sends brackets in a separate `BRACKETS` message
  after the board, like `DATES`, so clients before this change ignore it. The
  officer relay (`SeasonDetails.lua`) sends one bracket: the member's best.

## Decided (18 October 2026)

- Bracket limits: 15-29, 30-44, 45-59, 60.
- Fewer counted routes in the lower brackets (5, 5, 4; 8 at level 60).
- The addon shows brackets.

## Provisional plan (`src/services/dungeon-bracket-plan.ts`)

At the owner's request, a starting plan until real launch timings exist: every
catalog dungeon except Upper Blackrock Spire gets a bracket, a level range and a
target time. 16 come from the Forever beta (client level ranges, clipped to the
bracket, and the guild's beta design targets); the rest are estimates from the
usual Classic ranges, or the catalog's order for new dungeons. `/dungeon
catalog` shows it in a second message. `bracketPlanProblems()` checks it fits
the default brackets. It has no map IDs, encounter evidence or difficulty, so
it cannot become season rules by itself.

## Still open before a season can use it

- Real launch data: each route's map ID, required encounters and difficulty.
- Real timed runs to replace the provisional level ranges and targets.
