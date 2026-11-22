# Addon finish-line audit (22 November 2026, addon 9.4.8)

Scope: `addon/Guilded/` (and `addon/GuildedDungeons/`, `addon/GuildedGames/` where they share code). First pass: evidence from the owner's PC, an audit of the code paths that have hurt before, bug fixes with tests, and ranked proposals. Nothing was packaged, uploaded or version-bumped. WoW was never started or focused; only files were read.

## Verdict

The addon is close to final. Since 17 November the owner's PC has recorded **no** `ADDON_ACTION_BLOCKED` / `ADDON_ACTION_FORBIDDEN` and no Lua error, across the 9.4.0 to 9.4.8 installs. What remains is (1) a few checks that cannot be done from files (a fresh taint log, two-player checks), (2) one real saved-file weight problem (fixed here), (3) decisions the owner has not made (layer auto-invite default, how long to keep merged leftovers), and (4) a short list of features guild players expect.

## Evidence read (all read-only)

| File | What it says |
| --- | --- |
| `D:\Program Files (x86)\World of Warcraft\_forever_\Interface\AddOns\Guilded\Guilded.toc` | Installed: 9.4.8 (folder written 22 Nov 07:43). Only `Guilded` and `GuildedData` are installed; `GuildedDungeons` is not (its old `GuildedDungeons.lua` saved file is from 20 Nov). |
| `...\WTF\Account\77911595#2\SavedVariables\Guilded.lua` (4.31 MB, written 22 Nov 06:41) | `diagnostics` holds 20 entries, 11 of them `ADDON_ACTION_BLOCKED/FORBIDDEN`, all between 12 Nov 15:52Z and 17 Nov 10:33Z (see below). Newest entries are `SLOW` notes (65 ms roster update, 20 Nov). No `LUA_ERROR` entry at all. |
| `...\Logs\taint.log` | 2.4 KB, **written 9 Nov** only. It shows the two old findings (diagnostic `message()` read a secret table; `Invite()` refused). It says nothing about 9.4.x because the owner has not switched `taintLog` on since. |
| `...\Logs\FrameXML.log`, `General.log`, `Client.log`, `DeveloperLog.log` | No Guilded line. `FrameXML.log` has two load errors for another addon (`ForeverDungeonJournal`, 10 Nov), not ours. |
| `...\Logs\WoWChatLog.txt` | Last Guilded line 19 Nov (the owner's chat-log test). Nothing to add. |

### Blocked actions recorded in the saved file (11)

| When (UTC) | Detail | Likely version | Status |
| --- | --- | --- | --- |
| 12 Nov 15:52, 17:44; 13 Nov 00:37 | `tried to call UNKNOWN()` | 9.2.x | MOTD / guild-info reads in combat, fixed in 9.3.x (GuildSnapshot `inCombat()` guard, `guarded()` marker). |
| 13 Nov 10:43 | `FORBIDDEN UNKNOWN() (after UNIT_INVENTORY_CHANGED)` | 9.3.0 | Not attributed. |
| 13 Nov 20:50 | `GuildedPanel:Show() (after UI_ERROR_MESSAGE)` | 9.3.0 | Secure `/reload` button made the panel protected; 9.4 parents it to `UIParent` (Minimap.lua:2502), and the open paths check `InCombatLockdown()`. |
| 13 Nov 21:39 | `UNKNOWN() (after GUILD_ROSTER_UPDATE)` | 9.3.0 | MOTD read, as above. |
| 16 Nov 03:20 | `UNKNOWN() (after ACTIVE_TALENT_GROUP_CHANGED)` | 9.3.x | Not attributed. |
| 16 Nov 14:50; 17 Nov 01:56, 02:01, 10:33 | `UNKNOWN() (after UNIT_INVENTORY_CHANGED / CHAT_MSG_LOOT)`, 5+ s or under 1 s after the last event | 9.3.8 or earlier | **Open, not attributed.** `ns.guardedCall` was not set, so the call was not one of the named guarded reads. |

The last four are the only unexplained group. None has recurred in five days of play on 9.3.9 to 9.4.8, so they are most likely among the 9.3.9 to 9.4.0 fixes (fewer login lines, secure-button and invite rework). The owner can close the question for good with check C1 below.

## Test results

- `node addon/Guilded/validate-addon.mjs`: passes for Guilded and Guilded Dungeons (static validator: no direct `SendAddonMessage`, ASCII-only Lua, no protected calls on forbidden paths).
- Lua harness (`tests/lua/`, fengari): see "Run results" at the end.
- `npm ci` could not complete inside this worktree on Windows (`ENOTEMPTY` on `node_modules\effect`, a file lock). Vitest ran by resolving `node_modules` from the main checkout, which is enough for these tests.

## What works (checked by reading the code and tests)

- **Protected calls.** Party invites call `C_PartyInfo.InviteUnit` directly with a remembered per-client refusal, guild invites and promotions are copy-box lines the player sends (Util.lua:686-780, AutoInvite.lua:138, RosterTools.lua tools.*). MOTD and guild-info reads skip combat and use `guarded()` (GuildSnapshot.lua:127-145). Chat lines go through `ns.comm.chat` (one global budget, `GuildedCommBudget`).
- **Windows in combat.** Secure `/reload` button is created out of combat only, parented to `UIParent`, and the open/scale paths return when `InCombatLockdown()` (Minimap.lua:2573-2619, 2707-2714).
- **Pacing.** Every module sends through `ns.comm.send`; the validator fails a module that calls `SendAddonMessage` directly. Chat lines sent by Bidding, Council, Reserve, Ready, LootRoll fall back to raw `SendChatMessage` only when `ns.comm.chat` is missing.
- **CPU.** The always-on `OnUpdate` frames (Duels, RosterTools, RunResults, SecretAchievements, WorldPvP) all accumulate `elapsed` and return early (0.25 to 0.5 s). `UNIT_HEALTH` / nameplate events in WorldPvP filter by unit token before any work.
- **Defaults ON.** Only one user option is off by default (layer auto-invite, see decision D1).
- **French.** Every literal `L("...")` is checked by `tests/addon-locale-catalog.test.mjs` against FR, DE and ES. Locale.lua stays ASCII with `\195\169`-style escapes.
- **Without the companion or Discord.** `SyncNow.statusLine` says plainly that local saving works with `/reload` and that online sync is optional; the Home page needs no sign-in. Backup/restore carries a 7-day undo copy.
- **Data growth.** Runs age out (synced after the window, guildmates' unconfirmed after 45 days, parked guilds the same); events and the audit log are capped; parked guilds not played for 180 days are forgotten unless they hold points or an unsent run.

## Bugs

| # | Severity | Finding | Repro / evidence | Status |
| --- | --- | --- | --- | --- |
| B1 | Medium (performance, not data) | The SavedVariables file is **4.3 MB**, 1.86 MB of it a parked leftover of the blank-realm incident (`otherGuilds["Québec Gold-"]`, marked `mergedIntoHome`), of which **1.5 MB is a stale copy of `dungeonBoard`** (the standings board the companion and guildmates rebuild) plus `standings` and `peerRoster`. The 9.4.7 board shrink (#1225) only reduced the loaded copy. The leftover stays until the 180-day forget. Every login parses 4.3 MB. | `Guilded.lua` in the owner's SavedVariables: `otherGuilds` 1,856,092 B of 4,086,357 B; inside it `dungeonBoard` 1,498,701 B. | **Fixed in this PR** (`trimBulk` in Core.lua drops those three fields from merged leftovers only; records such as duels, runs and points are untouched; test in `tests/lua/guild-key-blank-realm.test.ts`). Expected result: the file drops to about 2.8 MB at the next login. |
| B2 | Low (done in 9.4.9 branch) | 9 `ns.message` lines and the 37 `/guilded ...` usage lines are English-only (for example "Tools window failed to open", "Dungeon tracking on this client", "scroll debug"). Most are developer errors; the "Dungeon tracking on this client" line is user-visible. | `grep 'ns.message("'` outside `L()` (Dungeon.lua:2129, Minimap.lua:2728/2772/3104, Bidding.lua:377, Council.lua:619, usage lines). | Open. French/QC-voice players see English here. Easy once the owner wants them: wrap in `L()` and add FR/DE/ES, the catalog test then keeps it. |
| B3 | Low (done in 9.4.9 branch) | `PER_PC_FIELDS` in Backup.lua still lists `verifyCode` although `/guilded verify` was retired in 9.4.1. Harmless. | Backup.lua:55. | Open (cosmetic). |
| B4 | Info | `UNKNOWN()` blocks of 16-17 Nov (after inventory / loot / talent events) are unattributed. | Saved diagnostics above. | Open until C1. |

No Lua errors, no taint from `Guilded` in current evidence, no data-loss path found in the guild-key repair (the leftover is intentionally kept; B1 only removes what is rebuildable).

## Ranked proposals

What guild members value in Classic-era guild addons (Guild Roster Manager, RCLootCouncil, Guild Greet, Skada-style recaps) against what Guilded already has. Ranked by value to a guild like Québec Gold and by how safe each is on a client that refuses most addon actions.

| Rank | Proposal | Why | Effort | Risk |
| --- | --- | --- | --- | --- |
| 1 | **Join / leave / rank-change / level-milestone toasts and a "recent guild events" list** in the Guild tab, fed by the roster diff the snapshot already takes (GRM's most-used feature). Chat lines only, never an automatic guild message. | Guilded has the guild log and the snapshot; showing arrivals, departures and promotions in the window is the single most requested guild-addon feature. | M (2 to 3 days) | Low: reads only, no protected calls |
| 2 | **Officer "inactive members" and "left but still has points" reports** (last online over N days, from the roster; alts grouped by the bot's main/alt links). | Officers do this by hand; the data is already in `guildSnapshot` and `rankSince`. | S to M | Low |
| 3 | **Guild anniversaries and birthdays-style reminders** (join date from the snapshot, shown once on login as a local line, optional bot card). | Cheap morale feature, uses data that exists; builds on the donor and promotion cards. | S | Low |
| 4 | **Where-is-it search**: one box that searches recipes, who has crafting offers, and online members by profession and level (Recipes and CraftOrders data are already in the addon). | Crafting is the guild's biggest in-game loop; today the search lives on two pages. | M | Low |
| 5 | **French and Québec voice for the remaining English-only lines (B2) plus a `/guilded lang` self-check list** that prints the untranslated labels in the current build. | The owner's guild is French-first; every English line is felt. | S | None |
| 6 | **Raid-night helper** for the 9 December launch: a countdown banner, a consumables check (Consumables.lua exists) and the reserve list in one "Raid night" page. | Fits the launch; pieces exist, only the page is missing. | M | Low |
| 7 | **Layer auto-invite default** (decision D1). | Opt-in feature, off by default, against the owner's 21 Nov "on by default" rule. | S | Medium: it invites other players automatically |

Not recommended: tooltip decoration (taint history), guild MOTD or note editing (the game refuses them), automatic guild chat lines (refused on WoW Forever).

## Decisions needed (owner)

- **D1** Layer auto-invite: turn it ON by default (his 21 Nov rule) or keep it off because it invites people on its own? Suggested: ON, with the existing guards (alone or party lead, out of combat, outside instances) and a one-line first-run notice.
- **D2** Merged leftovers (the blank-realm copy): after B1 the rest (about 360 KB of records) stays 180 days. Drop the whole leftover after, say, 30 days once it holds no run and no points? Suggested: yes.
- **D3** Install `GuildedDungeons` on the main PC? It is not installed there; the full Guilded addon covers dungeons, so this only matters for the Dungeons-only path.
- **D4** Which proposal goes first for 9.5 (suggested: 1, then 2).

## Real-client checks still owed (cannot be done from files)

Run with WoW open by the owner; no desktop control by an agent.

- **C1 Taint log, 10 minutes.** Type `/console taintLog 1`, `/reload`, play normally (open the Guilded window, change gear, loot something, switch spec if you can, get a roster update by waiting), then `/reload` twice. Then read `Logs\taint.log` for "Guilded". Expected: nothing. If a line appears, send me `taint.log` and the saved `Guilded.lua`.
- **C2 Saved file size.** After installing the build with fix B1, log in on the main character, `/reload`, and check `WTF\Account\77911595#2\SavedVariables\Guilded.lua`. Expected: about 2.8 MB (from 4.3 MB); `/guilded diag` and the Guild and Dungeons pages unchanged; the standings board refills from the companion.
- **C3 In-combat windows.** In combat, press the Guilded key binding and the minimap button: no "blocked" popup, nothing opens (or a plain message). Leave combat: it opens.
- **C4 Invite buttons.** Guild invite from To invite (copy box line, paste, send), party invite from Layer invite (direct) with and without being group leader.
- **C5 Two-player checks** (already in the roadmap "Carried over"): call for help and On my way, duel result card both sides, crafting request and claim, ledger sync, carried duel from an addon-only guildmate, one real dungeon run with a group relay.
- **C6 French client pass.** Switch to frFR, open every tab and the setup window, confirm no English line except the ones in B2.
- **C7 Promotion flow** on a real Initiate: the reviewed click with the rank-number self-check.

## Run results

Full `tests/lua` run on this PC (parallel, slow machine): everything passed except four 5-second timeouts in `carry.test.ts` (2), `full-addon.test.ts` (1) and `data-loss-addon-9-4.test.ts` (1). Re-run alone with `--maxWorkers=1 --testTimeout=60000`: those three files pass, 99 of 99. So the failures are load timeouts of this machine, not code. The new test in `guild-key-blank-realm.test.ts` passes (7 of 7). `validate-addon.mjs` and eslint pass.
