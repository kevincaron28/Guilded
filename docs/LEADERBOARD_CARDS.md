# Leaderboard cards (ladder layout)

Every ranking card is drawn by one layout in `src/services/score-card.ts` (`ScoreCard.ladder`, `renderLadder`), styled like a ranking site:

- A rank column with gold, silver and bronze medals for the top 3; the first place row is tinted gold.
- The name in its class colour, with an optional quiet second line.
- Right-aligned value columns. A `primary` column is drawn in gold, a `bar` column draws a progress bar, and a `move` column draws a green up or red down arrow.
- Zebra rows, plus a top-right line with the season (when there is one) and the update time in UTC (`ladderMeta`).
- One long board is split into two side-by-side panels when the names still have at least 170 px; otherwise it stays one full-width table. Several boards sit two per row. The image is as tall as its rows need.

| Board | Builder | Rows | Columns |
| --- | --- | --- | --- |
| Race to 60 | `raceCard` (race-board.ts) | top 50 by default (officers pick 10-50) | progress bar, level, levels this week |
| Guild duels | `duelBoardCard` (duel-board.ts) | top 25 | wins, losses, win %, best streak, current streak |
| Battlegrounds | `bgLadderCard` (bg-ladder.ts) | one panel per mode and bracket (up to 6), top 10 each | wins, losses, win %, games |
| Dungeon season | `dungeonSeasonCard` (dungeon-leaderboard.ts) | top 25 | score and dungeons when the season is rated, else points |
| Community leaderboard | `communityBoardCard` (community-leaderboard.ts) | top 25, the community season (last 4 weeks with no season) | Discord, dungeons, PvP, total; replaced the guild activity ladder on 14 November 2026 (docs/plans/COMMUNITY_LEADERBOARD_MERGE_2026-11-14.md) |
| Top crafters | `craftLadderCard` (craft-ladder.ts) | top 25 in #top-crafters | points (1 per finished craft), crafts in 30 days, main profession |
| /stats server | `serverStatsCard` (stats-card.ts) | classes by count | bar, characters |

- Class colours for boards that only store a name come from `ladder-classes.ts`: it matches the full name, then the first name. An ambiguous first name gets no colour.
- With a card attached, the duel embed keeps only the top 3, and the battleground embed keeps only its summary. The dungeon board's embeds are unchanged, with the picture on the first one. When drawing fails or is busy, every board falls back to its old embed.
- Race to 60 now shows the top 50 by default. Migration `20270108000000_race_board_top_50` sets the column default to 50. It also moves every guild still at the old default of 25 to 50; an officer who picked 25 on purpose can set it again with `/race`.
- "Since yesterday" arrows (`ladder-snapshots.ts`, table `LadderSnapshot`, migration `20270110000000_ladder_snapshots`): every refresh of the race, dungeon season, duel and battleground boards writes that board's ranks for the current UTC day. There is one row per board per day, rewritten through the day; ids are race character keys, member ids, or member id + character for a rated season. The card compares today's ranks with the latest earlier day and draws a "24h" column: a green ▲ with the places gained, a red ▼ with the places lost, "–" for unchanged, and "new" for an id that was not on that day's board. The first day draws no column at all. Each dungeon season and each battleground bracket is its own board. Rows older than 14 days are pruned on write, and deleting a guild deletes its rows. A failed snapshot only means no arrows on that refresh. The race card's "Week" column shows levels gained this week.
- The Hall of Fame cards are unchanged.
- To regenerate the samples in `docs/cards/ladder-*.png`, run `npx tsx scripts/render-ladder-cards.ts [outDir]` (it needs the placeholder environment from CLAUDE.md).
