# PoE2 mapping journal — first implementation

Implemented locally on 1 October 2026. Product version remains 5.0.0. This is an
opt-in journal of client-log observations, not an official account integration
or a competitive completion feed. Bot deployment, migration/restore rehearsal,
installed companion upgrade and a real PoE2 session remain release gates.

Local validation: the full suite passed **933 tests in 125 files**, along with
TypeScript, ESLint, addon validation and both dependency audits (zero reported
vulnerabilities). `release:prepare` built the addon ZIP and Windows installer;
final recovery/authorization changes passed another 23 PoE tests and lint.
The final full test run also passed all 933 tests. The current installer is
`dist/companion-poe-mapping/Guilded Companion Setup 5.0.0.exe`; its nine changed
app/tracker files were verified against source after packaging. A separate
output folder avoided Windows refusing to replace the prior build directory.
The PostgreSQL gate was **not run locally**: no configured disposable test
database or PostgreSQL client tools were available. No production migration,
bot deployment, installed-app upgrade or real-game verification was performed.

## Using it

1. After the bot update and migration, an officer uses `/poe setup enabled:true`.
   It is disabled by default and creates no channels or points.
2. Members keep their existing Guilded companion pairing. New members use
   `/poe pair`, then Settings → Link Discord account. `/character pair` works
   for either game too. Pairing again revokes the old credential.
3. In companion Settings, select **Read my PoE2 log and share map visits with
   this Discord guild**. Choose `logs/Client.txt` from the PoE2 installation.
   Enter the character, exact league name and mode you will play. These values
   are self-declared; change them **before** changing characters/leagues in game.
   Turn off **Track World of Warcraft** for a PoE2-only setup.
4. Save and start. Existing log history is skipped on first opt-in. A newly
   observed map is sent after the next area-generation event. An open map is
   shown in the companion's status, not assumed complete.
5. `/poe runs` lists your latest 15 visits; optional `league` filters them.
   `/poe summary league:<exact name> mode:STANDARD days:7` shows your activity.
   Add `guild:true` for up to 15 members with the most observations. All replies
   are private to the caller. Guild members can see the aggregate activity you
   consented to share. French guild settings localize the Discord responses.
6. `/poe setup enabled:false` pauses accepted uploads, preserving stored history.
   Companions retain queued observations and require Save and start after an
   officer re-enables tracking. Uncheck the companion option to stop capture.

The command-line companion uses the same settings in
`companion/companion.config.json`; its example keeps WoW enabled and PoE2 off.
No PoE login, password, session cookie or GGG application credential is needed.
Reviewed challenges and game-specific seasons already use `/community`; mapping
observations do not automatically award community points.

## What the numbers mean

The parser recognizes exact `DEBUG Client` engine messages of the form
`Generating level … area "Map…" with seed …`. It ignores campaign/hideout areas,
PoE1 `MapWorlds…` areas and chat. These messages are observed in public PoE2
client-log reports, not a stable documented telemetry contract:
[Lofty Summit log](https://www.pathofexile.com/forum/view-thread/3853562),
[Steppe log](https://www.pathofexile.com/forum/view-thread/3912955/page/2).

Each portal return is another **visit**, not another unique map clear. The
duration is the interval between area-generation messages, including loading
and idle time. Area level is recorded as area level; it is not converted to a
waystone tier. No clear, kill, death, XP, loot, profit, party roster or speedrun
claim is inferred. A loading attempt may fail after its generation message.
Do not use these observations as automatic challenge evidence.

Disconnect/login markers, changed client process, tracker stop/restart and log
replacement mark the open visit interrupted, with unknown duration. Intervals
over six hours also have unknown duration. Unknown durations still count as
observations and are excluded from total timed minutes. Local game timestamps
are converted using the companion computer's timezone; keep its clock/timezone
correct. English engine messages are currently required. Unknown formats are
ignored; a real localized-client test is required before claiming support.

## Consent, authentication and recovery

GGG permits independent tools to read logs when users understand how the data is
used. New API applications remain unavailable at the time of verification; its
documented APIs do not provide a per-map completion feed. This first slice uses
no GGG endpoints. See [GGG policy](https://www.pathofexile.com/developer/docs)
and [API reference](https://www.pathofexile.com/developer/docs/reference).
The companion and Discord help display an independent-third-party notice.

Only filtered area ID/level, visit timestamps/reason and declared
character/league/mode reach `POST /api/v1/poe/visits`. Raw log lines, chat,
seeds, process IDs, account passwords and local paths are not uploaded. Partial
raw lines are re-read from the game file rather than stored in the journal.
The bot derives the owning member from the existing personal credential and
checks current Discord membership/roles on every request. Officer credentials
can upload only their own PoE observations too. The retired shared token has
no access. `GET /api/v1/poe/status?guild=…` uses the same authentication.

Uploads contain at most 100 observations. A unique guild/member/reference key
deduplicates concurrent retries. The database derives duration from timestamps.
Malformed, future-dated and backwards observations are rejected. Full guild
reset cascades the PoE rows with the guild; `dataResetAt` excludes any old local
history replayed after reset. Other guilds' records are untouched.

The companion stores a cursor, current parsed map and pending filtered visits
in atomic `poe-journal-<scope hash>.json` files. Installed copies use the existing
app data directory; command-line copies use `companion/` (gitignored). Queues
are scoped to credential/guild/log/character/league/mode. Changing identity or
declaration leaves the previous queue on disk and starts at the current EOF;
it never silently relabels old data. Return to the original settings/credential
to retry that queue. A revoked credential's old queue requires explicit
recovery; it is not transferred to a new identity. Removing companion data or
uninstalling with data cleanup removes those journals.

One poll/upload is in flight. Transient failures retry with 5-second to 5-minute
backoff while capture continues. Authentication/disabled-feature/validation
errors retain the queue and stop automatic upload retries until restart or
reconfiguration. Stop aborts network requests. Corrupt journals are preserved
and stop tracking. Log replacement/truncation skips replacement history and
resumes with new events. Pending data is not discarded when capture fails;
the queue stops accepting new capture at approximately 10,000 pending visits.
Time while the companion was stopped is not promised as continuous tracking.

## Build and verification

Additive migration: `20261028090000_poe_mapping` introduces the disabled feature
setting and `PoeMapVisit`, with cascading ownership, indexes and SQL checks.
Regenerate Prisma after schema changes. PoE data is separate from WoW characters,
dungeon runs and loot/points ledgers. Protocol 2 and all shared product versions
stay unchanged; this adds separately authenticated PoE API routes.

`tests/poe-mapping.test.ts` covers validation, owner/guild isolation, duplicate
replays, reset exclusion, unknown timing and parser bounds. Companion tests
exercise real temporary files, complete/partial lines, old-history skip,
privacy, durable offline replay, revoked access, truncation, cancellation and
scope changes. `scripts/verify-poe-postgres.ts` is part of `test:postgres`: it
checks concurrent idempotency, league/mode isolation, cascades and restored
observations on the disposable localhost database only.

Before deployment, follow `V5_0_RELEASE_HANDOFF.md`: build/check, green Windows
and PostgreSQL CI, ledger preflight, verified backup, then the existing updater.
Install the rebuilt companion while keeping its config and pairing.

Real-client pilot gate: opt in with a volunteer; enter a map, return to hideout,
re-enter the same map, then another map; compare visits/timed minutes in Discord.
Test crash/restart, offline bot recovery, revoked pairing, character/league
change, a non-English PoE2 client and both standalone/Steam log locations.
Confirm chat never appears in an upload. Do not announce automatic clears or
competitive scoring until a separate evidence/verification path exists.
