# Guilded 9.3.0 — release notes (13 November 2026)

**Addon polish after 9.2.0.** Protocol 2, WoW Forever only. No bot migration.

Real-client checks: docs/V9_3_0_RELEASE_ACCEPTANCE.md. Not yet verified in a real game client: the tabbed settings page, the chat tab online/offline line, the tooltip change, the dungeon paintings on the result card and Run tab, the duel leaderboard and end-of-duel card.

## What changes for members

- **Availability removed:** the addon page, module and `/guilded free` are gone; the website "Who's free?" page redirects to the account page.
- **Settings in tabs**, with a description for each setting.
- **Guilded chat tab:** one online/offline line; `/guilded chattab` explains how to add the tab.
- **Tooltips:** Guilded no longer drives the game's tooltips (aimed at the forbidden-action warning).
- **Dungeon paintings** behind the result card and the Run tab band.
- **Duels:** a redesigned leaderboard and a card at the end of a duel.
- **Map:** the Guilded map shortcut is removed; use the game's map.
- **Companion:** the "Syncing now" line clears when the sync ends; docs and Store listing describe the single window.

## Technical

- #819-#832 since 9.2.0 (see CHANGELOG.md), plus dependency updates #763 and #764.
