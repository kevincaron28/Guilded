# Guilded 9.4.6 release notes

Prepared 21 November 2026, not yet published. Protocol 2, WoW Forever only. Bot changes are already live.

Real-client checks: docs/V9_4_6_RELEASE_ACCEPTANCE.md.

## Addon

- World PvP kills count again. On WoW Forever the honor chat line was unreadable, so kills stayed at 0 while deaths were recorded. A kill now counts when the game's honorable-kills total rises (#1216), and the victim is named from the honor line, the killing blow or an enemy player seen dying nearby (#1220). Duels, Feign Death, battlegrounds and instances never count.
- Guild data survives the 1.60.1 hotfix that hides realm names. A guild whose realm went blank is no longer taken for a new guild; saves that already parked the guild's data are repaired at login (runs merged without duplicates, points never moved), with one chat line (#1219).
- Officer windows stay apart after a drag and open in front (#1214).
- Québec voice for the French milestone, duel and call-for-help lines (#1211).

## Companion

- Reads saved files up to 4 million values (#1215); a file it cannot read is shown as a problem and reported (#1218).

## Bot (already live)

- Standings no longer take 10-15 s to rebuild (#1217); website PvP map shows kills and deaths (#1216); character ids for the last name lookups (#1210); Discord polish (#1212); database on a free VM next to the bot.
