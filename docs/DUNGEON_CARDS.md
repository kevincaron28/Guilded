# Dungeon completion cards (9.1)

Every completed run now gets **its own post**: a rendered card image and a short embed. Before, one post bundled every run of an import.

- Builder: `src/services/dungeon-card.ts` (`dungeonRunCard`) makes the card definition; `score-card.ts` (`renderDungeon`) draws it. The definition is plain data, queued with the Discord job and drawn on delivery like the other share cards.
- Post: `src/services/dungeon-announce.ts` (`dungeonPosts`) returns one `{ embed, card, components }` per run; `announceDungeonRuns` in `import-followup.ts` queues them (also used by `/setup testraid dungeon`).
- Embed: time, final boss, guild deaths; guildmates tagged (no ping); a points line only above 0; ONE "Non classé ×N" line; outsiders with localized roles; records and achievements. No per-run rating boilerplate.
- **Chronologie** button (`dgtl:<run id>`, handled in `src/commands/dungeon-post.ts`) answers with the boss chronology privately. It needs `DungeonImportResult.runId`, set by the importer.
- Background art is generated (two colours, a silhouette motif and a seed per dungeon, `dungeonTheme`), never game art. Unknown dungeons get a stable theme from their name.

## Death heat map (not recorded yet)

The card draws a map under the party when its definition carries `dungeon.deathPoints` (0..1 coordinates, x right, y down). Nothing records positions today: the run schema (`dungeonRunSchema`) only holds a death **count** per player. To switch it on:

1. Addon: on each death of a party member (`PLAYER_DEAD` for self, combat log `UNIT_DIED` for others) record `{ t = seconds since start, x, y, map }` from `C_Map.GetPlayerMapPosition` (use the instance map id; indoors it can be nil, then record nothing).
2. Companion/bot: add `deathPoints` to `dungeonRunSchema` (optional, capped at 200, `.catch(undefined)` so it can never invalidate a run), keep it in `competitionData`.
3. Importer: pass the points to `dungeonPosts(summary, lang, { deathPoints: { [runRef]: points } })`, already wired as a hook.
