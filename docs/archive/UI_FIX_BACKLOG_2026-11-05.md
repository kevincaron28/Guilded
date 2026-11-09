# Addon UI fix backlog: in-game pass, 5 November 2026

Source: one read-only in-game pass in WoW Forever as Lebowski Holyroller (Guild Master, level 10),
installed addon **Guilded 8.4.2** (TOC in `_forever_/Interface/AddOns/Guilded`; the repo is 8.4.3).
`/console scriptErrors 1` was on throughout: **no Lua error dialog appeared**.
Nothing was sent, awarded, started or changed (the Send to Discord, Start raid, Award, Give and Roster
admin buttons were not clicked; `/guilded verify` was run with no code and only prints help).

Screenshots are in `docs/images/ui-backlog-2026-11-05/`:
[01 home](images/ui-backlog-2026-11-05/01-home.jpg),
[02 dungeons window](images/ui-backlog-2026-11-05/02-dungeons-window.jpg),
[03 guild embed](images/ui-backlog-2026-11-05/03-guild-embed-standings.jpg),
[04 portrait corner](images/ui-backlog-2026-11-05/04-portrait-corner.jpg),
[05 settings](images/ui-backlog-2026-11-05/05-settings.jpg),
[06 calendar](images/ui-backlog-2026-11-05/06-calendar.jpg).

Most pages live in `addon/Guilded/Modules/Minimap.lua` (panel, sidebar, embedded guild-window pages).
Coverage: standalone panel (Home, My character, Open raids, Ready, Raid, Loot, Settings), the
Dungeons window (Run, Season), Calendar, and the guild-window embed (Standings, Crafting, Availability,
Gear, Administration, Local guild, Roster admin, Officer tools). Guild tools (Home button) opens the embed.
Not opened: Roster admin window, Officer tools sub-windows, Guild bank/log, Backup.

