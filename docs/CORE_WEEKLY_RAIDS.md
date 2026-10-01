# Core weekly signup schedule — 5.0.0

Owner preference: one week ahead. In `/core setup`, enter start times such as
`mardi 20h; jeudi 20h30` in the optional schedule field. `/core create schedule:`
accepts the same format. Shared-day syntax `Tue/Thu 8pm` also works. Times use
the server's configured IANA timezone (Québec Gold: America/Toronto).

The bot prepares ordinary Guilded raid signup posts in the general raid channel
and the core's channel. This does not create separate Discord native Scheduled
Events. Only starts within the next seven local calendar days are generated.
At startup and every five minutes it fills that rolling window, independently
of `/raid end`. DST preserves the local hour; a nonexistent spring clock time
is skipped, and a repeated fall time creates one raid.

`/core edit` → **📅 Horaire hebdomadaire** changes or pauses the schedule; blank
stops generation. `/core rules schedule:off` also stops it. Existing raids and
their signups remain untouched when the schedule changes. Use `/raid cancel`
to skip a specific night; cancelled and moved raids retain their original
occurrence identity and never respawn. Raid title, bosses, caps and individual
details remain editable using existing `/raid` tools. Generated raids use the
core name and description, with no attendance or point awards made automatically.

Old free-text schedule notes remain inactive until a leader explicitly saves a
valid weekly schedule. Never infer an automatic schedule from historical text.
Timezones are captured when the leader saves a schedule; save it again to adopt
a changed server timezone. A manually-created raid at the same core/start is
reused, including cancelled raids. The legacy per-raid repeat-on-end flag is
disabled on adopted raids and ignored for scheduled occurrences.

Migration `20261024090000_core_weekly_schedule` adds three nullable RaidCore
fields and the unique nullable Raid.weeklyOccurrence. Per-core PostgreSQL
advisory transaction locks serialize scheduling/settings edits. Raid creation
and its durable RAID_POST job commit atomically. Failed Discord delivery retries
through the existing queue; restarts also repair missing signup cards. No data
is removed by the migration, and deleting a core stops its schedule through
the existing core deletion path while preserving its raids.

Core public channels follow the configured general raid signup channel's
audience instead of giving broad welcome/member roles access on a multi-game
server. Private core chat/voice remain restricted to that core and leadership.

Validation: parser/horizon/DST unit tests; PostgreSQL CI covers concurrent ticks,
unique identities, cancellation/rescheduling, pause, legacy notes, guild scope,
delivery jobs and backup/restore. Real Discord UI/core creation remains a client
check; no live test core or fake raid should be created without explicit need.
