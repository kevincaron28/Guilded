# Native Discord events

Guilded 5.0.0 can publish raids and gaming nights in Discord's Events tab. Version,
addon protocol and saved game data are unchanged. This is implemented locally;
production deployment and a real Discord verification remain release gates.

## Behavior

- `/raid create`, repeating raids and weekly core occurrences each get one native event.
- `/raid edit`, `cancel`, `start` and `end` refresh that event. Weekly occurrences
  have separate IDs; no second recurrence engine competes with Guilded's schedule.
  Moving an event that Discord already started closes that event and creates a
  replacement for the future date, because Discord cannot change its active start.
- `/community gaming create` publishes an event, and `edit`, `cancel` and `close`
  update it. Gaming nights start at their configured time and close at their end.
- Existing upcoming raids and gaming nights are reconciled on startup and every
  minute. Publication normally takes one or two queue ticks after the signup post.
- Events link directly to their Guilded signup message. **Interested** enables
  Discord notifications; it does not create a signup, record attendance or award points.
- Lotteries, quizzes, challenges and `/testraid` do not create calendar events.
- Raid event end times are estimated at four hours after the scheduled start;
  `/raid end` closes an active native event sooner. This estimate never ends the
  Guilded raid itself. Gaming nights use their actual configured end time.
- Missing events may be recreated while their start is still in the future.
  Past or finished events are not restarted. An event that never reached Discord
  before its start is not recreated as a misleading future event.

English/French event descriptions explain the signup distinction. Discord name
and description limits are enforced without truncating the signup link or the
recovery identity. Managed raid events are excluded from the addon's native-event
import because the same raid already appears in its Guilded feed.
Native voice/stage events in the companion feed are filtered against the paired
member's freshly checked channel visibility, rather than the bot's wider access.

## Private activities and voice channels

Discord external events are visible across the server. Guilded only uses that
type when the activity's announcement audience is fully public, with no member
or role visibility denials. Core events use the core's existing voice channel
and chat audience. Other private activities reuse a voice channel in the same
category with identical visibility overrides. No channels or roles are created.

To select an existing gaming voice explicitly:

```text
/community gaming create season:SEASON title:Co-op starts:vendredi 20h ends:vendredi 23h capacity:8 points:10 voice:VOICE
/community gaming edit id:NIGHT title:New title starts:samedi 20h ends:samedi 23h voice:VOICE
```

For a private season, the selected voice must have the same visibility overrides
as the season's announcement channel. The organizer must be able to see/connect
to it. A missing compatible voice leaves the event job pending; the signup and
activity still work. Use `gaming edit voice:` to choose a compatible channel,
then `/system retry`. Reminders are reset when a future gaming night is moved.

## Delivery and permissions

Grant **Create Events** to the bot role. For voice events, grant it in the chosen
voice channel too, together with **View Channel** and **Connect**. **Manage Events**
is not required for events the bot creates. No new gateway or privileged intent
is requested, and the bot does not modify events owned by human organizers.

`/system status` shows `SCHEDULED_EVENT` jobs and their last error code;
`/system retry` retries pending deliveries. `50013` indicates missing permissions;
`event-private-venue` means no matching private voice; `event-voice-audience`
means mismatched visibility; `event-signup-message-missing` means the signup post
has not been delivered. Discord's 100 scheduled/active-event limit also remains
in effect; failures stay queued with bounded backoff.

`DiscordEventLink` stores a unique guild/source identity, native event ID and
last delivered source signature. Settled links remain available for recovery
and backups without rescanning their finished sources each minute.
Guild-scoped PostgreSQL locks serialize event
writes. A bot-owned description marker recovers a successful create whose
response or database commit was lost, including replacements after rescheduling.
Reconciliation preserves pending retry backoff and reads the current source
instead of replaying stale event details. Reset/uninstall removes only this
guild's marked Guilded events before wiping the links.

## Deployment and real verification

Apply additive migration `20261029090000_discord_scheduled_events` after CI and
backup using the normal release process. It creates one table and two unique
indexes; existing raids, points, activities and signups remain intact.

On the updated live bot, verify creation, title/time edits, cancellation,
start/end, weekly generation, French descriptions, Interested notifications and
the signup link. Check a role-restricted game/core with a normal member account,
restart with a pending delivery, and verify the addon displays each raid once.
Use one bot instance only. PostgreSQL migration/restore CI remains required.

Local verification: full Vitest suite **983 tests across 129 files**, TypeScript,
ESLint and addon static validation passed. The scheduled-event PostgreSQL
concurrency/uniqueness/restore fixture is wired into `test:postgres`, but was not
run locally because no disposable PostgreSQL/client runtime was available.
These checks do not establish production or real Discord verification.
