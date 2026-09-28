# Addon audit handoff (4.0.0 hardening)

What was changed in the addon audit, why, and exactly what is left to do. Written
for whoever picks this up next (you in VS Code, or another Claude session). Commit:
`05fefd8 Harden the addon: audit fixes and upgrades` on branch
`claude/sleepy-pascal-cmmf3q` (not merged to `main` yet).

## Status at a glance

- Done and pushed: 11 fixes + 6 upgrades, 46 new tests, docs.
- Verified: `npx tsc --noEmit -p .`, `npx vitest run` (606 tests, 90 files),
  `npx eslint .`, `node addon/Guilded/validate-addon.mjs` all pass.
- **Not** done yet (needs a human, see "What is left"): merge to `main`, rebuild the
  addon zip and the companion installer, redeploy the bot, run the in-game checks.
- Version is still **4.0.0** on purpose (4.0.0 is not published yet; bumping the
  version posts an update notice to every guild, see CLAUDE.md). All changes are
  listed under 4.0.0 in `CHANGELOG.md`.

## What is left, in order

1. **Merge** `claude/sleepy-pascal-cmmf3q` into `main` (PR or local merge). Before
   merging, run the four checks below; they must all pass.
2. **Rebuild the addon zip:** `npm run addon:zip`. The existing
   `dist/Guilded-v4.0.0.zip` predates the audit and is missing `Util.lua` and
   `Modules/Options.lua`, so the old zip would not even load correctly.
3. **Rebuild the companion installer** (the companion now sends `reporterNames`
   for dungeon runs; `companion/lua-export.mjs`).
4. **Redeploy the bot** on the maintainer's PC: `redeploy-oracle.bat` (the new
   dungeon run check is in `src/services/dungeon-rules.ts`). No database migration.
5. **In-game checks** with a second player: `RELEASE_CHECKLIST.md`, section
   "Addon audit: to check in game (with a second player)". One item per fix/upgrade.
6. Then the normal release steps in `RELEASE_CHECKLIST.md` (CurseForge upload, etc.).

Everyone testing must run the new build: the reserve-list message format changed
(see "Protocol changes"), and an old client shows reserve lists incompletely.

## How to verify (copy-paste)

```
npx tsc --noEmit -p .
npx vitest run
npx eslint .
node addon/Guilded/validate-addon.mjs
```

Without `.env.local` (cloud sandboxes), 9 bot test files fail to *load* because
`src/config.ts` requires Discord/database settings. That is not a code error. Run
them with throwaway placeholders set only in the shell (never commit these):

```
DISCORD_TOKEN=placeholder DISCORD_CLIENT_ID=123 DISCORD_GUILD_ID=456 DATABASE_URL=postgresql://u:p@localhost:5432/x npx vitest run
```

(PowerShell: `$env:DISCORD_TOKEN="placeholder"; ...` then `npx vitest run`.) On the
maintainer's PC with `.env.local`, plain `npx vitest run` works.

## The fixes (what, where, why)

