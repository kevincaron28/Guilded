# Guilded 9.3.5 — release notes (15 November 2026)

**A new logo, a richer dungeon result card and quieter syncing.** Prepared 15 November 2026, not yet published. Protocol 2, WoW Forever only. No bot migration since 9.3.4.

Real-client checks: docs/V9_3_5_RELEASE_ACCEPTANCE.md. 9.3.5 is not yet confirmed on real clients.

## What changes for members

- **New logo:** a painted logo spelled GUILDED, in the addon, the companion and the website.
- **Dungeon result card in game:** it shows each player's level, guild, score gained and season total, taken from the bot's receipt.
- **Dungeon cards:** brighter paintings, and the Scarlet Monastery wing is named on the cards and in game.
- **Addon:** a "last saved" line tells you when the companion last saved your data, and one quiet chat line suggests `/reload` after a run or a duel. It never reloads by itself and can be turned off in the settings.
- **Syncing:** guildmates compare a short weekly digest before the login replay, so a run a guildmate already has is not sent again. Older addons keep the old replay. Long run batches are now packed into one message (older addons keep the old way).
- **Discord:** an achievement-unlocked card with a painted background, a short guide with the essential commands, and the old dungeon points embed is gone from the #classement-donjons board.
- **Community podium:** dungeon runs count less (about 15 points a clean run, at most 100 a week), and the weekly limits for duels, battlegrounds and World PvP are lower, so Discord activity and WoW activity weigh about the same. Seasons that ended before November keep their numbers.
- **Officers:** `/officer dungeon sync` shows stuck syncs, and the developer gets a daily alert.

## In short (English)

Guilded 9.3.5: a new painted logo, a dungeon result card in game with each player's level, guild and score, brighter dungeon cards with the Scarlet Monastery wing named, a "last saved" line and a quiet `/reload` reminder, and fewer repeated run uploads between guildmates. Community points are rebalanced.

## En bref (français)

Guilded 9.3.5 : un nouveau logo peint, une carte de résultat de donjon en jeu avec le niveau, la guilde et le score de chaque joueur, des cartes de donjon plus claires avec l'aile du Monastère écarlate nommée, une ligne « dernière sauvegarde » et un rappel discret de `/reload`, et moins d'envois répétés de donjons entre membres. Les points de communauté sont rééquilibrés.

## Technical

- #985, #986, #987, #988, #989, #990, #991, #992, #993, #994/#998, #995 since 9.3.4 (see CHANGELOG.md). The bot parts are already on main; the bot is deployed after the GitHub release is published.
