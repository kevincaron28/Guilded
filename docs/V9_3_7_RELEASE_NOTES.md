# Guilded 9.3.7 — release notes (16 November 2026)

**Fixes from the two-PC test.** Prepared 16 November 2026, not yet published. Protocol 2, WoW Forever only. No new bot migrations.

Real-client checks: docs/V9_3_7_RELEASE_ACCEPTANCE.md. 9.3.7 is not yet confirmed on real clients.

## What changes for members

- **Companion log:** the log file now covers the whole time the companion runs, so a support question can be answered from it. Old logs rotate.
- **Honest messages:** a website install no longer says it was "restarted by Microsoft Store", and an addon update no longer says "not needed: busy" next to a real install.
- **Joining a guild in game:** the addon saves the new guild on your character record at once, so the next upload shows it without a reload.
- **Already live on the bot:** card polish for French (dungeon names, ranking layout, plurals, long names, trend axes). French guides for officers, EP/GP, the Discord bot, self-hosting and status. Website visit statistics.

## In short (English)

Guilded 9.3.7: the companion log covers the whole run, restart and addon-update messages tell the truth, and a guild joined mid-session is saved at once.

## En bref (français)

Guilded 9.3.7 : le journal du compagnon couvre toute la session, les messages de redémarrage et de mise à jour de l'addon sont exacts, et une guilde rejointe en cours de session est enregistrée tout de suite.

## Technical

- #1043 (companion-app/run-log.cjs, addon-auto-update.cjs, main.cjs; addon Core.lua), #1042, #1039, #1038, #1040, #1041, #1044 since 9.3.6. No migrations in prisma/migrations since 9.3.6. The bot needs no deploy for this release (card polish is already live).
