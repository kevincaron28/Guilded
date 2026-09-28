# 4.6.0 handoff

What 4.6 changed, where, and what is left. Written for whoever picks this up next (you in
VS Code, or another Claude session). Version is **4.6.0** everywhere (`package.json`,
`package-lock.json`, `companion-app/package.json` + lock, `Guilded.toc`, the API.lua comment).
4.5 is described in `docs/V4_5_HANDOFF.md`; 4.6 builds on it and neither has been published yet.

## What is left, in order (maintainer's PC)

1. Pull `main`.
2. `npm run db:update` — applies migration `20261002090000_v46_cores_channels_loot_groups`
   (new columns only, nothing removed).
3. `npm run addon:zip` → `dist/Guilded-v4.6.0.zip` (the zip now also carries `Bindings.xml`).
4. Rebuild the companion installer (4.6.0).
5. `redeploy-oracle.bat`. On its first start the bot posts "updated to v4.6.0" once per guild.
   New slash-command options (`/core rules offspec_percent min_ep`, `/core delete channels`,
   `/loot award offspec`, `/epgp decay weekly`) register with the normal command deploy.
6. On Discord: `/setup start` > **Update bot messages** once per guild (the group finder menu
   replaces the old dungeon button; the old button still works until then).
7. In-game / Discord checks: `RELEASE_CHECKLIST.md`, section "4.6: to check in game and on Discord".
8. CurseForge upload (Beta), changelog text in `docs/CURSEFORGE_COPYPASTE.md`.

## How to verify (must all pass before any push)

```
npx tsc --noEmit -p .
npx vitest run
npx eslint .
node addon/Guilded/validate-addon.mjs
```

Without `.env.local`, prefix the tests with throwaway placeholders (shell only, never committed):
`DISCORD_TOKEN=placeholder DISCORD_CLIENT_ID=123 DISCORD_GUILD_ID=456 DATABASE_URL=postgresql://u:p@localhost:5432/x npx vitest run`.
New tests: `tests/v46.test.ts` (bot) and `tests/lua/v46.test.ts` (addon loot); additions in
`tests/lua/window.test.ts` (position, size, key binding, Crafting), `tests/lua/sync.test.ts`
(off-spec / min EP adoption) and `tests/dungeon-guide.test.ts` (the menu).

## The changes

