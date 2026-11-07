# Guild records, challenges and the daily recap

Owner ideas of 7 November 2026 (P2). Status: built in one PR (this plan travels with it).

## What already existed

- **Fastest clear per dungeon**: the import already decides a "new guild record" (`guildRecord`, with the
  record-eligibility rules of the season in `dungeon-import.ts`), the dungeon card shows the badge and the
  dungeon leaderboard channel carries "Fastest dungeon clears" (`dungeon-best-runs.ts`, one per dungeon and
  difficulty for the current season). `/dungeon records` lists them too.
- **Per-member dungeon achievements** (`dungeon-achievements.ts`): First Blood, No One Dies, Guild Squad,
  Record Breaker… These are personal and permanent, with no announcement of their own.
- **Weekly report** (`weekly-report.ts`, off by default, embeds only): raids, cores, dungeon week, players of the week.
- **Race to 60** (`race-board.ts`): live board + Hall of Fame posts, tracks `weekStartLevel` only (no daily gain).

## Recommendations

### 1. Guild records and challenges

One new table, `DungeonHighlight`, one row per guild record or challenge, with a **unique key per guild**.
The key gives exactly-once for free: a duplicate report, a re-upload or a second observer can never
announce the same thing twice.

| Kind | Key | When |
| --- | --- | --- |
| Fastest clear (record) | `clear:<dungeon>:<difficulty>:<run>` | the import's own `guildRecord` (same logic as the card badge) |
| Fastest boss kill (record) | `boss:<encounter>:<difficulty>:<run>` | a kill (pull → kill, from the run's stored `encounters`) faster than every earlier guild kill of that boss on that difficulty |
| First guild clear | `first:<dungeon>:<difficulty>` | no earlier completed guild clear exists (new Forever dungeons included) |
| Flawless clear (challenge) | `deathless:<dungeon>:<difficulty>` | first clear of that dungeon where every party member was tracked with 0 deaths |
| All-guild party (challenge) | `guild5:<dungeon>:<difficulty>` | first clear of that dungeon with 5 or more players, all from the guild |

- **First beats count as nothing**: a first boss kill sets the bar, it is not a "record" (same rule as `guildRecord`).
- **Challenges are once per dungeon and difficulty** (not once per run): otherwise every clean run would ping.
  History is checked too, so turning the feature on does not announce old achievements as new.
- **Simulations (`SIM-`) and invalid runs never count.** Only runs with guild members count, as for the board.
- **Most runs in a week** is a period award, not a run event: it goes into the recaps (daily "most runs today",
  weekly "dungeon marathon") instead of a post.
- **Test servers**: everything here is per guild, so no cross-server record exists to protect. When the
  test-server flag lands and a cross-server board is added, filter it there.

**Notification**: the run post *is* the notification. When a run sets a record or completes a challenge, its
post (already one per run) leads with a short line (`🏆 New guild record · Wailing Caverns`), the card shows
the highlights as badges and the embed lists them. A second message under the run post would double the
dungeon channel for nothing, and members who do not read that channel get the same items in the daily recap.
**On by default** (rule 5); officers switch the callouts off with `/dungeon records announce:false` or in the
companion's server settings. Recording continues while they are off (the board and recaps stay complete).

**Records board**: the existing "Fastest dungeon clears" panel in the dungeon leaderboard channel gains a
"Fastest boss kills" section (all time, the 12 most recent records first within the message budget), and
`/dungeon records` shows boss kills too. No new channel.

### 2. Recaps

**Recommendation: a daily recap card, one post per day, only on days with something to say.**

- Posted after midnight in the server's timezone (`GuildSettings.timezone`), covering the day that ended.
  `dailyRecapLastDay` makes it once per day; a quiet day posts nothing.
- Channel: the weekly-report channel, else the notify channel (same route as the weekly report). Nothing
  posts until one exists (rule 5).
- **On by default**, officer off switch: `/stats recap-posts:false` or the companion server settings. Anyone
  can preview yesterday's card privately with `/stats recap:true`.
- Content (each section only when it has something):
  - **Race to 60**: levels gained by the guild, *most levels today* (top 5), new level 60s.
    Needs the day's starting level: `LevelRaceEntry` gains `dayStartLevel`/`dayStartedAt` and keeps the last
    finished day's gain (`lastDayGain`/`lastDayStartedAt`) so the recap still knows it after the day rolls over.
  - **Dungeons**: clears, different dungeons, *most runs today*, and the day's records and challenges.
  - **PvP**: duels (counted ones) with the top winner, battlegrounds won/played by members who share stats.
- **Professions: not yet.** The bot stores current skill only (no history), so "who levelled a profession today"
  would be guesswork. Add a `profession` milestone kind from the addon first (it already records level,
  dungeon, HK and duel milestones), then a "maxed a profession" line. Follow-up.
- **Weekly report**: unchanged layout (embeds), plus a "Dungeon marathon" line (most completed runs in the week).
  It stays off by default as before; turning the weekly report into a card is a possible follow-up once the
  daily card has been seen by the owner.

The card is a new `recap` layout in `score-card.ts`: the painted fortress scene (from `dungeon-art.ts`, seeded
by the day so it varies), a stats strip and up to three frosted section panels, in the style of the dungeon card.

## Files

- `prisma/migrations/20270107000000_records_and_recaps/` — `DungeonHighlight`, settings switches, race day fields.
- `src/services/dungeon-records.ts` — highlight detection (pure) and storage, boss records for the board.
- `src/services/daily-recap.ts` — the day's data, the card and the hourly delivery.
- `dungeon-card.ts`, `dungeon-announce.ts`, `import-followup.ts`, `dungeon-best-runs.ts`, `race-board.ts`,
  `weekly-report.ts`, `score-card.ts`, `commands/dungeon.ts`, `commands/stats.ts`, `companion-hub.ts`, `main.ts`.

## Still needs a real client

- Encounter pull times (`startedAt`) come from the addon; boss records only appear for runs that recorded them.
- Seeing the recap card and the callouts in kevmister28's Discord (never in Québec Gold).
