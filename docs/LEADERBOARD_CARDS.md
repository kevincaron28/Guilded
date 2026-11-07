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
| /stats server | `serverStatsCard` (stats-card.ts) | classes by count | bar, characters |

- Class colours for boards that only store a name come from `ladder-classes.ts`: it matches the full name, then the first name. An ambiguous first name gets no colour.
- With a card attached, the duel embed keeps only the top 3, and the battleground embed keeps only its summary. The dungeon board's embeds are unchanged, with the picture on the first one. When drawing fails or is busy, every board falls back to its old embed.
- Race to 60 now shows the top 50 by default. Migration `20270104000000_race_board_top_50` sets the column default to 50. It also moves every guild still at the old default of 25 to 50; an officer who picked 25 on purpose can set it again with `/race`.
- There are no "since yesterday" rank arrows yet: no board stores yesterday's ranks. The race card's arrow shows the levels gained this week, which the data does have.
- The Hall of Fame cards are unchanged.
- To regenerate the samples in `docs/cards/ladder-*.png`, run `npx tsx scripts/render-ladder-cards.ts [outDir]` (it needs the placeholder environment from CLAUDE.md).
