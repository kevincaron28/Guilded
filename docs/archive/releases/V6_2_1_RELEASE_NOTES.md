# Guilded 6.2.1 — Guild pages, bug reports and steadier sync

Patch release, October 16, 2026. Addon, bot and Windows companion move together to 6.2.1;
protocol remains 2. The 6.2 real-client checks ([checklist](V6_2_GAME_ACCEPTANCE.md)) are
planned for the weekend and feed the next minor version, 6.3.

## Discord bot

- **Guild web pages.** Each guild can publish a page at `guilded.kcaron.top/g/<name>/`
  with its raid cores and times, loot system, rosters, EPGP rankings and recruitment, from
  live data. Officers manage it with `/mod page` (create, show or hide sections, intro and
  recruitment text, Discord invite, search engines, publish). Nothing is public until an
  officer publishes it; rosters and rankings show character names only.
- **Setup follows your server.** New channels join the category their group already uses
  and keep a game role gate (for example, World of Warcraft only). "Organize channels" no
  longer moves channels out of categories you chose.
- **Per-core attendance.** Each raid core gets an officers-only `#<core>-presences` channel
  where its raids' attendance is posted. The shared raid roster channel is no longer
  offered (each core has its own roster channel).
- **Bug reports.** `/report bug` answers with a short reference and always reaches the
  developer, with the bot version attached.
- Pilot approval sends the server owner a bilingual welcome with next steps.
- Sync stamps survive a bot restart, so companions and game clients do not re-download
  unchanged standings after an update.

## Companion

- Uploads leave out finished raids older than 90 days, so uploads stop growing.
- A folder watch that stopped (antivirus, backup software) is tried again every 5 minutes.
- Long polls end after 12 seconds, further inside the website's 20-second limit.

## Addon

- `/guilded ledgersync status` remembers when each officer with sync on was last heard from
  (across reloads) and says plainly when no partner has been seen: sync needs two officers
  online at the same time.

## Database

Migrations: `20261114090000_guild_pages`, `20261115090000_core_attendance_channel` (already
applied on the hosted bot) and `20261116090000_error_report_status`. Deploys apply them.
