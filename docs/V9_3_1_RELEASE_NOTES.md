# Guilded 9.3.1 — release notes (14 November 2026)

**Fixes after 9.3.0.** Not yet published. Protocol 2, WoW Forever only. No bot migration.

Real-client checks: docs/V9_3_1_RELEASE_ACCEPTANCE.md. The 9.3.1 fixes themselves are not yet verified in a real game client.

## What changes for members

- **Combat:** the save button no longer blocks the Guilded window in combat.
- **Duels:** the in-game duel rating starts from 1000 and the season ladder runs from 13 November 2026. Duels outside the guild are kept. Old history is pruned by season.
- **Officer menu:** a character without a guild is no longer shown as an officer.
- **Commands:** `/gdg` and `/guilded dungeons` open the dungeons window.
- **Looks:** the dungeon result card and the options panel are opaque; French text that overlapped is fixed.
- **To invite window:** invite marks survive a reload, the copy box opens below the window, and the window says how old its list is.
- **Runs for another guild** wait for that guild's server.
- **Companion installer:** run by hand over a running companion, it finishes and restarts it. The uninstall entry is safe. The companion steps say "Guild Sync Companion".

## Discord and website (already live)

- Card redesign and painted badges.
- Duel rating with guild and global ladders, and public pages.
- One witness is enough for a dungeon run; officers review held runs with `/officer dungeon flagged`.

## Technical

- #856, #874, #877, #882, #884-#886 since 9.3.0 (see CHANGELOG.md), plus the bot and website work above.
