# 9.3.0 release acceptance

Status: 13 November 2026, 9.3.0 not yet published. None of the 9.3.0 addon changes has been confirmed in a real game client yet.

## Where it is published

| Provider | State |
| --- | --- |
| GitHub | not yet run (v9.2.0 is the latest) |
| Installer | not yet run |
| CurseForge | not yet run |
| Microsoft Store | 9.3.0.0 package not yet built or submitted (Guild Sync Companion 9.2.0.0 certifying) |
| Website | `site/releases.json` still at 9.2.0 |

## Checks owed (all "not yet run")

- Settings tabs and descriptions in the game client.
- Chat tab online/offline line and `/guilded chattab` text.
- No forbidden-action warning from tooltips (the 13 November report).
- Dungeon painting on the result card and the Run tab.
- Duel leaderboard and end-of-duel card.
- Guilded Dungeons alone: runs upload through the companion and the sync line counts sent, stored, copied and refused.
- Abandoned runs: fewer finished runs lost, the chat line explaining why a run will not count, completing a run from a guildmate's copy, relay for members without a companion (both addon pairings).
- Discord: duel card with `/bg duel-cards`, weekly report card, card-only messages and backgrounds on the live bot; website guild pages.
- Companion "Syncing now" line clears after a sync (two PCs).
- Final-commit CI, packaging hashes, install over 9.2.0.
