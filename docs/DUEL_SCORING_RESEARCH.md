# Duel scoring: today's rules, weaknesses and three proposals (13 November 2026)

Research note for the owner's decision. Nothing in the scoring was changed by it. The public duel page (PR "duel leaderboard") reads the rules from one
place (`DUEL_RULES` in `src/services/duel-rules.ts`), so a later change updates the page's "how scoring works" box.

## 1. How scoring works today

| Rule | Value | Where |
|---|---|---|
| Points for a win | 10 base, +2 per level the loser is above the winner, -2 per level below, clamped 0..20; an unknown level (either side) gives 10 | `src/services/duels.ts:144-154` (`duelPoints`); addon copy `addon/Guilded/Modules/Duels.lua:36,168-172` (`duels.points`) |
| A loss | costs nothing (no points, but it is a game: lowers win rate and breaks a streak) | `duels.ts:165-169` |
| Ranking | points, then wins, then win rate, then fewer losses, then name | `duels.ts:170-171`; Lua `duels.standings` `Duels.lua:271-277` |
| Streak | current run of wins (+) or losses (-), best streak is the longest win run | `duels.ts:167-168`; `Duels.lua:260-262` |
| Period | all-time; no season, no decay (`duelLeaderboard` accepts `since` but nothing passes it) | `duels.ts:175-179` |
| Who counts | both players must be known members of the same guild and different members (alts linked to one member are rejected); the uploader must be the winner or the loser | `duels.ts:80-83` |
| Pair cap | at most 5 counted duels per pair per UTC day, either direction; later ones are stored with `counted=false` (a replay cannot count them) | `duels.ts:15,88-93`; Lua `PAIR_DAILY=5`, `Duels.lua:30,231-238` |
| Reporter cap | at most 25 counted duels per reporter per UTC day (bot only; the addon has no such cap) | `duels.ts:16,91-93` |
| Dedupe | both players' companions report the same duel: same winner and loser within 120 s on the bot (60 s in the addon) is one duel | `duels.ts:17,85-87`; `Duels.lua:28,207` |
| Age | results older than 30 days or more than 5 minutes in the future are refused | `duels.ts:18,82-83` |
| Level used | the character's level stored when the upload is imported (not the level at the time of the duel) | `duels.ts:57,96` |
| Rewards | none; nothing is awarded or posted automatically | header of `duels.ts` |

Two small differences between the bot and the addon's in-game board: the dedupe window (120 s vs 60 s) and the reporter cap, which only the bot has. In
practice the numbers match except for rare edge cases, but one rule set has to live in two languages and be kept equal by hand.

## 2. Weaknesses, with examples from the simulation

The simulation (`duelsim`, seeded, 13 players, 21 days, 265 duels before caps) is reproduced in section 4. In today's ranking:

* **Farming with a friend.** Cato and Dede duel five times a day for ten days (the pair cap), Cato winning 3 and Dede 2 each day. They finish **3rd and 6th** of 13 with 300 and 200 points and a single opponent each. Win-trading between two friends is rewarded because losses cost nothing.
* **Volume beats skill.** Aria (32-4, the best player) is **5th** with 230; Ivo (19-21) and Jo (16-26, a losing record) are tied for 1st with 320 each. Bram (37-58) is 9th only because his opponents were low-level. Wins add up, losses never subtract.
* **Level 1 = level 60.** Two level-1 characters earn 10 per win exactly like two level-60 characters. A level-60 beating a level-1 gets 0 (good), but a pair of low-level alts farm full points.
* **No penalty for losing**, so playing a lot is always profitable even at 30% wins.
* **Alts and mismatches.** The only alt guard is "same linked member". An unlinked friend's alt works as a punching bag; the level clamp stops it only when the levels are 5 or more apart.
* **Class and gear imbalance** cannot be fixed by scoring; only level and result are known (the addon cannot read gear or the combat log).
* **New players never catch up.** Points are cumulative all-time: Fay (22, 9-3) is 7th.
* **Inactivity.** Nothing decays, so a veteran who stopped in November stays on top.
* **Reporting trust.** Every result comes from a member's own addon; two cooperating members can invent duels (the dedupe only checks winner, loser, time). The caps limit the damage but do not remove it.

