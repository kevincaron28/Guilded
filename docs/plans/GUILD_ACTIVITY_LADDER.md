> **Retired 14 November 2026.** The separate ladder was merged into the community leaderboard (`docs/plans/COMMUNITY_LEADERBOARD_MERGE_2026-11-14.md`). `services/guild-activity.ts`, `/stats activity` and `/stats activity-board` are gone; the stored switch, message id and `activity:*` snapshots stay readable. This note is history.

# Guild activity ladder

Owner request, 7 November 2026: "Add duel points to guild dungeon participation points and make a common participation points
leaderboard that also includes BG participation points, with a dedicated channel maybe?" Status: built in one PR (this plan travels with it).

## What it is

One "Guild activity" ladder that adds up, per member:

| Source | Points | Weekly cap |
| --- | --- | --- |
| Dungeons | the member's dungeon season points, unchanged (the ledger in `DungeonPointTransaction`; a completion is 50 by default) | none (the dungeon rules already limit repeats) |
| Battlegrounds | 15 per consented report, +5 for a win | 300 per member per reset week |
| Duels | 5 per counted win, 2 per counted loss | 100 per member per reset week |

- **Why these weights:** a battleground game takes about half the time of a dungeon, so it is worth about a third of a completion;
  a duel takes a minute or two, so it is worth a few points. Losses still count (it is participation, not skill). The caps stop
  farming on top of the existing duel caps (5 per pair per day). The weights are printed in the card's footer.
- **Only counted duels** (the duel caps already applied), **only consented battleground reports** (status PROVISIONAL, like the
  battleground ladder), **only active members**. A duel against someone who left still counts for the one who stayed.
- **Each board keeps its own numbers.** The dungeon, duel and battleground boards are unchanged, and this ladder awards and stores
  nothing: it reads the three sources on every refresh. Season points stay what they were.
- **Community (Discord message) points are not included.** They are a separate Discord score with a spendable balance, shown in
  the 🏆 leaderboard channel; mixing chat activity into an in-game ladder would make both harder to read.

## Views

- **Season** (the posted card): the active dungeon season, or the last four weeks when there is none. Top 25, columns Dungeons,
  Duels, BGs, Total, and the "since yesterday" arrows from #532 (snapshot board `activity:season:<season>`).
- **This week**: from the Tuesday 15:00 UTC reset, like the dungeon week. The embed always shows the week's top 3 next to the
  season's top 3; `/stats activity:This week` draws the week card privately.

## Where it posts: no new channel

One message, edited in place every 30 minutes and at startup, in the **dungeon leaderboard channel** (else the duel ladder
channel). Reasoning: every Forever server already has that channel from `/setup`, it is where members look for standings, and
dungeon points are most of the total. A dedicated channel would add one more channel to `/setup`'s layout for a single message.
The dungeon board's cleanup only removes its own panel titles, so the two messages live side by side.

## Switches (rule 5)

On by default. Officers: `/stats activity-board:false` (or `server.activityBoard` in the companion). The message stays when it is
turned off. `/stats activity` works either way and never moves the public arrows.

## Files

- `prisma/migrations/20270117000000_guild_activity_board/`: `GuildSettings.activityBoardEnabled`, `activityBoardMessageId`.
- `src/services/guild-activity.ts`: points, card, embed, loading and the live message.
- `discord-jobs.ts` (`ACTIVITY_BOARD`), `main.ts` (startup and 30-minute refresh), `commands/stats.ts`, `companion-hub.ts`.

## Later

- Refresh right after a duel, battleground or dungeon upload (today: within 30 minutes).
- Officer-tunable weights, if the defaults feel off after Season 1's first weeks.
- A public website view of the same ladder.

## Still needs a real client

Seeing the card in kevmister28's Discord (never in Québec Gold).
