# Guilded 9.5.8 release notes

Prepared 26 November 2026. Protocol 2, WoW Forever only. Companion, addon and bot changes; one bot database migration (20270323090000_reserve_requests).

Real-client checks: docs/V9_5_8_RELEASE_ACCEPTANCE.md.

## Companion

- Choose folder saves and watches the WoW account right away; with several accounts it lists them, with a checkbox per account under Advanced (#1308).
- Repair and All problems show each step, the server's reason and what to do next (#1308).
- A sign-in that only matched "public leaderboards" no longer replaces a guild sync you already have; the website asks you to choose (#1308).
- New window, installer and tray icon from the painted emblem (#1303); Electron 45.4.1 (#1112).

## Soft reserves

- Reserve from Discord (/loot reserve, /loot unreserve) or from the phone while the loot keeper's list is open; the keeper's game applies it at the next login, /reload or unlock (#1310).

## Raid nights

- /raid report for raid leaders once the raid ended, weekly repeat fixes, a day-before reminder for members who have not answered, auctions that close by themselves, raid boss suggestions, Warcraft Logs raid picker (#1309).

## Addon

- Lines that stayed English on French, German and Spanish clients are translated; raid boss kills are recorded even with the Dungeons module off (#1312).

## Website and phone (server side)

- French pages stay French, real command names everywhere, fuller guides and a raid night guide (#1307); phone app server fixes (#1305). The phone app keeps its own version.
