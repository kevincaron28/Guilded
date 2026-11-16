# 9.3.5 release acceptance

Status: prepared 15 November 2026, not yet published. 9.3.5 is not yet confirmed on real clients.

## Where it stands

| Provider | State |
| --- | --- |
| GitHub | not yet published |
| CurseForge | not yet uploaded |
| Microsoft Store | not yet submitted (9.3.4.0 in certification as Submission 13) |
| Website | feed still at 9.3.4 |

Published artifact hashes are added here after the build.

## Tested so far

- The merged pull requests passed CI (tests and packaging) on main.
- Release pull request CI: see the pull request.

## Checks owed (to be tested on real clients)

- In-game dungeon result card: the columns show each player's level, guild, score gained and season total from the bot's receipt, in a real run.
- Scarlet Monastery: the wing name shows in game and on the Discord card.
- The "last saved" line (sidebar tooltip, `/guilded sync`) and the one-time `/reload` reminder after a run or a duel (never in combat, only for your own duels, off switch works).
- Digest (D1) and packed summaries (Z1, #998: run batches over 255 bytes compressed, fallback for older addons) with mixed versions: a 9.3.5 addon with a 9.3.4 guildmate and the reverse; no run lost, no repeated replay.
- The new logo in game (addon icon and minimap) and in the companion (window, tray, installer, Store tile).
- Carried run and duel records between two real PCs (carried over from 9.3.4), a real dungeon run and group relay across guilds.
- Install over 9.3.4.