## 3. How comparable ladders score (and what fits a small guild)

* **Elo** (chess, many games): rating change = K x (result - expected). Expected comes from the rating gap, so beating a stronger player pays more and a loss to a weaker one costs more. K is high for new players (provisional), lower later. Elo is the natural fix for "volume beats skill" and "no penalty for losing", it is zero-sum, and a rating can be explained in one line.
* **Glicko / Glicko-2** (Lichess, many online games): Elo plus a rating deviation that shrinks with games and grows with inactivity. Better statistics but harder to explain and needs per-period updates; too heavy for a few dozen players.
* **WoW arena / battleground ladders**: season-based rating with a minimum of games and a decay, sometimes a win-streak bonus. Seasons solve "new players never catch up" and "inactivity".
* **Win-streak bonuses** are popular for fun but amplify farming (a friend can feed a streak), so they are better kept as a displayed statistic than as points.
* **Minimum games / distinct opponents to be ranked** is the cheapest anti-farming rule: a ranking with one opponent is meaningless.
* **Diminishing returns per pair** (the n-th duel of the same pair in a window is worth less) is used by trading-card and fighting-game ladders against win-trading.
* **Fit for a small guild with self-reported results**: results can be faked by two cooperating members, so (1) do not make the number depend on a single pair, (2) require several distinct opponents, (3) keep the pair cap, (4) reduce the value of repeated pairs, (5) keep the stakes social: no rewards (already the rule). Elo's zero-sum nature helps here: a farmer takes rating from a friend, and with few opponents that friend is simply unranked.

## 4. Three proposed rule sets, simulated

All keep the existing caps (5 per pair per day, 25 per player per day) and the "no rewards" rule. "Weekly pair weight" = the n-th counted duel of a pair in a calendar week counts 1, 1, 0.5, 0.5, 0.25, 0.25, then nothing.

* **A. Points, hardened.** Same points as today x the weekly pair weight; ranked only with 5 duels against 4 distinct opponents (unranked players are listed below the ranking, with their record).
* **B. Elo.** Start 1000; K = 40 for a player's first 10 duels, 24 up to 30, then 16; expected result uses the rating gap plus a level handicap of 20 points per level of difference (capped at 5 levels); K multiplied by the weekly pair weight; ranked after 8 duels against 4 opponents. The old "duels won" counter stays as a fun statistic.
* **C. Elo, shrunk.** As B, but the displayed score is `1000 + (rating - 1000) x games / (games + 10)`, so a few lucky wins cannot top a long record; ranked after 5 duels against 4 opponents.

Simulation results (ranked rows; "not ranked" = fewer than 4 distinct opponents):

| Player (story) | Today | A | B | C |
|---|---|---|---|---|
| Aria (32-4, best, plays little) | 5th | 5th | 2nd | **1st** |
| Fay (new, level 22, 9-3) | 7th | 4th | **1st** | 2nd |
| Bram (37-58, plays a lot) | 9th | 7th | 7th | 7th |
| Jo (16-26) | 2nd | 1st | 3rd | 3rd |
| Ivo (19-21) | 1st | 3rd | 4th | 4th |
| Cato / Dede (farming pair, one opponent) | 3rd / 6th | not ranked | not ranked | not ranked |
| Eli (60-0 against three friends) | 10th (0 points: level gap) | not ranked | not ranked | not ranked |

Full tables from the run:

