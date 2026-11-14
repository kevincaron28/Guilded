# 9.3.0 release acceptance

Status: 13 November 2026, 9.3.0 not yet published. Only the items under "Confirmed on a real client" have been seen in game; everything else is still not yet seen in a real client.

## Where it is published

| Provider | State |
| --- | --- |
| GitHub | not yet run (v9.2.0 is the latest) |
| Installer | not yet run |
| CurseForge | not yet run |
| Microsoft Store | 9.3.0.0 package not yet built or submitted (Guild Sync Companion 9.2.0.0 certifying) |
| Website | `site/releases.json` still at 9.2.0 |

## Confirmed on a real client (13 November 2026)

- With full Guilded 9.3.0, a test dungeon run made with `/guilded sim dungeon` was stored by the bot 8 s after `/reload`, through the 9.3.0 companion.
- With full Guilded disabled, Guilded Dungeons 9.3.0 saved the character, the guild key and `myCharacters`, and a test run added to its saved file was stored by the bot 7 s later (companion signed in, both saved files present on that PC).
- The end-of-duel card appeared after a real duel between two PCs.

## Checks owed (not yet seen in a real client)

- Settings tabs and descriptions in the game client.
- Chat tab online/offline line and `/guilded chattab` text.
- No forbidden-action warning from tooltips (the 13 November report).
- Dungeon painting on the result card and the Run tab.
- Duel leaderboard, and the new look of the end-of-duel card (painted background, stat row, card for duels outside the guild).
- A PC that never had full Guilded uploading through Dungeons alone; the relay between two players.
- UI polish: left menu, clamped windows, cards remembering their position.
- The To invite window showing only who still needs an invite.
- Installer over a running companion; the companion banner.
- One name per profession (with Poisons) and World PvP deaths, K/D and zones.
- Guilded Dungeons alone: runs upload through the companion and the sync line counts sent, stored, copied and refused.
- Abandoned runs: fewer finished runs lost, the chat line explaining why a run will not count, completing a run from a guildmate's copy, relay for members without a companion (both addon pairings).
- Discord: duel card with `/bg duel-cards`, weekly report card, card-only messages and backgrounds on the live bot; website guild pages.
- Companion "Syncing now" line clears after a sync (two PCs).
- Final-commit CI, packaging hashes, install over 9.2.0.
