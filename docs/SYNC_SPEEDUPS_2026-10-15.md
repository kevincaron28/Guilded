# Faster, lighter sync: addon, companion and bot (15 October 2026)

Originally prepared on `claude/sync-speedups` from 6.1.2 / protocol 2 and preserved
in commit `c405607`. Now integrated into the 6.2.0 candidate with November scoring
and current website changes. Production and published clients remain 6.1.2.
Compatibility paths support older bots/companions and both officer wire formats;
the remaining real-client limitations and checks are listed below.

Integration review added regressions for account switching, independent ledger
and loot feature negotiation, stop during startup, concurrent stale standings,
recovery-file precedence/cancellation, and the author's recovered ledger entries.
This work does not activate a season or write to production data.

The addon is still standalone. None of this is needed for an in-game-only guild, and the one
new standalone feature (officer ledger sync) is off until an officer turns it on.

## What was slow or fragile, and what changed

| Area | Before | Now |
| --- | --- | --- |
| Standings to the companion | Rebuilt in full (about ten queries and a Discord API call) for every companion, every 2 minutes, even when nothing changed | Cached per guild and member, with an ETag: an unchanged answer is `304` without rebuilding standings (authorization still runs). The companion waits for the next change (long poll, at most 15 s per request), so an award or import reaches the addon folder in seconds |
| Standings stamp | The time of the request, so two officers' companions stamped identical data differently and their addons rebroadcast it to each other | The time the guild's shared data last changed (standings, prices, cores, raids, dungeon board). The same data gets the same stamp on every PC |
| Upload size | The whole ledger and loot history on every upload, growing toward the 1 MB limit | gzip-compressed (several times smaller), and entries the bot already stored are left out. Raids, digests and held entries are still sent every time |
| Import apply | One database call per new ledger row; every guildmate's unchanged gear digest re-applied on every officer upload | New ledger rows inserted in one call. Digests, attunements, recipes and character details are skipped when identical to that uploader's previous applied upload, while nobody's links changed (up to 6 hours). Ledger, loot and raids are never skipped |
| Addon updates | Replaced the companion's `Standings.lua` with the empty one the addon ships; standings disappeared until the next write and `/reload` | The companion also writes `Interface/AddOns/GuildedData` (its own tiny addon, not part of the download), which addon updates leave alone. It only replaces Guilded's own copy when the shared timestamp is newer; a tie keeps the main file and its personal data. The companion also notices a replaced file and writes it again |
| Officer bridge in game | Every byte sent as two hex digits, so a large roster took minutes and data over ~23 KB was refused | `DATA|2`: printable text sent as is, about half the messages, up to ~46 KB of data |
| Answers to requests in game | Every officer with the data answered every login request at once | Answers wait 1 to 5 seconds and an officer that hears another officer sending the same data stays quiet |
| Companion file watch | A watch error stopped uploads until the companion was restarted; a missed save waited for the next one | The watch restarts by itself, and a 30-second check catches a missed save |
| Standalone officers | Each officer's ledger stayed on their PC; handover was by backup code | Optional: `/guilded ledgersync on` (in-game-only mode) lets officers exchange missing EP/GP entries in game |

## Compatibility

The bot lists what it supports in `features` (standings answer and `/health`):
`gzip-upload`, `ledger-delta`, `loot-delta`, `etag`, `long-poll`. The companion only uses
what the bot lists.

- **Older companion, new bot:** unchanged. No ETag is sent, so every request gets the full
  answer, as before.
- **New companion, older bot:** no `features`, so plain uploads with everything in them and
  the old 2-minute refresh.
- **Website proxy (Cloudflare Worker):** it forwarded only a few headers and gives up after
  20 seconds. The worker now forwards `content-encoding` and `if-none-match`. Until it is
  redeployed, everything still works: the bot recognizes gzip bytes without the header, the
  companion sends its ETag as `since` too, and long polls stay at 15 seconds.
