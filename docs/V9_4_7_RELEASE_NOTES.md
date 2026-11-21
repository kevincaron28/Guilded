# Guilded 9.4.7 release notes

Published 21 November 2026. Protocol 2, WoW Forever only. Bot changes are already live.

Real-client checks: docs/V9_4_7_RELEASE_ACCEPTANCE.md.

## Companion and addon

- The dungeon board written into every member's game (Standings.lua and the addon's saved copy) is about 93% smaller. Guildmates keep what the game shows of them; your own characters keep every detail; officers keep guildmates' runs for the relay. On for everyone, no setting (#1225).

## Bot (already live)

- Standings rebuild fast again: dungeon rules checked once, board in about 1.5 s (#1222).
- Community tick without a lock every minute; failures in one activity or server no longer stop the others; stuck deliveries stop after a day and show in /setup system status; quieter logs (#1226).
