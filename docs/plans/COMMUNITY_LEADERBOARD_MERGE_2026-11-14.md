# Community leaderboard merge (14 November 2026)

Owner request: "remove the activity guild leaderboard and points and combine those into the community leaderboard, so the points for
in-game guild activities like dungeons, PvP and battlegrounds are combined with the Discord leaderboards; and make the Discord
community leaderboards have a card also and a nice leaderboard."

## What exists today

**Guild activity ladder** (`services/guild-activity.ts`, 9.1). One bot message in the dungeon leaderboard channel (else the duel
ladder channel), edited in place every 30 minutes (`ACTIVITY_BOARD` job, `main.ts`), plus `/stats activity` (private) and
`/stats activity-board:false` (officer switch, also `server.activityBoard` in the companion). Per member it adds three sources:

| Source | Points | Weekly cap |
| --- | --- | --- |
| Dungeons | the season ledger (`DungeonPointTransaction`; a completion is 50, a clean run about 115) | none |
| Battlegrounds | 15 per consented report, +5 for a win | 300 |
| Duels | 5 per counted win, 2 per counted loss | 100 |

It stores only the message id (`GuildSettings.activityBoardMessageId`), the on/off switch (`activityBoardEnabled`) and the daily
rank snapshot (`activity:*` rows in `LadderSnapshot`). Open-world PvP was not part of it ("no points or awards").

**Community leaderboard** (`services/community-leaderboard.ts`, refreshed from `main.ts`). The "Community podium" is one pinned
message of embeds (top 10 text, no card) in the leaderboard channel of the community category. A member's points are the
`CommunityPoint` ledger of the active Discord community season (monthly by default): messages, reactions, shared voice, poll
votes, dice, gaming nights, quizzes, challenges, helper nominations. `standings()` makes the earned score (AWARD + REVERSAL) and
a separate spendable balance. The "Full rankings" and "My points" buttons (`commands/community-hub.ts`), `/community`, the month
end archive (`finalStandings`) and the honors (podium roles, monthly rookie) all read these standings.

## The merge

One leaderboard per server: the community podium. A member's earned score for a season is

    community points = Discord points (unchanged, from the ledger) + in-game points (computed, see below)

- **In-game sources:** dungeons, battlegrounds, duels and now open-world PvP. Each row shows the breakdown: Discord, dungeons, PvP
  (PvP = battlegrounds + duels + open-world), and the total. `/community` "My points" shows the same split.
- **Computed, not written.** In-game points are read from the tables that already hold them (dungeon ledger, duel results,
  battleground reports, world PvP weeks) every time the board is drawn, for the season's window (season start to now; for a closed
  season the window ends when it ended). Nothing is added to the community ledger, so the spendable balance (lottery tickets) is
  not inflated by game activity, and "carry over the existing activity points" is automatic: the underlying rows are untouched and
  the current period picks them up the moment the new board draws.
- **Period:** the community season, exactly as today (monthly by default, an officer can end one early). With no active season the
  board shows the in-game points of the last four weeks (what the old ladder did when there was no dungeon season). Closed seasons
  freeze `finalStandings` with the merged total and the breakdown stored beside it (extra fields; older rows without them stay
  readable and count as all-Discord).
- **Season end and honors:** the monthly archive and the podium roles / monthly rookie use the merged total, because they read
  `finalStandings`. The *weekly* MVP and the weekly honors recap still read the ledger by week (Discord points only): in-game points
  are not stamped per week in the ledger, so they cannot be added there without writing to it. That is the one place the two scores
  stay apart.

## Point scale

The old ladder printed raw points next to the community's. Raw, a regular dungeon player earns about 600 a week from dungeons
alone (a 50-point completion, 25 more for a clean run, repeats of the same dungeon worth 100% / 50% / 0%), while the Discord caps
allow a very active chatter about 48 a day (10 messages, 6 reactions, up to 32 from voice). Dungeons would bury Discord.

