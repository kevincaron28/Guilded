# Dungeon Season 2: audit, observations and the 9 December plan

Status (6 November 2026): audit done, observation and the Season 2 proposal tools built and **inactive**.
Season 1 keeps its frozen rules (current-v1). Nothing is scheduled until the owner runs
`/guilded-season season2-activate`. No version change. Owner request: ROADMAP batch 3 #1.

## 1. What Season 1 scores (verified in code)

- Rules: `provisionalSeasonRules()` (`dungeon-bracket-season.ts`) → version 6, frozen into
  `OfficialSeason.rules` by `freezeSeasonRules` with `evidencePolicy: "current-v1"` (`snapshotRules`).
  Points per route = `round(200 × target / time)` clamped to 50-400, then the over-level penalty
  (10% per level above the route's band, up to 3 levels, beyond = 0), best N routes per bracket
  (`timeRating`, `penalized`, `characterScores`). Public and guild scoring share `bracketedVerdict`.
- Brackets in Season 1: **15-29 (best 5, 10 routes) and 30-44 (best 5, 8 routes)** only. 45-59 and 60 have
  no observed map IDs, so they are not in the season; Drowned City and Kroldok Stronghold wait for IDs.
- Targets are **design estimates** (plan of 18 October: 12 from beta design targets, the rest guesses).
  The addon's `RunResults.lua` table mirrors them and a test compares it with the server.
- Completion = the addon sees the final boss (`Compat.lua`: Encounter Journal, Forever id fallbacks
  `finalBossFallbacks`, then names in `foreverFinalBossNames`; Scarlet wings by boss name). #384 added
  recovery of runs that finished ABANDONED with the final boss already logged (`Dungeon.lua recoverRuns`).
- Full-name and no-addon changes: guildmates flagged by the addon count for the announcement
  (`inGuildPlayers`); scoring itself still needs a linked member (`calculateDungeonRating`), unchanged.

### Findings

| # | Finding | Where | Status |
| --- | --- | --- | --- |
| 1 | `snapshotRules` forces `evidencePolicy: "current-v1"` on every frozen rule set (a deliberate no-silent-activation guard), so an owner-uploaded **current-v2** Season 2 (`/guilded-season rules`) was stored as current-v1. | `public-score.ts` `snapshotRules` | **Fixed** with an explicit `reviewed` flag, passed only by `configureNextSeasonRules` (the owner's reviewed path). Season 1, `freezeSeasonRules` and every default still freeze as current-v1. |
| 2 | Three rated Season 1 routes have **no Forever final-boss id or name** in the addon: Ruins of Lordaeron (2999), Excavation Site: Wetlands (2998), City of Dalaran (2959). Unless the Encounter Journal supplies them, their runs end ABANDONED (unranked) and log `DUNGEON_FINAL_UNMATCHED`. Armory and Cathedral rely on the Scarlet name list. | `addon/Guilded/Compat.lua` `foreverFinalBossNames` / `finalBossFallbacks` | **Open**: needs the real names or ids from a player's `DUNGEON_FINAL_UNMATCHED` log (no guessing). `#384` recovery then completes saved runs after the next addon update. |
| 3 | **No 45-59 or 60 route exists.** Players reaching 60 before 9 December earn no dungeon rating. Season 1 can still gain routes (`addedRules`), but a **current-v2 season cannot** (`addedRules` returns null for v2): Season 2's routes must be complete before activation. | `official-seasons.ts`, `public-score.ts addedRules` | By design; the new observations list cleared-but-unrated maps with their map ids, levels and times so routes can be added. |
| 4 | Forever name transition: a character reported as bare "Kev" by an older addon and "Kev Caron" by 8.5 is two ranking rows (public `characterId`, guild `ratingCharacterKey`). Matching elsewhere uses `foreverSameName` only when unique. | `public-score.ts characterId`, `dungeon-rating.ts ratingCharacterKey` | **Open**, transitional: closes as members update the addon. Merging scores needs an owner decision (a first name is ambiguous). |
| 5 | The existing per-guild calibration (`recalibrationEvidence`) is guild-scoped and merges overlapping crews into one component, so a small guild whose members all run together rarely reaches "ready" (20 samples, 5 crews, 3 days). It also reads `startTrigger`/`gameBuild` that older runs lack. | `dungeon-calibration.ts`, `dungeon-bracket-season.ts` | Left as is (read-only evidence). The new bot-wide observation uses every accepted public run once, whichever guild or player uploaded it. |
| 6 | Hard dependency for v2: a run only ranks under current-v2 with an observed first-combat start, a native boss checkpoint within 5 s of the end and known presence ≥ 80%. The review shows how many Season 1 runs already satisfy it. | `dungeon-integrity.ts`, `dungeon-rating.ts bracketedVerdict` | Check before activating (below). |

Not found wrong: reciprocal curve and clamps, rounding, penalty maths, best-N and tie rules, public/guild
parity, the Scarlet wing keying, presence rule, season window and 72-hour upload grace, rotation from a
v1 season into a v2 season (`startSeason` archives the v1 season normally).

## 2. Observation only (Season 1 unchanged)

`/guilded-season observations` (owner only, ephemeral) reads every accepted **public** run of the running
season (`prismaLeaderboardStore`, so one row per run across all guilds and personal uploads) and
rates it with the season's own frozen rules (`rateRun`). Per route and bracket it shows:

- **count**: ranked runs with no over-level penalty (over-level groups finish faster than the route's own
  audience, so they are not timing samples), **median, p25, p75** of the durations;
- **samples / crews / days**: one time per crew per UTC day (`calibrationSample`: repeat farming and swapped-in
  crews add no weight); a route is "ready" at 20 samples, 5 crews, 3 days;
- runs whose recorded start was not a first combat (excluded from samples) and runs without start provenance;
- how many runs would also pass current-v2; maps cleared but not rated.

Code: `dungeon-season-observations.ts` (pure, `observeSeason`), `dungeon-season2-admin.ts` (loading, embeds).
It writes nothing and changes no score.

## 3. Season 2 proposal (inactive until the owner activates it)

Season 2 = Season 1's routes, level bands, brackets, best-N and over-level penalty **unchanged**, new targets,
`evidencePolicy: current-v2` (option `evidence: current-v1` keeps the old policy).

Target per route (`proposeTarget`; the target is the time that earns 200 points):

| Independent samples (crew/day) | Rule | Basis |
| --- | --- | --- |
| < 8 | Keep the Season 1 estimate | carried (stays flagged provisional) |
| 8-19 | `(n × median + 12 × S1 target) / (n + 12)` | blended |
| ≥ 20 with ≥ 5 crews and ≥ 3 days | the crew/day median | measured |

Then clamp to 0.5×-2× of the Season 1 target (a thin or farmed sample cannot move it further), to 5 minutes-2 hours,
and round to a whole minute. A typical measured run therefore scores about 200; a run twice as fast scores 400.
Measured and blended routes are recorded as recalibrations from the season start so only carried routes keep the
"provisional" label in `/dungeon rules`.

Season 2 starts **2026-12-09 15:00 America/Los_Angeles = 23:00 UTC**, the same instant of day as Season 1 and
Forever's launch (`EDITION_CALENDARS_2026-10-30.md`: Forever 23:00 UTC). Other editions' calendars are not touched.
The exact hour of the raid opening is the owner's to confirm; pass `date` or reschedule with `/guilded-season next`.

## 4. Owner steps

1. **Now to ~30 November:** watch `/guilded-season observations`. Fix finding 2 (final-boss names/ids) if runs on those
   three maps stay ABANDONED; the more runs, the better the targets.
2. **~28 November:** `/guilded-season season2-review`. Read the table and the readiness line (runs passing
   current-v2). The command attaches `season2-rules.json`.
   - Add 45-59 / 60 routes (and Drowned City / Kroldok) to that JSON using the map ids from "Cleared but not rated",
     then upload it with `/guilded-season rules` **after** step 3 has scheduled the season (it replaces the stored
     rules). v2 seasons cannot gain routes later, so do this before 9 December.
   - If the v2 readiness is poor, use `evidence: current-v1` for Season 2.
3. **~2 December (a week ahead so the targets are public):** `/guilded-season season2-activate` (defaults to
   2026-12-09, 15:00 Pacific). It schedules "Season 2" and stores the targets computed at that moment. Re-running it later
   recomputes and replaces the stored rules; use `keep_rules: true` to keep an uploaded rules JSON. Confirm with `/guilded-season status`;
   `/guilded-season cancel` removes it.
4. **9 December:** the calendar tick freezes nothing new (rules are already stored), rotates every guild and
   Season 1 closes with its standings.
5. After 9 December re-run `observations` to compare Season 2 times with the targets; adjust only for Season 3.

Rules stay locked inside a season (`DUNGEON_SCORING_LOCK_2026-10-24.md`); this proposal changes nothing in
Season 1 and officers get no new setting.

## 5. Verification

`tests/dungeon-season2.test.ts`: observation statistics (median, quartiles, crew/day dedupe, exclusions, unrated
maps, window), the target formula (carry, blend, measure, clamps), the proposal is a valid current-v2 rule set that
leaves Season 1's rules untouched, and `snapshotRules` keeps current-v2 only on the reviewed path.
Not run against live data: the production database was not available from this session.
