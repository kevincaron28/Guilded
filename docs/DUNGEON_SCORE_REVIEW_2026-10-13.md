# Guild dungeon scores: review and candidate UI

Prepared 13 October 2026 in `codex/guild-dungeon-scores`, an isolated worktree
based on `codex/bridge-default-on`. No installed game files, bridge implementation,
companion settings, database, live service, or bridge test ZIP was changed.
Version stays 6.0.0. This is an uninstalled candidate, not real-client acceptance.

Local checks: TypeScript, ESLint, addon validation, 170 test files / 1,398 tests
passed. The full addon ZIP was built and its TOC contents verified. Six new Lua
regressions cover outsiders, retained history, departed members, unconfirmed
rosters, score messages, delayed roster loading, custom cards, season snapshots,
and the finder tab's load-on-demand/combat behavior. UI tests use mocked frames;
they do not establish visual quality or compatibility in the real Forever client.

## Implemented

- Score learning, the guild speed benchmark, ranking, tooltip lookup and message
  reception require confirmed current guild membership. The local character also
  qualifies while the client reports being in a guild. Legacy roster rows without
  `inGuild = true` are excluded until confirmed. Retained outsider history is not deleted.
- Roster updates replay retained runs so a roster that arrives after login does
  not permanently omit eligible guildmates. Leaving members disappear from the
  view on roster refresh. Filtering relies on the existing roster lifecycle;
  it is not a new live membership verification service.
- A Guilded scores tab attaches to `PVEFrame`, `LFGParentFrame`, or `LFGFrame`
  after the game loads it. It opens an opaque Guilded pane, with a Close button
  returning to the native view. Queue handlers and native tab handlers are untouched.
  Creation is deferred in combat. Unsupported custom finder frames use the
  **Scores > Dungeon overview** fallback in Guilded.
- Eight paginated dungeon cards show recorded score/time or an unrecorded state.
  The existing 19-entry Classic catalog is shown, plus recorded custom dungeons
  (such as Hall of Thanes). This is not a complete verified Forever dungeon catalog.
- Current and past season totals use the existing companion/officer snapshots.
  Nonmembers are filtered at display time; saved archives remain intact.
  A missing player means **Not in this snapshot**, never an invented zero.

**Data limitation:** cards are explicitly all-time local records. The existing
season transport contains names and totals, not per-dungeon season results,
season dates, rules version, or all character mappings. It cannot provide an
honest Raider.IO-style per-dungeon seasonal history. This candidate displays the
available seasonal totals separately. An end-to-end seasonal detail export is
follow-up work across the bot, companion and officer bridge, deliberately outside
the owner's concurrent bridge test. Main-character-only snapshots may omit an
alt's personal score; the view labels that absence rather than guessing identity.

## What retail currently does

Raider.IO describes character rating as the sum of the highest scoring run in
each dungeon. Repeated lower runs do not stack additional rating. Its currently
published base-score table gives +2 = 155, +4 = 200, +7 = 260, +10 = 320,
+12 = 365 and +15 = 410, with time modifying the base. That supports a
best-per-dungeon model driven principally by difficulty and secondarily by time.
It does not justify copying retail difficulty numbers onto Forever dungeons.

Sources checked 13 October 2026:

