# Addon simplification plan (12 November 2026)

The owner asked on 12 November 2026: *"the addon is way too crowded and has a lot of modules or things that are not used,
starting with the guild message which is useless because it can't auto post new messages, I think we need to remove; what
else would you remove or change place to make it less friction. People find it too complicated to navigate the addon"*, and
*"make sure to analyse best implementation method"*.

This is a read-only audit of `addon/Guilded/` (version 9.1.6). **Approved by the owner on 12 November 2026 ("DO THIS")**, with
the decisions recorded in section 4. Sync, dungeon
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
| Levelling partners (`LevelPartners.lua`, Home button, minimap menu, `/guilded partners`) | **REMOVE** (owner, 12 Nov) | Replaced by **Layer invite** (section 1b). Its Whisper button calls `ChatFrame_OpenChat`, which the addon's own rules forbid. |
| Every invite helper: `/guilded invite raid` and `missing`, the "To invite" window (`InviteQueue.lua`), auto-invite (`AutoInvite.lua`), the Invite buttons in call for help | **MERGE** into **Layer invite** (`Invites.lua`) | One module and one copy box for every `/invite` and `/ginvite` line, instead of four. |
| Announcements page | **MERGE** into Settings | It is a set of switches, not a destination. |
| Info and data page | **MERGE** into Settings > Advanced | Diagnostics (peers, relay, ledger sync) that members never need. |
| Test tools (`Sim.lua`), Speed report (`Perf.lua`), GRM archive import | **HIDE** (Advanced) | Developer and one-time tools that crowd Settings and Officer tools. |
| Guild overview, Guild board, Availability, Duels | **MERGE** into **Guild** | Four thin pages about "my guild" become one page with sections. |
| Crafting (guild panel) and Crafting orders | **MERGE** into **Crafting** | Search recipes and claim orders in one place. |
| My character | **MERGE** into **Home** | Gear check and attunements belong on the first screen. |
| Open raids and Raid sign-up | **MERGE** into **Raids** | One place to find and join raids. |
| Ready, Reserves, Run a raid, Loot, Council, Standings, Calendar panel | **MOVE** into Raids (leader/officer section) | Raid-night tools grouped in one place. They stay visible before raids open on 9 December (owner, decision 3). |
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

## 1b. Layer invite (replaces levelling partners; owner, 12 Nov)

The owner's words: *"we will remove the levelling partners addon and combine everything into a layer invite module to help
people that want to get layered"*.

**Goal:** a member who wants another layer asks once. Guildmates who can help see the request and invite them, with the
fewest clicks. Accepting a party invite from someone on another layer moves you to that layer; you then leave the group and
stay there.

### What WoW Forever allows

| Step | Automatic? | Why |
|---|---|---|
| Send the request to guildmates | Automatic, on the requester's one click | Addon messages on the guild channel work (`ns.comm`, used by every sync). |
| Know who is on another layer | **No** | The addon cannot read the layer. It only knows each guildmate's zone, continent, group and instance state, and whether they run Guilded. |
| Invite | **One click plus one paste** by the helper | The invite API, secure macro buttons and lines the addon writes into the chat box are all refused (`Util.lua:485`). Only a line the player pastes works: `/invite Marie Tremblay` in Guilded's copy box (`util.inviteButton`). |
| Accept | One click by the requester | This is Blizzard's own invite pop-up. |
| Leave the group after the move | One typed `/leave` (or right-click your portrait > Leave group) | Leaving from addon code is not attempted; Guilded only says when. |
| Post the request in guild chat | Not used | Addon-written guild-chat lines are unverified or blocked. The addon channel does the job silently. |

### The flow

1. **Requester:** clicks **Change layer** on Home (or types `/guilded layer`). Guilded first checks the requester can be
   invited: not in a group, not in an instance, not in combat. If any check fails, it says which. Otherwise it sends
   `REQ` with the requester's full first and last name, continent and zone on a new prefix, `GuildedLayer`.
