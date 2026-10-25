> **25 October release decision:** the owner explicitly authorized publication before
> the unavailable game/two-PC tests. Earlier hold instructions below are superseded.
> Tests remain pending follow-up, not passes; targets remain provisional. See
> [release decision](RELEASE_DECISION_2026-10-25.md) and [current notes](V7_3_2_RELEASE_NOTES.md).

# Offline dungeon preparation — 25 October 2026

The candidate now supplies source-reviewed completion routes and provisional
benchmark targets. These are prepared rules, not fabricated client observations.
Forever keeps its existing beta-observed routes and targets.

| Edition | Routes | Prepared competition coverage |
| --- | ---: | --- |
| Classic Era / Hardcore | 26 | Classic dungeons, separate Scarlet/Dire Maul/Stratholme/Blackrock Spire wings |
| TBC Anniversary | 58 | The 26 Classic routes plus all 16 Outland dungeons in normal and heroic |
| Mists Classic | 18 | All nine Mists dungeon maps in normal and heroic, including old-world remakes |
| Retail | 33 | Nine Midnight dungeons in normal/heroic/Mythic 0, plus three Season 2 returning dungeons in heroic/Mythic 0 |
| Retail Mythic+ | 8 | The separate Midnight Season 2 pool, using native key/affix/time evidence |

Historical leveling/timewalking, Season of Discovery, and Mists challenge modes
remain activity outside this competition catalog. Level bands are Guilded's
provisional competition policy, not assertions about minimum queue/entry levels.
The port can import other runs without granting a score from unrelated content.

## Sources and provenance

Encounter and NPC identities come from the maintained boss modules in
[DBM Dungeons at d989f711](https://github.com/DeadlyBossMods/DBM-Dungeons/tree/d989f711bfb99eb002a51e32aebcdcebefc207f3).
Every route retains its individual source paths. Numeric facts are extracted;
DBM implementation code is not bundled. Classic-era conditional IDs are distinct
from TBC IDs. NPC IDs have their own evidence namespace, survive peer/companion
transport, and cannot accidentally match encounter IDs of the same number.
Combat-log capture is registered only on Classic clients, never Retail/Forever.

Reproduce the checked-in facts with:

```powershell
python scripts/prepare-dungeon-catalog.py backups/port-sources/dbm-dungeons
node scripts/sync-dungeon-catalog.mjs
npm run dungeons:sync
npx tsx scripts/export-edition-rules.ts
```

The generator refuses a different DBM commit. The server and both addons share
one manifest. CI checks generated Lua drift and exports validated rules into
`dist/edition-rules/<edition>.json`; each stays below the rules-upload size limit.

Each ordinary route specifies first-combat start, a final boss, required checkpoints,
difficulty, level band and target. Optional bosses and trash are not required.
There are no invented pull coordinates or optimized trash paths. The 20–60 minute
targets are explicit Guilded design estimates, not Raider.IO measurements.
Every catalog target stays marked provisional until timed runs calibrate it.
Missing checkpoints, wrong difficulties and overleveled carries cannot silently
qualify. Normal and heroic identities can share a map without merging their scores.

## Retail scoring inspired by Raider.IO

[Raider.IO's character ranking description](https://support.raider.io/kb/frequently-asked-questions/how-do-you-rank-characters-for-mythic-plus)
uses the best score per dungeon and sums those results. Guilded follows that
structure: each map contributes once across affix weeks and roles; repeated runs
cannot reduce the total. Role filters select runs before the same aggregation.
The website shows contributing runs, character totals and cards; Discord exposes
the rating alongside its existing per-affix highest-key leaderboard.

`guilded-keystone-v1` is an immutable, explicitly provisional Guilded formula:

- Base points use the [published key-level table](https://support.raider.io/kb/frequently-asked-questions/what-is-the-base-score-value-for-each-level-keystone).
- Guilded adds `25 × clamp((1 − nativeTime / timer) / 0.4, 0, 1)` speed points,
  rounding each run to one decimal. This bonus is our own design choice.
- At the timer, +2 earns 155, +10 earns 320 and +12 earns 365. At 40% under the
  timer the bonus reaches 25. Only levels +2 through +30 are supported in v1.
- Only in-time, score-eligible, non-practice native completions count, with 80%
  wall-time player presence. Overtime is activity. Scores are community reports;
  they are not official Raider.IO/Blizzard ratings or external verification.
- The frozen pool checks challenge map ID, instance map ID and timer together.
  A map/timer mismatch remains visible on the raw keystone board but earns no
  provisional rating. This avoids silently accepting a different timer hotfix.

The eight pool maps and timer facts come from
[Raider.IO's generated Season 2 catalog at 127d9711](https://github.com/RaiderIO/raiderio-addon/blob/127d971160d9405d5c2dd04c4b46e95b73799cce/db/db_dungeons.lua).
The seasonal pool and model are frozen in version-6 season rules. Old snapshots
without keystone ratings remain without them; adding ordinary routes does not
retroactively enable or rewrite a keystone rating. Future changes require a new
season snapshot/model. Existing native per-affix rankings remain available.

## Remaining client acceptance

For every edition, record actual interface/build, English and French completion
events, a full run, missing checkpoint, wrong wing, reset, wipe, disband and reload.
Verify both addon variants, two-player peer agreement and companion import/ack.
Classic tests must include an NPC-only boss, a dual NPC/encounter notification,
and a shared-map wing. Retail tests must verify native penalties, affixes, resets,
in-time/practice flags and a real timer against the frozen Season 2 pool.

Collect representative complete runs before calling the provisional targets
calibrated. Recalibrations apply prospectively; old earned scores retain their
original target. Keep publication held until the existing game/two-PC acceptance
and deployment gates pass. No production rule changes are performed by generation.
