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

## Production numbers (read-only, 14 November, last 28 days) and the recommendation

- Discord: week of 9 Nov 34 members, 2099 points (about 62 per active member); 2 Nov 25 members, 1605; earlier weeks 5 to 13 members.
- Dungeons (raw ledger points per member per week): 2 Nov 8 members, average 144, median 125, top 250; 9 Nov 17 members, average 229, median 100, top 675.
- Battlegrounds: no rows. Duels: 3 counted in the week of 9 Nov. Open-world PvP: 2 members, 0 kills, 11 deaths in one week, 1 call answered in another.

What this changes in the estimates above: a real chatter is about 62 a week (not 110), and a real dungeon runner does about one run a week (median 100 raw), not four.
At the shipped 1/5 the median runner gets 20 against 62 for the chatter: dungeons are under-weighted, not over-weighted (raw 100 looks equal to chat only before dividing).

**Recommended scale**

| Source | Divider | Median week | Average | Top |
| --- | --- | --- | --- | --- |
| Dungeons | 1/3 | 33 | 76 | 225 (the soft curve trims the top further) |
| Battleground game / win | 5 / +2 (1/3 of the old 15 / +5) | no data | | |
| Duel win / loss | 1.7 / 0.7 (1/3) | no data | | |
| Open-world PvP | 1/3 | no data | | |

Rationale: a dungeon runner with one clean run (about 115 raw, 38) lands in the same 30 to 60 range as a chatter; a heavy runner (675 raw) is not buried and not 3x the whole server. PvP has too little data to tune: it follows the same 1/3 by design and is re-checked after the first battleground weeks (raids open 9 December). The soft per-day curve and rematch rule stay as proposed; they matter more for PvP than for dungeons today.
Decision for the owner: ship 1/3 for dungeons and PvP (recommended), or keep 1/5 (safe but dungeons under-count), or 1/4 (in between).