**Chosen: every in-game point counts one fifth.** The old values and weekly caps are kept as they were; one divisor is applied
after the caps, per source, rounded to a whole number. Open-world PvP (new) is expressed in the same old units.

| Source | Old units (kept) | Community points |
| --- | --- | --- |
| Dungeons | ledger points (completion 50, clean run ~115) | ÷ 5 → a completion is 10, a clean run about 23 |
| Battleground game | 15, +5 for a win, cap 300 / week | 3, +1 for a win, cap 60 / week |
| Duel | 5 win, 2 loss, cap 100 / week | 1 win, 0.4 loss (counted after the cap), cap 20 / week |
| Open-world PvP (new) | 5 per kill, +5 per defend, 5 per call answered, cap 125 / week | 1 / +1 / 1, cap 25 / week |

Weeks are the reset week (Tuesday 15:00 UTC), as before. World PvP weeks count when they start inside the season window.

Worked examples (one month):
1. A raider: 4 dungeon completions worth 340 old points → 68; 6 battlegrounds (4 won) = 110 → 22; 10 duels (6 won) = 38 → 8;
   open-world 30 kills, 8 defends, 5 calls = 215, capped 125 → 25. In-game 123, plus 180 Discord = **303**.
2. A chatter who ran one dungeon (50 → 10) and has 300 Discord points: **310**. A player who only plays in game is not out of
   reach: about 13 clean dungeon runs (23 each) match that chatter's 300.

## Anti-inflation

Unchanged and not described in member-visible text. The old duel / battleground weekly caps and the "only counted duels, only
consented battleground reports, only active members" filters apply before the divisor. Discord caps (daily message and reaction
caps, cooldown, duplicate hashes, voice minutes, reaction limits) are untouched. The card footer and the embed do not mention caps.

## What is removed

- The separate board: `services/guild-activity.ts`, the `ACTIVITY_BOARD` job (a queued one is dropped quietly), the 30-minute
  refresh, `/stats activity` and `/stats activity-board` (the options leave `/stats`).
- The channel: the ladder never had its own channel entry in `setup-names.ts` (it lived in the dungeon leaderboard channel), so
  `/setup` does not change. The old message is not deleted by the bot: at startup it is edited once into a final notice pointing to
  the community leaderboard and then left alone (its saved id is cleared). An officer can delete that message by hand.
- Stored rows stay: `GuildSettings.activityBoardEnabled`, `activityBoardMessageId`, `LadderSnapshot` rows named `activity:*` (they
  age out on the existing 14-day prune). No migration. The companion's `server.activityBoard` action is still accepted so an older
  companion does not error; it does nothing.

## The card

The podium message gets a painted card in the new banner-and-body layout (the ladder layout through `card-next.ts`): rank with the
painted medallions for the top 3, member name, the total in gold, the three small figures Discord / dungeons / PvP, the "since
yesterday" arrows (snapshot board `community:<season>`). Backdrop: the approved `season-podium` painting (key `community`, falling
back to it); a dedicated painting is requested in `Guilded-Art/community-card/PROMPT.md`. Text under the card: ranks 1 to 10 with
the split on each line, in English and French. The card is attached by REST and replaced only when the standings change.

## Switches

Community seasons and participation keep their officer switches. There is no new automatic message. The old ladder's off switch
disappears with the ladder.

## Update, 14 November (owner: "divide by 3")

The scale above (one fifth) is superseded: every in-game source is divided by 3 (dungeons, battlegrounds, duels, open-world PvP), per the production numbers in `COMMUNITY_SCORING_PROPOSAL_2026-11-14.md`. The values live in server-side config (`scoring()` in `community-ingame.ts`, optional environment override `COMMUNITY_INGAME_SCORING`), never in member text. Built with it: a soft daily curve for duels and battlegrounds (full, then half, then a quarter), a rematch rule for duels (same opponent within 7 days counts half), the in-game read done before the season-end transaction opens, a one-minute cache of a live window, ordered reads, and the open-world week that overlaps the window start. PvP is rechecked after the first battleground weeks and the 9 December raids.
