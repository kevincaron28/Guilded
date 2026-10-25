# Guilded 7.3.2 release gaps — 25 October 2026

## Released

The full addon, bot and companion port is published for Forever, Classic
Era/Hardcore, TBC Anniversary, Mists Classic and Retail. Multiple guilds/editions
can coexist in one Discord. Forever uses authentic first/last display names;
Blizzard character identities retain realm context. All ten CurseForge files
are approved; all 21 GitHub assets were downloaded and checksum-verified.
See [publication evidence](RELEASE_EXECUTION_2026-10-25.md).

Raid presets, Components V2 signup posts, gear audit, generated character/run
score images, companion folder/status improvements, opt-in hosted auto-approval
and version consistency checks are implemented. They are not missing features.
German/Spanish translation groundwork exists, but native review is still owed.

## Events follow-up

Two reported Upcoming game events errors occurred while Prisma was trying to
acquire a transaction, before the event callback started. Event transactions
previously inherited Prisma's two-second acquisition deadline, shorter than the
pool's 30-second wait. The fix gives this feature a bounded 30-second acquisition
window without enlarging the pool or changing event/reminder idempotency. Board
delivery retains its existing 60-second execution deadline. A disposable
PostgreSQL test holds a one-connection pool for three seconds, then verifies the
event reconciler succeeds and reminders remain deduplicated.

Reference: [Prisma transaction options](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions).
Live observation also found this acquisition failure in community activities.
The shared Prisma factory now aligns its default acquisition deadline with the
configured pool wait (30 seconds by default); a disabled pool timeout still gives
transactions a finite 30-second wait. Execution deadlines and pool sizes are
unchanged. The contention regression exercises a transaction without feature
options as well as event reconciliation.

This addresses short startup contention; sustained pool exhaustion still needs
investigation. Event delivery currently holds its advisory lock/transaction
during Discord requests; reducing that duration is a future reliability task
that must preserve cancellation ordering and crash recovery.

Countdown boards now display days, hours and minutes with bilingual preparation,
near-start and final-hour messages. The next scheduled visible event appears
first; the header highlights it. Existing board messages update about once per
minute, with content-hash deduplication and no new reminder subscriptions or
pings. Unknown dates, postponements and cancellations never get invented timers.
Reaching the scheduled time does not assert server availability. One-off
reminders retain native relative timestamps so an old notification cannot freeze
a numeric countdown. This is a bot-only change; published client assets remain valid.

PR #219 is deployed at `bd7bcaa229ec3f00e92cef34e1a8c0e2ad8d5055`.
Both quality jobs passed on the PR and merged commit (runs 40211936510 and
40212213189). Local validation passed 279 files / 2,361 tests, TypeScript,
ESLint and both addon validators. The existing French Discord board was read
back with `2j 03h 23m` and `10j 06h 23m`, a successful delivery job and no error.

### Countdown load limits

The shared delivery worker remains serial and refuses overlapping ticks. Normal
jobs, including reminders, take priority; countdown boards use at most five spare
slots within the existing 25-job batch. A cycle stops starting new deliveries
after 20 seconds; an in-flight operation finishes with its existing timeout.
Backlogged boards retain one job and render current time when eventually delivered,
instead of replaying every missed minute. Busy servers may refresh less frequently.

Reconciliation reads pending board jobs once for the whole batch, preserves leases
and retry backoff, and skips unchanged content. Static/TBA boards get a repair
check every five minutes. Dynamic boards still refresh at minute precision when
capacity is available. Tests exercise a 200-board backlog, ordinary-job priority,
batch/time caps, non-overlap, coalescing and real PostgreSQL retry preservation.
These bounds protect the worker; they are not a claim of unlimited guild capacity.

The small Oracle host also prepares deployments at lower CPU priority so npm and
Prisma generation yield to the live bot. Three expired community-button
interactions were logged during staging; that handler already acknowledges before
database work. Those reports remain under observation, not claimed fixed by the
transaction acquisition change.

### PoE2 launch time check

The [GGG announcement](https://www.pathofexile.com/forum/view-thread/3999366)
checked on 25 October gives December 11 (PST), without an hour. The suggested
20:00 GMT equals 15:00 Montréal / 12:00 PST on that date, but is based on usual
launch habits. The catalogue therefore retains its date and unconfirmed time;
no guessed official countdown or timed reminder is enabled.

## What is actually still missing

| Area | Current limit | Next action |
| --- | --- | --- |
| Game evidence | Automated coverage cannot prove real-client APIs, combat restrictions or two-PC behavior | Run the [game checklist](V7_3_2_GAME_CHECKLIST.md) on the published builds; owner explicitly waived these checks before launch |
| Discord walkthrough | Some real member permission, onboarding, picker, promotion, closure and external link-preview flows are not recorded passes | Complete remaining cases in [Discord acceptance](DISCORD_ACCEPTANCE_2026-10-24.md) with appropriate accounts |
| Live interaction latency | Three community button acknowledgements expired during deployment preparation | Lower staging CPU priority is mitigation; observe actual interactions and keep the reports open until verified |
| Dungeon coverage | 135 ordinary Classic/Retail routes and eight Retail seasonal key maps are prepared; targets are provisional, unsupported routes stay unrated | Collect real completion evidence and representative runs; add catalogues and calibrate only future rules |
| Rating parity | Guilded rating is a separate provisional score; Mists challenge activity is not Retail keystone ranking | Keep labels explicit; do not present it as official Raider.IO/Blizzard rating |
| Official countdown catalogue | Event boards currently support Forever and PoE2; Classic/Retail raid and season tools are separate | Extend event catalogue/settings for other editions when verified announcements and edition-specific reminder preferences are available |
| Raid content | Presets exist; verified Forever raid loot/GP data and a real two-officer raid rehearsal are outstanding | Add sourced loot data when available and rehearse before raids; do not invent prices or encounter IDs |
| Windows signing | Public installer is unsigned | Use an owner-controlled signing identity, then verify clean-machine installation/update behavior |
| Languages | English/French ship; German/Spanish groundwork lacks native acceptance | Get native review and exercise actual client layouts before claiming full support |
| Hosted onboarding | Automatic approval exists but is opt-in configuration | Review thresholds and abuse controls before enabling it; no silent production policy change |

## Recommended order

1. Ship and observe the events reliability/countdown fix; preserve one bot instance,
   database/ledger data, saved credentials and existing reminders.
2. Keep feature scope steady through launch. Prioritize reproducible faults and
   the outstanding real-member Discord walkthrough over another broad rewrite.
3. As game access becomes available, validate every edition and gather dungeon
   receipts. Preserve the Forever season calendar and frozen benchmarks; apply
   calibration prospectively.
4. Before raid opening, complete sourced loot data and the two-officer rehearsal.
5. Then prioritize signing, native language review, broader verified event/route
   coverage, and shortening the Discord delivery transaction.

The unavailable game/two-PC tests are post-release work, not a publication hold.
They also are not the only outstanding evidence: human Discord acceptance,
signing identity and native-language review need inputs automated tests cannot supply.
