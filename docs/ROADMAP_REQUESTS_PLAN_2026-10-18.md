# Plan for the 18 October 2026 roadmap requests

How each item in [ROADMAP.md](../ROADMAP.md) "Requested — 18 October 2026" gets
built, based on what the code already has. Order: smallest and most independent
first. Item 1 and the in-game part of item 2 are built on branch `feat/roadmap-requests`.

## 1. Ko-fi support links — built

Already done before this plan: the Ko-fi page [ko-fi.com/wowguilded](https://ko-fi.com/wowguilded)
(see [DONATION_SETUP.md](DONATION_SETUP.md)), the website footer and
[SUPPORT_GUILDED.md](SUPPORT_GUILDED.md), CurseForge's Donate button and the
`kcaron.top/support` redirect.

Added on this branch:

- **Bot:** a clickable line at the top of `/help` (`help.support` in
  `src/i18n.ts`, English and French). `/help` is its own command, so the merged
  `/setup` size limit is not affected.
- **Companion app:** "Support Guilded · buy me a coffee" in the app's footer
  (`companion-app/renderer`); the desktop app opens it in the browser.
- **Addon:** one sentence on the Settings page, with French in `Locale.lua`.
  WoW can't open links, so it shows the short address `kcaron.top/support`.

Never: features behind payment, popups, or a reminder that repeats.

## 2. Spreadsheet export — built (game, companion, bot)

**In game (built here):** `/guilded sheet [standings|loot|attendance|raids|dungeons]`
(`/guilded export` was already taken: it marks data for the companion)
opens the existing copy box (`showCharacterExport` in `Core.lua`) filled with
tab-separated text with a header row. Ctrl+C, then paste into Excel or Google
Sheets: each value lands in its own cell. A "Copy for Excel" button on the
Standings page opens the standings table. Tests: `tests/lua/sheet.test.ts`. Data comes from what the addon already keeps:

| Table | Source | Columns |
| --- | --- | --- |
| standings | `ns.effectiveStanding` for every known character | Rank, Name, EP, GP, PR |
| loot | `db.loot` | Date, Raid, Item, Player, GP, Boss |
| attendance | `db.raids` + `db.attendance` | Raid, Date, Player, Status |
| raids | `db.raids` | Raid, Started, Ended, Attended, Bosses, Loot |
| dungeons | `ns.scores.ranking()` | Rank, Name, Score, Dungeons |

Tabs and line breaks inside a value are replaced with spaces so a cell can't
spill. WoW's edit box gets slow with very long text, so each export stops at
1000 rows and says so.

**Companion (built for 7.0):** "Export to spreadsheet" on the World of Warcraft page writes
the same five tables as CSV files from Guilded.lua (`companion/sheet-export.mjs`, tests in
`tests/sheet-export.test.ts`): all tables or one picked from a list. The desktop app saves them
in a folder the player chooses; the online companion downloads them. UTF-8 with a byte-order
mark so Excel shows accents, RFC 4180 quoting, CRLF rows, item links as plain names.

**Bot (built for 7.0):** `/officer export table:<standings|ledger|loot|attendance|roster>`
replies privately with a CSV file of that server's data (standings per point pool, EPGP
ledger, loot, attendance, roster). It replaces `/report export`, which members could see;
`/officer` is hidden from members and Lite servers don't get it. Tests: `tests/exports.test.ts`.

## 3. Dungeon season for all levels

Today: the November rules (`src/services/dungeon-november-rules.ts`, version 5)
set `competitionLevel: 60` and every rated route's band to 60-60. Participation
bands per route already exist (`participationBand`).

Plan:

1. Add **brackets** to the rules: `brackets: [{ key, min, max, bestCount }]`,
   for example 15-29, 30-44, 45-59, 60. Each rated route belongs to the bracket
   that contains its competition band, instead of a fixed 60-60.
2. The rating counts a character's best routes **per bracket**, using the
   character's level at the time of the run (already stored in
   `competitionData.players[].level`). A level-60 run doesn't count in a lower
   bracket.
3. `/dungeon leaderboard` and the season card get a bracket choice (default:
   the viewer's own bracket). Season archives freeze each bracket separately.
4. Rules version 6 so active version 5 seasons are untouched; validator and
   tests for both versions.
5. Owner decisions before a season can open: bracket limits, best-N per bracket,
   and real timed runs to set each bracket's targets (the catalog's targets are
   still unset).

## 4. Guilds join on their own (lite until approved)

Today: the hosted pilot (`src/hosted-pilot.ts`, `src/services/pilot-requests.ts`,
[HOSTED_PILOT.md](HOSTED_PILOT.md)) gives a server **no access** until the owner
approves it from a DM, and a 5-server cap applies.

Plan:

1. Three states instead of two: `approved` (full), `lite` (pending servers) and
   `blocked`. `hostedPilot.allows()` stays as "full access"; a new
   `hostedPilot.tier(id)` returns the state.
2. On joining, a pending server gets the **lite command set** registered
   (`registerCommands` takes a list): `/setup` (channels and roles only),
   `/help`, `/faq`, `/report`, `/dungeon group` and basic event signups. The
   owner still gets the approve/block DM. Approving re-registers every command.
3. Background jobs, the companion API and guild pages keep checking `allows()`,
   so lite servers get no sync, EPGP, seasons or public page.
4. Separate caps: lite servers (e.g. 50) and full servers (`HOSTED_GUILD_LIMIT`).
   A lite server that has been idle for 30 days is told and then left.
5. Store the lite list in the existing `backups/pilot-requests.json` state, not a
   new table, so no migration is needed.
6. Update the website's pilot guide and `/setup` text to say what lite includes.

## 5. Online core and guild recruitment

Today: public guild pages exist (`src/services/guild-page.ts`, served through
the Worker) with a free-text `recruitment` section and invite link, managed by
`npm run guild-page`.

Plan:

1. Structured listing fields on the guild page: classes/roles wanted, raid days
   and times, language, faction, realm, and an "open" switch. Same for each core
   (`RaidCore`) that wants players.
2. Officers edit them in Discord (`/recruit` command) instead of the CLI.
3. A public **/recruitment/** page lists open guilds and cores with filters.
4. "Apply" form: the player gives a character name, class, role and a short
   message. It's posted to the guild's officer channel with Accept and Decline
   buttons. Sign-in with Discord (OAuth) so applications can't be spammed or
   faked; rate limit per user.
5. Players can post a "looking for guild" card (same sign-in), shown on the page.
6. Only approved (full) guilds can list. Needs a migration and a Worker route.

## 6. Standalone dungeon addon and public leaderboard

The biggest item; it depends on 3 (brackets) and on the sign-in from 5.

1. **Addon:** a small separate addon, `GuildedDungeons`, built from the same
   files as Guilded's dungeon tracking (`Modules/Dungeon.lua`, `RunResults.lua`,
   `Scores.lua`, `DungeonRoutes.lua`). The build script copies them so there's
   one source. If Guilded is installed too, `GuildedDungeons` stays quiet and
   Guilded counts the run.
2. **Accounts without a guild:** a player signs in on the website with Discord
   and gets a personal pairing code for the companion (the same pairing system,
   with no guild attached).
3. **Upload and trust:** the companion uploads runs to a public endpoint. A run
   is trusted more when other party members' uploads agree; impossible times
   and duplicate uploads are rejected.
4. **Website:** leaderboards by dungeon, bracket, class, role and season, plus a
   page per character. Guilded guilds can choose to include their members' runs.
5. Needs a migration (players, characters, public runs), new API routes and Worker
   routes, and a CurseForge project for the new addon.
