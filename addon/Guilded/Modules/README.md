# Guilded addon modules

Modules loaded after `Core.lua` (and `Compat.lua`, `Locale.lua`),
sharing its namespace (`local addonName, ns = ...`). Core.lua exposes
`ns.playerName`, `ns.normalizeName`, `ns.isSecret`, `ns.now`,
`ns.message`, `ns.send`, `ns.isOfficer`, `ns.isOfficerName`,
`ns.runCommand`, `ns.getSettings`, `ns.getDb`, `ns.getActiveRaid`,
`ns.groupMembers`, `ns.logDiagnostic`, and a `ns.commandHandlers` table
that modules register into to add `/guilded <action> ...` subcommands. Help
lines go in `ns.commandHelp` (a string, or `{ officer = true, text = ... }`).

## Addon message protocol

Every message is `KIND|field|field|...` on the module's own prefix. Receivers
must **ignore kinds they don't know and fields past the ones they read**, and
new optional fields are only ever **appended**, marked with a tag (like
`F:` in the readiness digest) so an empty field before them can't shift the
rest. That is what lets an older addon run next to a newer one. `/guilded peers`
lists who runs which version. Anything that would break older readers gets a
new `KIND`, never a changed one.

## Rules every module follows

- **Own channel.** Each module has its own addon-message prefix (16
  characters max, checked by `validate-addon.mjs`) and its own event frame,
  with the handler wrapped in `pcall`. One module failing never stops
  another.
- **Only call other modules through `ns`, guarded** (`ns.bidding and
  ns.bidding.current`), so a module that is missing or switched off is just
  skipped.
- **Module switches.** Optional modules are listed in `ns.MODULES` in
  Core.lua with the `/guilded` commands they own. Players switch them with
  `/guilded modules on|off <module>`; officers for the whole guild with
  `/guilded modules guild on|off <module>` (shared by Sync.lua). Saved settings
  only exist from `PLAYER_LOGIN`, so a module always loads and must stay
  dormant while off: its event handler (and any ticker) starts with
  `if ns.moduleActive and not ns.moduleActive("<key>") then return end`.
  Core already blocks the module's commands and help lines, and the window
  hides its tab and widgets (`module =` on a tab, `forModule(...)` on a
  widget). Adding a module = add it to `ns.MODULES`, add the file to the
  TOC (`validate-addon.mjs` checks every file the TOC lists), gate its handler.

| Module | Switch | Prefix | What it does |
| --- | --- | --- | --- |
| Games.lua | `games` | (none) | Fun roll games: high roll, deathroll, duel. No gold |
| Bidding.lua | `bidding` | GuildedBid | In-game GP bidding on loot |
| Recipes.lua | `recipes` | GuildedRcp | Recipes and profession cooldowns: who can craft what, shared with the guild |
| Reserve.lua | `reserve` | GuildedRes | Soft reserves: reserve items for a raid, shared list, roll between reservers |
| Loot.lua | (always on) | none | Which loot system this raid core uses, item prices, `/guilded drop`, `/guilded core` |
| Council.lua | `council` | GuildedLC | Loot council: BiS / upgrade / off-spec answers, ranked for the officers |
| Dungeon.lua | `dungeon` | GuildedDgn | Dungeon run tracking for the Dungeon Challenge |
| Calendar.lua | `calendar` | (none) | `/guilded calendar check` |
| AutoInvite.lua | `autoinvite` | (none) | Officers: `/guilded autoinvite on [phrase]`, guild invite for whoever whispers the phrase (rate limited) |
| SyncNow.lua | `syncnow` | (none) | `/guilded sync`, `/guilded sync auto`: save now / auto-save at safe moments so the companion uploads sooner |
| Backup.lua | `backup` | (none) | `/guilded backup` and `/guilded restore [undo]`: this guild's saved data as one `QGBKP1:` code |
| API.lua | always on | (none) | `GuildedAPI` read-only v1 for other addons and WeakAuras (see the file header) |
| Digest.lua | `digest` | (none) | Login digest: "since your last login" from saved data; `/guilded digest [on/off]` |
| Consumables.lua | `consumables` | (none) | `/guilded consumes`: who in the group lacks a flask/elixir or food; your own buffs go into your readiness snapshot; buffs are read by spell id and icon (ConsumableData.lua), hidden buffs are "unknown", never "missing" |
| ConsumableData.lua | with `consumables` | (none) | Spell ids of flasks, augment and vantus runes and raid buffs, and the food icons (from Ready Check Consumables, MIT) |
| Ready.lua | always on | Guilded (`CONSUME\|`) | The Ready page and `/guilded ready`: runs on every ready check by itself, each addon reports what it carries |
| Sim.lua | `sim` | (none) | Test raid / dungeon run for officers |
| Sync.lua | always on | GuildedSync | Version check, standings, guild module switches |
| GuildMap.lua | `guildmap` | GuildedMap | 5.0: guildmates as dots on the world map and minimap (`P\|map\|x\|y\|class\|level`, `G` = gone, `Q` = rate-limited position refresh); `/guilded map share\|show on\|off` |
| Scores.lua | `scores` | GuildedScore | 5.0: a dungeon score per player from recorded runs (best run per dungeon), on tooltips; `S\|score\|dungeons`; `/guilded score [player\|top]` |
| RaidTools.lua | `raidtools` | GuildedRT | 5.0: raid target icons, mark the tanks, world marker buttons (secure `/wm`), boss plans shown on raiders' screens (`PLAN\|id\|i\|n\|text`, line 0 = boss); `/guilded rt` |
| Minimap.lua | always on | (none) | Minimap button and tools window |

