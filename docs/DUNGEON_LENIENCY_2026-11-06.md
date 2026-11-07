# Season 1 leniency (owner decision, 6 November 2026)

The owner asked for a "a lot less strict" dungeon season so many more runs show up. This is a new
**rules revision** (`leniency: 1`), applied from the moment a season's stored rules carry it.

## What is relaxed (guild time board and public leaderboards share it)

| Gate | Before | With leniency 1 |
| --- | --- | --- |
| Presence | 80% of the run | 50% |
| Over-level party | up to 3 levels over the band (10% per level) | up to 6 levels over (same 10% per level) |
| Below level range | any member under the band hid the run | up to 3 levels under the band |
| Required encounter evidence | needed named boss kills | the detected final boss is enough when the map has one route |
| Unknown party level | whole run unranked | only that player is left out (9.0, #441) |

## What is NOT relaxed

The detected final boss (no manual finishes), the season window and upload grace, SIM runs, the
evidence policy, targets, brackets, best-N and the percent-per-level penalty. Routes without a
target ("Participation-only route", "Target not calibrated") still cannot be rated: a time needs a
target to become points. Their runs are stored and counted in `/guilded-season observations`, which
is how their targets get measured.

Participation (weekly variety) points are unchanged and never recomputed.

## How it reaches the running Season 1

`provisionalSeasonRules()` now carries `leniency: 1`. `addedRules` (the existing "add what is new to
a frozen season" step used by `freezeSeasonRules` and the official-season tick) copies the marker
onto the running season and each guild's season rules on the next tick, leaving every frozen target
and bracket untouched. Rating boards are computed at read time, so they reflect it at once; it is
retroactive for the **time board** of the running season only (more runs appear), never for awards
already given. Season 2 (current-v2) never gets leniency.

## Where runs are recorded

Every uploaded run (valid or not, ranked or not, any party) is already stored as a `DungeonRun`
with its time and party; nothing is dropped for being unranked. The public `PublicRun` table stays
opt-in per guild (`publicDungeonRuns`), so no backfill into it was done: publishing a guild's runs
without its choice would break the privacy rule on the public pages.

## Run posts

One "Unranked: reason ×N" line and one "No participation points (N)" line replace the per-member
"0 pts / Unranked" lines.
