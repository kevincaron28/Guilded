# Guilded 6.4.0 — Guided guild setup and raid summaries

Feature release, October 17, 2026. Addon, bot and Windows companion move together to 6.4.0;
protocol remains 2. Everything below was checked in game on WoW Forever on two PCs
([checklist](V6_2_GAME_ACCEPTANCE.md)).

## Addon

### New

- **Set up a guild in game, step by step.** Officers type `/guilded setup guild`, or press
  "Officers: set up my guild in game, step by step" in `/guilded setup`. Guilded switches to
  In-game only and opens the Local guild page: create a raid core, choose how loot is given,
  add your raiders. Each button says what happened and what to do next. New officers are
  pointed to it on their first login.
- **End-of-raid summary.** `/guilded end` now lists what was recorded: attendance (marked by
  officers), people seen in the group but not marked, boss kills (marked by hand), EP/GP totals
  and loot. `/guilded summary` opens it in a box to copy into Discord or a forum.
- **Gear checks that fit levelling characters.** Below level 60, empty gear slots are a note
  ("Empty slots (normal while levelling)") instead of "Not ready". `/guilded slots level <n>`
  changes the level (1 = always count them).
- **Season view freshness.** The dungeon season view says when its scores were updated and who
  shared them.

### Fixed

- Soft-reserve roll-off with Guilded Games installed: when a game was running, the party was
  told "rolling between ..." although the roll-off was refused. Nothing is announced now when
  a roll-off cannot start.
- The roll-off winner line said "including SR+" when nobody had a bonus; it now says so only
  when someone does.
- The raid summary shows "today 14:43" instead of a raw timestamp.

### Changed

- **Party games live only in the Guilded Games addon** (`/ggames`). Guilded's `/guilded games`
  and `/guilded casino` launchers are removed; Guilded still keeps a loot roll-off and a game
  from running at the same time. A drop nobody reserved now says: everyone `/roll`, then award
  it with `/guilded reserve award`.
- French text added for everything new; unused old text removed.

## Bot

- Pinned-message lookups use discord.js's current `fetchPins()`, so the bot no longer logs a
  deprecation warning at every start. No command or data changes.

## Companion

No changes besides the version number. The 6.3.1 to 6.3.2 upgrade was checked on the main PC
(pairing kept, one instance, uploads once).

## Checked in game (17 October, two PCs)

- Guilded Games installed alongside Guilded (G9): a running game blocks a roll-off, a pending
  roll-off blocks hosting a game, a reload clears a pending roll-off, and the award is recorded
  once. **PASS** (after the fix above).
- The new setup, raid summary, gear-check and season features on both PCs: **PASS**.
- Still owed: G6–G8 (dungeon runs with a group), G10 (French client), and the companion checks
  that need a new pairing code or a test server.

## Database

No new migrations.
