# Guilded 9.3.8 — release notes (17 November 2026)

**Addon fixes and the card redesign.** Published 17 November 2026. Protocol 2, WoW Forever only. No new bot migrations.

Real-client checks: docs/V9_3_8_RELEASE_ACCEPTANCE.md. 9.3.8 is not yet confirmed on real clients.

## What changes for members

- **Companion fix (important):** the 9.3.7 companion could not start ("Cannot find module ./run-log.cjs"), so after updating it stayed closed and runs stopped uploading. If your companion did not come back after updating to 9.3.7, download and run the 9.3.8 installer once.

- **Guilded setup window:** it opens on top of the main window and you can drag it.
- **Quiet login:** turn on "Quiet login" in Settings (or type `/guilded quiet on`) to hide Guilded's chat lines after you log in. Errors and command answers still show.
- **Milestones and achievements:** the line for guild chat now waits in a small Share bar; one click shares it. WoW Forever refused the automatic line, which caused the "Guilded tried to call UNKNOWN()" message.
- **Already live on the bot:** redesigned Discord cards (new title font, the achievement badge large on a painting, brighter dungeon cards without the death map), and invite requests that close when the member left Discord or corrected the name.

## In short (English)

Guilded 9.3.8: a movable setup window, a quiet-login switch, and milestone lines shared with one click.

## En bref (français)

Guilded 9.3.8 : une fenêtre de configuration déplaçable, une option de connexion discrète, et les messages d'étape partagés en un clic.

## Technical

- #1053 (Options.lua, Core.lua, Util.lua, SettingsPage.lua), #1061 (Modules/Milestones.lua, Locale.lua) since 9.3.7. Bot changes already live: #1048-#1062. No migrations in prisma/migrations since 9.3.7. The companion code is unchanged since 9.3.7 (its version follows the product).
