# Guilded 6.6.0 — Guilded Lite, dungeon brackets and spreadsheet copy

Feature release, October 18, 2026. Addon, bot and Windows companion move together to 6.6.0;
protocol remains 2. No database migration.
In-game results are in the [checklist](V6_2_GAME_ACCEPTANCE.md).

## Hosted bot: Guilded Lite

- A server that adds the hosted bot now gets **Guilded Lite** right away instead of waiting
  with nothing. Lite includes `/setup start` (language, roles and channels), `/help`,
  `/mod faq`, `/report bug`, `/dungeon group` and basic `/raid` signups.
- When the owner approves the server, every command appears without inviting the bot again.
  Sync, EP/GP, seasons and the public guild page stay for approved servers.
- The owner's request DM and the server's greeting explain what Lite includes, in English
  and French. A Lite server that stays unused is warned, then the bot leaves it.
- `HOSTED_LITE_LIMIT` (default 50; `0` keeps the old "no access until approved") is separate
  from `HOSTED_GUILD_LIMIT`. Details: [HOSTED_PILOT.md](HOSTED_PILOT.md).

## Dungeon seasons for every level (prepared, not active)

- Dungeon rules version 6 rank characters in level brackets: 15-29, 30-44, 45-59 and 60, each
  with its own best runs and leaderboard. A run counts in the bracket of the character's level
  at the time.
- A group 1-3 levels over a dungeon's range loses 10% per level; 4 or more levels over is a
  carry and scores 0.
- `/dungeon leaderboard` and `/dungeon season` get a `bracket` option. In game, the score panel
  opens on your bracket and a button switches brackets; tooltips and `/guilded score top`
  follow the bracket.
- **No season uses this yet.** Provisional level ranges and target times are shown in
  `/dungeon catalog`; real timed runs and launch data are needed before a season is started.
  Version 5 seasons work as before. Design: [DUNGEON_SEASON_BRACKETS.md](DUNGEON_SEASON_BRACKETS.md).

## Addon: copy tables into Excel or Google Sheets

- `/guilded sheet standings|loot|attendance|raids|dungeons` shows a table in a copy box.
  Press Ctrl+C, then paste into Excel or Google Sheets: each value lands in its own cell.
- A **Copy for Excel** button on the Standings page does the same for the standings.

## Support Guilded

- A link to [Guilded's Ko-fi page](https://ko-fi.com/wowguilded) in the bot's `/help`, the
  companion's footer and the addon's Settings page. Guilded stays free; nothing is behind a payment.

## Roadmap

- [ROADMAP.md](../ROADMAP.md) lists the features requested on 18 October 2026, with a build plan
  for each in [ROADMAP_REQUESTS_PLAN_2026-10-18.md](ROADMAP_REQUESTS_PLAN_2026-10-18.md).

## Checked

- Automated: TypeScript, ESLint, the addon validator and the full test suite, with new tests for
  the spreadsheet copy, Lite tiering and approval, and bracketed ratings and penalties.
- Live bot: a new test server joined Lite, saw only the Lite commands and received the owner DM;
  approval was then tested on the same server.
- Not checked in game yet: `/guilded sheet`, the Copy for Excel button and the bracket view of the
  score panel.
