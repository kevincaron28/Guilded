# PvP zone map (14 November 2026)

The interactive map on `/leaderboards/pvp/`: two continents, every zone drawn from the game's own coordinates, lit by PvP activity for the chosen period.

## How the geography works

- `src/services/pvp-zone-rects.ts` holds, per zone and capital city, the rectangle of its map on its continent map: `C_Map.GetMapRectOnMap(zone, continent)` read from the WoW Forever client on 14 November 2026 (`[minX, maxX, minY, maxY]`, fractions of the continent map). Zone identity is the map id (uiMapID 1411-1458), so French and English clients land on the same zone; only an older upload that has no map id is matched by its folded English or French name.
- Each continent is drawn as an SVG: the zone rectangles (largest first, so small zones and cities stay clickable), cropped to their bounding box and a 2:3 portrait frame (`continentView`). A zone map is the frame of the zone, not its outline: rectangles overlap and the game's API gives no outlines, so the shape is exact for position and an approximation for coastline.
- An event with a zone position (zone map x, y as 0-1) is placed by `zonePoint(mapId, x, y)`, which converts it through the zone's rectangle. Tests: a known coordinate lands inside its zone and the frame; every catalogue zone has a rectangle; the totals on the map equal the table.
- Cities are their own small rectangles (1453-1458). Battlegrounds (1459-1461) have no rectangle and are not drawn; any unknown map id goes to the table only, with a `PvP map: unknown zone map id ...` log line so we learn the id.
- Painted art is only a background (`CONTINENT_IMAGES`, null today): `Guilded-Art\website-art\PVP_MAP_PROMPTS.md` has the prompts that paint over the reference images (`reference-*.png`, exported from the same drawing) without moving anything. Where the art drifts the SVG wins. Pictures should be WebP, one per continent, lazy-loaded.

## What it shows

- Heat = kills plus deaths in the zone as soon as any exist for the period; until then calls for help (the page says which). The tip shows the zone name and kills and deaths separately (or calls); the panel adds the guilds most active and the recent calls; the table repeats the numbers (zone, kills, deaths, total, calls).
- Dots (yellow): where players called for help, at their real position.
- No JavaScript: server-rendered, CSS `:hover` / `:focus` for the tip, `:target` for the panel, under `default-src 'none'`. Period, class and level filters stay in the URL; class and level apply to kills and deaths, not to calls (a call carries no class or level).

## What the data can and cannot say today (checked in the code)

- The addon (`Modules/WorldPvP.lua`) keeps, per kill, the victim name, the zone text (localized) and the time; per death, the zone text and time. No map id or position.
- The companion (`exportWorldPvp`) sends only weekly totals and the last 30 victim names. So the server has **no per-zone kills or deaths** yet; only calls for help carry a map id and position.

## Next (owner decision: all PvP data is public)

1. Addon 9.3.2: store the uiMapID and the zone position of the player with each kill and death (reading `C_Map.GetBestMapForUnit` and `C_Map.GetPlayerMapPosition` only; never in a protected path).
2. Companion: send per-event rows in the world PvP export under a feature flag `pvp-events` that the bot advertises: `{ k: "kill" | "death", t: unix seconds, m: uiMapID, x, y }`, x and y as 0-1 fractions of the zone map rounded to 4 decimals (absent when the game gives no position, e.g. inside an instance). Bounded to the newest events; no enemy names beyond what is already sent.
3. Server (separate PR): `WorldPvpEvent` table (additive hand-written migration), the import field behind the flag, `zoneActivity` filled from it, dots for kills and deaths, and the privacy text.

## Pan and zoom (not built)

A script would need one self-hosted file and `script-src 'self'` on this page only. Propose separately if wanted.

## Later (not built)

The same map for dungeon entrances and for where guild members are.
