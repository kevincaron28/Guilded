# 4.5.0 handoff

What 4.5 changed, where, and what is left. Written for whoever picks this up next (you in
VS Code, or another Claude session). Version is **4.5.0** everywhere (`package.json`,
`package-lock.json`, `companion-app/package.json` + lock, `Guilded.toc`). 4.0.0 was never
published: 4.5.0 is the first public release and includes the addon audit
(`docs/ADDON_AUDIT_HANDOFF.md`) and all of 4.0.

## What is left, in order (maintainer's PC)

1. Pull `main`.
2. `npm run db:update` — applies migration `20261001090000_application_role_core_trial`
   (two columns, nothing removed).
3. `npm run addon:zip` → `dist/Guilded-v4.5.0.zip`.
4. Rebuild the companion installer (4.5.0).
5. `redeploy-oracle.bat`. On its first start the bot posts "updated to v4.5.0" once per guild.
6. In-game / Discord checks: `RELEASE_CHECKLIST.md`, section "4.5: to check in game and on Discord".
7. CurseForge upload (Beta), changelog text in `docs/CURSEFORGE_COPYPASTE.md`.

## How to verify (must all pass before any push)

```
npx tsc --noEmit -p .
npx vitest run
npx eslint .
node addon/Guilded/validate-addon.mjs
```

Without `.env.local`, prefix the tests with throwaway placeholders (shell only, never committed):
`DISCORD_TOKEN=placeholder DISCORD_CLIENT_ID=123 DISCORD_GUILD_ID=456 DATABASE_URL=postgresql://u:p@localhost:5432/x npx vitest run`.
New tests: `tests/v45.test.ts` (bot) and `tests/lua/v45.test.ts` (addon); `tests/lua/syncnow.test.ts` was rewritten.

## The changes