```
Today          1 Ivo 320 (19-21)  2 Jo 320 (16-26)  3 Cato 300 (30-20, 1 opponent)  4 Hana 280  5 Aria 230 (32-4)  6 Dede 200  7 Fay 180 (9-3)  8 Gus 80  9 Bram 60 (37-58)  10 Eli 0 (60-0)
A              1 Jo 240  2 Hana 195  3 Ivo 180  4 Fay 180  5 Aria 95  6 Gus 63  7 Bram 35 | unranked: Cato 80, Dede 23, Eli 0, Kit1-3 0
B (Elo)        1 Fay 1142  2 Aria 1113  3 Jo 1012  4 Ivo 1006  5 Hana 987  6 Gus 945  7 Bram 914 | unranked: Cato 1052, Dede 948, Eli 1140, Kit1-3 ~940
C (shrunk)     1 Aria 1089  2 Fay 1078  3 Jo 1009  4 Ivo 1005  5 Hana 989  6 Gus 955  7 Bram 922 | unranked: Cato 1043, Dede 957, Eli 1120, Kit1-3 ~960
```

Reading it: A only mends farming; a 32-4 player still ranks 5th because points still pay for volume. B and C rank Aria and Fay at the top, put the 37-58 volume player last, and
keep farmers out of the ranking, until they duel enough different people (then their rating reflects real results).

## 5. Recommendation

**Rule set C** (Elo-style rating, shrunk toward 1000 while the record is short), with the "duels won" and win-rate columns kept next to it. It answers every weakness
in section 2 except class imbalance, is a single-sentence explanation ("beat stronger players to rise, a loss to a weaker player hurts; new records count less"),
and degrades well when results are self-reported. Cost: it is a number members have to learn instead of "points".

Switching without rewriting history unfairly:

1. Keep every stored result and the old points. Nothing is deleted or recalculated into old rows.
2. **Start the new rules at a date** (best: the start of a calendar month, announced a week before), with the old ladder frozen as "Season 0 (points)" and kept as a read-only page. The new ladder starts everyone at 1000.
3. The board shows which rules apply (`DUEL_RULES.id`, name and start date), and in the transition month both can be shown.
4. A season is a calendar month or a quarter; the rating resets each season (or is pulled halfway to 1000) so new players can catch up. The page already supports a season filter for this.

Addon changes needed (the in-game board and the end-of-duel card must agree with the bot): replace `duels.points` and the sort in `duels.standings` with the rating loop (the same
constants), keep `counted()` for the pair cap, add the weekly pair weight and the "ranked" rule, show the rating change on the end-of-duel card instead of "+N points", and bump
the addon protocol/version note so older addons are marked "old rules" rather than showing wrong numbers. Both sides need a shared test vector file (a list of duels and the expected ratings) so Lua and TypeScript cannot drift. The addon also needs the same dedupe window as the bot (use 120 s).

Anti-abuse limits to keep or add: pair cap 5/day (keep); 25 counted per player per day (add it to the addon, it exists only in the bot); weekly pair weight (add); minimum 4 distinct opponents to be ranked (add); level gap above 10 either way counts for nothing; no rewards; officers can mark a pair "not counted" from the existing moderation tools (later).

Open questions for the owner: minimum duels/opponents (5/4 is tuned for a guild of ~30 active duellists), season length (month or quarter), and the start date of the new rules.

## 6. Decision (13 November 2026)

The owner chose rule set C. Implemented as `src/services/duel-rating.ts` (rules and pure functions), with these defaults: ranked after 8 duels against 4
different opponents (placement shown as "3/8"), the weekly pair weight of section 4 (the weekly window is the existing Tuesday 15:00 UTC reset), duels between
players more than 10 levels apart move nothing, calendar-month seasons in UTC, everyone back to 1000 each season, and the first rated season starting on
1 December 2026 00:00 UTC. Earlier duels stay as the frozen "Season 0 (points)". `GuildSettings.duelRatingStartsAt` lets one server move its own start date
(for tests); null means the default. The addon follows [DUEL_RATING_ADDON_SPEC.md](DUEL_RATING_ADDON_SPEC.md).