| # | Fix | Files |
| --- | --- | --- |
| 1 | Whispered GP bids and loot council / EPGP priority answers only count from your raid or party (`ns.util.inMyGroup`). Addon-message bids/answers too. Before: anyone whispering "25" or "yes" was entered, and priority loot charges the top answer GP by itself. Also "+" now actually matches (the old pattern could not). | `Modules/Bidding.lua`, `Modules/Council.lua` |
| 2 | Dungeon run trust. `END` is accepted only from the run's recorder or the group leader, and only with an end time between the start and now+60s. `ACTIVE` start times before detection are ignored. A guild-shared `SUM` is kept only if the sender is listed in the run's players and its times are not in the future. Bot: `validateRun` rejects a run whose `recorder` is not among its players, or (when `reporterNames` is sent) none of whose reporters were. | `Modules/Dungeon.lua`, `companion/lua-export.mjs`, `src/services/dungeon-rules.ts` |
| 3 | Shared data dated more than 10 minutes ahead of the server clock is refused (`ns.util.tooFarAhead`): standings (`STAND`), item data (`ITEM`), guild module switches (`applyGuildModules`), reserve stamps. Before: one wrong clock froze everyone on that copy forever. | `Util.lua`, `Modules/Sync.lua`, `Core.lua`, `Modules/Reserve.lua` |
| 4 | Burst sends. All addon messages go through one paced queue (upgrade U1). Reserve lists are versioned (below). | `Util.lua`, every module |
| 5 | Recipes: opening someone else's profession (chat link, guild crafter view, NPC/crafting order view) is never saved as yours (`recipes.viewingOthers`). Enchant keys: the modern window now uses `-recipeID` (the enchant's spell id), the same key the classic window's `enchant:<id>` link gives. Before it used `-skillLineAbilityID`, a different number. | `Modules/Recipes.lua` |
| 6 | Guild roster membership. `db.roster[name].inGuild`: `true` from the guild roster, `false` for raid pugs (added by attendance/presence) and for members who left (marked when a full roster no longer lists them; skipped if the roster hides offline members). Entries from before this field have no `inGuild` and count as members. New `ns.isGuildMember`. Used by `/guilded roster`, `GuildedAPI.GetRosterNames`, the login digest (`joinedAt`), auto-invite, officer attunements. Peer gear digests (`READINESS`) from raid/party chat are kept only from guild members, so the companion no longer "discovers" pugs. | `Core.lua`, `Modules/API.lua`, `Modules/Digest.lua`, `Modules/AutoInvite.lua` |
| 7 | Other players' unrecognised `Guilded` messages are counted (`ns.ignoredMessages`, shown in `/guilded diag`), no longer saved to `db.events` (which evicted real history and kept the Send to Discord banner coming back). | `Core.lua` |
| 8 | Reserve list stamp: only the keeper stamps `updatedAt` (before sharing, so the stamp sent is the new one); receivers adopt the keeper's stamp from `VER`. Before: every receiver stamped its own copy "newest". | `Modules/Reserve.lua` |
| 9 | Backup: the `/guilded restore undo` copy (`db.preRestore`) is dropped after 7 days at login, or now with `/guilded restore forget`. Backup codes leave out data that rebuilds itself: `recipeBook`, `calendarEvents`, `consumeScan`, `lootRules`, `biddingSession`, `councilSession`. | `Modules/Backup.lua` |
| 10 | Tooltips: on clients with `TooltipDataProcessor` the "already decorated" flag is not used (it was only ever cleared on `GameTooltip`/`ItemRefTooltip`, so comparison tooltips showed Guilded lines once). The old script-hook path keeps the flag. | `Modules/Tooltip.lua` |
| 11 | Sync, bidding and council errors go to `/guilded diag` (`logDiagnostic`) instead of chat. Over-long messages are cut on a UTF-8 boundary (`ns.util.truncate`) and noted quietly (`SEND` diagnostic). Raid ids and ledger ids use the server clock. | `Modules/Sync.lua`, `Modules/Bidding.lua`, `Modules/Council.lua`, `Util.lua`, `Core.lua` |

## The upgrades