2. **Helpers:** guildmates who opted in see a small toast (a plain frame, no secure template): *"Marie Tremblay wants
   another layer (Elwynn Forest)"*, with **Invite** and **Not now**.
   - **Invite** shows `/invite Marie Tremblay`, already selected in the copy box. The helper presses Ctrl+C, Enter,
     Ctrl+V, Enter.
   - The helper's addon then sends `CLAIM`, so every other helper's toast closes and only one invite goes out.
   - Toasts never appear to a helper who is in an instance, a raid, a full party or combat, or who is on another
     continent.
3. **Back on the requester's side:** once they have joined the helper's group, Guilded says *"You are in Jean Roy's group.
   When the zone has reloaded, type /leave."* and sends `DONE`.
   - If they are still on the same layer, a **Same layer, try someone else** button skips that helper for 30 minutes and
     re-sends the request.
4. **Timeouts:** a request expires after 5 minutes. A claim expires after 60 seconds if the requester never joined, and the
   request reopens. A requester can ask at most once every 2 minutes.
5. **Opt-in:** helpers see toasts only after saying yes once. The first time a request arrives, a one-time prompt asks
   *"Help guildmates change layer? Yes / No"*. Either answer is remembered in `db.layer.helper`, and Settings can change it.
   Requesters need no opt-in.
6. **Layer requests list** (Guild tab): open requests with a ready `/invite` line each. Here a helper who turned toasts off
   can still help.
7. **Guildmates without Guilded:** below the list, Guilded shows online guildmates on the same continent who don't run it,
   each with a **Whisper** copy line (`/w Jean Roy can you invite me for a layer?`). Guilded can't know whether they will help.

### What it absorbs

All of these go into one `Modules/Invites.lua`, with one copy-box component and three sections:

- **Layer** (everyone): the flow above. It replaces `LevelPartners.lua`. Levelling buddies are still found on Discord with
  `/character race near`.
- **Raid group** (raid leaders): `/guilded invite raid` and `/guilded invite missing`, from `AutoInvite.lua`. This lists
  the `/invite` lines for signed-up players who are not in the group yet.
- **Guild invites** (officers): the "To invite" window (`InviteQueue.lua`, Discord requests sent by the companion as
  `_G.GuildedInvites`) and whisper auto-invite (`AutoInvite.lua`, phrase "ginv").

Call for help keeps its own banner, but its **Invite** and **Invite caller** buttons use the same component. Every line uses
full first and last names (`util.bareName`, Forever full names).

### Removing levelling partners safely

`LevelPartners.lua` has no saved key, no addon prefix and no companion or bot data; it reads only the guild roster.

1. Delete the file and its `.toc` line.
2. Remove the Home button and its refresh (`Minimap.lua:1473`, `1796`) and the minimap menu entry (`Minimap.lua:2664`).
3. Leave `/guilded partners` as a one-line pointer to Change layer for one release.
4. Delete `tests/lua/level-partners.test.ts`, and the `LevelPartners.lua` entry in `tests/addon-no-global-taint.test.ts:79`.
5. Update the text that mentions it: `src/commands/help.ts:33` (bot `/help`), `site/pages/features.md` and
   `site/pages/features.fr.md` (line 93), and the `Locale.lua` strings, which can stay.

The `Invites.lua` merge keeps every existing saved key byte-for-byte: `db.inviteState`, `inviteSent`, `inviteRemoved` and
`autoInvite`, plus the companion's `_G.GuildedInvites` global. The only new data is `db.layer = { helper, lastAskAt }`;
requests live in memory only. There is no bot or companion change.

## 1c. Who can open "Info and data" (owner question, 12 Nov)

**Today: every guild member.** The tab has no officer flag (`Minimap.lua:1652`), so anyone with the addon sees it. The
"Officer" half of the page (`INFO_OFFICER_TOOLS`, `Minimap.lua:1563`) is hidden from non-officers with `officerOnly`.
"Officer" is a check against the member's *own* saved settings (`Core.lua:263`): their rank must be ticked in
`db.settings.officerRanks`, or their name must be listed in `db.settings.officers`.

**Can a member get around it?** Yes, in two ways. They can type the slash command behind a hidden button, or edit their own
saved file. `/guilded invites` and `/guilded promote` don't check the rank themselves (`InviteQueue.lua:275`,
`Promotion.lua:178`).

