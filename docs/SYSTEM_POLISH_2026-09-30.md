# Audit improvements and recovery

Product 5.0.0, companion protocol 2. Optional calendar identity remains compatible with older uploads. Migration `20260930180000_system_delivery_archive` adds `DiscordJob` and final-season snapshots.

## Changes

`/system status` is an officer-only private sync dashboard: active pairings, last accepted upload/import state, waiting approvals, auto-apply, queued Discord deliveries, last successful update and channel permissions. `/system retry` advances retries without stealing active leases. `/system permissions` lists the permissions needed without Administrator, including existing moderation. Discord online status does not prove a companion is running.

Raid posts, standings, profession directories and announcements use a durable queue. Coalesced refresh revisions prevent a slow delivery erasing a newer refresh. Expiring leases recover after process failure, retries back off to one hour, and successful jobs expire after 30 days. Reset cascades queued data. Import/profession transactions enqueue refreshes before commit; calendar application also has a persisted job. Notifications become durable once enqueued; a crash before enqueue can still omit an announcement. Nonce and recent-message delivery references reduce duplicates, but Discord and PostgreSQL have no shared atomic commit; a delayed retry after more than 100 newer messages can duplicate an announcement.

The addon embeds `[Guilded raid:<id>]` in created calendar events, reads it when opening the event and sends it through the companion. Matching is ID-first and guild-scoped. Unavailable IDs never select another raid. Legacy events require a unique title within the existing time window; ambiguity is reported. Native Discord events without bot raids receive no invented raid ID.

`/dungeon archive page:` reaches all seasons beyond the dropdown's 25-item limit. `/dungeon hall-of-fame page:` shows champions and ties. Season close captures member names, points and scoring rules; Discord and the in-game feed use frozen points. Older seasons use existing champion awards and are labeled legacy. Corrections remain visible in the ledger/all-time totals and do not silently rewrite published season ceremonies. In-game history remains bounded to the ten most recent past seasons; Discord exposes the complete archive.

Directories refresh after profession relay transactions and recover archived posts. Reused setup guides receive documented access. General raid signups, the addon guide and FAQ remain owned by setup/reset, including historical aliases.

## Recovery and permissions

The scoped Neon project record confirmed 21,600 seconds (six hours) of recovery history. Oracle daily JSON copies retain 14 days; private native database/app archives precede deployment. `scripts/backup-oracle-offsite.mjs <verified Oracle recovery directory>` transfers AES-256-GCM encrypted copies to `%LOCALAPPDATA%\Guilded Recovery` with a separate owner-only key directory. It verifies authenticated decryption and remote/local SHA-256 equality. The app archive contains sensitive configuration.

`scripts/restore-oracle-offsite.mjs <local recovery directory>` reconstructs verified files into the private `restored` subdirectory without changing live data. Keep a separate secure backup of the recovery key: losing it makes the copy unusable. Both local folders are on this PC; protection against losing this PC requires another secure storage location.

The bot's role must remain above roles it assigns. Discord prevents bots editing roles at or above their highest role. Removing Administrator from a highest managed role can require the server owner after a functional permission role is prepared. Recheck channel overrides afterward. [Discord permission hierarchy](https://docs.discord.com/developers/topics/permissions)

## Real-client acceptance still required

Use an officer with a freshly paired companion and a second member with only the addon. Open both players' professions, save through reload/logout, and confirm the officer's upload refreshes both characters. Unlearn a profession and check skills, recipes, cooldowns and the directory remove it.

1. Create a core raid. Sign up from both general/core posts, change role or cancel from the other post, and confirm identical rosters. A non-core member uses the general post. Two simultaneous tank signups with cap one yield one slot and one waitlist.
2. Create two similarly named core raids near the same time. Create an event from the addon, accept, save and upload. Its explicit ID selects its own raid; legacy ambiguous events remain unresolved. Discord answers/cancellations retain precedence.
3. Finish a real guild dungeon. Check its end-of-run summary, one official run/award after import, identical current points in game and Discord, and archived seasons. Re-upload grants no second award.
4. During a real raid, keep the compact marker window open, exercise supported markers in/out of combat, and verify core loot/report routing and totals. Test installation/upgrade on a non-developer Windows PC too.

Automated checks do not prove WoW hardware-event restrictions, combat UI or a raid night. These remain public-release gates.

## PoE 2

See [POE2_GUILD_COMPETITION_PLAN.md](POE2_GUILD_COMPETITION_PLAN.md). This task plans the module rather than enabling channels/scoring. GGG registration is currently unavailable, so the proposed first phase uses reviewed evidence and later adds official OAuth if available.
