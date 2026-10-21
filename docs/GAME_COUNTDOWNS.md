# Upcoming Events

Bot-only feature; product version stays 7.3.0. No client changes. Deploying the
additive migration seeds the official catalogue, **not** guild boards or reminders.
The normal Oracle updater applies migrations before starting the single bot.

## Guild controls

Requires Discord **Manage Server**, checked again at execution:

- `/events board channel:<text channel> games:<Both|WoW Forever|PoE2> region:<NA|EU|KR|TW>`
  enables one persistent board per server/channel. Repeat to update its game filters
  or region. The region selects the correct WoW name reservation time.
- `/events status channel:…` previews the board and shows reminder offsets and delivery status.
- `/events refresh channel:…` repairs a missing/unpinned board. Startup/minute reconciliation
  also repairs it. Changing dates or reaching a date edits the same post; native Discord
  timestamps update countdowns without second-by-second message edits.
- `/events reminders channel:… game:… when:… role:… opt_in_confirmed:true`
  explicitly enables 24h, 1h and/or scheduled-time reminders. The administrator must
  confirm that members voluntarily selected that role for game reminders. The role must
  be mentionable, non-managed, non-privileged and able to see the channel. Use an existing
  opt-in game role, such as one offered by the server's self-role panel. No roles are
  created or assigned. `when:off` clears that game's subscription.
- `/events disable channel:…` stops reminders immediately and queues a disabled-board
  edit/unpin. Re-enabling starts with reminders off. Removing a game from the board
  suppresses its reminders as well.

The bot requires View Channel, Send Messages, Embed Links, Read Message History and
Manage Messages. Only ordinary guild text channels are supported. Permission/network
failures are retried; a permission error is never treated as a deleted message.
`/events status` reports the existing outbox's sanitized error code. The guild language
selects EN/FR board and reminder copy. Discord renders UTC instants in each viewer's timezone.

## Official catalogue

Only the Discord application's owner (team owner for a team application) can use
`/guilded-events`, registered in the bot's home server like `/guilded-season`.

- `list` lists stable IDs, state and UTC instants.
- `save` adds/edits an event: stable ID, game, EN/FR titles, official source URL,
  state, optional region (GLOBAL by default), exact ISO timestamp **with offset**, or
  bilingual date/window labels for TBA. Scheduled/reached states require an instant;
  TBA/postponed/cancelled require no instant. Never infer midnight from a date-only source.
- `state` postpones, cancels or returns an event to TBA, clears its old countdown and
  requires the official source supporting that change. Use `save` to confirm a new date.
- `archive` hides an event and invalidates its reminders; `save` can restore it.

At most 12 unarchived events keeps the single board within Discord's total embed budget.
The catalogue stores the last editor and update time. Titles/date-label changes preserve
reminder deduplication; schedule, state, game/region or archive changes advance the schedule
revision. Reaching a date automatically changes scheduled to reached **without** advancing
that revision. Reached means only that the advertised time passed, not that servers are online.
Official HTTPS sources are restricted to Blizzard domains for WoW and Path of Exile domains
for PoE2. No source URL is fetched by the bot.

## Dates verified 21 October 2026

[Blizzard name reservation announcement](https://news.blizzard.com/en-us/article/24303866/claim-your-world-of-warcraft-forever-character-names):

| Region | Advertised time | Stored UTC |
| --- | --- | --- |
| North America | Oct 27, 13:00 PDT | 2026-10-27 20:00Z |
| Europe | Oct 27, 18:00 CET | 2026-10-27 17:00Z |
| Korea | Oct 28, 07:00 KST | 2026-10-27 22:00Z |
| Taiwan | Oct 28, 07:00 CST | 2026-10-27 23:00Z |

[Blizzard's What's Next recap](https://news.blizzard.com/en-us/article/24303862/world-of-warcraft-forever-whats-next-panel-recap)
explicitly gives November 4, 2026 at 15:00 PST for global launch: **2026-11-04 23:00Z**.
The separate launch introduction contains inconsistent PDT/PST wording; the seed uses the
unambiguous PST recap, which matches Pacific standard time on November 4.

[GGG's full-release announcement](https://www.pathofexile.com/forum/view-thread/3999366)
confirms **December 11, 2026 (PST)** but gives no hour. PoE2 therefore displays the known date
and time TBA, with no timestamp, countdown or reminders until the owner verifies an exact hour.

## Delivery guarantees and recovery

Uses the existing Discord outbox and leases. Reminder keys contain board ID, event ID,
schedule revision and offset. Reconciliation never revives completed reminder jobs.
Delivery re-reads current settings, role permissions and event revision; cancellation,
rescheduling, disabling and sending serialize through a PostgreSQL advisory transaction lock.
Only the named opt-in role is allowed to be mentioned; users, everyone and other roles are
excluded from allowedMentions. Board posts cannot ping.

A reminder is eligible from its threshold through 15 minutes afterward, and only if opt-in
predated the threshold. A restart in this window recovers it; longer outages skip stale
reminders instead of flooding channels with old 24h/1h/start notices. Each game's opt-in time
is independent. Delivery checks expiry again after Discord history/permission lookups.

Stable author-checked message markers plus nonce deduplication recover Discord sends accepted
before a database commit/worker restart. Recovery pages through history back to the durable
intent, including more than 100 intervening messages. Missing history permissions fail closed.
The persisted board message ID/hash prevents duplicate boards and unchanged-content edits.
Cross-system transactions cannot guarantee exactly-once delivery if Discord accepts a message
and it is externally deleted before recovery; normal restart recovery retains message history.

## Validation and rollout

`tests/game-events.test.ts` covers UTC parsing, official sources, TBA, EN/FR, regions,
Discord limits, permissions, stale schedule/cancellation/disable suppression, opt-in roles,
restart recovery, pagination and missing-board recovery. `scripts/verify-game-events-postgres.ts`
is included in normal `npm run test:postgres` CI and restore rehearsal: concurrent queueing,
leases, unique board constraints, delivered-job persistence, rescheduling, cancellation and
migration constraints. Both Guilded quality jobs must pass on the final PR head before merge.

Follow `deploy/update.sh` through the existing Oracle deployment process, including ledger
preflight and verified backup. Confirm migration status, deployed SHA, systemd, `/health`
(including Discord command registration), and the home-server owner command. Do not start
another bot or activate channels/roles as part of deployment. A live board/reminder smoke test
requires a separately authorized test channel and opted-in role.
