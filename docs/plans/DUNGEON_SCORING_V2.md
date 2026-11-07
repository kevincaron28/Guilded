# Dungeon scoring v2 (proposal for Season 2)

Status (7 November 2026): analysis tool and inactive Season 2 rules built; **no production numbers were read**
(this session has no database access). The tables below are filled by running the read-only script once.
Season 1 is untouched: its frozen rules and the 9.0.1 leniency stay as they are.

## 1. Get the real numbers (read-only)

```
npx tsx scripts/analyze-dungeon-runs.ts          # markdown report
npx tsx scripts/analyze-dungeon-runs.ts --json   # same, as JSON
```

It reads every accepted public run through the same store the leaderboards use, writes nothing, opens no Discord
session and prints no credentials. Code: `src/services/dungeon-analysis.ts` (pure, tested). It reports, per route:
runs, distinct crews, p10 / median / p90, the trimmed spread (outliers removed), median against the target, whether
the target is still an estimate, and a **suggested target** once the route is measured (20 clears from 5 crews).
It also reports the pooled **level effect** and the **party-size effect**, and lists clears of maps with no route.

| What to look for in the report | Why |
| --- | --- |
| `Status` thin / none and `(estimate)` on the target | Those routes still score against a guess. Most Season 1 targets are design estimates (`DUNGEON_SEASON_2_PLAN.md`). |
| `Median/target` far from 1 | A target no one reaches (or everyone beats) makes every score 50 or 400 and flattens the board. Aim: median score near 200. |
| Outliers | Under a third of the median is a timer error or skipped content; over three times is an AFK. They must never set a target. |
| `Level effect` | If groups above the band really finish faster, the flat 10% per level is the wrong shape. |
| `Party size` | Whether 1-3 player clears are a different population from full parties. |

## 2. What is wrong with Season 1 scoring (from the code, confirmed by the report)

1. **Targets are guesses for most routes.** Rating is `200 x target / time`, so a wrong target moves every score on
   the route by the same factor; best-N then picks the routes with the most generous guess. Fix: targets from data.
2. **The over-level rule is a cliff-plus-flat-rate.** A party 1 level over loses 10%; 4 levels over loses everything
   (beyond `maxLevels`). Time does not behave like that: each extra level shortens the run smoothly. Fix: price the
   level difference into the target (below).
3. **Level strictness hid real runs** (9.0.1 already relaxed presence, bands and evidence; the 2 under / 6 over window
   is kept in v2 because the price now makes it fair).
4. **No party-size rule.** A solo or duo clear of a five-player dungeon is ranked like a full party.
5. **Outliers are only filtered by the 80/50% presence rule**, not by time, so a timer glitch can set a record.

## 3. Proposal (scoring model 2, Season 2 only)

| Part | Rule | Why |
| --- | --- | --- |
| Targets | `proposeTarget` as in `DUNGEON_SEASON_2_PLAN.md`, fed by the report's **trimmed** medians and clean in-band runs | Measured routes use the crew/day median; blended 8-19; carried below 8 |
| Level fairness | Effective target = target x (1 - 0.05 x levels over the band + 0.05 x levels under it), floor 0.5x. Replaces the flat percentage (percentage is 0 in v2). Window: 6 over, 2 under; beyond is "Overlevel carry" / "Below level range" | A group 3 levels over must beat a 15% faster clock for the same points; the data fit (`Level effect`) replaces 0.05 when it is solid |
| Party size | Fewer than **3** observed players: "Party too small", unranked (the run still counts for participation and is stored) | Keeps duo/solo clears off the time board without hiding anyone |
| Outliers | The report's suggested targets ignore runs flagged by `findOutliers`; the Season 2 proposal already uses the crew/day median, which is robust. Feeding `findOutliers` into `observeSeason` is a small follow-up, not done here | Records stay honest without deleting evidence |
| Evidence | Season 2 default stays `current-v2` (observed start, native checkpoint, presence) | Unchanged from the Season 2 plan |

The numbers 0.05 and 3 are defaults in `SCORING_V2` (`dungeon-season2.ts`). After the report:
- if `Level effect` shows a fitted slope from at least 30 runs, replace 0.05 with it (clamped 0.02-0.10);
- if the 4-player median ratio is within 5% of the 5-player one, consider `minParty: 4` only for routes where it is rare.

## 4. What is built (all inactive)

- `scoring: { version: 2, timePerLevel, minParty }` is an optional rule field. Rule sets without it behave exactly
  as before (tests assert Season 1's verdict is unchanged). Public and guild scoring share `bracketedVerdict`, so a
  run scores the same on both.
- `/guilded-season season2-review scoring_v2:true` previews Season 2 with it (the attached `season2-rules.json`
  carries the field); `season2-activate scoring_v2:true` stores it. **Without the flag nothing changes.**
- It never reaches a running season: the frozen-rules design (`addedRules`) only copies leniency and new routes.
- `tests/dungeon-scoring-v2.test.ts` covers the analysis, the level price, the party minimum and Season 1 parity.

## 5. Owner steps

1. Run the script and read the report (send it to the coordinator).
2. Decide the two numbers (level price, party minimum) with the report in hand.
3. Preview: `/guilded-season season2-review scoring_v2:true`; activate with `season2-activate scoring_v2:true` as in
   `DUNGEON_SEASON_2_PLAN.md` (around 2 December; v2 seasons cannot gain routes later).

Not done here: backfilling stored runs, changing awarded participation points, or touching Season 1.