- **A proxy that ignores `since`:** the companion notices three full answers in a row with the
  same ETag and falls back to the timed refresh instead of spinning.
- **Officer bridge, mixed addon versions:** a new client sends `CAP|2` right before its usual
  `REQ|1`. A new officer answers that requester with `DATA|2`. A `REQ|1` without `CAP|2`, or
  a guildmate announcing an older version, means an older addon is online, and the officer
  sends `DATA|1` for 30 minutes. Older officers ignore `CAP|2` and keep answering `REQ|1` with
  `DATA|1`, which new clients still read.
  Known gap: an older client that logged in *before* the officer and does not ask again gets
  the officer's next proactive share only if the officer has seen evidence of older clients.
  It catches up at its next login.

## Officer ledger sync (standalone guilds)

`Modules/LedgerSync.lua`, prefix `GuildedLedger`. Off by default. An officer turns it on with
`/guilded ledgersync on` in in-game-only mode; `now` asks online officers to compare,
`status` counts entries.

Ledger entries have permanent ids (`<author>-<server time>-<sequence>`) and are never edited:
a void only marks one. So merging is a union with "voided wins", with no conflicts to
resolve. Officers announce a count and hash of their whole ledger (`SUM`) at login and every
few minutes. When two differ, they compare per author (`AUTH`), then per day (`DAYS`), and
whisper each other only the entries of the days that differ (`GET`, `E`). Received entries
count like local ones: balances, standings, publishing and backups. Only an entry's author can
void it (`/guilded void` skips other authors' received entries but permits the
author's recovered entries). Only officers' messages count, only in
in-game-only mode with sync on.

This is not a central database. An officer who is offline catches up the next time two
officers with sync on are online together. The record keeper can still publish standings to
members, and backup-based handover still works.

## Not done, on purpose

- **Raids are not pruned from uploads.** The bot does not store a raid's addon reference, so
  there is no safe acknowledgement. Raids are small next to the ledger.
- **No per-section manifest for in-game sharing.** With the shared stamp, identical data is no
  longer rebroadcast, which was most of the waste. Separate stamps per section would mean a
  new message format for little gain.
- **`SeasonSync.lua` (dungeon board relay) is unchanged** while the dungeon work is in
  progress elsewhere. It already ignores data that is not newer, and it benefits from the
  shared stamp.
- **Shared stamps live in the bot's memory.** After a bot restart, the first answer gets a new
  stamp, so in-game clients rebroadcast once.

## Deployment order

1. Bot (this branch, after review and CI). No database migration.
2. Cloudflare Worker (`worker/index.mjs`, two forwarded headers). Optional: everything works
   without it, just less efficiently.
3. Companion builds: desktop app (`companion-app/package.json` now ships `delta.mjs` and
   `data-addon.mjs`) and the web companion bundle (`npm run companion:build`).
4. Addon: `LedgerSync.lua` is in the TOC. Bridge and sync changes read both wire versions.

## Checks still needed in real clients

Offline tests cover the protocols (`tests/standings-feed.test.ts`,
`tests/companion-sync-speed.test.ts`, `tests/companion-upload-body.test.ts`,
`tests/addon-import-sections.test.ts`, `tests/lua/ledger-sync.test.ts`, and new cases in
`tests/lua/officer-bridge.test.ts` and `tests/lua/sync.test.ts`). Not yet seen in the game:

- `GuildedData` loads after Guilded on WoW Forever, is enabled by default, and an addon update
  leaves it in place with standings still shown after `/reload`.
- An award on Discord appears in the companion's `Standings.lua` within seconds (long poll
  through the website address and through the direct address).
- Two clients, one older (6.1.2) and one newer: bridge data reaches both.
- Two officers in an in-game-only guild with ledger sync on: entries made on each PC appear on
  the other after both are online; a void reaches the other officer; totals match.
- Upload size in the companion log before and after (`lastUploadBytes` in its state).
