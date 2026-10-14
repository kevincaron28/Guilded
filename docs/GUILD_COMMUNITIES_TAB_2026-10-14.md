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
