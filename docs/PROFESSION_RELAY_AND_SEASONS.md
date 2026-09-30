# Profession relay and dungeon history

Guildmates can use the updated addon without installing a companion. Their own
profession and recipe reports travel over WoW guild addon messages to online
officers. At least one officer must run the companion, with a paired officer
Discord account. Professions and recipes sync even when guild ledger imports await
manual review. Both players need the updated
addon and the Recipes module enabled. Open profession windows once to scan recipes.
The officer's reload or logout saves the received data for the companion to upload.

On login, officers request the professions and recipes of online guildmates. Players
also broadcast their own profession changes and share recipe lists at login. If
players never overlap online, a member's own companion remains useful. Nothing
uploads directly from WoW to HTTP, and a member companion cannot upload guild ledgers.

A complete profession snapshot replaces the character's skill list, removing recipes
and cooldowns for dropped professions. An unavailable API is unknown, not an empty
list. Original report timestamps stop old saved copies from restoring removed skills.
Legacy addon reports remain additive until a complete updated report arrives.
The craft guide's directory refreshes after imports.

Closed dungeon group posts stay visible for 48 hours, then the bot deletes their
Discord messages. Database group records and signups remain. Missing messages count
as already removed; other deletion failures are retried during the regular cleanup.

The dungeon standings board shows the current season and recent archived podiums.
Its menu opens the latest 25 seasons; `/dungeon leaderboard season` can search older
seasons too. Starting a season retains previous run/point history and existing season
champion achievements. Hall of Fame presentation is on the roadmap.

Validation still needed in the real game: have a guildmate without the companion
open both professions while an officer is online, unlearn one, then reload the
officer's client. Check that Discord keeps the remaining skill/recipes and removes
the dropped profession. Unit tests cannot replace this two-player check.
