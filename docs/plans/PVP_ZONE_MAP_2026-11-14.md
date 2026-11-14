# PvP zone map (14 November 2026)

The interactive map on `/leaderboards/pvp/`: two continents, every zone drawn from the game's own coordinates, lit by PvP activity for the chosen period.

## How the geography works

- `src/services/pvp-zone-rects.ts` holds, per zone and capital city, the rectangle of its map on its continent map: `C_Map.GetMapRectOnMap(zone, continent)` read from the WoW Forever client on 14 November 2026 (`[minX, maxX, minY, maxY]`, fractions of the continent map). Zone identity is the map id (uiMapID 1411-1458), so French and English clients land on the same zone; only an older upload that has no map id is matched by its folded English or French name.
- Each continent is drawn as an SVG cropped to the zones' bounding box and a 2:3 portrait frame (`continentView`). Zones are drawn from their **own outlines** (`src/services/pvp-zone-shapes.ts`): simplified paths traced on 14 November 2026 from the zone land masks of the MIT-licensed OpenMap addon's geometry data, in a 1000 x 1000 frame placed on the continent through the zone's rectangle, plus one land path per continent from the game's sea mask (it fills the gaps and is looser than the zones). Only our own derived numbers are committed: no texture or picture of the game is stored or published; the trace sources stay outside the repository. Cities and any zone without an outline fall back to the rectangle. A soft blur-and-threshold filter joins the land into one smooth coast.
- An event with a zone position (zone map x, y as 0-1) is placed by `zonePoint(mapId, x, y)`, which converts it through the zone's rectangle. Tests: a known coordinate lands inside its zone and the frame; every catalogue zone has a rectangle; every zone box is inside the 2:3 view; each zone number on the map equals its table cell.
- Cities are their own small rectangles (1453-1458). Battlegrounds (1459-1461) have no rectangle and are not drawn; any unknown map id goes to the table only, with a `PvP map: unknown zone map id ...` log line so we learn the id.
- Painted art is only a background (`CONTINENT_IMAGES`, null today): `Guilded-Art\website-art\PVP_MAP_PROMPTS.md` has the prompts that paint over the true-shape references (`reference-*-v2.png`, exported from this same drawing, 1024 x 1536) without moving anything. The sea is always drawn under a painting; where the art drifts the SVG wins. Pictures: WebP under `site/images/pvp-map/`, one per continent, lazy-loaded, the file must exist when set.

## What it shows

- Heat = kills plus deaths in the zone as soon as any exist for the period; until then calls for help (the page says which). The tip shows the zone name and kills and deaths separately (or calls); the panel adds the guilds most active (counts only); the table repeats the numbers (zone, kills, deaths, total, calls).
- Calls for help are shown **by zone only** (privacy decision, 14 November 2026): the zone is lit and counted, guild counts per zone stay, but there are no dots, no per-call list, no subzone or date, and no position leaves the database for a call. Exact dots exist only for kills and deaths (`pvp-events` PR), and only on the zone whose map id the event carries.
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
