# Pre-launch (beta) cleanup for WoW Forever

Owner request, 6 November 2026: "delete pre launch season, and all beta characters. Some still
appear in Québec Gold Discord in professions and on the leaderboard to 60 and in the unlinked
characters."

`npm run cleanup:prelaunch` (`scripts/prelaunch-cleanup.ts`, logic and rule in
`src/services/prelaunch-cleanup.ts`). **Preview by default**; `--apply` deletes, one transaction
per guild. Running it again finds nothing more.

## The rule

WoW Forever launched on **2026-11-04 at 23:00 UTC** (Season 1, `current-v1`). Forever data from
before that is the beta.

| Data | Deleted when | Kept (and listed) when |
| --- | --- | --- |
| Linked characters (Forever) | last activity before launch; activity = latest of `lastSeenAt`, `professionsUpdatedAt`, `guildRankAt`, `relayedAt`. A row never seen in game is deleted only if its realm label contains "Beta" | any activity at or after launch; a "Beta" realm label with activity since launch is listed; a row never seen in game on a non-beta realm is listed (an officer may have added it by hand before launch) |
| Unlinked characters (Forever) | `lastSeenAt` before launch | seen since launch (a "Beta" label is listed) |
| Recipes, profession cooldowns | the deleted characters' own, and any scanned before launch that belong to no kept character | belonging to a kept character |
| Race to 60 board and Hall of Fame | the name key is no kept character's | a kept character's (Retail/Classic keys untouched) |
| Dungeon seasons | the beta preset (`forever-beta-2026-10-13-v1`, "Quebec Gold - Beta finale Oct 22") or any season that ended before launch | started before launch but still open: listed, never deleted |
| Dungeon runs | ended before launch, or in a deleted season; with their players, dungeon points and dungeon achievements | everything at or after launch |

What a deleted character carries goes with it (its professions, attunements, wishlist, gear checks,
raid signups and core spots); the preview counts them.

**Never touched:** EP/GP and DKP ledgers (they belong to members, not characters), members,
Retail and Classic characters, anything dated at or after launch, Season 1. Official seasons
(`/guilded-season`) are global and are not part of this cleanup.

## Owner steps (on the server, in the bot folder)

1. Take a backup (`docs/DEPLOY_ORACLE.md`).
2. Preview (changes nothing):
   ```bash
   npm run cleanup:prelaunch
   ```
   or for Québec Gold only: `npm run cleanup:prelaunch -- --guild <Discord server id>`.
   Read each guild's block: the names that would be deleted, what goes with them, and every
   `KEPT, CHECK` line.
3. If it is right, apply:
   ```bash
   npm run cleanup:prelaunch -- --apply
   ```
4. The running bot then redraws the profession directory and the per-profession posts, the race
   board and the dungeon board (jobs `PROFESSIONS`, `RACE_BOARD`, `DUNGEON_BOARD`; no restart
   needed). Roster gaps and the unlinked list are computed when asked, so they are already clean.
5. Hall of Fame posts already sent to Discord are listed by the preview; delete those messages by
   hand.
6. Run the preview again: it should say nothing is left.

Not verified against the production database: the rule was tested on a fake guild only
(`tests/prelaunch-cleanup.test.ts`).
