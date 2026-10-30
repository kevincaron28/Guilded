# Edition calendar initialization — October 30

Kevin authorized official PvE period alignment, prospective activation today if
the affected data is empty, and three-calendar-month Era/Hardcore seasons.
Forever remains November 4 at 23:00 UTC (18:00 Toronto). No retroactive awards,
history deletion, invented end dates or automatic public announcements.

Production read-only inventory at 11:42 UTC found zero guilds, calendars, guild
seasons, guild/public runs, reporter evidence, addon imports (including pending
evidence), dungeon awards/achievements, DKP and EP/GP entries in all four other
editions. This observation is not a concurrency guard or an activation receipt.

## Official history versus Guilded activation

The default is explicitly **NA**, not global. Each snapshot stores period title,
kind, region, source, checked date, date precision, calibration scope and the
separate exact Guilded activation instant. Historical dates never become scoring
eligibility cutoffs. The first official-period-aligned Guilded season is partial.

| Edition | Period | Official historical start | Next boundary |
| --- | --- | --- | --- |
| Retail | Midnight Mythic+ Season 2, NA | Week of August 18 | Unverified; open |
| Mists | Siege of Orgrimmar / Season 3 | June 2 regional maintenance | Unverified; open |
| TBC Anniversary | Gods of Zul'Aman | October 22, 22:00 UTC | Sunwell date unverified; open |
| Era / Hardcore | Guilded-defined, NA | No official recurring dungeon season | Three calendar months after activation, Toronto wall time |

Sources: [Retail](https://news.blizzard.com/en-us/article/24294369/midnight-season-2-is-now-live),
[Mists](https://news.blizzard.com/en-us/article/24264421/mists-of-pandaria-classic-the-siege-of-orgrimmar-now-live),
[TBC](https://worldofwarcraft.blizzard.com/en-us/news/24310652/bcca-the-gods-of-zulaman-now-live),
[Era](https://worldofwarcraft.blizzard.com/en-us/news/23625676).
Retail PvP/preseason/patch dates are distinct from Mythic+; Mists Normal/Heroic
coverage does not imply Challenge/Celestial scoring. TBC's final reduced Heroic
difficulty receives its own calibration scope. No older phase samples are pooled
into a new calibrated target; all retained ordinary targets remain estimates.

## Supported initialization and verification

`scripts/initialize-edition-calendars.ts` defaults to a read-only preview. Apply
requires its exact `--expected` SHA-256. The create-only implementation refuses
existing calendars, snapshots, any imports, runs, evidence or award ledgers.
It never resets history, even when it could be empty. All four editions commit
together at the database clock's actual activation instant.

Short-lived PostgreSQL table locks with NOWAIT cover pending imports, personal
uploads and ledger writes; existing calendar advisory locks are also checked
without waiting. Any in-flight writer aborts initialization. New writers cannot
arrive between the empty check and commit. A fresh preview and recovery backup
precede a retry. The returned receipt includes the inventory and rule hashes.

Era's next boundary is stored immediately; the existing season tick extends only
this explicitly authorized quarterly cadence. Toronto DST and month-end clamping
are tested. Other editions wait for separately verified relevant PvE boundaries.
Historical frozen rows remain intact. The real PostgreSQL fixture tests an
in-flight importer, pending evidence, disputed public runs, stale previews,
atomic initialization, recurrence and preservation of Forever.

Status: implementation and tests in progress; production activation pending.
This operational follow-up does not replace the already published 8.2.0 assets.
