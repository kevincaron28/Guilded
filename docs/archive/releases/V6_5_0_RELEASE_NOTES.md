# Guilded 6.5.0 — Raid-night tools and core planning

Feature release, October 17, 2026. Addon, bot and Windows companion move together to 6.5.0;
protocol remains 2. One new database migration (applied automatically on deploy).
In-game results are in the [checklist](V6_2_GAME_ACCEPTANCE.md).

## Addon

### Raid nights

- **Raid templates.** `/guilded template save tue Tuesday Molten Core` keeps a title and the
  selected raid core; `/guilded start tue` starts it with that core. `/guilded template list`
  and `/guilded template remove <name>`.
- **Raid notes.** `/guilded note <text>` adds a note to the running raid; notes appear in the
  end-of-raid summary.
- **Attendance from the core roster.** `/guilded attendance roster` (Raid page: "From core
  roster") marks the selected core's players who are here PRESENT and its missing mains ABSENT,
  leaving the bench alone. If it cannot run, it says why (no core, an empty local core, or a
  Discord core whose roster has not arrived yet).
- **Undo.** `/guilded undo` (Administration page: "Undo my last award") takes back your last
  EP/GP entry. `/guilded raid discard` removes a raid started by mistake, as long as nothing has
  been recorded in it.
- **Raid history.** `/guilded raids [n]` lists recent raids, one line each, in a box to copy into
  Discord or a forum.

### Your EP/GP and loot history without Discord

- `/guilded history` (My character page: "My EP/GP history") shows your last EP/GP entries and
  loot. Your addon asks the guild; one online officer whose PC has your records whispers them
  back. Officers see anyone's history with `/guilded history <player>`.

### Guilded Games

- The lobby reads "High roll - Joining" instead of "high - JOINING".

French text for everything new.

## Bot

- **Core planning.** Core setup and editing offer a raid size of 10, 20 or 40 players with tank,
  healer and DPS targets, a weekday picker, a launch date and a 1–90 day planning window with a
  preview before saving. New raids take the core's signup limits; raids already published are
  unchanged. See [CORE_PLANNING.md](CORE_PLANNING.md).
- `/setup start`: the "Create the missing ones for me" buttons now show a "Working on it" line while the channels are made (it takes up to 30 seconds), so the screen no longer looks stuck. Found during a from-scratch install on a new server.
- Interaction replies use discord.js's current ephemeral flag, so the bot no longer logs a
  deprecation warning for each private reply.

## Database

- Migration `20261117090000_core_planning`: six new `RaidCore` columns (all optional or with a
  default) and a check that a set size equals tanks + healers + DPS. Existing cores are
  unaffected. The PostgreSQL rehearsal in CI applies it.

## Checked

- In game on the main PC: templates, notes, undo, raid discard, the raid summary and
  `/guilded raids`. `/guilded history` and the Games label are covered by automated tests (they
  need a second player online).
- Still owed from earlier checklists: G6–G8 (dungeon runs with a group), G10 (French client).
