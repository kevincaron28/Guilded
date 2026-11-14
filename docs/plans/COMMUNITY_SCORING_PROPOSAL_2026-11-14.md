# Community scoring proposal (14 November 2026)

Owner: "optimise scoring if needed for the community leaderboard." Numbers below are from the code; the "typical week" figures are
estimates until the read-only query at the end is run on production. Nothing here is member-visible wording about limits.

## What each source earns today (code)

| Source | Points | Limit in code |
| --- | --- | --- |
| Message | 1, 5 min cooldown, duplicates ignored | 10 per day |
| Reaction (listed emojis) | 1 | 6 per day |
| Shared voice | 2 per 15 min block (1 to 4 by officer choice) | 240 min a day = 32 |
| Helper thanks (officer-reviewed) | 15 | 3 per week |
| Dice | 2, or 5 on 90 to 100 | 1 per day |
| Gaming night, quiz, challenge | set per activity by officers | per activity |
| Dungeon run (old ladder, raw) | completion 50, clean run +25 (about 75 to 115), repeat of one dungeon 100% / 50% / 0% | none |
| Battleground (raw) | 15 per game, +5 win | 300 per reset week |
| Duel (raw) | 5 win, 2 loss | 100 per reset week |
| World PvP (raw, new in the merge) | 5 kill, 5 defend, 5 call answered; deaths score nothing | 125 per reset week |
| Raids, crafting orders, milestones | no community points today | |

A very active chatter can earn at most 48 a day (336 a week). A typical active chatter is 15 to 25 a day, so 100 to 175 a week.

## Typical weeks with the shipped scale (every in-game point counts 1/5)

- Chatter, 5 evenings: 10 messages + 4 reactions + 1 h voice (8) = 22 a day, **about 110**.
- Dungeon runner, 4 clean runs: 4 x 115 = 460 raw, **92**.
- PvP player, 6 battlegrounds (4 wins) + 10 duels + a good open-world week: 110 + 38 + 125 = 273 raw, **55**.

The chatter leads, the PvP player trails by half. That is the imbalance to fix.

## Proposed scale

1. **Same range for a comparable effort.** Target 90 to 130 for a solid week of any one kind. Change the dividers per source: dungeons 1/4 (a clean run is about 29, a week of four is 115), battlegrounds 1/3 (game 6, win 8), duels 1/3, open world 1/3. PvP week then is about 90 + 13 + 25 = 128.
2. **Diminishing returns, not public caps.** Per day and per source, the first actions earn full points, the next half, then a quarter (for battlegrounds: 3 full, then half, then a quarter; for duels: 4, then 2, then 1; for messages the 10 a day stays but is not named). The curve is one function, `softPoints(count, full, half)`; the values live in server config because they are anti-farming values.
3. **Quality over volume.** An abandoned or flagged ranked run earns 0 (already so); a completed ranked run keeps the clean bonus. Battleground win 2x a loss. A duel against someone not fought in the last 7 days is full value, a rematch half. Helper thanks stay at 15.
4. **Easy to read.** Board text, three lines: "Chat, react and join voice. Run dungeons. Win battlegrounds and duels. Every kind of play counts on the same board." The card already shows the Discord, dungeons and PvP split.
5. **No change to anything stored.** Still computed at render time; the ledger and the spendable balance stay as they are.

## Worked weeks (proposed scale)

| Week | Chatter | Dungeon runner | PvP player |
| --- | --- | --- | --- |
| Discord | 110 | 15 | 20 |
| Dungeons | 0 | 4 clean runs x 29 = 115 | 0 |
| PvP | 0 | 0 | 6 BG (4 wins) 38 + 10 duels with soft returns 11 + open world 25 = 74 |
| **Total** | **110** | **130** | **94** |

Recommendation: ship the shipped 1/5 scale now (it is safe: nobody is buried), and set the proposed dividers and soft curve after the production numbers come back. Today the values are `WEIGHTS` and `INGAME_DIVISOR` in `community-ingame.ts`; the per-source dividers, the soft-return curve and the rematch rule are NOT built yet (they wait for the owner's numbers).

## Read-only SQL for production (last 28 days, no personal IDs returned)

```sql
-- 1. Discord points per member per week, by kind
select date_trunc('week', "createdAt") wk, kind, count(distinct "userId") members, round(avg(amount),1) avg_amount, sum(amount) total
from "CommunityPoint" where "createdAt" > now() - interval '28 days' group by 1,2 order by 1,2;
-- 2. Dungeon points per member per week
select date_trunc('week', "createdAt") wk, count(distinct "memberId") members, round(avg(s),1) avg_week, percentile_cont(0.5) within group (order by s) median, max(s) top
from (select "memberId", "createdAt", sum(amount) over (partition by "memberId", date_trunc('week',"createdAt")) s from "DungeonPointTransaction" where "createdAt" > now() - interval '28 days') t group by 1 order by 1;
-- 3. Battlegrounds, duels and open-world PvP per member per week
select 'bg' src, date_trunc('week',"endedAt") wk, count(*) games, count(distinct "memberId") members, sum((outcome='win')::int) wins from "BattlegroundReport" where "endedAt" > now() - interval '28 days' group by 2
union all select 'duel', date_trunc('week',"endedAt"), count(*), count(distinct "winnerId"), count(*) from "DuelResult" where "endedAt" > now() - interval '28 days' and counted group by 2
union all select 'wpvp', null, sum(kills+defends+helped), count(distinct "memberId"), sum(kills) from "WorldPvpWeek" where "weekKey" >= (select max("weekKey")-3 from "WorldPvpWeek");
```