- [Raider.IO: character ranking](https://support.raider.io/kb/frequently-asked-questions/how-do-you-rank-characters-for-mythic-plus)
- [Raider.IO: base scores](https://support.raider.io/kb/frequently-asked-questions/what-is-the-base-score-value-for-each-level-keystone)
- [Blizzard: Midnight Season 2](https://news.blizzard.com/en-gb/article/24294369/midnight-season-2-is-now-live)

The support pages do not provide enough dated detail to assert a complete exact
current time-adjustment formula, so this proposal does not claim one.

## Three existing Guilded systems

| System | Current behavior | Consequence |
| --- | --- | --- |
| Local addon score | Level × 2, multiplied by 75–100% relative-speed factor and 75–100% individual death factor | Other players can lower your rating by improving the guild record. Unknown dungeons default to level 40. |
| Discord exploration rating | 100 per distinct dungeon; detected final boss and at least 80% presence; alts and difficulties share a slot | Stable and accessible, but little differentiation once everyone has explored the same dungeons. |
| Discord participation points | Completion 50; death bonus up to 25; first clear 25; personal record 15; guild record 25; full guild group 20; target bonus 20; weekly repeat multipliers 100%, 50%, 0% | Rewards attendance but mixes volume, personal survival, early-season records and performance. |

The addon chooses its best run using `seconds + deaths × 60`, but awards points
using a different formula. A 1,200-second run with one death can replace a clean
1,300-second run while scoring fewer points. A lower computed score can also be
masked by the maximum of that value and an old shared score. Local ratings are
therefore not authoritative season standings. Existing values are preserved in
this candidate; no rule change is silently applied to a running season.

## Recommended next-season rules: exploration plus a small challenge bonus

This is a proposed pilot, not a proven optimum or an enabled rule change.

1. **100 points per distinct dungeon**, once per season, for a detected final-boss
   completion with at least 80% presence. No points for simulations, abandoned runs,
   manual completions, unknown duration, or insufficient presence evidence.
2. **0–20 speed points**, against a target fixed before the season:
   `bonus = round(20 × clamp((targetSeconds - runSeconds) / (0.30 × targetSeconds), 0, 1))`.
   A clear at or above target earns 100; 15% faster earns 110; 30% faster earns 120.
   Every completion remains worthwhile. No target means 100 only.
3. **Keep the highest actual point result per dungeon.** Slower replays cannot
   reduce rating. Farming the same dungeon cannot stack rating. Alts share a
   member's slot on the authoritative server; separate difficulty/level brackets
   should only be introduced with trustworthy recorded metadata.
4. **No individual death penalty.** Deaths already cost time, and separate penalties
   can discourage tanks, learning groups, or a player taking a useful sacrifice.
   Survival and clean runs can remain optional badges.
5. **Keep helping/social rewards separate.** Full-guild and newcomer-help badges
   recognize cooperation without making a solo-scheduled member's skill rating
   inherently lower. Retain participation as a separately labelled board, not a
   second contribution to rating.
6. **Freeze rules, targets and final results by season.** Use stable instance IDs
   rather than name fragments; different wings must not accidentally collapse.
   Store the contributing run and rule version. No retrospective target changes.

Example: five ordinary clears score 500; five excellent clears score at most 600;
six ordinary clears also score 600. Exploration stays valuable while improvement
provides a modest competitive edge. Equal ratings share a rank; raw time records
remain visible for players who want a stronger speed challenge.

Calibrate targets from a pilot of comparable verified full clears, preferably
20 or more per dungeon, using a median baseline reviewed for route/level differences.
This is a sampling recommendation, not a guarantee of statistical sufficiency.
Do not derive targets from the live fastest guild record. Leave uncalibrated
dungeons at completion-only points. Review completion rate, repeat participation,
new-player participation and player feedback after one season before tuning.

## Remaining integration and client checks

- Add explicit season IDs/dates/rules and per-dungeon personal bests to the
  authoritative export, companion format and bridge in a coordinated later change.
- Preserve frozen past rules and standings; never mix the proposed 100–120 model
  with historical local scores or old participation totals.
- On Forever, verify the actual finder frame, tab placement at different UI scales,
  pagination, close/reopen, load-on-demand, combat, queueing and English/French.
- Verify the guild roster on both PCs excludes outsiders and former members.
- Test existing current/archived season snapshots, an alt absent from the snapshot,
  no companion snapshot, and custom dungeon names.
- Keep bridge test installation unchanged until its owner finishes that test.
  Package/build evidence is not installed-client or release evidence.
