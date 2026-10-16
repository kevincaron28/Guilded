# November level-60 scoring — implemented, not activated

Prepared October 15, 2026 for the intended November 4 season. Version 5 is a
separate rules model; version 4 remains the level-30 beta. No season, ledger,
SavedVariables, existing rating or archive is rewritten by this work. There is
no scheduled start, production deployment or CurseForge publication here.

## Rules implemented

- Per character: best score per verified route, sum of the highest **eight**.
  Score = round(200 × frozen target seconds / run seconds), clamped to 50–400.
  Eight target clears = 1,600; maximum = 3,200. A ninth score of 240 replacing
  180 adds 60. Extra coverage and boss records remain visible without extra points.
- Every observed participant, including guests and replacements, must remain
  **level 60**. No early leveling scores are required. Normal import validation,
  detected final boss, exact configured difficulty, 80% personal presence and
  the season's start/exclusive end constraints still apply.
- Participation remains per account: weekly 75/25/0 for fully eligible clears;
  50/25/0 without bonus eligibility, including eligible overlevel helpers.
  Helpers require an in-band linked guild member with at least 50% presence.
  No speed, death, record or full-guild point bonuses. Alts and difficulties
  share the route counter; verified wings are separate. Reset: Tuesday 15:00 UTC.
- November participation requires at least 50% presence, a detected final boss
  and complete configured route evidence. Unknown, mixed or incomplete routes
  earn zero; they cannot consume a second wing's weekly reward. Historical runs
  in the same week still consume the account's budget when their evidence qualifies.
- Targets and participation bands are independent. A route with `targetSec: null`
  can earn participation but never rating. Unknown routes do not default to a
  Classic map, guessed wing, beta target or difficulty 0.

This measures a team's recorded speed, not individual skill. Gear and composition
remain unnormalized. The timer still starts at first observed combat; pre-combat
travel is excluded and manual starts are not reliably distinguished. Required
encounter evidence is a route checklist, not proof of every trash pack or anti-cheat.

## Wing preparation and frozen configuration

`src/services/dungeon-november-rules.ts` implements version-5 validation, an offline
rules factory and an encounter-based resolver. Each route needs an observed map
ID, a distinct scoring key, difficulty, participation band, endpoint ID/aliases,
any additional required encounters, a written route standard, and retained
client-build/run-reference evidence. At least eight calibrated rated routes are
required to compile rules. Inputs are copied; mutable guild settings do not supply
November targets or bands.

Only successful encounters with timestamps inside the run can establish a route.
An ID or an explicitly configured localized name can match. Run labels cannot.
Evidence for multiple configured wings makes the run ambiguous; missing required
encounters prevents both rating and participation. Shared maps require wing keys;
cross-wing ID/name collisions are rejected. Register **all sibling wings together**,
including participation-only siblings, so mixed-wing evidence is recognized.
Without the full observed sibling roster, an unconfigured wing cannot be identified.

`addon/Guilded/DungeonRoutes.lua` prepares endpoint detection using the same
completion/verification/band shape. Its `verified` table is deliberately **empty**.
Existing Deadmines, Hall of Thanes and Scarlet beta behavior is preserved. After
reviewing real evidence, add the verified endpoint mappings in a new candidate
build, matching the frozen server configuration, and retest that exact build.
The server enforces the full checklist; the addon endpoint merely ends the timer.
Journal-based completion alone does not satisfy the server's route evidence checks.

Prepared families: Dire Maul East/North/West, Stratholme Main/Service, Blackrock
Spire Lower/Upper, and the remaining Scarlet wings. This is support for future
verified configuration, **not a claim these mappings work in the launch client**.
No new game IDs, final-boss aliases, official timers or official level ranges are
invented. Tests use clearly synthetic IDs, difficulty, names and targets.

Generate a fresh evidence worksheet for all 35 catalog entries:

```powershell
npx tsx scripts/prepare-november-rules.ts --template backups/november-evidence.json
```

Fill it with reviewed observations; remove routes not ready for the initial
selection, retaining all siblings of shared-map routes. Then compile to a new file:

```powershell
npx tsx scripts/prepare-november-rules.ts --input backups/november-evidence.json --output backups/november-rules-reviewed.json
```

The compiler refuses invalid/incomplete data and existing output files. It loads
no credentials, accesses no database, sends no Discord messages and cannot activate
a season. The existing beta rotation script is **not** a November activation tool.
Create and freeze a new season only after the final selection, exact start/cutoff,
backup and launch checks are approved. Do not overwrite an existing season's JSON.

## In-game checks still required

Every item below is **pending**. Use isolated test-season data for November awards;
do not switch Quebec Gold's active beta to rehearse November scoring.

1. Install the newly built candidate on both PCs, preserving SavedVariables and
   pairing. Verify current beta totals and archived results before/after reload.
   The previously installed candidate predates these addon changes.
2. For every proposed rated route and every sibling wing, record client build,
   locale, actual map ID, difficulty, successful encounter IDs/names, timestamps
   and run reference. Test English/French aliases only when actually observed;
   numeric evidence can avoid a locale dependency once verified.
3. Run each wing separately, exiting/re-entering. Confirm exactly one automatic
   completion at its endpoint through ENCOUNTER_END/BOSS_KILL; duplicate events,
   failed encounters and leaving/disbanding must not create extra completions.
   Specifically cover Dire Maul's three wings, both Stratholme routes, both
   Blackrock Spire routes and Scarlet Armory/Cathedral before enabling them.
4. Omit a configured required boss, combine wing evidence, and upload incomplete
   evidence in an isolated test. Expect zero rating and zero participation with
   a clear reason. Confirm the agreed BRD/wing route checklist is actually recordable.
5. With a level-60 party when available, verify score/time/target agreement,
   personal best updates and separate alts. Test a replacement, disconnect/rejoin
   and level change; all observed guests must affect eligibility. Verify recorded
   presence around the 50% participation and 80% rating thresholds.
6. Test a lower-level participation route with an overlevel helper. Confirm the
   correct recipient per account and 75/25/0 or 50/25/0 across alts and separate
   wings, including reconnect/re-upload. No competitive rating for that route.
7. On both PCs, verify level-60 explanatory text, best-eight counted labels,
   non-counted ninth routes, boss records and unranked reasons through companion
   download **and** officer-to-member relay. Archived level-30 labels must stay intact.
8. Collect comparable full-route samples from several crews before setting targets.
   Limit one crew/day contribution, review outliers and publish sample counts and
   provisional status. Do not copy October targets. Freeze the chosen targets,
   evidence and bands only for the new season.

The best-eight arithmetic, locale aliases, ambiguity, evidence timestamps,
participation history, addon endpoint hooks and relay format have offline regression
tests. Offline passes do not satisfy any real-client check above. Existing 6.2
G1–G10 checks in [V6_2_GAME_ACCEPTANCE.md](V6_2_GAME_ACCEPTANCE.md) remain required;
disabled November mappings do not need to be presented as release-tested features.

Catalog evidence and source uncertainty are retained in
[NOVEMBER_DUNGEON_CATALOG.md](NOVEMBER_DUNGEON_CATALOG.md).
