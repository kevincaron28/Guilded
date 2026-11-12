# Addon simplification plan (12 November 2026)

The owner asked on 12 November 2026: *"the addon is way too crowded and has a lot of modules or things that are not used,
starting with the guild message which is useless because it can't auto post new messages, I think we need to remove; what
else would you remove or change place to make it less friction. People find it too complicated to navigate the addon"*, and
*"make sure to analyse best implementation method"*.

This is a read-only audit of `addon/Guilded/` (version 9.1.6). **Nothing is removed until the owner approves.** Sync, dungeon
runs, linking and uploads are protected: no module the companion exports or guildmates sync through is removed.

## Summary

Today a member meets **three windows and 26 pages**. The main window has 16 pages in four groups. A second panel inside
Blizzard's guild window has 9 pages, and a third panel sits on the calendar. On top of that come a Guilded tab in the group
finder, a right-click menu of up to 9 items, 5 modifier-click shortcuts on the minimap button and about 75 `/guilded` subcommands.

Proposal: **one window with 5 tabs** (Home, Guild, Dungeons, Crafting, Raids). Officers get a sixth tab, **Officer**, and
Settings becomes a gear button. Features the game blocks are removed outright. Developer tools and one-time importers go
behind Settings > Advanced.

| Item (where a member meets it today) | Verdict | Reason |
|---|---|---|
| **Guild message** (`GuildMotd.lua`, guild-panel page, Settings button, `/guilded motd`) | **REMOVE** | WoW refuses `SetMOTD` from addons (seen in the owner's saved diagnostics), so it is only a reminder plus a copy box. |
| Automatic guild welcome (`OfficerNotes.lua` greeting, prefix `GuildedGreet`) | **REMOVE** | Guild-chat line sent from a timer; confirmed blocked in the taint log (10 Nov). |
| Automatic welcome whisper (`Recruit.lua` `/guilded welcome`) | **REMOVE** | Same timer-driven `SendChatMessage` path. Keep the prospect list. |
| Guild-note writers (OfficerNotes auto notes, RosterProfessions note writer, note sections of Roster admin) | **REMOVE** | WoW Forever refuses guild-note edits even on a click (#618). They already do nothing. |
| `/guilded finder` (`ClientTools.lua`) | **REMOVE** | Refuses itself on Forever with a notice (`ClientTools.lua:25`). |
| `/guilded probe` (`Probe.lua`) | **REMOVE** | Developer probe; its job (achievement APIs) is done (`GameAchievements.lua:4`). |
| `/guilded import history` (`LootHistoryImport.lua`) | **REMOVE** | Writes `lootHistory`, which nothing reads. Has no tests. |
| "Race to 60" in the minimap menu | **REMOVE** | No such page exists in the addon (`Minimap.lua:2663`), so it is a dead branch. |
| Announcements page | **MERGE** into Settings | It is a set of switches, not a destination. |
| Info and data page | **MERGE** into Settings > Advanced | Diagnostics (peers, relay, ledger sync) that members never need. |
| Test tools (`Sim.lua`), Speed report (`Perf.lua`), GRM archive import | **HIDE** (Advanced) | Developer and one-time tools that crowd Settings and Officer tools. |
| Guild overview, Guild board, Availability, Duels | **MERGE** into **Guild** | Four thin pages about "my guild" become one page with sections. |
| Crafting (guild panel) and Crafting orders | **MERGE** into **Crafting** | Search recipes and claim orders in one place. |
| My character | **MERGE** into **Home** | Gear check and attunements belong on the first screen. |
| Open raids and Raid sign-up | **MERGE** into **Raids** | One place to find and join raids. |
| Ready, Reserves, Run a raid, Loot, Council, Standings, Calendar panel | **MOVE** into Raids (leader/officer section) | Raid-night tools. Forever raids open 9 December; until then they only clutter. |
| Administration (EP/GP), Local guild, Roster admin, Gear, Officer tools, To invite, Auto-invite | **MOVE** into **Officer** | One officer tab instead of officer pages spread over two windows. |
| Guilded panel inside Blizzard's guild window and calendar | **MERGE** into the main window | Two extra windows are the main navigation confusion. A Guilded button there opens the main window on the right tab. |
| Background modules (Sync, CatchUp, GuildRelay, GuildSnapshot, LedgerSync/Relay/Digest, OfficerBridge, SeasonSync, Scores, Dungeon, RunResults, DungeonStats, DungeonScorePanel, SeasonDetails, Battleground, WorldPvP, GameAchievements, Duels, GuildMap, CallForHelp, Tooltip, Presence, Recipes, CraftOrders, GuildBoard, GuildBank, GuildLog, CompanionLink, Backup, History, API) | **KEEP** | They carry sync, runs, linking and uploads, or have a single obvious entry. |
| Milestone announcements (`Milestones.lua`) | **KEEP, verify** | Its guild-chat line goes out from a timer, the same path as the blocked welcome. Check in a real client (decision 2). |

## 1. The owner's example: the guild message

"Guild message" is the officer page of that name in the guild-window panel (`Minimap.lua:1645`). It is also a Settings button
(`Minimap.lua:1013`) and `/guilded motd`. Module: `Modules/GuildMotd.lua` (593 lines, prefix `GuildedMotd`, saved key `db.motd`).

- **What it was meant to do:** keep the in-game message of the day current, either by rotating officer lines or from the
  next Discord raid.
- **What the game allows:** nothing. The owner's own saved diagnostics record `Guilded tried to call SetMOTD()` (WoW Forever
  `SavedVariables\Guilded.lua`). The module header already admits it: "GuildSetMOTD is Blizzard-UI only". The validator also
  bans the call (`validate-addon.mjs:79`). All that is left is a reminder that opens a copy box; the officer pastes the text
  into Guild > Info. That is *more* steps than typing the message directly.
- **Dependencies:** none outside the module. The companion does not export `db.motd`. The bot learns the current MOTD from
  `GuildSnapshot.lua`, which only *reads* it; that stays. The only test is `tests/lua/guild-motd.test.ts`.
- **Verdict:** remove it completely.

**The same test applied to everything else:** does the feature need an action WoW Forever refuses (writing chat from a timer,
guild notes, invites, MOTD, protected calls)? If yes and only a copy box is left, remove it, unless the copy box is the
feature's whole point. The `/ginvite` and `/invite` copy lines stay, because inviting is the point and the owner confirmed
pasting works (10 Nov). Two more automatic guild-chat posts fail this test: the officer's welcome greeting and the
recruiting welcome whisper.

## 2. Navigation, before and after

**Before:**

- **Main window:**
  - **Overview:** Home, Guild overview, Guild board, Crafting orders, My character, Open raids.
  - **Raid night:** Ready, Reserves, Raid sign-up, Run a raid, Loot, Council.
  - **Fun and runs:** Duels.
  - **System:** Announcements, Info and data, Settings.
- **Guild-window panel:** Standings, Crafting, Availability, Gear, Administration, Local guild, Guild message, Roster admin,
  Officer tools.
- **Calendar panel:** Calendar.
- **Group finder tab:** Dungeons.
- **Minimap button:**
  - Right-click menu with up to 9 items: Raid signups, Loot and standings, Dungeons, Crafting search, Guild map, Race to 60, Levelling partners, Call for help, Settings.
  - Modifier clicks: Shift opens dungeons, Ctrl opens gear, Alt opens the map, middle-click opens settings, Shift-right-click calls for help.

**After:**

1. **Home** is the first screen. It shows, in order:
   1. *Right now*: raid tonight, open orders for your professions, unread board post.
   2. The Discord link status with one "Get the companion" button. The code box stays as a fallback.
   3. Your gear check and attunements (formerly My character).
   4. Levelling partners, while you are levelling.
2. **Guild:** online overview, board and polls, availability, duel ladder. Each is a section of one scrolling page.
3. **Dungeons:** opens the existing Guilded tab in the group finder, unchanged.
4. **Crafting:** recipe search plus crafting orders.
5. **Raids:** sign-up and open raids for everyone. A *Raid leader* section (Ready, Reserves, Run a raid, Loot or Council by
   loot system, Standings, Calendar) shows only to leaders and officers, and only once raids are open or a raid is running.
6. **Officer** (officers only): Administration (EP/GP), raid cores (Local guild), Roster admin, To invite and auto-invite,
   gear check, guild log, prospects, guild bank, imports.

Settings becomes a gear button at the top of the window. It holds the module switches, announcements, chat tab, main names in
chat, daily digest and minimap, plus an **Advanced** fold with Info and data, the test tools, the speed report and the GRM
import.

The Guilded button inside Blizzard's guild window and calendar stays but opens the main window on Guild or Raids. The
minimap button keeps three actions: left-click opens Guilded, right-click shows a short menu (Dungeons, Guild map, Call for
help, Settings), and Shift-right-click calls for help. The other modifier clicks are removed; nobody discovers them.

**Slash commands in `/guilded help`:**

- `/guilded` (open)
- `/guilded verify <code>`
- `/guilded companion`
- `/guilded sync`
- `/guilded map`
- `/guilded announce off` (owner rule, 5 Nov)
- `/guilded diag`
- `/gsos`
- `/gdg`

Every other existing subcommand keeps working but is hidden from help, so officers' habits and macros don't break. A removed
command prints one line ("removed in 9.2: WoW does not allow it") for one release, then goes.

## 3. Implementation method

**Remove by deleting, not by switching off.** `validate-addon.mjs` builds its file list from `Guilded.toc` (line 66), so
removing a module means deleting the `.lua` file and its `.toc` line. Then also:

- delete its test file;
- drop its `ns.MODULES` entry and aliases in `Core.lua`;
- remove its page or button in `Minimap.lua`.

For the guild message, delete the `GuildMotd.lua`-specific validator block (lines 81-84) but keep the general `SetMOTD` ban.
A "switched off" module still loads, still costs memory and still shows up in Settings, which is the crowding we are fixing.

**SavedVariables:** never delete keys from members' saved files in these PRs.

- Stale keys (`db.motd`, `db.recruits.welcome`, `db.officerAuto`, `GuildedRosterToolsDB.lootHistory`) are small and
  harmless. `settings.modules[key]` for a removed key is simply ignored.
- Never rename or move a key the companion exports. `companion/lua-export-content.mjs` reads `character`, `roster`,
  `peerRoster`, `epgp`, `dkp`, `loot`, `itemPrices`, `reserves`, `recipeBook`, `craftOrders`, `board`, `signupAnswers`,
  `readiness`, `consumeScan`, `raids`, `attendance`, `presence`, `milestones`, `duels`, `dungeon`, `battleground`,
  `worldPvp`, `helpCalls`, `mapSeen`, `mapTrail`, `guildSnapshot`, `guildLog`, `guildBank`, `guildBankLog`,
  `bankRequests`, `calendarEvents`, `attunements`, `syncStats`, `displayNames` and `myCharacters`. All of these stay.

**Guildmates on older addons:** no protocol bump is needed.

- Each module registers its own prefix through `ns.comm` (`Util.lua:847`). Once `GuildMotd.lua` and the greeting code are
  gone, the new client no longer registers `GuildedMotd` or `GuildedGreet`, and the game drops those messages from 9.1.x
  officers before Lua sees them.
- In the other direction, new clients simply stop sending them; old clients lose nothing they rely on.
- Keep every other prefix byte-for-byte.

**Navigation without breaking callers:**

- `TAB_DEFS` is data-driven (`Minimap.lua:1627`). The new tabs are new groups whose sections reuse the existing `build*Page`
  functions.
- Many places call `ns.openToolsPage("Standings")`, `"Crafting"`, `"Open raids"` and similar, and so do the tests. Keep a
  name-alias table so every old page name opens the new tab at the right section.
- Pages that ask for a raid or loot mode keep their existing gates (`lootModes`, `leader`, `officer`).

**French:**

- Every new or renamed label needs an entry in `Locale.lua`, written with `\195\169`-style escapes (the validator rejects
  non-ASCII). `tests/lua/french-window.test.ts` checks the window.
- `Locale.lua`, `Util.lua` and the dungeon modules are copied into `addon/GuildedDungeons/Shared/`. Any PR touching them runs
  `npm run dungeons:sync` and commits the copies (`validate-addon.mjs` fails when they differ).
- Unused locale keys may stay; nothing enforces them.

**Each PR:** run `tsc`, vitest, eslint and `node addon/Guilded/validate-addon.mjs`. Add a Lua test that loads a saved file
from 9.1.6 (with `db.motd` and so on) and checks that login raises no error and that the companion export output is
unchanged. Only the coordinator bumps the version: these ship together as **9.2.0**.

### PR sequence (each ships alone)

| # | PR | Size |
|---|---|---|
| 1 | Remove the guild message: `GuildMotd.lua`, its page, Settings button, `/guilded motd` (one-line notice), test, validator block | S (about −700 lines) |
| 2 | Remove other blocked or dead parts: automatic greeting and note writers (OfficerNotes, RosterProfessions writer, Roster admin note sections), welcome whisper, `ClientTools` finder, `Probe`, `LootHistoryImport`, "Race to 60" entry | M (about −900 lines) |
| 3 | One Settings page: merge Announcements and Info and data in, add the Advanced fold for Sim, Perf and GRM | M |
| 4 | Member navigation: Home, Guild, Dungeons, Crafting, Raids; old-name aliases; trimmed minimap menu and clicks | L (`Minimap.lua`) |
| 5 | Officer tab, and the guild-window and calendar panels folded into the main window | M-L |
| 6 | Short `/guilded help`; update the website guides, bot `/help` and FAQ to name the new tabs (site republishes on merge) | S-M |

PRs 1-3 are independent. PR 5 needs PR 4.

### Real-client checks (owner's PC and a second PC, French client too)

- Log in with a 9.1.6 saved file. Expect no Lua error and no `ADDON_ACTION_BLOCKED`. Afterwards check `Guilded.lua`
  diagnostics; old keys are still present.
- Open every tab as a member, as an officer and in combat (the window must still open and close in combat).
- One guildmate stays on 9.1.6 with the guild message turned on. The other client shows no errors, and sync, dungeon runs
  and linking still work end to end (a run reaches Discord).
- **Milestones:** reach a milestone and see whether the guild-chat line appears (decision 2).
- **Send to Discord:** the secure `/reload` button (`SyncNow.lua:42`) still reloads.
- **Levelling partners whisper:** it calls `ChatFrame_OpenChat` (`LevelPartners.lua:85`), which `Util.lua` itself says
  never to call. Fix it in PR 4 with a copy box or `/w` copy line.

## 4. Decisions for the owner

1. **Remove the guild message completely** (not just hide it)? *Recommend: yes.*
2. **Milestone announcements:** they post to guild chat from a timer, the path the game blocked for the welcome greeting. If
   the real-client check shows they are refused, move them to the Discord echo (already opt-in per server) plus a line only
   you see? *Recommend: check first; if refused, yes.*
3. **Hide raid-night tools until raids open on 9 December** (they show by themselves then, or while a raid runs)?
   *Recommend: yes.*
4. **Fold the Guilded panels inside Blizzard's guild window and calendar into the main window**, with a button there that
   opens it? *Recommend: yes. Two extra windows are the biggest source of "where is it?".*
5. **Old slash commands:** keep them working but hidden from help, instead of deleting them? *Recommend: keep them hidden;
   remove only the commands of removed features.*

Out of scope, noted for later: the separate `GuildedGames` addon also posts game lines with `SendChatMessage`, which is
unverified on Forever. Raid-chat announces in LootRoll, Bidding, Council, Reserve and Ready are swallowed silently if
refused; check them in the first Forever raid on 9 December.