| # | Where | What is wrong | Severity | Likely file | Suggested fix |
|---|-------|---------------|----------|-------------|---------------|
| 1 | Guild & Communities › Guilded (all pages) | **Confirmed.** The Blizzard portrait/emblem ring in the guild window's top-left sits half over the window corner, above the "Guilded" title; the dark panel backing starts at the host's top-left +8/-30 and the portrait (a host child) draws over/around it, so the ring looks clipped and the corner looks broken ([04](images/ui-backlog-2026-11-05/04-portrait-corner.jpg), [03](images/ui-backlog-2026-11-05/03-guild-embed-standings.jpg)). | major | `Modules/Minimap.lua` ~2068-2080 (embed anchors), 1859 (`ui.solidBack`) | Hide the host `PortraitContainer`/portrait while the Guilded page is shown (restore on leaving), or anchor the panel/backing at TOPLEFT -4,-4 so it covers the ring; keep the backing frame level above the portrait. |
| 2 | Guilded dungeons window (Home › Dungeons) | Same emblem problem: the green eye portrait overlaps the window corner **and the "Dungeons" heading** (letter "D" is covered) on both Run and Season views ([02](images/ui-backlog-2026-11-05/02-dungeons-window.jpg)). | major | `Modules/DungeonScorePanel.lua` ~470 (`PortraitFrameTemplateNoCloseButton`) | Use a template without portrait (`ButtonFrameTemplate` with `SetPortraitShown(false)`) or move the heading right by ~40 px. |
| 3 | Home › Dungeons button, Home › Guild tools button, Home › Calendar | Navigation is inconsistent: Dungeons opens a separate window and the standalone panel stays; Guild tools opens the Guild & Communities window and the standalone panel **disappears**; Calendar opens the Blizzard calendar frame with the whole Guilded panel replacing the month grid (Blizzard "November" arrows and Filter button peek out above it, [06](images/ui-backlog-2026-11-05/06-calendar.jpg)). Each opens at the top-left and overlaps the others. | major | `Modules/Minimap.lua` ~2031 (Guild tools), `Modules/Calendar.lua`, `DungeonScorePanel.lua` | Decide one rule (open as a tab in the panel, or always separate and the panel stays). At minimum keep the panel open, offset new windows so they do not stack on one corner, and give the Calendar page a title instead of showing Blizzard header chrome. |
| 4 | Standalone panel (all pages) | The panel is small (about 610x390 at this scale) and several pages are cramped while others (Home, Dungeons Run, Roster admin) are mostly empty. Pages needing more room (Settings modules, Local guild, Availability) scroll inside a short viewport. | minor | `Modules/Minimap.lua` ~1859-1901, window-size code ~2226 | Give the panel a larger default size or remember a user size; make the Window size +/- more discoverable (it is buried in Settings). |
| 5 | Settings | The module list scrolls but its last row is cut mid-button at the bottom edge ("Login digest", Turn off / Guild buttons clipped, [05](images/ui-backlog-2026-11-05/05-settings.jpg)); the scrollbar thumb is a tiny square and each wheel tick moves only a few pixels. | major | `Modules/Minimap.lua` ~1490-1500 (module rows), scroll frame ~1791-1794 | Clip the scroll child to the viewport with bottom padding, raise `SetVerticalScroll` step, size the thumb to content. |
| 6 | Settings | The help paragraph under "Window size" (Minimap button hidden... kcaron.top/support) wraps to the right edge and runs into the "Modules" heading with no spacing. Test tools (fake players) sit right above Window size with no separation from the real settings. | minor | `Modules/Minimap.lua` ~916-925 | Add a gap and width limit to the paragraph; group Test tools under a collapsible "Developer tools" heading. |
| 7 | Settings | The Officer and Test tools rows are shown to a Guild Master only in a flat run of 8+ buttons, including "Clear test data" with no confirm hint nearby. (Not clicked.) | polish | `Modules/Minimap.lua` ~905-915 | Put destructive test buttons behind a confirm and a lighter style. |
| 8 | Home | Large dead space between the "Right now" block and "Your gear check", and below the six buttons. "Pick a core with /guilded core <name>." shows a slash command and a literal `<name>` placeholder on a primary screen. The "Loot system" line is a long run-on. | minor | `Modules/Minimap.lua` (Home page builder) | Add a button for "Pick a core" (or link to Local guild); tighten line spacing; move the explanatory text to a tooltip. |
| 9 | Home / all standalone pages | The bottom-left "Unsent changes / Send to Discord" block shows on every page including pages unrelated to sync (Open raids, Calendar), with no hint what is unsent. | polish | `Modules/Minimap.lua` ~1560 | Show the count or a tooltip listing what is queued; hide it on read-only pages. |
| 10 | Sidebar (all pages) | The hover tooltip for a sidebar button (title plus a one-line description) covers the page content next to it: the first button on My character ("Check my gear"), the realm box on Open raids and the Ready column headers are hidden behind it (seen on every page in this pass). | polish | `Modules/Minimap.lua` sidebar buttons ~1870-1900 | Anchor the tooltip to the right of the panel or below the cursor; or drop it, the page header already shows the same text. |
| 11 | My character | Page header "My character" plus the "Me" button tooltip shows "Me / your gear check and attunements" (mislabelled: tooltip text is the page tagline, not the button). Gear check reads "Last check: PARTIAL Item level 3" with the raw status word in capitals. | polish | `Modules/Minimap.lua` ~1682 | Give buttons their own tooltips; show "Partly ready" like Home does. |
| 12 | Open raids | The Realm field is empty with no default (it should default to the current realm); role buttons (All roles, Tank, Healer, DPS) sit directly under it and are partly hidden by the sidebar tooltip; the empty state is explained ("Open raids need a fresh companion snapshot...") but is a dense line with no action button. Previous/Next are shown for a single page (1 / 1). | minor | `Modules/PublicRaids.lua` ~29 and its builder in `Modules/Minimap.lua` | Prefill realm; hide pagination for one page; add a "Website" call to action next to the message (the button exists far below). |
| 13 | Ready | Every row shows `?` in all six consumable columns plus "88%" and a green tick, with no legend; the player name truncates ("Lebowski Holyr..."); the "Why" column is empty. The page prints "1 ready, 0 with issues" yet 6 unknowns. | minor | `Modules/Ready.lua`, `Modules/Minimap.lua` ~1255-1284 | Add a legend ("? = not checked: needs a group"), widen the Player column, and use "n/a" instead of `?` when not in a group. |
| 14 | Ready | "Post to group chat" and "Ask everyone to check" sit next to Refresh as primary buttons. They send chat/addon messages; not clicked. | polish | `Modules/Ready.lua` | Confirm before posting to group chat (or disable when not in a group). |
| 15 | Raid | The attendance buttons (Present / Late / Absent) are partly hidden under the sidebar tooltip ("Attendance for the selected player" header overlapped); "Mark everyone seen present", "Start raid" and "Record kill" sit in the same dense block with no visual grouping. | polish | `Modules/Minimap.lua` Raid page builder | Space the groups, disable attendance buttons until a raid is active. |
| 16 | Loot | "No bidding running" appears twice (top and "No bidding, give it to the selected Player for Min GP") and "Dropped this raid / Nothing yet: epic items..." is small grey text. The item box says "click the box, then shift-click the item" with no example. | polish | `Modules/Loot.lua`, `Modules/Minimap.lua` | Merge the two status lines; show a visible placeholder in the item box. |
| 17 | Guild window › Administration | Footer says "Loot and GP bidding are on the Loot tab." but the guild-window embed has **no Loot tab** (Loot exists only in the standalone panel). The user is told to go to a place that is not there. | major | `Modules/Minimap.lua:393` | Say "Open /guilded and use the Loot tab" or add a button that opens the standalone Loot page. |
| 18 | Guild window › Roster admin | The page is a single full-width button named "Roster admin" under a heading "Roster admin", with no description of what it opens. | minor | `Modules/Minimap.lua:1326` | Add a one-line description and make it a normal-width button labelled "Open roster admin". |
| 19 | Guild window › Crafting | Large empty gap between the item box and "My professions"; the cooldown line ("No profession cooldowns are known. They are read when you open a profession window.") is a good explanation but looks like an error. | polish | `Modules/Recipes.lua`, `Modules/Minimap.lua` | Tighten vertical spacing; style the explanation as a hint. |
| 20 | Guild window › Availability | The page is longer than the window: the Mon-Sun heat map (24 columns) is cut off at the bottom and needs scrolling inside a short viewport; the scroll step is tiny and the thumb is a small square. | major | `Modules/Minimap.lua` ~993 (cells) and ~1791 (scroll) | Give embedded pages a taller default host or wrap the heat map into the scroll child with a proper scroll step. |
| 21 | Guild window › Local guild | Same scroll problem: step 3 "Add your raiders" is cut by the viewport edge; a stray line ("/guilded modules - turn optional parts...") overlaps the bottom of the viewport, and steps 4-5 are unreachable without many wheel ticks. | major | `Modules/LocalGuild.lua`, scroll frame in `Modules/Minimap.lua` ~1791 | Increase scroll step; clip the child frame properly; remove the stray help line or move it into the page. |
| 22 | Guild window › Gear | "Aethyria level 7 - item level 3 - today": item level 3 for every member looks like a bug or a fresh-character artifact; names are truncated to first names only while other pages use full names. | minor | `Modules/Minimap.lua` ~1682 gear list | Show full names and "ilvl" with "n/a" when no gear; check the average-item-level calculation for naked/low-level characters. |
| 23 | Guild window (on reopening) | Re-running `/guilded` while the guild window is open leaves it on the Chat tab, hiding the Guilded tab; the standalone panel and guild window overlap in the same screen area. | polish | `Modules/Minimap.lua` ~2031 | Open the guild window on the Guilded tab when it was the last tab, and offset the two frames. |
| 24 | All frames | `Escape` closes every Guilded and Blizzard window at once (guild window included); that is expected for UI panels but the standalone panel and Dungeons window do not close independently with their own Close buttons in some cases (the first Close click on the Dungeons window did not respond until the guild window was opened). | minor | `Modules/DungeonScorePanel.lua`, `Modules/Minimap.lua` | Register frames with `UISpecialFrames` once and make Close behave consistently. |
| 25 | Linking (`/guilded verify`) | There is **no in-panel entry point** for linking: Home, Settings and the Guild tools do not mention linking or `/guilded verify`; it exists only as a slash command and a line in `/guilded help`. A bare `/guilded verify` prints: "In Discord, use /character pair, copy the /guilded verify line it shows and paste it here." (the "here" means chat, not a field.) | major | `Core.lua:1747-1769` (command), `Modules/Minimap.lua` Home/Settings | Add a "Link to Discord" row on Home with a paste box and status ("Linked / not linked") that calls the same function; show the saved state in Settings. |
| 26 | `/guilded help` | Help output is a long wall of chat lines; the last entries (`/guilded options`, `setup`, `modules`) wrap awkwardly and are partly cut at the chat frame edge. | polish | `Core.lua:1514` area | Group help into short sections, or open a help window. |