| Request | What was done | Files |
| --- | --- | --- |
| Change core names | `/core rename <core> <name>` (new subcommand) and the existing Rename button share `coreService.rename` (unique name check). The roster message refreshes. The addon now keeps the core it runs **by id** (`settings.activeCore`), and the companion sends the next raid's `coreId`, so a rename never breaks `/guilded core`. Old saved names still work. | `src/services/raid-core.ts`, `src/commands/core.ts`, `src/commands/core-editor.ts`, `src/services/raid-roster.ts`, `companion/standings.mjs`, `addon/Guilded/Modules/Loot.lua` |
| Easy item prices | **Discord:** an "Item prices" button in `/core edit` and in `/core setup` (any loot mode) opens a form prefilled by `priceDraft()`: current prices, then wishlisted / past-awarded items without a price, suggested at the average GP paid over 180 days (`= ?` when never awarded; the parser now skips `= ?` lines quietly). **In game:** `/guilded drop` in priority mode with no price opens a StaticPopup asking the GP (`loot.askPrice` / `loot.priceAccepted`), starts the item and saves `db.itemPrices["<coreId>:<key>"]`; `/guilded price <item> <GP>` sets one. `loot.priceOf` checks in-game prices first. The companion exports `itemPrices`; the bot's `applyAddonItemPrices` saves each unless Discord's price is newer (unknown core = guild-wide). | `src/services/item-values.ts`, `src/commands/core-wizard.ts`, `src/commands/core-editor.ts`, `src/integrations/addon.ts`, `src/services/addon-import.ts`, `companion/lua-export.mjs`, `addon/Guilded/Modules/Loot.lua` |
| Recipes / linking without typing | The profession scan was already automatic on opening a window. New: a guildmate's profession opened from a chat link or the guild window is saved **under their name** (`viewed = true`; their own addon report always replaces it); guild-wide / NPC views are still ignored. A one-time reminder at login lists crafting professions never read (gathering skills skipped by skill line id). Core keeps `db.myCharacters` (every character that logs in on this PC for this guild, max 50); the companion exports them as `alts`; a **paired** upload links every alt to the paired member (`linkPairedCharacter`, which refuses names owned by someone else). | `addon/Guilded/Modules/Recipes.lua`, `addon/Guilded/Core.lua`, `companion/lua-export.mjs`, `src/integrations/addon.ts`, `src/companion-api.ts` |
| "Action blocked ... /reload" | Newer clients block `ReloadUI()` from addon code. `syncNow.reloadButton()` builds a `SecureActionButtonTemplate` button with `type = macro`, `macrotext = /reload` (allowed from a click); used by the officers' banner and both window buttons. Built in combat → a plain button that says to type /reload. The automatic reload (`/guilded sync auto`) is removed (cannot work); its Options switch is gone. | `addon/Guilded/Modules/SyncNow.lua`, `addon/Guilded/Modules/Minimap.lua`, `addon/Guilded/Modules/Options.lua` |
| Raid tools (markers, icons, map drawing) | **Not built:** planned as the v5 `raidtools` module, written up in `ROADMAP.md` ("v5: Raid tools module"), with the game's limits (secure buttons for world markers, no addon messages during boss fights). | `ROADMAP.md` |
| Setup button for optional roles | `/setup start` step 1: **Create optional roles** (Loot Leader, Class Leader) and a menu to create **one Class Leader role per class** ("Class Leader (Warrior)" / "Chef de classe (Guerrier)"). `isPermissionRoleName("classLeader", …)` accepts those variants, so each counts as Class Leader (same access, not class-scoped). French strings in `src/i18n-fr.ts`. | `src/commands/setup.ts`, `src/permissions.ts`, `src/i18n-fr.ts` |
| Officer log only for guild people | No line when someone joins the server (they have no role yet). New `GuildMemberUpdate` handler logs when someone **gains** the Member role or a leadership role (GM, Officer, Raid Leader, DKP Officer, Loot Leader, Class Leader incl. per-class) and when they lose it; a leave is logged only if they held one (or, when Discord did not keep their roles, had a linked character). `guildRoleOf()` decides. | `src/services/housekeeping.ts`, `src/main.ts` |
| Role on the raid application | Discord forms hold 5 fields and all are used, so the roster's Apply button first shows Tank / Healer / DPS buttons (`apply-form:role:<core>:<ROLE>`), then the form (role in its custom id). `/apply` got a required `role` option. Saved as `Application.role`; shown on the card and `/application view`. | `prisma/schema.prisma`, migration, `src/services/application.ts`, `src/commands/application.ts` |
| Trial members on the core roster | `RaidCoreMember.trial`. Trial decision → `coreService.settleApplicant(core, member, "TRIAL", role)` adds them as trial; the roster embed shows a "🧪 Trial" section and "+ n on trial". Approve clears the mark (keeps role/bench an officer set, or adds them as a full member); Reject removes a trial member only. Officers adding someone with `/core add` or `/core edit` make them a full member. | `src/services/raid-core.ts`, `src/commands/application.ts`, `src/i18n-fr.ts` |
| Trial keeps the application open | `applicationDecisionRows(id, status)` (now in the service): pending → Approve / Trial / Reject; trial → Approve (end trial) / Reject; approved or rejected → none. Used by the card buttons and the `/application` commands. The service already allowed TRIAL → APPROVED/REJECTED. | `src/services/application.ts`, `src/commands/application.ts` |

## Protocol and saved-data changes

- **Companion → bot export:** new optional `alts` (up to 50 characters) and `itemPrices`
  (`{ name, id?, gp, coreId?, at }`, up to 500). Older companions still upload fine.
- **Bot → companion (`GuildedNextRaid`):** new `coreId`.
- **Addon saved data:** `myCharacters`, `itemPrices`, `recipeBook.reminded`,
  `recipeBook.people[<name>][<profession>].viewed`, `settings.activeCore` now holds a core id.
- **Database:** `Application.role` (`RaidRole`, nullable), `RaidCoreMember.trial` (bool, default false).

## Known limits / decisions

- Per-class leader roles give the same access as Class Leader; scoping a leader to their class
  (e.g. only warriors on the readiness board) was not built.
- A guildmate's profession saved from a link is only in *your* saved data (not re-broadcast);
  it reaches Discord with your companion's upload.
- A player on trial in a core counts as a core member for signup priority (like the main roster).
