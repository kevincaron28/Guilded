# Guilded 9.3.0 — release notes (13 November 2026)

**Addon polish after 9.2.0, dungeon-run fixes and Discord cards.** Not yet published. Protocol 2, WoW Forever only. No bot migration.

Real-client checks: docs/V9_3_0_RELEASE_ACCEPTANCE.md. Confirmed on a real client on 13 November: a test dungeon run reached the bot through the 9.3.0 companion (full Guilded, and Guilded Dungeons alone) and the end-of-duel card appeared after a real duel (details in the acceptance record). Not yet verified in a real game client: the tabbed settings page, the chat tab online/offline line, the tooltip change, the dungeon paintings on the result card and Run tab, the duel leaderboard and end-of-duel card, the Dungeons-only upload and run counts on the sync line, the abandoned-run chat line, guildmate recovery and relay.

## What changes for members

- **Availability removed:** the addon page, module and `/guilded free` are gone; the website "Who's free?" page redirects to the account page.
- **Settings in tabs**, with a description for each setting.
- **Guilded chat tab:** one online/offline line; `/guilded chattab` explains how to add the tab.
- **Tooltips:** Guilded no longer drives the game's tooltips (aimed at the forbidden-action warning).
- **Dungeon paintings** behind the result card and the Run tab band.
- **Duels:** a redesigned leaderboard and a card at the end of a duel.
- **Map:** the Guilded map shortcut is removed; use the game's map.
- **Companion:** the "Syncing now" line clears when the sync ends, the window has a painted banner, and the installer closes a running companion by itself; docs and Store listing describe the single window.
- **Dungeons-only PCs:** a PC with only the Guilded Dungeons addon uploads its runs to its guild through the companion; the sync line says how many runs were sent, stored, copied or refused.
- **Fewer lost runs:** fewer finished runs end as abandoned, a chat line says why an abandoned run will not count, a run can be completed from a guildmate's copy, runs are relayed for members without a companion, and each player's guild is recorded on a run.

- **To invite window:** shows only who still needs an invite.
- **Professions:** one profession under one name everywhere, with Poisons.
- **World PvP:** deaths with zone and time, K/D and deadliest zones.
- **UI polish:** a left menu that no longer jumps, clamped windows, cards that remember their position.
- **End-of-duel card:** painted background, a stat row, and a card for duels outside the guild.

## Discord and website

- Season podium and start cards in the dungeon leaderboard channel (switch: `/bg season-cards`, on by default), a card for every counted duel (switch: `/bg duel-cards`), the weekly report as a card, card-only messages and ten painted backgrounds.
- Season, welcome, rookie of the week and World PvP recap cards, and a second batch of painted backgrounds.
- A painted hero on the website home page.
- Stable guild addresses and fuller guild pages on the website.

## Technical

- Deploys update only the dependencies that changed.

- #819-#869 since 9.2.0 (see CHANGELOG.md), plus dependency updates #763 and #764.
