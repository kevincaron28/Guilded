# Guild pages — design draft (16 October 2026)

Status: approved design, not built yet. Owner decisions are recorded at the end.

## Goal

Every guild that sets up Guilded gets its own public web page, so players can
find it (including through Google) and see raid times, cores and rankings at a
glance. Quebec Gold is the first one: its page replaces the hand-copied
`/quebec-gold/cores/` snapshot with live data.

## How it works

1. **Created as a draft.** When a server finishes `/setup start`, the bot creates
   a draft page with an address based on the guild name, for example
   `guilded.kcaron.top/g/quebec-gold/`. A draft is not public: only officers get a
   private preview link.
2. **Officers choose what to show** and publish. Nothing is public until they do.
   They can unpublish at any time; the address then answers 404.
3. **Visitors** see a fast, read-only page in the guild's language (`/config`
   language, English or French).

## Sections officers can turn on

| Section | Source in the database | Notes |
| --- | --- | --- |
| About | `Guild.name`, `GuildSettings.timezone`/`language`, officer-written intro | Always on once published |
| Raid cores and times | `RaidCore` name, description, realm, `weeklySchedule` + `weeklyTimezone` | Times shown in the guild's timezone |
| Loot system | `RaidCore.lootMode` and EP/GP rules | Explains EPGP, council, reserves or priority |
| Rosters | `RaidCoreMember` → character name, class, role | Character names only |
| Rankings | EPGP standings per core | Character names and points only |
| Recruitment | Officer-written text + Discord invite | Optional |

Never shown: Discord user IDs or names, applications, audit logs, notes, private
channels, individual loot history.

## Technical shape

- **Data:** one new table, `GuildPage` (guild, slug, status draft/published,
  enabled sections, intro and recruitment text, Google indexing on/off,
  published time). Hand-written migration, as usual.
- **Serving:** the bot answers `GET /g/<slug>/` from its existing HTTP server
  (`src/companion-api.ts`) with plain HTML that uses the site's `style.css`. The
  Worker forwards `/g/*` to the bot (one new route in `worker/index.mjs` and
  `wrangler.jsonc`'s `run_worker_first`).
- **Speed and database:** the bot keeps one rendered copy per page and rebuilds
  it only when its data changes (same idea as the standings feed). The Worker
  may cache it for a few minutes, so visitors never wake Postgres.
- **Search:** published pages that allow indexing are listed in a sitemap the bot
  serves; others send `noindex`.
- **Officer controls:** a new `/guildpage` command, kept out of the merged
  `/setup` command because that one is close to Discord's 4,000-character limit.
  A "Guild page" tab in the companion's manage view can follow later.
- **Self-hosted bots** serve the same pages on their own address
  (`https://their-bot/g/<slug>/`); the kcaron.top Worker only fronts the hosted pilot.

## Build order

1. `GuildPage` table, page rendering and the Worker route; Quebec Gold only.
2. `/guildpage` command (preview, choose sections, publish, unpublish), French
   translations, tests.
3. Automatic draft for every hosted pilot guild after `/setup start`; sitemap.
4. Optional: companion "Guild page" tab, dungeon leaderboard section, custom intro image.

## Owner decisions (16 October 2026)

1. **Address:** `guilded.kcaron.top/g/<name>/`, not subdomains.
2. **Rosters and rankings:** character names with points, each section off until
   an officer turns it on.
3. **Google:** indexing on by default for published pages; officers can turn it off.
4. **Who edits:** Officers, Guild Masters and server administrators. Raid Leaders cannot.

## Still open

- Discord-only guilds (no addon) get a page too, showing only the sections that
  have data (cores, times, loot rules). Proposed default; confirm before step 3.
