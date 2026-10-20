# Guilded 7.2.1 — Leaderboards with both addons, clearer companion setup and a steadier bot

Patch release, October 20, 2026. Addon, bot, Windows companion and Guilded Dungeons move to
7.2.1; protocol remains 2. No new database migration (the official seasons migration from
7.2.0's follow-up is already applied). In-game results are in the
[checklist](V6_2_GAME_ACCEPTANCE.md).

It is also the first release the Windows companion can install by itself: a 7.2.0 companion
shows **Update now**, downloads 7.2.1, checks it against GitHub's checksum and restarts.

## Dungeon seasons follow one calendar

- Season 1 starts **4 November 2026 at 3 PM Pacific** (23:00 UTC, 6 PM Eastern) for every guild
  and the public leaderboards, and runs until the bot owner starts the next one with
  `/guilded-season` (home server only). Officers no longer start seasons; `/organize
  dungeon-seasons` shows the calendar.

## Guilded Dungeons and the companion

- **Fixed:** with both Guilded and Guilded Dungeons installed, a companion connected to the
  public leaderboards only could send nothing ("no character yet"): Guilded records the runs and
  Guilded Dungeons stays quiet, but the companion only read `GuildedDungeons.lua`. It now reads
  `GuildedDungeons.lua` and `Guilded.lua` from the same SavedVariables folder and sends each run
  once, in the Windows app and online.
- Companion setup says what each connection does: a **guild** connection syncs `Guilded.lua`
  (EP/GP, loot, attendance, dungeon runs) and brings standings back; **Public dungeon
  leaderboards only** sends finished runs from either addon. After connecting it shows which one
  you have, and the World of Warcraft steps and **Find it** follow that choice.

## Sign in with Discord comes first everywhere

- There is nothing to type when connecting: the short code on the sign-in page only shows it is
  your companion. The companion, the sign-in page, My page and the Discord replies
  (**Connect optional companion**, `/character pair`) now say so and lead with **Sign in with
  Discord**. The code stays, last, for companions older than 7.2 and for bots without website
  sign-in.

## A steadier bot

- The bot keeps up to 8 database connections (was 5) and starts each server's boards and raid
  repairs one after the other; the daily backup waits a few minutes after a restart. A burst of
  startup work ran out of connections once on 19 October.
- An update now stops with a clear message if Discord refuses the new slash commands (as it did
  for 7.0.0's first deploy); `/health` shows `"commands": "ok"` once they are registered.
- Developer bug reports say where an error happened (server, channel, message and operation),
  so problems in one guild are easier to find.

## Checked

- Automated: TypeScript, ESLint, both addon validators and the full test suite, including both
  addons' files read together, the folder reader, the deploy script's `/health` check and the
  reworded Discord replies; the online companion's setup page checked in a browser in guild and
  leaderboards-only modes.
- To check with real clients: the first one-click update from 7.2.0, leaderboards-only sync with
  both addons installed, Discord sign-in from the Windows app, and the in-game checks in the
  [checklist](V6_2_GAME_ACCEPTANCE.md).
