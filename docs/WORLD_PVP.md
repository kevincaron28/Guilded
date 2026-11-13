# World PvP stats and leaderboard (9.1 plan)

Status (7 November 2026): **stage 1 is built** (addon capture, `/guilded worldpvp`). Stages 2 and 3
(upload, Discord board) are planned below and not started.

## What the existing PvP addons do

Researched 7 November for WoW Forever / Classic Era / Anniversary.

| Addon | What it records | Takeaway for Guilded |
| --- | --- | --- |
| Honor Kills Counter, HonorLog, HazeHonorTracker | Honorable kills from the honor-gain chat line, per session and per day, by zone; some add a kill list | The honor line (`COMBATLOG_HONORGAIN`) is the reliable kill signal in Classic. It names the victim and fires only for honorable kills. |
| PvP Tracker, WarlordsPvP | Kills, deaths, streaks, battleground wins; kill/death feed and a small window | Deaths need the combat log or a "killed by" line; we avoid the combat log, so we only count deaths after a confirmed attack. |
| WorldPvP Gank Signal, MostWanted | Alerts and "wanted" lists of enemy players; shared between users of the same addon | Same idea as our Call for help. None keep a guild leaderboard. |
| OpenPvPForever | Open-world PvP event log | Confirms there is no standard guild-level world PvP stat to stay compatible with. |

Gap: every one of them is single-player. None counts **defends** (helping a guildmate) or **calls
answered**, and none feeds a guild board. That is the part only Guilded can do, because Call for help
already knows who asked and who came.

## Signals we can read (no combat log)

- **Kills**: the game's honor-gain line (`CHAT_MSG_COMBAT_HONOR_GAIN`). Same signal Milestones already
  uses for the lifetime honorable-kill count. Read through the client's own global string so every
  language works. Not counted inside instances (battlegrounds have their own ladder).
- **Deaths**: `PLAYER_DEAD` within a minute of an attack by an enemy player confirmed by Call for help.
  A death with no confirmed player attacker (fall, NPC) is not a PvP death.
- **Calls made**: pressing Call for help. **Calls answered**: a guildmate whispers "On my way" to my
  call. **Calls I answered**: I press On my way.
- **Defends**: an honorable kill within 5 minutes of pressing On my way on a guildmate's call.

## Stage 1: addon (built)

`addon/Guilded/Modules/WorldPvP.lua`, module key `worldpvp` (on by default, can be turned off in the
module list). Stored in the saved variables as `worldPvp`: `total`, `week` (resets at the Tuesday 15:00
UTC reset), `recent` (last 30 kills: victim, zone, time, defend flag). `/guilded worldpvp` (or `wpvp`)
prints this week and the total. Nothing is sent anywhere. Tests: `tests/lua/world-pvp.test.ts`.

## Stage 2: upload (planned)

1. `companion/lua-export-content.mjs`: export `worldPvp` (week key, week and total counters, recent
   kills capped at 30) next to `helpCalls`. Add the field to the schema in `src/integrations/addon.ts`
   and to the upload apply in `src/companion-api.ts`.
2. Prisma: `WorldPvpWeek` (guildId, playerId, weekKey, kills, deaths, defends, calls, answered,
   responded; unique on guild + player + weekKey), hand-written migration. Upload sets the row from the
   addon's counters (take the larger value, never lower, so a re-upload cannot reduce a score).
3. Anti-farming, decided now so the numbers are trustworthy:
   - Counters come from the member's own addon, so cap the weekly kills counted for ranking (suggest
     300) and require the kill lines to be in `recent` with distinct victims for the capped part.
   - Same victim killed more than 3 times in a week stops scoring on the board (still counted in the
     member's own stats).
   - Defends count only when a matching call from a guildmate exists in the guild's `helpCalls` for
     that week, so a defend cannot be claimed without a real call.
   - Needs the same consent as the other PvP ladders: shown only for members who linked their
     characters, and removed by Delete my data.

## Stage 3: Discord board (planned)

- A "World PvP" section on the existing PvP ladder (`src/services/bg-ladder.ts` and
  `src/services/duel-board.ts` are the models): weekly top 10 by kills, with defends and calls answered
  as the tie-breakers and as extra columns; a "Defender of the week" line for most defends.
- Drawn with `score-card.ts` like the other ladder cards, including the since-yesterday arrows.
- On by default with officer and member off switches (ROADMAP rule 5). No automatic award; any award
  stays opt-in per server.
- FR/DE/ES for new Discord text follows the existing `tx()` rules.

## Open questions for the owner

- Deaths on the board: decided yes on 13 November 2026 (owner request). The addon keeps zone and time of each death (never the
  killer's name or class), the bot stores `WorldPvpWeek.deaths` (capped at 500 a week, only goes up) and shows deaths and K/D beside
  kills on the board and in the Tuesday recap (one guild-total line). Deaths never raise a rank: the order stays kills, defends,
  calls answered, then fewer deaths, then name, and a member with only deaths is left off. An addon older than 9.3 sends no deaths (0).
- Weekly reset: matches the raid week (Tuesday). Confirm, or use a rolling 7 days.
