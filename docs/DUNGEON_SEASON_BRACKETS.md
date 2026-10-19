# Dungeon season for all levels (rules version 6)

Item 3 of `docs/ROADMAP_REQUESTS_PLAN_2026-10-18.md` (PR #134). Built 18 October 2026.
Nothing here creates, activates or changes a season by itself; an officer starts the provisional
season below (7.0).

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

## Starting a provisional season (Guilded 7.0)

The owner decided on 18 October 2026 to "use provisional recommendations until real timed runs
exist". `src/services/dungeon-bracket-season.ts` turns the plan into version 6 rules using only
what the addon observes today. Officers (hidden `/officer dungeon` tools):

- `bracket-preview`: each bracket, its routes, level ranges, targets and best-N, all labelled
  provisional, plus what is left out and why. Nothing starts.
- `bracket-start name starts_at ends_at [rotate]`: explicit window with time zone. With a season
  active it refuses unless `rotate:true`; then the normal `startSeason` rotation archives it in one
  locked transaction (standings and rating frozen, runs and points kept). `starts_at` may be later
  than now (runs before it do not count); it may not be in the past.
- `recalibrate route [minutes]`: without minutes, the route's real ranked timed runs this season
  (in-band groups only) and their median as a suggestion. With minutes, needs at least 3 such runs.
  The change is stored as `recalibrations: [{ dungeonKey, targetSec, from, runs }]` and applies to
  runs that **end** at or after `from`; an earlier run keeps the target it was earned under, so no
  earned score changes (the best per route still compares those frozen points). Only a season with
  a `provisional` block can recalibrate; any other season keeps fixed targets until the next one.

### What is real and what is provisional

| Part | Source | Status |
| --- | --- | --- |
| Map IDs | `BETA_DUNGEONS` keys, reported by real beta-client runs; Armory and Cathedral use map 189 like the other Scarlet wings | Observed |
| Difficulty | 0, reported in real exported beta runs (`docs/DUNGEON_BETA_PRESET_2026-10.md`) | Observed (beta client) |
| Completion | Addon's final-boss detection from the Encounter Journal (`completionModel: "addon-final-boss"`), as in the beta seasons; Scarlet wings by their last boss's English/French name (`SCARLET_WINGS`), which the addon now also uses for Armory and Cathedral | Observed rule; no encounter IDs |
| Level ranges | Plan: beta client ranges clipped to the bracket, or estimates | **Provisional** |
| Targets | Plan: beta design targets, or estimates | **Provisional** until recalibrated |
| Brackets | 15-29 (best 5) and 30-44 (best 5) only | 45-59 and 60 have no route with an observed map ID, so they are left out: characters at 45+ get no rating row in this season |
| Waiting | 16 planned dungeons with no observed map ID (new dungeons, 45+ dungeons) | Listed in `provisional.waiting`; their runs are kept but unrated ("Dungeon route unknown") |

`provisionalTargets` is true while any rated route is still on its starting target. The leaderboard
and `/dungeon season` (title and a note), `/dungeon rules` (a field, `*` on each provisional
target) and the addon score panel (note, `*` after the target) show it.

## Still open

- Real launch data for the 45-59 and 60 brackets and the new dungeons: map IDs, then a new season.
- Real timed runs to replace the provisional level ranges (targets can be recalibrated in-season).
- In game: Armory and Cathedral final-boss detection, and difficulty 0 at launch.

## Monthly seasons (built 19 October 2026)

Owner, 19 October 2026: "a new season starting November 4th for release and then a season a month".
`src/services/dungeon-season-schedule.ts`; officers use `/organize dungeon-seasons preview | on | off`.

- Off by default: a guild opts in with `on` (options `first_start` YYYY-MM-DD, `hour` 0-23,
  `time_zone`; defaults 2026-11-04, 0, America/Toronto). `off` stops rotation and keeps the current season.
- Season 1 runs from the first start to the 1st of the next month at the same hour; then one season
  per calendar month ("Season 2 · December 2026", ...). Daylight saving is handled per time zone.
- A job in `src/main.ts` checks every 5 minutes. Before a season's start nothing changes: the current
  (beta) season stays active and unarchived. At the start it takes a backup
  (`backups/seasons/`, 24 kept), then rotates with the normal locked `startSeason` (standings, rating
  and champions frozen; runs and points kept). The guild's leaderboard post is refreshed.
- Idempotent: if the active season started inside the current window (this job, a restart, or an
  officer by hand) nothing happens. A month the bot was entirely down for is skipped.
- Rules carry over: an all-level (version 6) season passes its routes, brackets, provisional block
  and recalibrations unchanged (a recalibration's `from` is before the new start, so it applies to
  every run of the new month; recalibrating again needs 3 runs in the new month). Any other season is
  followed by the provisional plan above.
- `bracket-start` with a future `starts_at` still archives at once; use the schedule for a future start.

Owner decisions still open: the start hour and time zone (default midnight Toronto).
