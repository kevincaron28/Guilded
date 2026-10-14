# Guilds & Communities tab

6.1.2 candidate following the published 6.1.1 release; not in the 6.1.1 ZIP.

The Guilded logo below the native guild tabs embeds Standings, Crafting and
Administration (EPGP). Officer and module visibility rules are reused. Native
roster/chat remain their own tabs. Dungeon runs and season progress/rankings
have one location in the dungeon finder. Calendar administration opens beside
the native calendar; members see only their native calendar. Home shortcuts
route to these locations instead of duplicating pages.

Only Guilded's own window is reparented. Native display-mode tables and click
handlers are not replaced. Switching native tabs or closing the host restores
the regular window parent, saved position and scale. Attachment waits until
combat ends and retries when Blizzard's load-on-demand UI becomes available.

Uses the classic_anniversary CommunitiesFrame source as a reference:
https://github.com/Gethe/wow-ui-source/tree/classic_anniversary/Interface/AddOns/Blizzard_Communities

Validation: TypeScript, lint and addon static validation passed. Added Lua
coverage for scoped pages, member permissions, restoration, idempotent tab
attachment, combat deferral and preserving native click handlers. Full suite
result is recorded in the delivery evidence after completion.

Installed on the owner's local client with original files backed up under
backups/guild-tab-20261014. SavedVariables untouched. Real-client layout,
native-tab switching and minimap restoration remain pending owner acceptance.
The owner authorized publication and a coordinated 6.1.2 update. Publication
requires the final candidate checks; earlier layout acceptance is retained below.

Owner reported no tab visible on the first candidate. The integration now loads
inside the existing Minimap.lua TOC entry, avoiding reliance on the client
discovering a new Lua file on reload. Its icon is anchored at the lower right
edge of the guild window rather than below GuildInfoTab, keeping it away from
the extra upper side tab visible in the owner's screenshot.

Owner then confirmed the tab appears, but screenshots showed a shrunken panel
with native chat and roster drawing over it. The guild view now uses scale 1
and opposite-corner anchors inside the native title/borders. Every Guilded child
frame is raised with the panel; the regular 790x600 window size and saved scale
are restored on exit. A translucent selected texture keeps the logo visible.
Lua tests now model frame children and assert fitted anchors, scale, child
levels and restored window dimensions. Owner confirmed the main layout is now
correct. Their next screenshot exposed the fixed-position ledger publishing
button below the shorter host window. Guild pages now use a bounded scroll
viewport, preserving their original content height without rendering controls
outside the guild window. Standalone pages restore their original anchors.
This last scrolling adjustment is installed locally; visual retest pending.

The final menu reorganization uses Blizzard's marble background and native
CommunitiesFrameTabTemplate border (with a classic texture fallback). It removes
the nested dialog border from the guild page. Home has one shared save action;
setup is in Settings. Lua regression coverage checks the single menu scopes,
officer-only calendar routing, per-character recent runs, and Run/Season reuse.
Owner screenshots then exposed clamped marble textures, unnecessary scrolling,
and a blank calendar page after reselecting it. Textures now use REPEAT wrapping;
content height follows the selected page, short pages have no scroll range,
mouse wheel movement is bounded to 24 pixels, and scroll children are explicitly
anchored after every selection. The ledger share action follows the standings
text instead of sitting at a fixed off-screen offset.

Final owner acceptance on 14 October: after reload, the guild/dungeon backgrounds
are correct, Administration no longer needlessly scrolls, and Calendar controls
are visible. Owner answered: "Yes, these corrections work." Previous evidence
also confirms native-tab switching and restoration of the minimap menu.