| Request | What was done | Files |
| --- | --- | --- |
| Raid simulation commands in the UI | Tools page **Test tools** section (officers, `sim` module): Start test raid, Fake bids, Fake council answers, Test dungeon run, End test raid, Clear test data (second click confirms). Each runs the `/guilded sim ...` command. | `addon/Guilded/Modules/Minimap.lua` |
| In-game UI upgrades | **Crafting** page (module `recipes`): who can craft an item (`recipes.whoText`), your professions (`recipes.mineText`), cooldowns. **Export and send** for officers: `syncNow.reloadButton(..., macro)` with `"/guilded export\n/reload"` (secure macro, allowed from a click). Window position saved on drag (`settings.panelPoint`) and size (`settings.panelScale`, Tools page + / - / Reset, `/guilded menu scale bigger\|smaller\|reset\|<n>`). Key binding: `Bindings.xml` → `Guilded_ToggleWindow()` (`BINDING_HEADER_GUILDED`). `tip()` hover tooltips on the new buttons. `newButton` / `newLabel` / `confirmClick` pass text through `ns.L`, and `Locale.lua` gained French for every window string (officer pages included). Every Item box registers with `itemBox()`, so shift-click fills whichever one has focus (before, only the Loot page's box). The tab list gained Crafting (window test updated). | `addon/Guilded/Modules/Minimap.lua`, `Modules/SyncNow.lua`, `Modules/Recipes.lua`, `Locale.lua`, `Bindings.xml` |
| Weekly report | `services/weekly-report.ts`: `weeklyReport(db, guild, now)` covers [previous reset, last reset) (`reportWeek`), due once per reset (`isWeeklyReportDueAfterReset`). Guild stats for the week and the week before (▲/▼ via `withDelta`), per core (raids, main-roster attendance %, bosses, loot, GP, perfect attendance), dungeon week (runs, completed, fastest per dungeon, first clears from `rule:firstCompletion`, records from `rule:personalRecord` / `rule:guildRecord`, top 3 points), **Raider of the week** = most `EP_AWARD` EP (ties: raids, then name), **Dungeon hero** = most dungeon points. `weeklyReportEmbeds` builds 1–3 embeds. `guildStats` takes an end date and returns `attendanceByName`. | `src/services/weekly-report.ts`, `src/services/guild-stats.ts`, `src/commands/stats.ts`, `src/i18n.ts` (`weekly.*`) |
| Group finder for every kind | `DungeonGroup.kind` + `maxSize`. `GROUP_KINDS` (DUNGEON, LEVELING, PVP, WORLDPVP, WORLD, OTHER): dungeons fixed at 5 with role caps; the others take any role up to `maxSize` (2–40, asked in the modal). The pinned guide (`GUIDE_VERSION = 2`) is a select menu (`dguide:kind`) → modal `dguide:create:<KIND>`; the old `dguide:create` button still works. Voice `userLimit` = size. `LFG_ROLE_NAMES` ("LFG Dungeon", "LFG PvP", ...) are pinged on post when they exist; `/setup` **Create LFG ping roles** makes them. The channel is renamed `group-finder` / `recherche-de-groupe` (old names still recognised via `LEGACY_NAMES`). | `src/services/dungeon-group.ts`, `src/services/dungeon-guide.ts`, `src/commands/dungeon-group.ts`, `src/setup-names.ts`, `src/main.ts` |
| Loot systems review | Compared with Classic/retail practice (EPGP, loot council, SR / SR+, personal and group loot), 4.6 adds what was missing: **off-spec** share (`RaidCore.offspecPercent`, default 50, `/core rules offspec_percent`, `/loot award offspec:true`, in game the priority popup's Off-spec answer ranks after main-spec answers and pays the share), **minimum EP** (`RaidCore.minEp`, `rankCandidates(candidates, minEp)` on Discord, `belowMin` ranking in game), **automatic decay** (`GuildSettings.autoDecay` / `lastAutoDecayAt`, `/epgp decay weekly:true`, `runAutoDecay` hourly from `main.ts`, marks the guild before decaying so it never runs twice), **officer votes** on the loot council (`LIST` whisper to officers in the group on close, `VOTE` back, counts in the host's list), **SR+** (+10 per week a reserve went unwon; carried when the list is cleared or reopened, used up on award; `games.setBonus` adds it to the high roll), **GP suggestion** (`loot.suggestGp`: 200 × 2^(ilvl/26 − 4) × slot weight, rare 0.6×, capped 5000, rounded to 5; prefills the price box), **drop detection** (`LOOT_OPENED` and `ENCOUNTER_LOOT_RECEIVED`, epic and up, officers in a raid, kept 2 h in `db.lootDrops`) with a Drop button per item and **trade reminders** (`loot.noteAward`, called from Core's `recordLoot`). The companion writes each core's `offspec` / `minEp` into `GuildedLoot`; `Sync.lua` keeps them (clamped). | `prisma/schema.prisma`, `src/services/core-rules.ts`, `src/services/loot-priority.ts`, `src/services/auto-decay.ts`, `src/services/loot-rules-export.ts`, `src/commands/core.ts`, `src/commands/loot.ts`, `src/commands/epgp.ts`, `companion/standings.mjs`, `addon/Guilded/Modules/{Sync,Council,Loot,Reserve,Games}.lua`, `addon/Guilded/Core.lua` |
| Category and channels per core | `services/core-channels.ts`. **Role:** every core gets a role named after it (`ensureCoreRole`); `syncCoreRole` gives it to everyone in the core (main, bench, trial) and takes it off everyone else — called from `syncCoreRoster`, so every roster change follows. **Channels:** `/core edit` > **Create channels & role** (`createCoreChannels`) makes a category "⚔️ <core>", `#<slug>-roster` and `#<slug>-signups` (everyone reads, only the bot and leadership post), `#<slug>-chat` and a voice channel (core role + GM/Officer/Raid Leader + bot). The roster message moves (old one removed); `syncSignupEmbed` posts the core's raids in its signups channel. Rename follows (`renameCoreDiscord`); `/core delete channels:true` removes them (`deleteCoreDiscord`). Cores without channels keep the shared channels. | `src/services/core-channels.ts`, `src/services/raid-core.ts`, `src/commands/raid.ts`, `src/commands/core.ts`, `src/commands/core-editor.ts` |
| Setup checklist: every channel and bot message | `services/bot-messages.ts`: `botMessageFacts` (bot guide, group finder menu, craft board guide, dungeon leaderboard, each core's roster: current / outdated / missing, by comparing content or components) and `updateBotMessages`. The checklist adds optional rows for the 7 other channels and one row per bot message (⚠️ = `warn`, out of date). Summary buttons: **Update bot messages**, **Create LFG ping roles**, and a two-step "Use an existing channel for..." menu (field, then channel select) to link instead of create. | `src/services/bot-messages.ts`, `src/services/setup-status.ts`, `src/commands/setup.ts`, `src/i18n-fr.ts` |

## Protocol and saved-data changes

- **Council addon messages (prefix `GuildedLC`):** new `LIST|<id>|<item>|Name:tier;...` (host →
  each other officer in the group, whisper, on close) and `VOTE|<id>|<name>` (officer → host).
  Priority sessions now accept the `os` answer. Older clients ignore both.
- **Companion → addon (`GuildedLoot.cores[]`):** new `offspec` (percent) and `minEp`.
- **Addon saved data:** `lootDrops` (`items`, `trades`, pruned after 2 h), `reserves.plus`
  (`"<name>:<itemId>" = weeks`), `settings.panelPoint`, `settings.panelScale`; council sessions
  carry `votes`, `minEp`, `offspec`.
- **Database:** `RaidCore.offspecPercent`, `minEp`, `roleId`, `categoryId`, `rosterChannelId`,
  `signupChannelId`, `chatChannelId`, `voiceChannelId`; `GuildSettings.autoDecay`,
  `lastAutoDecayAt`, `botMessages` (JSON, reserved, not used yet); `DungeonGroup.kind` (default
  `DUNGEON`), `maxSize` (default 5).

## Known limits / decisions

- The core role is created the first time a core's roster refreshes after the update (the bot
  needs Manage Roles). A core whose role was deleted gets a new one at the next refresh.
- Core chat/voice access for leadership uses the roles named Guild Master / Officer / Raid Leader
  (and French names) present when the channels are created; roles made later are not added.
- Bot-message freshness is judged from the message itself (text or buttons); `GuildSettings.botMessages`
  is in the schema for a later per-message version record but nothing writes it yet.
- Drop detection sees what the officer's client sees: a corpse the officer opens, or personal /
  group loot the game reports. Master loot distribution is still done by hand.
- The GP suggestion is a starting point only (the EPGP curve, scaled for Classic item levels).
- SR+ counts weeks by the officer clearing or reopening the list; skipping a week (not reserving
  the item) resets the bonus for it.
