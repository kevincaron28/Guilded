# Guild data the game gives any member's addon (WoW Forever)

Owner request, 6 November 2026: "see what guild information is available for the addon to extract
from the game and could be useful... sync and share as much information as possible while not
penalising somebody who doesn't have the addon or companion."

Everything below is what the game shows **every** guild member, about **every** member, with or
without Guilded. So one member with the addon and the companion is enough for the whole guild to
reach Discord and the website.

## Inventory

| Data | Game API | Before 8.5 | Now |
| --- | --- | --- | --- |
| Roster: name, rank, level, class, online | `GetGuildRosterInfo` | Read in game; Core kept rank, first seen, joined/left; level and class read on the fly by ChatTab and Promotion; uploaded only as the rank of characters in the uploader's own export | **Saved and uploaded for every member** (`Modules/GuildSnapshot.lua`), applied by the bot (`services/guild-data.ts`) |
| Last online | `GetGuildRosterLastOnline` | Used for crafter "last seen" in tooltips only | **Saved and uploaded**; drives "last seen" |
| Zone | `GetGuildRosterInfo` | Unused | Unused (no consumer; location of members who did not opt in) |
| Public note, officer note | `GetGuildRosterInfo` (+ `CanViewOfficerNote`) | Read only by RosterTools for its note tool | **Deliberately not synced**: personal text, and EPGP-style addons keep data there |
| Guild event log: invites, joins, promotions, demotions, removals, quits | `QueryGuildEventLog`, `GetGuildEventInfo` | Kept and deduplicated in game (`Modules/GuildLog.lua`, 2000 events), never uploaded | **Uploaded**; stored once whoever reads it; dates "in this rank since" for the promotion panel |
| Message of the day | `GetGuildRosterMOTD` | Read by GuildMotd.lua for its reminder only | **Saved and uploaded** (`GuildText`) |
| Guild information text | `GetGuildInfoText` | Unused | **Saved and uploaded** (`GuildText`) |
| Guild bank contents and gold | `GetGuildBankItemInfo`, `GetGuildBankMoney` | Snapshot in game when someone opens the bank (`Modules/GuildBank.lua`) | **Uploaded** with a gold history (9.0, docs/GUILD_BANK_LEDGER.md) |
| Guild bank item and money logs | `QueryGuildBankLog`, `GetGuildBankTransaction`, `GetGuildBankMoneyTransaction` | Unused | **Kept and uploaded** (9.0): the read-only Guild bank page and a weekly officer summary. The owner confirmed Forever has a guild bank (6 November 2026) |
| Guild calendar events and answers | `C_Calendar` | Uploaded (`Modules/Calendar.lua`) | Unchanged |
| Professions | Not in the roster on classic-style clients | Shared by addon users only (digest, `Recipes.lua`) | Unchanged (Track K relays them through any guildmate) |
| Guild achievements, news, guild level | Not on classic-style clients | Not available on Forever | Not available |

## How it is applied (bot)

`src/services/guild-data.ts`, called for every paired companion upload (members and officers):

- **Roster (`GuildRosterEntry`)**: one row per guild member, with level, class, rank, last online
  and who reported it. The newest reading wins; an older upload is ignored. Only the newest
  *complete* roster (offline members shown) can mark someone as having left.
- **Linked characters**: the level only goes up, last seen only moves forward, a blank class is
  filled. That feeds the race board, last seen and statistics for members without the addon.
- **Unlinked guild members**: listed (`UnclaimedCharacter`) with level, class and last seen, never
  linked to anyone. That feeds "unlinked characters", the race board and roster gaps.
- **Names**: the addon files every roster member under the full Forever "First Last"
  (`util.characterKey`, which drops a "-Realm" suffix; docs/FOREVER_NAMES.md). An unlinked row still
  stored under the pre-8.5 first name takes the roster's full name (old key kept in `legacyName`)
  instead of a second row being added, unless another listed member shares that first name. The
  race board reads characters and unlinked rows, so its own duplicate-name rules apply unchanged.
- **Rank is applied only from an officer's upload**: rank drives Discord rank roles and the
  roster-gap freshness rule, and a member's saved file could be edited by hand. Every reading is
  still kept in the roster table.
- **Event log (`GuildEventEntry`)**: stored once; the game gives ages in hours, so the same kind,
  names and rank within 3 hours is the same event. The latest promotion or demotion to a
  character's current rank (or their join, if never promoted) dates the promotion panel's
  "in this rank since".
- **MOTD and info text (`GuildText`)**: the newest reading wins.
- Nothing here touches EP/GP, links characters or deletes rows. It is not part of the standings
  feed, so it never makes companions refresh.

## Still to check in a real client

1. `/reload` after opening the guild roster: `GuildedDB.guildSnapshot` lists every member with
   level and last online; MOTD and info text are there.
2. A member without the addon, not linked: appears in the unlinked list and on the race board
   after another member's companion uploads.
3. A promotion done in game: appears once even when two members' companions upload it; the
   promotion panel's time in rank starts at the promotion.
4. Whether Forever has guild bank tabs and logs (decides the ledger page).
