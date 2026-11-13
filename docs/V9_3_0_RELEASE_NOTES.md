# Guilded 9.3.0 — release notes (13 November 2026)

**Addon polish after 9.2.0, dungeon-run fixes and Discord cards.** Not yet published. Protocol 2, WoW Forever only. No bot migration.

Real-client checks: docs/V9_3_0_RELEASE_ACCEPTANCE.md. Not yet verified in a real game client: the tabbed settings page, the chat tab online/offline line, the tooltip change, the dungeon paintings on the result card and Run tab, the duel leaderboard and end-of-duel card, the Dungeons-only upload and run counts on the sync line, the abandoned-run chat line, guildmate recovery and relay.

## What changes for members

- **Availability removed:** the addon page, module and `/guilded free` are gone; the website "Who's free?" page redirects to the account page.
- **Settings in tabs**, with a description for each setting.
- **Guilded chat tab:** one online/offline line; `/guilded chattab` explains how to add the tab.
- **Tooltips:** Guilded no longer drives the game's tooltips (aimed at the forbidden-action warning).
- **Dungeon paintings** behind the result card and the Run tab band.
- **Duels:** a redesigned leaderboard and a card at the end of a duel.
- **Map:** the Guilded map shortcut is removed; use the game's map.
- **Companion:** the "Syncing now" line clears when the sync ends; docs and Store listing describe the single window.

- **Dungeons-only PCs:** a PC with only the Guilded Dungeons addon uploads its runs to its guild through the companion; the sync line says how many runs were sent, stored, copied or refused.
- **Fewer lost runs:** fewer finished runs end as abandoned, a chat line says why an abandoned run will not count, a run can be completed from a guildmate's copy, runs are relayed for members without a companion, and each player's guild is recorded on a run.

## Discord and website

- A card for every counted duel (switch: `/bg duel-cards`), the weekly report as a card, card-only messages and ten painted backgrounds.
- Stable guild addresses and fuller guild pages on the website.

## Technical

- Deploys update only the dependencies that changed.

- #819-#845 since 9.2.0 (see CHANGELOG.md), plus dependency updates #763 and #764.