**Does anything leak?** No. The invite queue and the promotion list come only from the companion. The bot puts them in the
download only for a Discord officer (`companion-api.ts:546`, `:573`), so a member's copy is empty. Loot rolls and the
consumables scan do check the rank. Hiding is about clutter, not security; the bot is the gate.

**What the member half shows and does:**

- *Read-only lists:* who runs which addon version (guildmates' names), which guildmate's companion carries your data,
  guildmates' shared professions, the saved-names check, your battleground capture status.
- *Actions:* ask guildmates or an officer for EP/GP history or data, which just sends sync requests; open interface options;
  turn the daily digest and main names in chat on or off; your guild bank requests; guild bank low stock.
- *Nothing destructive:* no export, reset or edit of anyone's data. Backup and restore live on the Settings tab, officer
  only.

**Recommendation (folds into PR 3):** the Info tab disappears.

1. **Home** gets a *My data* line: "Last sent to Discord: 12 min ago, by your companion" (or by a guildmate's), next to the
   existing **Send to Discord** button. That is the one thing a member needs from Info.
2. Your bank requests move to Guild > Guild bank. The on/off switches (digest, main names in chat) move to **Settings**.
3. Diagnostics about guildmates (versions, relay, professions shared, saved-names check, battleground capture, ledger and
   data requests) move to **Settings > Advanced**. Advanced is closed by default, and its text says "for troubleshooting".
4. The officer buttons (invite queue, ready to promote, auto-invite, loot rolls, consumables) move to the **Officer** tab.
   The invite ones go into Layer invite's Guild invites section.
5. The rank check moves into `/guilded invites` and `/guilded promote` themselves, so a member who types them gets "Officers
   only" instead of an empty window. The bot-side gate stays the real protection.

## 1d. The Crafting tab (owner, 12 Nov)

The owner wants in-game crafting redesigned as one clean screen that shows everything you need, taking retail's crafting
orders and TradeSkillMaster as models for layout only. No art, names or code is copied.

### What exists today

- **Crafting page** (guild-window panel): a search box with "Who can craft it" (prints a text line), your professions as
  text, and cooldowns as text.
- **Crafting orders page** (main window): Discord requests your character can craft. Each shows its reagents with
  have/need, a Claim / Done / Give back action and a "Show all" switch.
- **Tooltips:** "Crafted by" on item tooltips (compact, #375).

**Data the addon already has:**

- the guild recipe book, `db.recipeBook`: who knows which recipe (`people[player][profession]`), recipe names, and
  reagents (`mats`) for recipes this PC knows (`Recipes.lua:453`);
- profession skill per guildmate, from the roster sync (`RosterProfessions.lua:28`, "Alchemy:300");
- cooldowns;
- the orders feed `GuildedOrders`: id, item, quantity, profession, status, requester, crafter, reagents, note and timestamps
  (`docs/plans/CRAFTING_ORDERS.md`);
- the guild roster (online or not).

**On the bot:** Discord requests (`CraftRequest`: OPEN, CLAIMED, DONE, CANCELLED), crafter offers (`CraftOffer`), the craft
board posts and Top crafters (`craft-ladder.ts`).

**Missing:**

| Missing | Fix |
|---|---|
| Asking for a craft **from the game** (today only Discord can) | New: a "Request" action saved in `db.craftOrders.requests` and uploaded like bank requests (`bankRequests`). The bot creates the `CraftRequest` with the same rules as `/craft request`. Its first relay goes through a guildmate's companion. Needs a small bot import change. |
| A "Delivered" state | The bot has DONE only. Recommendation: no new state. **Done** means made and handed over, and the requester gets the existing DM. Delivery is outside Guilded's reach (see below). |
| Reagents of recipes nobody on this PC knows | They come from whoever shared the recipe: add `mats` to the `GuildedRcp` share (small, capped at 6 reagents). Older clients ignore the extra field. |
| Required skill and recipe difficulty | Not shown. The crafter's current skill is enough to rank "who can craft". |
| Top crafters in game | Add the top 5 per profession to the companion feed the bot already sends (`craftOrders.top`). It is small. |

### What WoW Forever blocks

- The addon cannot trade, mail, craft or open a profession window for you. Those are protected actions, and Guilded never
  handles gold.
- It cannot write into the chat box, so every "contact" is a copy line: `/w Jean Roy` (full first and last names).
- It cannot read other players' bags. "What the requester already has" therefore comes only from the request ("I bring the
  materials"), and from the requester's own bags when the requester is the one looking.
- All frames are plain Guilded frames, so the tab stays safe in combat (orders already are).

### Layout (text wireframe)

```
+- Crafting ----------------------------------------------------------------------+
| [ Find an item...        ] [Profession v] [Online only] [I can craft]           |
| [ Recipes ] [ Orders (3) ] [ My requests (1) ]                                  |
+------------------------------------+--------------------------------------------+
| Recipes (left list, 12 rows)       | Major Healing Potion            Alchemy    |
|  * Major Healing Potion   Alch  3  |  Who can craft (online first):             |
|    Flask of the Titans    Alch  1  |   * Jean Roy        Alchemy 300  online    |
|    Enchant Chest: Stats   Ench  2  |     Lise Gagnon     Alchemy 290  2 h ago   |
|    ...                             |  Reagents (for 1)       you have / need    |
|                                    |   Golden Sansam              2 / 1  ok     |
| "3" = guildmates who can craft it  |   Mountain Silversage        0 / 1  missing|
|                                    |   Crystal Vial               5 / 1  ok     |
|                                    |  [ Request this craft ]  [ /w Jean Roy ]   |
+------------------------------------+--------------------------------------------+
```

**Orders sub-tab** (the crafter's side): a list with a state column. Each state has one primary button.

| State | Requester sees | Crafter sees (primary action) |
|---|---|---|
| Open | "Waiting for a crafter" | **Claim** (orders for my recipes first, "For you" on top) |
| Claimed | "Jean Roy is making it" + `/w Jean Roy` | **Mark done** (Give back as a small link) |
| Done | "Ready: get it from Jean Roy" + `/w` line | none (stays 24 h, then leaves) |
| Cancelled | removed | removed |

Selecting an order fills the detail pane: reagents with your have/need, the requester's note ("I bring the materials", a
tip, a deadline) and who claimed it.

**My requests sub-tab** (the requester's side): your open requests with their state, plus **Cancel** while still Open.

The page opens on **Orders** when there is an order you can craft, otherwise on **Recipes**. The search takes a name or a
shift-clicked item, and matches French and English names (professions already use one English key since #702).

### Implementation

- New file `Modules/CraftingTab.lua`: the UI only. It reads `ns.recipes` and `ns.craftOrders`, and replaces
  `buildCraftingPage` and the CraftOrders page builder.
- `Recipes.lua` and `CraftOrders.lua` keep their data, their prefixes and their saved keys (`recipeBook`, `craftOrders`),
  which the companion exports.
- Two additions:
  - the request upload: `db.craftOrders.requests`, plus the companion export and the bot import, as a separate bot PR
    that lands first;
  - `mats` in the recipe share.
- The list is a pooled scroll (12 rows reused), so a guild with 800 recipes stays fast.
- **French:** about 40 new strings in `Locale.lua`, with escapes. `french-window.test.ts` covers the tab.
- **Tests:**
  - search and filter: profession, online only, I can craft;
  - who-can-craft order: online first, then skill;
  - the state-to-action table;
  - request upload format.
- **Real-client checks:**
  - open a profession so the book fills;
  - search in French and English;
  - claim and mark done, and see the Discord post and DM follow;
  - request from the game, and see it on Discord within one companion sync;
  - open in combat;
  - 800-recipe scroll speed.

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
   4. A **Change layer** button (Layer invite, section 1b). If a request is open, it shows that request's state instead.
2. **Guild:** online overview, **Layer requests** (open requests, each with its `/invite` line), board and polls,
   availability, duel ladder. Each is a section of one scrolling page. Helpers who opted in also get the request toast
   wherever they are.
3. **Dungeons:** opens the existing Guilded tab in the group finder, unchanged.
4. **Crafting:** recipes, orders and my requests in one screen (section 1d).
5. **Raids:** sign-up and open raids for everyone. A *Raid leader* section (Ready, Reserves, Run a raid, Loot or Council by
   loot system, Standings, Calendar, and the Raid group `/invite` lines from `Invites.lua`) shows only to leaders and officers. It is always visible, not held back until raids open (owner, decision 3).
6. **Officer** (officers only): Administration (EP/GP), raid cores (Local guild), Roster admin, Guild invites (the To invite queue and auto-invite,
   from `Invites.lua`),
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
- `/guilded layer` (Change layer)
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
| 6 | **Layer invite**: new `Invites.lua` (prefix `GuildedLayer`, request, claim, done, timeouts, opt-in, toast, Layer requests list); fold in `InviteQueue.lua` and `AutoInvite.lua` with their saved keys unchanged; call for help uses the shared copy box; remove `LevelPartners.lua` and its tests and mentions | M-L (about +450 / −700 lines, new Lua tests for the request, claim and timeout logic) |
| 7 | Short `/guilded help`; update the website guides, bot `/help` and FAQ to name the new tabs (site republishes on merge) | S-M |

| 8 | **Crafting tab** (section 1d): `CraftingTab.lua`, recipe reagents in the share, in-game requests (after a small bot PR for the request import and `craftOrders.top`) | L (about +900 Lua lines, +150 bot) |

PR 8 comes after PR 4 (it fills the Crafting tab). Its bot part ships first and changes nothing visible.

PRs 1-3 and 6 are independent. PR 5 needs PR 4. PR 6 can ship before PR 4: until then, Change layer sits on the current
Home page where the Levelling partners button was.

### Real-client checks (owner's PC and a second PC, French client too)

- Log in with a 9.1.6 saved file. Expect no Lua error and no `ADDON_ACTION_BLOCKED`. Afterwards check `Guilded.lua`
  diagnostics; old keys are still present.
- Open every tab as a member, as an officer and in combat (the window must still open and close in combat).
- One guildmate stays on 9.1.6 with the guild message turned on. The other client shows no errors, and sync, dungeon runs
  and linking still work end to end (a run reaches Discord).
- **Milestones:** reach a milestone and see whether the guild-chat line appears (decision 2).
- **Send to Discord:** the secure `/reload` button (`SyncNow.lua:42`) still reloads.
- **Levelling partners whisper:** it calls `ChatFrame_OpenChat` (`LevelPartners.lua:85`), which `Util.lua` itself says
  never to call. This goes away with the module in PR 6.
- **Layer invite, on two PCs, with two guildmates on different layers of one continent:**
  - the request reaches the helper while it is closed;
  - the toast and copy box work, and the pasted `/invite` is accepted with no `ADDON_ACTION_BLOCKED`;
  - a second helper's toast closes on the claim;
  - the requester moves layer after accepting, then `/leave` keeps them there;
  - **Same layer, try someone else** re-asks;
  - no toast appears in an instance, in combat or in a full group;
  - full first and last names appear in every line;
  - repeat on a French client.

## 4. Decisions

Owner answers of 12 November 2026: decisions **1, 2, 4 and 5: yes**, as recommended. Decision **3: no**: the raid-night
tools move into the Raids tab and stay visible. Decisions 6 and 7 (Layer invite) are still open, and so is decision 8 (Crafting).

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

6. **Layer invite helpers:** ask once at the first request (yes or no, remembered) rather than on by default? *Recommend:
   ask once.* A default-on toast that nobody asked for is the spam the owner wants to avoid.
7. **Layer invite reach:** send requests to helpers on the requester's continent only? *Recommend: yes.* Layers are per
   continent on Classic-style layering (confirm on Forever in the two-PC test), and helpers elsewhere cannot help without
   travelling.
8. **Requests from the game** (Crafting tab): let members ask for a craft in game, uploaded through the companion
   the way bank requests are, rather than keeping requests Discord-only? *Recommend: yes.* It is the missing half of the
   screen, and it needs a small bot change.

Out of scope, noted for later: the separate `GuildedGames` addon also posts game lines with `SendChatMessage`, which is
unverified on Forever. Raid-chat announces in LootRoll, Bidding, Council, Reserve and Ready are swallowed silently if
refused; check them in the first Forever raid on 9 December.
