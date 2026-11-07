# Dungeon completion cards (9.1)

Every completed run now gets **its own post**: a rendered card image and a short embed. Before, one post bundled every run of an import.

- Builder: `src/services/dungeon-card.ts` (`dungeonRunCard`) makes the card definition; `score-card.ts` (`renderDungeon`) draws it. The definition is plain data, queued with the Discord job and drawn on delivery like the other share cards.
- Post: `src/services/dungeon-announce.ts` (`dungeonPosts`) returns one `{ embed, card, components }` per run; `announceDungeonRuns` in `import-followup.ts` queues them (also used by `/setup testraid dungeon`).
- Embed: time, final boss, guild deaths; guildmates tagged (no ping); a points line only above 0; ONE "Non classé ×N" line; outsiders with localized roles; records and achievements. No per-run rating boilerplate.
- **Chronologie** button (`dgtl:<run id>`, handled in `src/commands/dungeon-post.ts`) answers with the boss chronology privately. It needs `DungeonImportResult.runId`, set by the importer.
- Background art is painted procedurally, never game art (9.1 card redesign). `dungeonTheme` (`dungeon-card.ts`) picks a scene from the dungeon's English or French name; `dungeon-art.ts` paints it as SVG from layered gradients, silhouettes, mist and particles, seeded by the name so a dungeon always gets the same picture. Scenes: Wailing Caverns and Maraudon (living cavern: roots, glowing bulbs, still pool, spores), Ragefire, Blackrock and Krol'dok (magma river, red spires, embers), Deadmines (wrecked ship in a timbered cove), Shadowfang, Scarlet, Stratholme, Scholomance (keep on a crag: moon, bats, fog; Scarlet red, Stratholme burning), Stockade and Alcaz (brick gaol, barred window, chains, torches), Blackfathom, the Drowned City and the Sunken Temple (underwater ruins, light shafts, kelp), Gnomeregan (gears, pipes, toxic glow), Razorfen (brambles, tusks), Blackmaw Hold (forest), Uldaman, Shaper's Terrace and the Hall of Thanes (carved hall, rune disc, braziers), Ruins of Lordaeron and Dire Maul (broken city in mist), Excavation Site: Wetlands (dig in the marsh, rain, crane), City of Dalaran (spires under a violet ward), Zul'Farrak (desert ziggurat). Unknown dungeons get a generic peaks-and-gate scene in a hue from their name. Cards queued before 9.1 carry only a motif and are painted with the nearest scene.
- The party panel is frosted glass (the art behind it blurred and darkened); the left column and footer text get a soft shadow. Role marks are vector glyphs in one set (`roleGlyph` in `score-card.ts`): a shield (tank, blue), a cross (healer, green), crossed swords (DPS, red), each in a ring of its colour.
- Score column: a rated season shows each member's season dungeon score after the run (`ratingTotal`) with this run's gain (`ratingGain`, "+35") under it; without a rating, members who earned points this run show them ("+50"); with neither, no column. Outsiders have no score.
- Under the stats: "New guild record", "First guild clear", or "Guild rank N of M" from `DungeonImportResult.guildRank`, which the importer computes from the record-eligible clears it already loads for the record check (no extra query).
- Samples: `docs/cards/`, rendered by `npx tsx scripts/render-dungeon-cards.ts [outDir] [dungeon ...]`.

## Death heat map (not recorded yet)

The card draws a map under the party when its definition carries `dungeon.deathPoints` (0..1 coordinates, x right, y down). Nothing records positions today: the run schema (`dungeonRunSchema`) only holds a death **count** per player. To switch it on:

1. Addon: on each death of a party member (`PLAYER_DEAD` for self, combat log `UNIT_DIED` for others) record `{ t = seconds since start, x, y, map }` from `C_Map.GetPlayerMapPosition` (use the instance map id; indoors it can be nil, then record nothing).
2. Companion/bot: add `deathPoints` to `dungeonRunSchema` (optional, capped at 200, `.catch(undefined)` so it can never invalidate a run), keep it in `competitionData`.
3. Importer: pass the points to `dungeonPosts(summary, lang, { deathPoints: { [runRef]: points } })`, already wired as a hook.

## Real dungeon maps

The death map draws on `site/dungeon-maps/<slug>.png` (slug of the dungeon name, e.g. `wailing-caverns`) when the file exists, else on a plain grid. No map art is bundled: the game's own maps are Blizzard's, so the owner must decide where they come from (own screenshots/exports, or a licensed source) and drop the files in. Positions are 0..1 across that image, so crop each map to the area the addon's `C_Map.GetPlayerMapPosition` coordinates cover.

## Death positions (9.1, shipped)

Addon (`Modules/Dungeon.lua`, copied to GuildedDungeons by `npm run dungeons:sync`): on `PLAYER_DEAD` inside the run each client records its own position (`C_Map.GetBestMapForUnit` + `C_Map.GetPlayerMapPosition`, rounded to 3 decimals, with the uiMapID) in `run.deathPoints` (at most 60 per run; nothing is recorded when the position is unknown, 0,0, restricted or the API is missing) and tells the group with a separate `DPOS|run|name|x‰|y‰|map` message, which older clients ignore. Receivers keep only a player's own DPOS, for a player in that run, with valid ranges. Companion export (`lua-export-content.mjs`) sends `deathPoints` (validated, capped); the bot schema accepts them as optional and never invalidates a run over them; they are stored in `competitionData.deathPoints` and drawn on the card. A dungeon with several floors draws the floor with the most deaths. Run summaries shared with officers (`SUM`) do not carry positions; only the recorder's own export does.
