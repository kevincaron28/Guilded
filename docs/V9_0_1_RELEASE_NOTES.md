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

## Website and operations

- Richer Québec Gold pages (English and French), visual 9.0 features, and clearer help text.
- Deploys prune old saved apps, clean stale staging folders and check free disk space.

The Store companion ships as 9.0.1.0.