## Summary

- 26 issues: **0 blocker, 8 major** (#1, #2, #3, #5, #17, #20, #21, #25), **8 minor**, **10 polish**.
- Lua errors: none seen (scriptErrors was on).
- Installed addon version: 8.4.2.

## Not covered (needs a follow-up pass)

Officer tools sub-windows (Guild event log, Guild bank, Prospects, Imports, Speed report), Roster admin
window, Backup/Officer setup/Guilded setup windows, Battleground card, window drag/resize, French and other
locales, `/guilded options` page, and any state with an active raid or bidding.

## Status after the fix batch (branch claude/gallant-borg-cf32dd)

Code-complete and covered by `tests/lua/` where layout logic is testable; **every visual item still needs
an in-game re-check** (the Lua harness cannot see overlap or clipping).

| # | Status | Note |
|---|--------|------|
| 1 | fixed | Host portrait/emblem hidden while the Guilded page shows, restored on close. |
| 2 | fixed | Dungeons heading starts right of the emblem in the finder. |
| 3 | partly | Calendar page starts at the top edge with its own Close; each Home button says where it opens. Windows are not staggered. |
| 4 | partly | Window size - / + now in the title bar. Default size unchanged. |
| 5, 6, 7 | fixed | Settings scroll has padding and a 44 px step; help text no longer collides with Modules; test tools labelled developer tools, Clear says click twice. |
| 8 | fixed | Home hangs from its text (no dead gap), "Pick a raid core" button. The long loot-system line is unchanged. |
| 9 | fixed | Unsent-changes block hidden on Open raids and Calendar; button tooltip shows what is queued. |
| 10, 11 | fixed | Sidebar tooltip opens to the left with the button's own name; gear status reads "Partly ready". |
| 12-16 | fixed | Open raids starts on your realm, hides one-page paging, Website next to filters; Ready legend, wider Player column, Post asks twice; attendance disabled without a raid; Loot status line reworded, item box placeholder. |
| 17, 18 | fixed | Administration points at the Loot page with a button; Roster admin described and renamed. |
| 19-21 | fixed | Crafting spacing; embedded scroll pages use the 44 px step and bottom padding; the stray line was the status line, now cleared when a page opens. |
| 22 | fixed | Full names and "n/a" item level. The item level value itself comes from the game. |
| 23 | partly | /guilded while the Guilded page is open inside a game window now closes that page instead of opening a second window. |
| 24 | deferred | Needs an in-game repro of the unresponsive Close click. |
| 25 | fixed | Home "Link to Discord" block with paste box and linked / pending / not linked state. |
| 26 | fixed | /guilded help grouped under Everyday, Officer and More headings. |

Also: the guild digest carrying a pending `/guilded verify` code is re-sent every 5 minutes through
`ns.comm.send` until the code is removed or the member shows up in the shared standings.
