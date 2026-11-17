# Guilded 9.3.9 — release notes (17 November 2026)

**Addon-only players, quieter logins and lighter sync.** Published 17 November 2026. Protocol 2, WoW Forever only. No new bot migrations in this release (the bot changes are already live).

Real-client checks: docs/V9_3_9_RELEASE_ACCEPTANCE.md. 9.3.9 is not yet confirmed on real clients.

## What changes for members

- **Playing without the companion:** your runs and duels are handed to a guildmate, party member or any online Guilded player with the companion right after you leave a dungeon. They now count on the leaderboards, also in Season 2.
- **Quieter login:** no more "sync with Discord in 3 steps" lines at login. `/guilded companion` still shows the guide.
- **Lighter sync:** the companion no longer re-sends runs the bot already has, and old log data ages out of your saved file.
- **Companion:** one Windows startup entry; every build is now launched once before release so it always starts.

## In short (English)

Guilded 9.3.9: addon-only players' runs reach the leaderboards faster and rank in every season, logins are quieter, and sync is lighter.

## En bref (français)

Guilded 9.3.9 : les parties des joueurs sans compagnon arrivent plus vite au classement et comptent dans chaque saison, la connexion est plus discrète et la synchronisation plus légère.

## Technical

- Addon: #1065, #1081, #1083, #1088 (CraftOrders), #1089 (Carry.lua presence proof `ig`/`ns`/`q1..q5`). Companion: #1068, #1075, #1081. Bot changes since 9.3.8 are already live (#1070–#1090). No migrations since the last deploy.
