# Public guild directory (PR #999, follow-ups in 1b)

Owner decision (15 November 2026): "we can show everything publicly": every guild seen in public runs, including guilds that never installed Guilded, with its member roster, scores, recent runs and top players. Only in-game data; never Discord IDs or private notes. `/delete-my-data` and the public deletion page keep working.

## Where guilds come from
- **Guilded guilds**: `GuildSettings.publicDungeonRuns`, as before (`/leaderboards/guild/<slug>`).
- **Observed guilds** (no Guilded server): `PublicRunPlayer.guild`, the in-game guild text the uploader's client showed (`GetGuildInfo`, unverified display text, 9.3+). `loadObservedGuilds` in `src/services/public-leaderboard.ts` reads ACCEPTED public run players, newest sightings first (cap 60,000, a warning is logged when hit), and `groupObservedGuilds` (`src/services/guild-public-stats.ts`) groups them.
- Grouping: folded guild name + realm. A row with no realm takes the realm of the same character elsewhere, else the only realm that guild name was seen on; otherwise it stays in its own bucket. Two characters minimum. A guild whose slug base equals a Guilded guild's is left to that guild's page.
- Older addresses (#999's plain name-realm slug, and the one from before the realm was known) are aliases that redirect to the stable slug.
- Address: `ig:<slug>` internally; the public slug is `<name>-<realm>-<6 hex>` derived from the folded name and realm alone (stable, never depends on other guilds).
- Faction is unknown for observed guilds (no source): they show under "All" and the new "Unknown" faction filter.
- Roster, scores and runs of an observed guild are the public run players with that guild text.

## Backfill
`src/services/public-run-guild-backfill.ts` runs once per bot start (8 minutes in), idempotent, only rows with no guild: first from `DungeonRunPlayer.guild` (same addon run id and character), then from Guilded rosters (`GuildRosterEntry` + `WowGuild`). Roster matches only use the roster of the Discord server that holds the run itself. Every run is looked at once (`PublicRun.guildBackfillAt`, migration `20270226000100`), covered or not, so uncovered runs are not rescanned on every start; they get a guild when a companion re-sends them (the ingest fill).

## Deletion
`deleteMyData` (`src/services/data-deletion.ts`) first anonymises (before the main transaction, outside it, set-based and batched, safe to repeat: a failure aborts before anything else is deleted) the member's characters in public runs: the player row becomes `deleted-player-<row id>` (no display name, no guild; class, role and level stay so the run is unchanged), and the same names are replaced in the run's saved integrity, upload evidence and reporters. Guild pages are built from those rows and from `Character`, so the member disappears from them. Public duel rows (names, keys, guild text, member ids, and the reports' keys and evidence) are anonymised the same way (`deleted-player-<duel id>-w|l`). First-name-only legacy rows ("Kev" for "Kev Caron") on the same realm are matched too, so a same-first-name player on that realm is anonymised with them.

## Open
- Public duel and PvP panels for observed guilds (PublicDuel has winnerGuild/loserGuild).
- Faction inference.

Matching rule for deletion: names match the full name or the first-name alias; with a realm on both sides the realms must be equal; a realm-less row (or a member character without a realm) is taken only when the name is unique in the member's guild. The public pages' caches are cleared after a deletion.
