# Boss-skip scoring (14 November 2026)

Owner request: "make sure dungeon scoring adapts for boss skips, so the most points is not always to skip all bosses and do the end boss only."

Status: built. A season carries it as one line in its rules (`bossScoring: { version: 1 }`); rules without it score as before. It is switched on for Season 1 by the owner-run script in section 6 (not yet applied) and is the default for Season 2.

## 1. The problem

A run is scored `200 x target / time` (clamped 50 to 400), then the over-level penalty. The target is the time of a full clear. The addon ends a run when the final boss dies, so a group that runs straight to the final boss and skips every optional boss finishes in a fraction of the target and scores up to 400, twice a normal full clear. Skipping is always the best play.

## 2. What the rule can use

- A boss list per dungeon with the required (final) boss: `src/services/dungeon-bosses.ts`. Every Season 1 dungeon is listed (19 lists: Scarlet Monastery has one per wing, keyed `189:graveyard`, `189:library`, `189:armory`, `189:cathedral`). A boss carries every id it was recorded under (any one counts as a kill; a name also matches when an id is unknown), exactly one boss per dungeon is the final boss, and rare or secret bosses are marked `optional`: they are not part of the total and add nothing, so a normal full clear never looks like a skip because of them. The lists are our own data file with only names and ids as facts: the guild's recorded ids of 10 to 14 November plus the game's journal ids (an out-of-repo reference table, cross-checked by name); no other addon's files or text were copied. `--kill-shares` (section 6) prints, per dungeon, how many completed runs killed each id, so the optional flags are checked against real play before the rule is applied.
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

Floor: after the cap the result is raised to the shared floor of 50 (a counted run is never below 50 anywhere in the rating), never above the run's own time score. The cost is that a slow skip-everything run ties a slow full clear at 50. Owner decision, 14 November 2026: keep formula C unchanged.

Cost of C: a group that legitimately cannot fight a boss (bugged, too many deaths to retry) is capped at 200 x share. That is intended: the board rewards finishing the dungeon.

Properties are tested exhaustively (`tests/dungeon-boss-scoring.test.ts`): for every pace from 10 to 120 minutes and every number of skipped bosses, a skip run never beats the same pace done as a full clear, never reaches 200, and more bosses never score less.

## 4. When a boss cannot be detected

- **No boss list for the dungeon** (or a list with fewer than two required bosses, such as the Armory): scored exactly as before, no "bosses" shown.
- **No encounters at all in the run** (the recorder sent none): scored exactly as before, no "bosses" shown.
- **Encounters present but none of the dungeon's bosses in them:** read as final-boss-only (1 of N), because a completed run always carries evidence of what it killed. A Scarlet Monastery run whose wing cannot be told from its final boss is scored as before.
- **The guild board reads `competitionData.encounters`, the public board `run.evidence.encounters`.** A run whose encounters are on only one of them is adjusted on that board and scored as before on the other (tested).
- **A boss killed but not recorded:** counts as skipped, because the rule can only use what was recorded. Several witnesses' encounters are already merged, so one guildmate with the addon in range is enough. This is the one place a player can be unlucky; the run page shows "Bosses 5/6" so a wrong count is visible.
- **The final boss event is missing but the run completed:** the final boss counts as killed (the run ended on it).
- **Wipes and npc events** never count as kills.

A run with no encounters at all still scores as before; in practice a completed run always carries at least its final boss event from the same addon.

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
npx tsx scripts/season-rules-change.ts --kill-shares           # read-only: per dungeon, each boss id with the share of completed runs that killed it
options: --off (switch the rule off instead) --top 20 --note "why"
```

The dry run prints, per dungeon, the runs, the runs scored differently, the points removed and the runs with skipped or unreadable bosses; the boss ids recorded in dungeons with no list yet; and, for the top 20 of each bracket, old score -> new score and rank old -> new with the move. It reads the accepted public runs of the season and alters nothing.

What apply does, in one transaction under the exclusive calendar lock:

- replaces the running season's official snapshot rules and every guild's active copy of that season with the same rules plus `bossScoring { version: 1, since: <now> }`. Targets, routes, brackets and best-N are rebuilt unchanged (`reviseRules` only touches a scoring block and validates the result);
- appends a revision to the snapshot: when, who (`--by`), the note, the old and new rules in words, the exact patch and its inverse, how many guild seasons followed, and the previous rules kept whole;
- never touches a stored run, player, boss or time. Scores, ranks and boards are computed from the runs and the season's rules whenever they are read, so replacing the rules is the whole recomputation. Cached pages and the Discord boards pick it up on their next refresh; nothing is rescored in place.

Restore applies the inverse of the latest change that was not already undone (also recorded, as a "restore" revision), so the history stays honest and the rules return exactly.

Everything that shows a Season 1 score follows, because it reads the same rules: the guild boards, the public leaderboards, player pages, the run page and card, season cards, and "best next improvement" (its scenarios assume a full clear, which is exactly what the rule rewards). **Addon dependency (found in review, 14 November 2026).** The 9.3.1 addon checks each run row of a member's season details against its own recomputation `clamp(200 x target / time, 50, 400)` times the penalty, and drops the member's season detail panel when a counted run's points differ. A boss-adjusted row differs, so the rule is safe for members only from the addon release that carries the `SeasonDetails.lua` tolerance (a counted row at or below the recomputation is shown with the server's points). Order: merge with the rule off, then release that addon, then apply to Season 1. Season 2's default-on depends on the same release. The post-run "~points" estimate in `RunResults.lua` stays a labelled provisional estimate that ignores bosses until the addon gets the boss lists.

Active cooperative goals: a goal stores a hash of its season rules, so after a change it no longer matches and has to be recreated.

Caches: the script runs outside the bot, so the website can show old scores for about 20 minutes; restarting the bot after `--apply` forces every board to refresh at once.

Order on production (each with a backup first, docs/DEPLOY_ORACLE.md): the Drowned City recovery (`scripts/recover-drowned-city-runs.ts`, dry run then `--apply`), then `--kill-shares` and the boss-list check, then this rules change (dry run, then `--apply --by`), then any target recalibration.

Season 2 defaults to the new rules: `season2-review` / `season2-activate` include the rule unless `boss_scoring:false`, and a Season 2 snapshot frozen without reviewed rules carries it too.

## 7. Where it shows

- Public run page: a "Bosses 5/6" tile, and on the run card a "Bosses 5/6" badge. They show for any run of a dungeon with a boss list, whether or not the season scores skips.
- Discord run card: "Bosses 5/6" under the final boss.
- "How scores work" on the leaderboards page (and the Discord scoring guide) gains a plain sentence, only for seasons whose rules carry the rule: "Bosses count: a run that kills every boss of the dungeon keeps its full time score. A run that skips bosses is rated against the same target, but its time score is capped at the on-target score (200) and multiplied by the share of bosses killed, so skipping never beats a full clear. When the bosses of a run cannot be read, the run is scored as before." (French text beside it.)

## 8. Owner decisions

1. Run the dry run on production, look at the tables, then apply (the owner chose Season 1 now).
2. Order: merge with the rule off, release the addon with the tolerance, then apply to Season 1 (never before).
3. Optional bosses follow one rule: killed in fewer than 60% of at least 5 completed runs (14 November 2026: Old Serra'kis, Lordaeron Captain, Lyn the Ignored). With fewer runs the journal and judgement decided: Cookie, Lorgus Jett and Obsidian Sentinel (never or once seen, rare or secret in the game), Ragglesnout (a rare, 1 of 2 runs). Re-run `--kill-shares` as data grows.
4. Cooperative goals: recreate any active goal after apply (see above).
