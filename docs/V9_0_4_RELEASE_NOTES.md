# Guilded 9.0.4 — release notes (8 November 2026)

9.0.4 fixes what the first in-game check of 9.0.3 found and adds several WoW accounts per member to the
companion. Protocol 2, WoW Forever only. The bot side is already live.

Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md.

## In game (addon)

- **No more "blocked action" warning at login.** WoW showed "Guilded has been blocked from an action only
  available to the Blizzard UI" on every login for officers. The guild roster professions tooltip hooked a
  Blizzard mixin; it now hooks each roster row instead, and both validators reject that pattern. (#595)

## Companion

- **Several WoW accounts.** Every WoW account folder on the PC syncs by itself. The first time a new one
  appears, the companion asks once whether it belongs to the same person. The Sync page shows a line per
  account, and Settings has a switch for each. (#592, #593, #600)

## Discord bot and website (already live)

- Character pictures on cards, profiles, player search and share images; guild-only by default. (#589-#591, #599)
- A gold "New guild record" card after each record run. (#603)
- Cards fit their text, two cards that never drew now render, French text on boards and journal lines, and
  cleaner names. (#604, #585, #569)
- Item previews always link (Wowhead search when there is no exact match) and ignore "[Guilded]". (#602)
- The World of Warcraft button in the game-choice panel works every time. (#596)
- "Addon import not applied" now says why, and database timeouts retry by themselves. (#605)
- Deploys can no longer freeze the server: dependency fingerprints, a memory ceiling, the bot protected, and an
  uptime check that emails the owner. (#598, #601)

## Still owed

A check of several accounts on a PC with two WoW licences, and the officer tools in a real client.
