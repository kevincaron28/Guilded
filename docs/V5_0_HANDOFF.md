# 5.0.0 handoff

What 5.0 changed, where, and what is left. Written for whoever picks this up next (you in
VS Code, or another Claude session). Version is **5.0.0** everywhere (`package.json`,
`package-lock.json`, `companion-app/package.json` + lock, `Guilded.toc`, the API.lua comment).
4.6 is described in `docs/V4_6_HANDOFF.md`; 4.5, 4.6 and 5.0 are all unpublished.

## What is left, in order (maintainer's PC)

1. Pull the branch (or `main` once merged).
2. `npm run db:update`: applies migration `20261010090000_v50_alerts_answers` (new columns
   `DungeonGroup.minLevel` / `maxLevel`, `GuildSettings.answerChannelId` / `aiAnswers`, new tables
   `GroupAlert` and `FaqEntry`; nothing removed).
   Also `20261020090000_core_member_character` (new nullable column `RaidCoreMember.characterId`,
   see "Several cores per member" below).
3. `npm run addon:zip` → `dist/Guilded-v5.0.0.zip`.
4. Rebuild the companion installer: `cd companion-app`, `npm install` (it now pulls `luaparse`),
   `npm run dist`. **Quit every running Guilded Companion first** (Task Manager: "Guilded
   Companion" and `electron.exe`): the 4.6 installer's app hung invisibly at startup.
5. Optional, answer channel: Discord Developer Portal > the bot > **Message Content Intent** on,
   then `MESSAGE_CONTENT_INTENT=true` in the server's `.env.local`. Order matters: asking for the
   intent without the portal switch makes Discord refuse the login. Free AI answers: set
   `AI_BASE_URL`, `AI_MODEL` (and `AI_API_KEY` except for Ollama); examples in `.env.example`,
   check the provider's current free models.
6. `redeploy-oracle.bat`. The bot posts "updated to v5.0.0" once per guild. New slash-command
   parts (`/dungeon alerts`, `/mod faq ...`, the new `/core delete channels` wording) register
   with the normal command deploy.
7. On Discord: `/setup start` > **Update bot messages** once per guild (group finder menu gains the
   alerts button; cores made before 5.0 get their channels).
8. Checks: `RELEASE_CHECKLIST.md`, section "5.0: to check in game and on Discord".
9. CurseForge upload (Beta), text in `docs/CURSEFORGE_COPYPASTE.md`.

## How to verify (must all pass before any push)

```
npx tsc --noEmit -p .
npx vitest run
npx eslint .
node addon/Guilded/validate-addon.mjs
```

Without `.env.local`, prefix the tests with throwaway placeholders (shell only, never committed):
`DISCORD_TOKEN=placeholder DISCORD_CLIENT_ID=123 DISCORD_GUILD_ID=456 DATABASE_URL=postgresql://u:p@localhost:5432/x npx vitest run`.
New tests: `tests/v50.test.ts` (bot: core channels, group alerts, answers),
`tests/lua/v50.test.ts` (addon: GP deduct, game rules, guild map, scores, group board, raid tools,
standings publish), `tests/companion-app-packaging.test.ts` (the installer ships what the engine
imports); `tests/lua/window.test.ts` tab lists updated.

## The changes

| Request | What was done | Files |
| --- | --- | --- |
| Answer channel AI could type without answering, and did not know Guilded commands | AI failures now produce a safe, localized message in the answer channel and a redacted server diagnostic; failed requests do not use the member cooldown or daily-success quota. Questions phrased without punctuation are recognized in English and French. The AI prompt gets the registered Discord slash-command schema plus a Guilded addon feature/command reference. | `src/commands/faq.ts`, `src/services/answers.ts`, `src/services/guilded-reference.ts`, `src/main.ts` |
| Companion would not start (no tray icon; installer said "already running") | The installed app loads `companion/*.mjs` from `resources/engine`, outside any `node_modules`, so `import luaparse` threw and the process hung with no window or tray while holding the single-instance lock. `luaparse` is now a companion-app dependency copied to `engine/node_modules/luaparse` (extraResources); a startup error shows a dialog and exits (`failStartup`); `start-companion-app.bat` installs the repo's dependencies and draws the icons when missing. | `companion-app/package.json`, `companion-app/main.cjs`, `start-companion-app.bat`, `tests/companion-app-packaging.test.ts` |
| Deduct GP in the in-game UI | **Deduct GP** on the EPGP page and `/guilded gpdeduct <player> <n> [reason]`: kind `GP_DEDUCT` in `EPGP_KINDS`, stored as ledger type `ADJUSTMENT` with a negative `gpAmount` (the bot's import already accepts it), capped at the player's current GP. | `addon/Guilded/Core.lua`, `Modules/Minimap.lua` |
| Explain the games in chat | `games.explain` / `/guilded games explain highroll\|deathroll\|duel` (no name: the running game) posts two rule lines through the games chat queue, in party/raid chat or `/say` when alone (queue entries can now carry their own channel). Three buttons on the Games page. | `Modules/Games.lua`, `Modules/Minimap.lua` |
| One category and channel list per core, added/removed automatically | `setupCoreDiscord` (never throws; returns the reason) and `ensureCoreDiscord` / `ensureAllCoresDiscord` (then the roster in its own channel) run on `/core create`, the core wizard and **Update bot messages** (older cores). `/core delete` now calls `archiveCoreDiscord`: text channels move to "🗄️ Archived cores" (a new "… 2" when a category would pass 50), every existing overwrite gets `SendMessages: false` (the bot's own is kept), voice and category deleted, role renamed "<core> (archived)" and not mentionable. `channels:true` still deletes. The checklist marks a core without its own channels ⚠️. | `src/services/core-channels.ts`, `src/services/raid-core.ts`, `src/services/bot-messages.ts`, `src/commands/core.ts`, `src/commands/core-wizard.ts`, `src/commands/setup.ts` |
| Tag or ping when someone creates a group I am eligible for / interested in | `GroupAlert` per member (kinds, roles). Panel: **My group alerts** button under the pinned menu (`GUIDE_VERSION = 3`, `dguide:alerts`) and `/dungeon alerts`; components `galert:kinds\|roles\|off`. Groups get `minLevel` / `maxLevel` from a new **Levels** box (`parseLevelRange`), or for dungeons/leveling from the title (`dungeonLevelsFromTitle`, English and French Classic dungeon names). `postGroup` mentions the kind's LFG role (as before) plus `alertRecipients`: kind wanted, any linked character in range (unknown levels count), dungeons: a role from `rolesFromTitle` ("need tank") that they play; never the leader, nobody already pinged by the role, at most 40. | `src/services/group-alerts.ts`, `src/commands/group-alerts.ts`, `src/commands/dungeon-group.ts`, `src/services/dungeon-group.ts`, `src/services/dungeon-guide.ts`, `src/commands/dungeon.ts`, `src/main.ts` |
| Bot listens to a channel and responds | Decision: free first. Officer answers (`FaqEntry`: triggers + answer) matched by `matchFaq` (every word of a trigger present; most specific wins). Optional AI through any OpenAI-compatible `/chat/completions` (`askAi`; free Google AI Studio or Groq key, or Ollama), off per guild until `/mod faq ai on`, only for questions ("?" or a mention), capped by `AI_DAILY_LIMIT` per guild per day (in memory: resets on restart) and one answer per member per 15 s. The AI gets `guildFacts` only (answers, cores, next 5 raids, the asker's characters and EPGP). `/mod faq add\|edit\|remove\|list\|channel\|ai\|test` (modals `faq:add`, `faq:edit:<id>`). The listener (`answerMessage`) caches each guild's channel for a minute; intents `GuildMessages` + `MessageContent` are requested only with `MESSAGE_CONTENT_INTENT=true`. | `src/services/answers.ts`, `src/commands/faq.ts`, `src/commands/index.ts`, `src/commands/autocomplete.ts`, `src/config.ts`, `src/main.ts`, `.env.example` |
| Guild location map (minimap and world map) | `GuildMap.lua` (module `guildmap`, prefix `GuildedMap`): `P\|mapId\|x\|y\|class\|level` (x/y in 1/10000) every 5 s while moving, 30 s standing still; `G` when you stop sharing or enter an instance; nothing in combat. Dots expire after 90 s. World map: pins on `WorldMapFrame.ScrollContainer.Child`, zone points translated to the viewed map through `C_Map.GetWorldPosFromMapPos` / `GetMapPosFromWorldPos`. Minimap: offsets computed on your own map with `C_Map.GetMapWorldSize` (no world-axis guessing), radius from the zoom (indoor/outdoor tables), rotated with `GetPlayerFacing` when the minimap rotates. No libraries (HereBeDragons not bundled). | `addon/Guilded/Modules/GuildMap.lua` |
| Addon usable without the bot; dungeon scores like Raider.IO | `Scores.lua` (module `scores`, prefix `GuildedScore`): best run per player per dungeon (`db.scores.bests`), points = dungeon top level × 2 × (0.75 + 0.25 × guild record / time) × (1 − 5% per death, max 25%); learned from every finished run (`ns.onDungeonRunFinished`, called by Dungeon.lua for own and peer runs; old runs at login). Players send `S\|score\|dungeons` (a self-report, capped at 5000). Tooltip line on players via `TooltipDataProcessor`. `Groups.lua` (module `groups`, prefix `GuildedLFG`): in-game group board, `O\|id\|kind\|min\|max\|roles\|title` / `X\|id`, alerts (raid warning + sound) with the Discord alerts' rules, groups expire after 30 min. `/guilded standings publish` (Sync.lua `ns.publishLocalStandings`): an officer's ledger as the guild's standings, source "<name> (in game)". **Groups** window page (board, alerts, scores); **Share my ledger as standings** on the Standings page. | `Modules/Scores.lua`, `Modules/Groups.lua`, `Modules/Sync.lua`, `Modules/Dungeon.lua`, `Modules/Minimap.lua`, `docs/STANDALONE_ADDON_ROADMAP.md` |
| v5 raid tools module (roadmap) | `RaidTools.lua` (module `raidtools`, prefix `GuildedRT`): `/guilded rt mark <1-8\|clear>`, `rt tanks` (skull, cross, square… on `UnitGroupRolesAssigned` / main tanks), `rt clear`, boss plans (`db.raidPlans`, up to 8 lines) saved by officers or the leader, **shared** as `PLAN\|id\|i\|n\|text` (line 0 = boss) to the group and shown in a movable window on every raider's screen, accepted only from the leader, an assistant or an officer; **posted** in raid chat for players without the addon; refused in combat. World markers: secure `/wm 1..8` and `/cwm 0` buttons (reusing `ns.syncNow.reloadButton`). **Raid tools** page (leaders). `rt check` says what the client allows. Map drawings from the roadmap are not done (see below). | `Modules/RaidTools.lua`, `Modules/Minimap.lua` |

Also: the window is 600 px tall (was 540) with 22 px sidebar buttons every 26 px, so every page
fits for officers; `validate-addon.mjs` now checks every `.lua` file the `.toc` lists (it had a
hand-kept list that missed Tooltip.lua and ChatTab.lua); `scripts/i18n-keys.mjs` enforces French for
`src/services/dungeon-guide.ts`, `src/commands/group-alerts.ts` and `src/commands/faq.ts` too.

## Several cores per member (after 5.0.0)

A member could already be in several cores (one `RaidCoreMember` row per core, own role and bench
spot in each); nothing recorded which character they bring. Each core spot now has an optional
`characterId` (one of the member's linked characters; `SET NULL` if the character is unlinked), so
a member can bring the same character to every core or a different one to each. Set with
`/core add ... character:` (officers), `/core character core: character: [player:]` (anyone for
themselves; Raid Leaders for others; no character clears it), or from an accepted core
application (the application's character, when linked and none is set yet). Shown as
"Name · Character" on the roster message, `/core show` and core raids' signup posts; `/core list`
marks your own role/character in each core and `/core add` says which other cores the player is in.
Points are unchanged: EP/GP stay per member (per pool), so every character of a member shares them,
and in-game standings are exported for every linked character. Tests: `tests/raid-core.test.ts`.
Files: `prisma/schema.prisma`, the migration, `src/services/raid-core.ts`, `src/commands/core.ts`,
`src/commands/application.ts`, `src/commands/raid.ts`, `src/commands/autocomplete.ts`,
`src/commands/help.ts`.

## Protocol, saved-data and database changes

- **New addon prefixes:** `GuildedMap` (guild), `GuildedScore` (guild), `GuildedLFG` (guild),
  `GuildedRT` (raid/party). Receivers ignore extra fields; `GuildedLFG`'s title and `GuildedRT`'s
  text are the last field and take the rest of the line, so new data there needs a new kind.
- **Saved data (per guild):** `scores` (`bests`, `board`), `raidPlans`; settings `mapShare`,
  `mapShow` (default on), `lfgAlerts` (`kinds`, `roles`).
- **Ledger:** GP deductions are `type = "ADJUSTMENT"` with `gpAmount < 0`.
- **Database:** `DungeonGroup.minLevel`, `maxLevel`; `GuildSettings.answerChannelId`, `aiAnswers`;
  tables `GroupAlert` (unique per member) and `FaqEntry`.
- **Environment:** `MESSAGE_CONTENT_INTENT`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`,
  `AI_DAILY_LIMIT` (all optional; blank = unset).

## Known limits / decisions

- **Nothing here ran in the real game or on the real Discord** (this session had neither): the map
  math, tooltips, secure marker buttons and plan window are tested against the mocked client
  (`tests/lua`), the Discord parts against fakes. The 5.0 checklist lists what to try.
- Map: `C_Map` position APIs are guarded; if WoW Forever hides them (Midnight-style restrictions)
  the map simply shows nothing. Positions are self-reported by guildmates.
- Scores are computed per client from the runs it knows plus self-reported totals; the page says
  when a player's shared total is higher than what this client saw. The formula is a first cut:
  tune `scores.points` (and the dungeon table, shared in spirit with `DUNGEON_LEVELS` in
  `src/services/group-alerts.ts`) after real runs.
- Group alerts use linked characters' levels as last uploaded; a member with no linked character
  matches on kind and role only.
- AI: the daily cap lives in memory (a restart resets it); the model can still be wrong, and the
  system prompt tells it to send guild-rule questions it cannot answer from the facts to an
  officer. The example model names in `.env.example` may be outdated by the time you read this.
- Raid tools: boss-room drawings and numbered map spots (roadmap) are not built; plans are text.
  Marks and world markers depend on the client allowing `SetRaidTarget` and `/wm`.
- Archived core channels keep the (renamed) role so former members can read their chat; delete the
  channels and role by hand when no longer needed.