| # | Upgrade | Files |
| --- | --- | --- |
| U1 | **`Util.lua`**, loaded first in `Guilded.toc`: `ns.comm.send(prefix, text, channel, target)` is a paced queue per prefix (burst 8, then 1/second, retries results 3/8 = throttled up to 5 times, then logs a `SEND` diagnostic). `ns.comm.register(prefix)`, `ns.comm.pending(prefix)`. The validator fails any file except `Util.lua` that calls `SendAddonMessage(` directly. | `Util.lua`, `validate-addon.mjs` |
| U2 | Shared helpers in `ns.util`: `itemKey`, `daysFromCivil`, `isoEpoch`, `serverTime`, `tooFarAhead`, `groupChannel`, `inMyGroup`, `base64Encode/Decode`, `truncate`. The copies in Loot, Tooltip, Ready, Calendar, Backup, Games were replaced (old names like `NS.tooltip.itemKey`, `NS.ready.epoch`, `NS.calendar.isoEpoch`, `NS.backup.b64decode` still exist as thin wrappers). | `Util.lua`, those modules |
| U3 | Addon Compartment: `## AddonCompartmentFunc*` lines in the TOC; globals `Guilded_OnAddonCompartmentClick/Enter/Leave` (left-click opens the window, right-click the gear check). | `Guilded.toc`, `Modules/Minimap.lua` |
| U4 | Open GP bidding / loot council survive `/reload`: saved in `db.biddingSession` / `db.councilSession` with `endsAtServer` (server clock); restored at `PLAYER_LOGIN` (`bidding.restore`, `council.restore`), timer rescheduled (closes 5s after login if it ran out during the reload). A session that ran out more than 10 minutes before login is dropped, never auto-awarded. | `Modules/Bidding.lua`, `Modules/Council.lua` |
| U5 | Options page: `Modules/Options.lua` (new, last in the TOC). Settings API canvas (`Settings.RegisterCanvasLayoutCategory`), falls back to `InterfaceOptions_AddCategory`. Switches: minimap button, chat tab, login digest, auto-save, and one per optional module (just for you). Each switch runs the normal `/guilded` command. `/guilded options` (alias `settings`) opens it. French labels in `Locale.lua`. | `Modules/Options.lua`, `Locale.lua`, `Guilded.toc`, `validate-addon.mjs` |
| U6 | Tests: `tests/lua/audit-fixes.test.ts` (new) plus added cases in `reserve`, `recipes`, `tooltip`, `full-addon` Lua tests and `tests/dungeon-rules.test.ts`. The Lua harness (`tests/lua/harness.ts`) now loads `Util.lua` automatically before any file loaded on a namespace that lacks `ns.comm`, like the game does. | `tests/` |

## Protocol changes (addon messages)

- **Reserves (`GuildedRes`):** the keeper now sends `STATE`, `CLR`, then
  **`VER|<updatedAt>|<chunk count>`**, then the `L|...` chunks. Receivers collect
  chunks after `CLR` and swap the list in only when `VER`'s count has arrived; the
  keeper's stamp comes with it. `DONE` is now `DONE|<updatedAt>`. Old clients
  still parse the new messages but may show a partial list; everyone should update.
- **Dungeon (`GuildedDgn`):** message formats are unchanged; only who is believed changed.
- **Companion to bot:** each dungeon run may carry `reporterNames` (up to 10 names).
  Optional in the bot's schema, so an older companion still uploads fine.

## Saved data (GuildedDB) changes

No migration needed; all additions are optional fields.

- `roster[name].inGuild` (bool), `joinedAt`, `leftAt` (ISO).
- `biddingSession`, `councilSession` (open loot session, cleared when it ends).
- `preRestore` now expires after 7 days.

## Test harness gotchas (learned the hard way)

- fengari (the Lua used in tests) has **32-bit integers**, so seconds far in the
  future (year 2099) overflow; WoW's Lua uses doubles. `tooFarAhead` compares the
  year first for this reason.
- fengari's `date()` does not support the `"!%Y"` format; use `date("!*t", t).year`.
- The harness `GetTime()` returns 0, so the send queue never refills its burst in
  a test. Tests that send more than 8 messages on one prefix make the clock move
  (see the top of `tests/lua/reserve.test.ts`).
- The harness has no `GetRaidRosterInfo`; tests with a raid define it
  (see `RAID` in `tests/lua/audit-fixes.test.ts`).

## Where to start if something breaks in game

- `/guilded diag` shows `SEND` lines (throttled or cut messages), `LUA_ERROR` lines
  from modules, and the ignored-message count.
- Messages missing between players: check `NS.comm.pending("<prefix>")` with
  `/dump` (prefixes: `Guilded`, `GuildedSync`, `GuildedBid`, `GuildedLC`,
  `GuildedRes`, `GuildedRcp`, `GuildedDgn`).
- A whisper bid or answer not counted: the sender must be in your raid/party
  (`/dump Guilded.util.inMyGroup("Name")`).
