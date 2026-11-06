# Guilded 7.1.0 — Monthly dungeon seasons, weekly boards and new leaderboards

Feature release, October 19, 2026. Addon, bot, Windows companion and Guilded Dungeons move to
7.1.0; protocol remains 2. Two database migrations (additive; applied automatically on deploy).
In-game results are in the [checklist](V6_2_GAME_ACCEPTANCE.md).

## Monthly dungeon seasons

- The release season starts on **November 4**, then a new season starts every month. Seasons
  rotate automatically, keep their history and champions, and survive a bot restart.
- Officers turn it on per server: `/organize dungeon-seasons on first_start:2026-11-04 hour:<release hour>
  time_zone:America/Toronto`. `/organize dungeon-seasons preview` shows the next seasons;
  `off` stops the rotation. Nothing changes before the first start.
- Only brackets with launch data are rated (15-29 and 30-44 today; 45-59 and 60 once those
  dungeons have map data). Provisional targets and recalibrations carry over between months.

## Weekly and monthly leaderboards

- `/dungeon leaderboard period:` week, month or season. The week resets with the North American
  WoW weekly reset (Tuesday 15:00 UTC).
- In game, the dungeon score panel has a **Week / Month** switch next to the level bracket switch.

## New public leaderboards (inspired by Raider.IO)

- guilded.kcaron.top/leaderboards/: this week's best runs and top characters per level bracket,
  filters by season, week, bracket, dungeon, class, role and realm.
- Character pages with score, best run per dungeon, recent runs and score history; guild pages
  that rank members. Runs confirmed by their party get a badge. English and French.

## Checked

- Automated: TypeScript, ESLint, both addon validators and the full test suite, including season
  windows (daylight saving, no rotation before 4 November, restarts, opt-out, failed backup),
  weekly reset boundaries, the addon toggle and sync, and the new pages.
- To check in game: the Week / Month button's position in the score panel.
