# In-game polish and navigation audit, 23 November 2026

Real client, WoW Forever, Guilded 9.5.3 (installed 12:21 local), officer character Lebowski Holyroller (Co-GM), Québec Gold.
Done by Claude through desktop control at the owner's request. Nothing was changed in game; no member was promoted.

## Passed

- `/guilded promote` opens Ready to promote with Copy command / Done rows, no blocked popup. Nobody was ready (every Initiate "waiting (needs link)"), so a real `/gpromote` paste is still owed.
- Ready to promote opens beside the main Guilded window without overlapping it.
- `/reload` with 9.5.3: no popup, no Lua error; the saved file went from 3,037,833 to 2,568,743 bytes (-15%).
- Crafting: reagents of a recipe never opened (Hot Lion Chops) show from the shipped list.
- Guild overview, Duels, Dungeon boards (My season, Guild board, Runs) all load with real data.
- Diagnostics: the only refusal on record is `C_GuildInfo.Invite (Invite button)` at 10:00 UTC, before 9.5.2 was installed (9.5.2 no longer calls it).

## To fix (9.5.4), most visible first

1. **Ready to promote covers Roster admin.** Both open in the same right-hand slot; opening one while the other is open hides it. Place the promote panel beside Roster admin, or reuse one window.
2. **Crafting "have" count shows `?`** (`?/1 Lion Meat`) instead of the number in your bags. Count bags (and bank when known) by item id; show `0` rather than `?` when none.
3. **Dungeons window opens behind the main Guilded window** (left side, buttons hidden). Raise it to the front, or close or shift the main window.
4. **"Season: Season 1"** in the Runs list (duplicated word). Show "Season 1".
5. **Officer › Gear table truncates every number** ("53...", "50..."). Widen the Level and iLvl columns.
6. **Raids › Open raids shows a raw timestamp** "2026-11-23T17:26:33.499Z". Show "today 12:26" like the other tabs.
7. **Standings tab lists 15 players at EP 0 / GP 0 / PR 0.00.** When nobody has EP, show one line ("No EP/GP recorded yet") instead of an alphabetical list of zeros.
8. **My season "Best next improvement" line is cut off** ("Hover for the scen..."). Wrap it.
9. **Tooltips cover the tab buttons** they belong to (Duels, Dungeons, My season). Anchor them below or right.
10. **Diagnostics output lands at the bottom of Settings** under "Modules", easy to miss. Show it in its own box at the top, or open the problems window.
11. **Layer: "Auto-invite layer requests" is ticked on this PC.** The owner's rule is off by default. Check that 9.5.0 (#1253) did not leave `true` saved for people who loaded it; reset it once if so.

## Navigation

- **Dungeons tab** is a page with one button that opens another window. Open the dungeons window directly from the sidebar.
- **Officer** has two rows of sub-tabs (Gear, Calendar, Administration / Local guild, Roster admin, Officer tools). Roster admin is again a page with one "Open roster admin" button. Merge into one row and open tools directly.
- **Home** repeats the companion links and "Link to Discord" help even when linked, and still offers "Pick a raid core / Run a raid / Give loot / EPGP" although raid loot tools are not used. Hide companion help once linked; move the raid buttons to the Raids tab.
- **Settings** is one long page (Digest on/off, Names on/off without explanation, companion links again). Group it into short sections with one line of help each, and drop the duplicate companion links.
- **Two close buttons** on the dungeons window (X and Close). Keep the X.

## Save file

- 2.57 MB after the 9.5.3 trim. The largest remaining parts are per-run dungeon detail (boss kills, encounters, intervals, integrity). A cap or a trim of confirmed runs' detail after a week would cut most of the rest.

## Still owed (needs a situation, not a click)

- A real `/gpromote` paste when a member is ready (the bot rule: linked character, 7 days at Initiate, 3 h of voice).
- Raid boss detection: the first raids open 9 December.
- Season 2 routes: once the real boss ids are known.
- Invite copy box: when someone asks for an invite.
