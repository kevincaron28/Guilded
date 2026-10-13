# Dungeon replacement players and richer results

The second Hall of Thanes run on 13 October completed automatically at Durgen's
kill, in 22:25. SavedVariables and the production database agree. The bot rejected
`QG-20261013-140828-Highpriest` with `6 players (dungeons are 1-5)` because one
player left and another joined. Guildmate participation is not required.

The run's player list is participant history, not simultaneous party size.
Validation now accepts up to the schema's existing 40-person history cap while
retaining duration, protocol, duplicate-name and reporter checks. No existing
record is silently reclassified on a duplicate upload.

Discord summaries include completion date, automatic/manual finish, participant
count, classes, roles, individual recorded deaths, individual points, and total
points. Partial death tracking is explicitly labelled; unknown deaths are never
described as a flawless run. Existing records and achievement highlights remain.
The message remains within Discord's embed limits.

The in-game results window now has a gold dungeon heading, completion status,
large duration and boss metrics, a scrollable roster with classes/roles/deaths,
and clearer sync instructions. No automatic reload or new sync popup is added.
Use `/guilded dungeon results` to reopen your latest saved result. English and
French labels use the existing addon language setting.

`scripts/recover-dungeon-roster.ts <guildId> <runRef>` previews recovery of one
run rejected solely by the obsolete five-name check. `--apply` requires the
original saved import, matching participants/times/instance, the original active
season, no existing awards, and no later valid clears of that dungeon. It takes
the same guild transaction lock as imports, retains the existing run/player rows,
uses the normal award rules, and queues one durable announcement and board
refresh atomically. Repeating it on an already-valid run makes no changes.
Do not use it to override officer invalidations or another validation failure.

Local checks: 166 files / 1,362 tests passed with two workers, plus TypeScript,
ESLint and addon validation. The recovery preview confirmed the six participants
and destination channel without modifying the database. Deployment, recovery
application and the new popup's real-client appearance are not yet verified.
Version remains 6.0.0 / protocol 2; no schema migration is required.