## Games.lua

Fun `/roll` games with no gold, no ledger and nothing owed: `/guilded games highroll|deathroll|duel`. Anyone can run one; the client is the referee, reading the group's rolls and posting short merged lines in party/raid chat. Players join a group game by typing `1`. There is no saved data and no addon-message prefix.

## Bidding.lua

Officer-run GP bidding: `/guilded bid start <min GP> <item> [seconds]` opens it
for the raid (addon users get a popup, pugs whisper a number), highest PR
breaks ties, then the earliest bid. `award` records the loot and GP through
Core's own commands.

## Recipes.lua

Reads a profession window (`TRADE_SKILL_*` for most, `CRAFT_*` for enchanting), opening collapsed
groups and closing them again, and keeps recipe ids per player in `db.recipeBook`
(`people[player][profession] = { v, keys }`, `names`, `mats` for your own recipes,
`cooldowns[player]`, `cooldownAt`). Ids are item ids, or minus a spell id for enchants. Your own
lists go to the guild in chunks under 255 characters, one message every 1.2 s:
`R|profession|version|n|N|id,id,...`, `CDC|profession` then `CD|profession|readyAt|name`. Only
the `GUILD` channel is read, and only a player's own data is stored under their name. Shared
cooldowns (all transmutes) are merged into one line. The companion exports it as `recipes`,
`recipeNames` and `cooldowns`.

## Reserve.lua

Soft reserves. The officer who runs `/guilded reserve open` is the keeper: members' `ADD|id|name`
and `DEL|id` go to them by whisper, they check the limit and the lock, then share the list
to the guild (`STATE|open|limit|title`, `CLR`, `L|name=id,id;...` in chunks under 255
characters, `DONE` to close). Members accept the list only from an officer. Items are stored by
id in `db.reserves` (`entries`, `names`, `host`, `open`, `limit`, `title`). `REQ` on login asks
the keeper to share again. Whispers `res [link]` / `unres [link]` cover players without the addon.
Tooltip.lua adds "Reserved by ...", Council.lua ranks reservers first.

## Loot.lua

Loads what the bot knows per raid core from `db.lootRules` (Sync.lua adopts the companion's
`GuildedLoot` global: `default`, `minimumBid`, guild-wide `values`, and `cores` with `mode`, `pool`,
`reserves`, `baseGp`, `values` and, for an own pool, `players`). Item price keys are the lower-case item
name (cleaned like tooltip keys) and `#itemId`. The core being run is `settings.activeCore` (set with
`/guilded core`) or `GuildedNextRaid.core`; `settings.lootMode` overrides the system. `/guilded drop` picks
the flow: bidding, council, reserves, or priority (`ns.council.startPriority`). Only the officer's
addon needs the rules; raiders get everything they need in the message that opens the popup.

## Council.lua

Loot council answers: `/guilded council start <item> [seconds]` opens it for the
raid (addon users get a popup with BiS / Upgrade / Off-spec / Pass, pugs whisper
a word). Answers rank by tier, then PR, then time, and carry what the player
wears in that slot. `award [player] [GP]` records the loot through Core's own
commands (GP only when a price is given). Prefix `GuildedLC`: `OPEN`, `RESP`,
`ACK`, `CLOSE`, `AWARD`. EPGP priority uses the same window: `OPENP|id|seconds|price|item`, answers `want` or
`pass`, ranked by PR only, awarded by itself at the close.

## Dungeon.lua

Records 5-player dungeon runs (`DETECTED -> STARTING -> ACTIVE -> COMPLETED /
ABANDONED / INVALID`), one recorder per group, deaths reported by each
player's own addon, saved in `GuildedDB.dungeon.runs` until the bot
confirms them (`GuildedDungeonAccepted` in Standings.lua). Every WoW API
call goes through `Compat.lua`. `/guilded dungeon status|start|complete|abandon|check`.

## Calendar.lua

`/guilded calendar check`: reports whether this client's guild calendar can be
read, which decides whether calendar sync gets built. Read-only.

## Sim.lua

Officer test tools: `/guilded sim start|end|bids|clear` (fake raid) and
`/guilded sim dungeon [minutes]` (fake dungeon run). Everything is marked as
test data and removed by `/guilded sim clear`.

## Sync.lua

Version check (everyone announces their version at login; older clients are
told a newer one exists), guild-wide sharing of the bot's EPGP standings
from `Standings.lua` (accepted only from officers), and the guild module
switches (`MODS` / `MODSREQ`: newest officer setting wins).
`/guilded standings`, `/guilded version`.

## Minimap.lua

Minimap button and the tabbed tools window. Tabs and officer tools are
shown per rank and per module switch (re-checked each time the window
opens and whenever a switch changes). The Tools tab lists every module
with its switches.

5.0 map shortcuts: Shift-click the minimap coin opens Raid tools; Alt-click opens the guild map.
Use `/guilded map check` for sharing status, map availability and peer count. Guildmates must
run Guilded and enable sharing; minimap dots are limited to nearby players outside instances.
