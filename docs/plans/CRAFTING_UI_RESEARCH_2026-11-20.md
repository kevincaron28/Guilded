# Crafting tab UI research (20 November 2026)

Owner feedback: the Crafting tab "is a lot better" but needs polish and easier navigation. This note
records what other crafting addons and Blizzard's own UI do, and what Guilded took from them.
Findings come from public listing pages and guides (web search summaries, not in-game testing), so
treat feature lists as indicative.

## What was looked at

| Source | What it does that helps navigation |
| --- | --- |
| [Skillet-Classic](https://www.curseforge.com/wow/addons/skillet-classic) | A larger replacement profession window; sort and filter options; a crafting queue; a shopping list of missing reagents; skill-up chance shown per recipe. |
| Blizzard Crafting Orders (Dragonflight and later; [Warcraft Wiki](https://warcraft.wiki.gg/wiki/Crafting_orders), [Wowhead guide](https://cn.wowhead.com/cn/guide/professions/creating-work-order-crafting-station-dragonflight)) | The "Place Order" side copies the Auction House layout: a scrolling category list on the left, a search box on top, favourites, and a detail pane that opens on a click. Orders are Public, Guild or Personal; the crafter side filters by profession, skill level and reagents. |
| [Who Can Craft](https://www.curseforge.com/wow/addons/who-can-craft) | Scans recipes when you open a profession, syncs them across the guild, lets anyone see who can make an item, one-click craft request by whisper. |
| [GuildCrafts](https://www.curseforge.com/wow/addons/guildcrafts) | `!gc` commands in guild chat, so people without the addon can still ask. |
| [GuildWorkshop](https://www.curseforge.com/wow/addons/guildworkshop) | A lightweight directory with an "LF Crafter" button that posts the request. |
| [Guild Recipes](https://www.curseforge.com/wow/addons/guild-recipes), [GuildCraftSync](https://www.curseforge.com/wow/addons/guildcraftsync) | Recipe sync into one guild-wide directory. |

Not confirmed from public pages: a search bar or favourites in Skillet-Classic, and an Auctionator
crafting tab (no such listing was found).

## What makes them easy to navigate

1. A list that always scrolls (mouse wheel plus a scroll bar), never one that truncates with "and N more".
2. A category tree on the same list (profession headers that expand), with a position indicator.
3. Search that filters as you type, no button needed.
4. Filters as toggles (for example "has a crafter online") next to the search box, not separate modes.
5. Favourites and recently used items first, labelled in words or with a clear star.
6. A stable detail pane: title, sub-line, materials, who can make it, then the action button.
7. One obvious primary action per recipe (Request / Place Order / LF Crafter).
8. Tooltips on every icon-only control.

## What Guilded already had

Sub-tabs (Request, My requests, Craft for the guild), search as you type, Favourites and Recent,
profession groups, "Crafter online now" filter, detail pane with reagents and crafters.

## What the 20 November polish changed

- The recipe list scrolls: mouse wheel over the list, page buttons on the right, and a
  "Showing 15-28 of 120" line. Opening a profession moves it to the top. Searches keep up to 80 matches.
- The cryptic red `*` became a readable "Fav" button (gold when kept) with a tooltip; the detail
  pane has a "Favourite" button instead of a star.
- A recipe title that wraps no longer overlaps the profession line; the lines below start under it.
- "Crafter online now" shows a checkbox style `[x]`/`[ ]` and a tooltip.
- The reagents hint is one short sentence.

## Possible later work

Breadcrumb or "back to all recipes" row, a "Can craft myself" filter, remembering the expanded
professions, keyboard navigation (arrow keys) in the list.
