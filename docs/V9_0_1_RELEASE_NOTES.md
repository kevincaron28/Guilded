# Guilded 9.0.1 — fixes and polish after 9.0.0

A fix release. Protocol stays 2, so older addons and companions keep working with the bot.
Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md.

## In the game (addon)

- Fixed a Lua error when the guild snapshot was read.
- The Guilded chat tab has new tests for safe first-run and login during combat.
- A companion download window, map pins hidden inside instances, and a Battle.net check.
- Roster admin in clear sections, officer switches inside the window, and a native look with
  copy windows.
- A new Info and data page for features that used to need slash commands.
- Officers see professions and EP,GP in guild notes, linked members can be promoted from
  Initiate, and new members get a join greeting.
- Guildmates' recipes, cooldowns and attunements now reach you through catch-up and member uploads.
- Names are shown the same way everywhere (one name standard, full names).
- Runs now complete in Ruins of Lordaeron (Rath'mael), Excavation Site: Wetlands (Relic Guardian) and
  City of Dalaran (Shade of the Archmage).
- The minimap button no longer hides under the Forever client's own button (new default spot;
  a dragged position is kept).
- The Guilded chat tab retries if it could not open at login, Guilded Dungeons is fully translated,
  and the "Linked to Discord" line shows at every login while you are linked.
- Death positions in dungeons are recorded for the heat map on dungeon cards.

## On Discord (bot)

- Dungeon completions post one card per run, and copies of the same run seen by several
  players are merged (no more triple posts).
- Profession Details no longer hangs; each crafter appears once.
- Invite requests get their check mark when the player joins.
- Nickname sync always logs, adds up scopes, asks for Manage Nicknames on invite and warns about
  role hierarchy; it runs 3 minutes after start-up.
- Race to 60: a leaderboard card, a reach-60 card, and officer edits to the Hall of Fame.
- The linked-characters message now lists every character and has a My linked characters button.
- Delete my data in the companion and on /me; PoE2 follows the tracking switch.
- Season 1 dungeon leniency and full names on dungeon boards.
- Dungeon cards draw a death heat map when positions exist.
- `/raid signup` and `/craft claim` are gone: the buttons on the raid and craft posts do the same.
- `#invitation-guilde` lives in the World of Warcraft category, and features each have a home in
  Discord.
- The companion standings feed no longer times out on loot rules.

## Companion

- Updating while the companion runs: the installer now closes it by itself (no error, no flashing
  window), and startup.log keeps earlier starts.

## Website and operations

- Richer Québec Gold pages (English and French), visual 9.0 features, and clearer help text.
- A public page per guild with its boards and how to join, and public data for the phone app.
- Deploys prune old saved apps, clean stale staging folders and check free disk space.

The Store companion ships as 9.0.1.0.
