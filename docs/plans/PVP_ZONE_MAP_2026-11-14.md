# PvP zone map (14 November 2026)

The interactive map on `/leaderboards/pvp/`: two continents, one marker per zone, lit by PvP activity for the chosen period.

## What it shows today

- Both continents as inline SVG, one marker per catalogue zone (38 zones keyed by the game's map id, `src/services/pvp-zones.ts`, English and French names).
- Heat = **calls for help** in the zone (the page says so). Marker size and colour grow with the count; zones with no activity are faint dots.
- Hover or keyboard focus on a lit marker: a tip with the zone name and numbers. Tap or click: jumps to `#zone-<id>`, a details panel (`:target`) with the numbers, the guilds most active there (links) and the recent calls (date, subzone, guild). A plain table of the same numbers sits under the map (phones, screen readers).
- Period: this week or the last 4 weeks (`?period=week|all`). The class, level and mode filters stay in the URL.
- No JavaScript: server-rendered numbers, CSS `:hover` / `:focus` / `:target`. Works under `default-src 'none'`.

## What the data can and cannot say (checked in the code)

- The addon (`Modules/WorldPvP.lua`) keeps, per kill, the victim name, the zone text (`GetRealZoneText`, **localized**: a French client sends French names) and the time; per death, the zone text and time. No coordinates for kills or deaths.
- The companion (`exportWorldPvp`) deliberately sends none of that: only the weekly totals and the last 30 victim names ("no enemy name, class or zone list leaves the PC"). So the server has **no per-zone kills or deaths**.
- What the server has per zone: calls for help (`GuildHelpCall`: zone, subzone, `mapId` (the language-independent uiMapID), x, y, continent). A French name and an English name land on one zone through the map id; a call without a known map id is matched by its folded English or French name; an unknown zone appears in the table only.
- The page and the data model already carry `zoneActivity` (kills and deaths per zone with class and level): when it exists the heat becomes kills + deaths + calls, the tip, panel and table show all three, and the class and level filters apply to kills and deaths. Calls for help carry no class or level of the caller, so those two filters do not change the calls.

## To light up kills and deaths (owner decision, not in this change)

1. Companion: send the zone of each kill and death (with the map id, which the addon would add to the saved record) in `exportWorldPvp`: a companion release and a Store submission.
2. Server: a `WorldPvpZoneWeek` table (guild, member, week, map id, kills, deaths), the upload schema, and `zoneActivity` filled from it.
3. A privacy line: the zone of a kill or death is where a member was.

## The picture

`docs/` has no art. The prompts for three original hand-painted images (one per continent and a combined one) are in `Desktop\Guilded-Art\website-art\PVP_MAP_PROMPTS.md`. Once approved: put the files under `site/images/pvp-map/`, set `CONTINENT_IMAGES` and move each marker in `src/services/pvp-zone-positions.ts` (x, y as a percent of the picture). Until then the markers sit on a neutral dark background.

## Pan and zoom (not built)

A script would need one self-hosted file and `script-src 'self'` on this page only. Cost: a wider policy for one page and one more file to keep safe. 38 zones do not need it. Propose separately if wanted.

## Later (not built)

The same map for dungeon entrances and for where guild members are.
