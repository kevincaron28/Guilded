# Guilds & Communities tab

Local candidate following the published 6.1.1 release; not in the 6.1.1 ZIP.

The Guilded logo below the native guild tabs embeds the existing Standings,
Crafting, Season, Calendar and EPGP pages. Officer and module visibility rules
are reused. Native roster/chat remain their own tabs. Dungeon runs and personal
scores remain available through the dungeon finder and full Guilded menu.

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
No version bump, public package replacement or live server change for this tab.

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
levels and restored window dimensions. Updated layout acceptance is pending.
