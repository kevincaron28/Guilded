# Boss-skip scoring (14 November 2026)

Owner request: "make sure dungeon scoring adapts for boss skips, so the most points is not always to skip all bosses and do the end boss only."

Status: built. A season carries it as one line in its rules (`bossScoring: { version: 1 }`); rules without it score as before. It is switched on for Season 1 by the owner-run script in section 6 (not yet applied) and is the default for Season 2.

## 1. The problem

A run is scored `200 x target / time` (clamped 50 to 400), then the over-level penalty. The target is the time of a full clear. The addon ends a run when the final boss dies, so a group that runs straight to the final boss and skips every optional boss finishes in a fraction of the target and scores up to 400, twice a normal full clear. Skipping is always the best play.

## 2. What the rule can use

- A boss list per dungeon with the required (final) boss: `src/services/dungeon-bosses.ts`. Only The Drowned City (6 bosses, final boss Min'loth the Serpent) is listed today, read from the guild's real runs of 10 to 14 November. Every other dungeon has no list yet: the rule leaves it exactly as it is.
- The run's successful encounters (`success: true`, native, combat-log or peer, already merged across witnesses). A boss counts as killed when one successful kill of its encounter id is in the run. The final boss always counts, because the run was completed by it.
- The target time keeps meaning "a full clear".

## 3. Three formulas on real run shapes

Shapes use a 40 minute target (2400 s) on The Drowned City, 6 bosses. `s` = bosses killed / 6.

| Run shape | Today | A. Share multiplier (`time score x s`) | B. Shorter target (`target x (1 - 0.6 x (1 - s))`) | C. Capped share (`min(time score, 200) x s`) |
|---|---|---|---|---|
| Full clear on target (40:00, 6/6) | 200 | 200 | 200 | **200** |
| Fast skip run (20:00, 2/6: first boss and final boss) | 400 | 133 | 240 | **67** |
| Fast, one boss skipped (30:00, 5/6) | 267 | 222 | 240 | **167** |
| Slow full clear (60:00, 6/6) | 133 | 133 | 133 | **133** |

What each formula does:

- **A. Share multiplier.** Skipping costs a share of the points, but the saved time still earns up to 400. A fast run with one boss skipped (222) beats a full clear on target (200). It fails your requirement.
- **B. Shorter target.** Fair on paper (a skipped boss takes its time out of the target), but groups that skip also skip the trash and walking, so they beat even the shortened target by a lot. Both skip rows (240) beat a full clear on target. It fails too.
- **C. Capped share (recommended).** A run that kills every boss scores exactly as today. A run that skips is rated against the same target, but its time score is capped at the on-target score (200) and then multiplied by the share of bosses killed. The cap is what makes the guarantee: the best a skip run can ever score is 200 x (bosses killed / bosses), which is less than 200, and a full clear within the target always scores 200 or more. At the same pace a full clear always scores at least as much as the run with skips, and more bosses never score less.

A flat "full clear bonus" was also considered. It leaves the fast skip run at 400 against 250 for a full clear on target, so it does not meet the requirement either.

Cost of C: a group that legitimately cannot fight a boss (bugged, too many deaths to retry) is capped at 200 x share. That is intended: the board rewards finishing the dungeon.

Properties are tested exhaustively (`tests/dungeon-boss-scoring.test.ts`): for every pace from 10 to 120 minutes and every number of skipped bosses, a skip run never beats the same pace done as a full clear, never reaches 200, and more bosses never score less.

## 4. When a boss cannot be detected

- **No boss list for the dungeon** (every dungeon except The Drowned City today): scored exactly as before, no "bosses" shown.
- **No readable boss evidence in the run** (no encounters, or none of the listed boss ids in it): scored exactly as before, no "bosses" shown. The run is not punished for a recorder problem.
- **A boss killed but not recorded:** counts as skipped, because the rule can only use what was recorded. Several witnesses' encounters are already merged, so one guildmate with the addon in range is enough. This is the one place a player can be unlucky; the run page shows "Bosses 5/6" so a wrong count is visible.
- **The final boss event is missing but the run completed:** the final boss counts as killed (the run ended on it).
- **Wipes and npc events** never count as kills.

A run with no boss evidence scoring as before is a small hole: a group could skip and then upload no encounters. In practice the completed run always carries at least its final boss event from the same addon; if this shows up it is a one-line change to treat "no boss evidence" as the final boss only.

## 5. Seasons and rules versions

- The rule lives in an optional `bossScoring: { version: 1 }` block of the version 6 rules (`dungeon-november-rules.ts`), the same pattern as scoring model 2. Rules without it score as before, forever, so a frozen snapshot never changes.
- Frozen rating rows record `bossesKilled` and `bossesTotal` on each detail; the row validator recomputes the points from them and refuses a forged count.
- Season 2 gets it by default (section 6). A mid-season rule addition keeps the block if the frozen rules already carry it.
- The guild board, the public leaderboards and the public run page all go through `bracketedVerdict`, so they agree.

## 6. Changing Season 1 (owner decision, 14 November 2026: "unfreeze season 1 rules so season 2 is perfect")

Season 1's rules are no longer frozen. Only the **running** season can change; ended seasons never do. One script, `scripts/season-rules-change.ts` (owner PC, needs `.env.local`):

```
npx tsx scripts/season-rules-change.ts                         # DRY RUN (default): writes nothing
npx tsx scripts/season-rules-change.ts --apply --by "name"     # apply: one transaction
npx tsx scripts/season-rules-change.ts --restore --by "name"   # undo the latest change (without --by: dry run of the undo)
npx tsx scripts/season-rules-change.ts --history               # every recorded change
options: --off (switch the rule off instead) --top 20 --note "why"
```

The dry run prints, per dungeon, the runs, the runs scored differently, the points removed and the runs with skipped or unreadable bosses; the boss ids recorded in dungeons with no list yet; and, for the top 20 of each bracket, old score -> new score and rank old -> new with the move. It reads the accepted public runs of the season and alters nothing.

What apply does, in one transaction under the exclusive calendar lock:

- replaces the running season's official snapshot rules and every guild's active copy of that season with the same rules plus `bossScoring { version: 1, since: <now> }`. Targets, routes, brackets and best-N are rebuilt unchanged (`reviseRules` only touches a scoring block and validates the result);
- appends a revision to the snapshot: when, who (`--by`), the note, the old and new rules in words, the exact patch and its inverse, how many guild seasons followed, and the previous rules kept whole;
- never touches a stored run, player, boss or time. Scores, ranks and boards are computed from the runs and the season's rules whenever they are read, so replacing the rules is the whole recomputation. Cached pages and the Discord boards pick it up on their next refresh; nothing is rescored in place.

Restore applies the inverse of the latest change that was not already undone (also recorded, as a "restore" revision), so the history stays honest and the rules return exactly.

Everything that shows a Season 1 score follows, because it reads the same rules: the guild boards, the public leaderboards, player pages, the run page and card, season cards, and "best next improvement" (its scenarios assume a full clear, which is exactly what the rule rewards). The **addon** does not compute scores: its season score, best-run points and board come from the standings the companion writes (`companion/standings-format.mjs`) from the bot's numbers. After apply the game shows the new scores at the next companion sync, with no addon release; until then the game and the website can differ for a member whose companion has not synced. Only the addon's own rule sentence (and a "bosses 5/6" hover line) waits for the next addon release.

Known edge: a cooperative goal stores a hash of its season rules; goals created before the change will not match the new hash. If any are active they need to be recreated.

What the code already tells us before the numbers come in: in Season 1 The Drowned City is still a waiting route ("No map ID observed yet") and the only dungeon with a boss list, so the first apply changes no stored Season 1 score yet. The dry run's second section lists the boss ids to add to `src/services/dungeon-bosses.ts` so the rule covers more dungeons.

Season 2 defaults to the new rules: `season2-review` / `season2-activate` include the rule unless `boss_scoring:false`, and a Season 2 snapshot frozen without reviewed rules carries it too.

## 7. Where it shows

- Public run page: a "Bosses 5/6" tile, and on the run card a "Bosses 5/6" badge. They show for any run of a dungeon with a boss list, whether or not the season scores skips.
- Discord run card: "Bosses 5/6" under the final boss.
- "How scores work" on the leaderboards page (and the Discord scoring guide) gains a plain sentence, only for seasons whose rules carry the rule: "Bosses count: a run that kills every boss of the dungeon keeps its full time score. A run that skips bosses is rated against the same target, but its time score is capped at the on-target score (200) and multiplied by the share of bosses killed, so skipping never beats a full clear. When the bosses of a run cannot be read, the run is scored as before." (French text beside it.)

## 8. Owner decisions

1. Run the dry run on production, look at the tables, then apply (the owner chose Season 1 now).
2. Add boss lists for the other dungeons (from the ids the dry run prints) so the rule has something to act on.
3. Cooperative goals: recreate any active goal after apply (see above).
