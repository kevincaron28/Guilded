# Guilded 6.3.0 — Guild-wide sync, tested on two PCs

Release, October 16, 2026. Addon, bot and Windows companion move together to 6.3.0;
protocol remains 2. This is the first version checked on two PCs in game the same evening
(results in the [checklist](V6_2_GAME_ACCEPTANCE.md)); every fix the checks turned up is in it.

## Addon

- **Every guild member shares data, not only officers.** Standings, item data and the
  dungeon board travel from any guildmate who has a newer copy, so small guilds where
  officers and members are rarely online together still get current data. Officers answer
  first; a member's copy never replaces an officer's.
- **Home shows how fresh things are.** Standings and dungeon standings show when they
  were made and who shared them; Home also lists ledger-sync partners whose ledgers
  differ, and each raid core's loot system.
- **Recent dungeon runs show their date and season.**
- **Ledger sync works in both directions.** In game, one officer's guild-channel
  messages never reached the other, so entries only crossed when the other officer asked.
  The checksum now also goes by whisper to officers already met this session, and a
  changed ledger (a new award or void) is answered at once.
- **Joining a guild is noticed at once** (it used to need a `/reload`).
- **WoW Forever full names** ("Highpriest Cheech") work in `/guilded localcore add`.
- **Backups move between PCs.** The same guild can show a different realm text on each
  PC ("Classic Beta PvP" and "Classic Beta PvP 2"); a restore now only checks the guild
  name. A restore also keeps the receiving PC's own settings (ledger sync, chat tab,
  window position, characters) instead of copying the officer's.
- **In-game only guilds see their own ledger** in `/guilded standings`, not an old
  companion snapshot.
- `/guilded diag` lists Guilded's own problems first; `/guilded diag all` adds other
  addons'. The window has an opaque backing.
- French: untranslated menu items, cut-off buttons and missing accents fixed.

## Discord bot

- The dungeon board carries each season's start and end dates for the addon.
- Already live since 6.2.1: member answers are no longer logged as bot errors, the
  member cache is filled page by page, and `/uninstall` handles a late reply.

## Companion

- The standings file carries the season dates to the addon.

## Checked in game (16 October, two PCs)

PASS: officer ledger sync (both directions, voids, reload, sync off), officer data sharing
between two 6.3 clients, local cores and EP/GP, backup and restore across PCs with undo,
member permissions, and the member relay of standings and dungeon boards.
Not run: a two-player loot roll-off (G9) and an older 6.1.2 client next to 6.3 (part of G12).
Small open issue: `/guilded chat off` leaves the Guilded chat tab open; close it with a
right-click.

## Database

No new migrations.
