# Guilded WoW addon

This is a self-contained, library-free addon for WoW Forever (interface
`16001`, which uses the modern Mainline addon API and its Midnight-era
restrictions). It maintains an officer-controlled raid, attendance, boss, EPGP, loot, and
event journal in the `GuildedDB` SavedVariables table.

## Install

Copy the `Guilded` directory into WoW Forever's `Interface\AddOns` directory:

```text
World of Warcraft\_forever_\Interface\AddOns\Guilded\
```

`_forever_` is the WoW Forever client folder; other client flavors (Classic, Retail, PTR, ...)
use a different folder under `World of Warcraft\`, so copy into the one the client you actually
launch reads from. Enable **Load out of date AddOns** if the client requests it. The addon does
not require the Guilded Discord bot or any external library.

## Modules: use only what you want

It is one addon (one download, one saved file). The optional parts can be
switched off:

| Module | What it does |
| --- | --- |
| `games` | Fun /roll games (high roll, deathroll, duel): no gold |
| `bidding` | In-game GP bidding on loot |
| `council` | Loot council answers (BiS / upgrade / off-spec) and EPGP priority loot |
| `reserve` | Soft reserves: reserve items for a raid, shared list, roll between reservers |
| `recipes` | Who can craft what, profession cooldowns, materials list |
| `dungeon` | Dungeon run tracking for the Dungeon Challenge |
| `calendar` | The guild calendar, both ways with Discord |
| `consumables`, `tooltip`, `chattab`, `digest`, `backup`, `autoinvite`, `syncnow` | Consumable scan, item tooltips, the Guilded chat tab, login digest, backup and restore, auto-invite, save-now |
| `sim` | Test raid / dungeon run for officers |

Raids, attendance, EPGP, loot, the gear check, standings and the version
check are the core and always run.

- `/guilded modules` lists them and whether each is on.
- `/guilded modules off games` turns one off just for you;
  `/guilded modules on games` turns it back on.
- Officers: `/guilded modules guild off games` turns it off for the whole guild.
  It's shared with everyone online and with members when they next log in;
  a member can't turn a guild-off module back on.
- The **Tools** tab of the window has the same switches.

Turning something off works immediately (its tab, buttons, commands and
chat listening go away). Turning something back on that was off when you
logged in needs a `/reload`.

## Minimap button and tools panel

A gold coin button sits on the minimap edge. Left-click opens the tools
window, right-click checks your gear, drag moves it. Each rank sees only
what it can use: members get Me, Standings, Reserves, Dungeons, and Tools; officers
also get Ready, Calendar, Raid, EPGP, Loot, Council, and the officer tools (rank is re-checked
each time the window opens). Tabs for switched-off modules are hidden. A shared **Player** box sits at the top: targeting a
player fills it in, and **Me** / **Group...** (clickable raid/party list, or
online guildmates when solo) fill it on demand. Amounts and
attunements have preset buttons; shift-click an item into the EPGP tab's
Item box to award loot. Whole-group actions and ending a raid need a second
click to confirm. Every button runs the same `/guilded` command you could type,
so the permission checks are the same. Roll games run from the
Games tab; players join from chat (see `Modules/README.md`). `/guilded menu` opens the window from chat, and
`/guilded minimap show|hide|reset` controls the button. Guilded is also in the Addon
Compartment (the addon list under the minimap), and `/guilded options` (or Esc > Options >
AddOns > Guilded) has the minimap button, chat tab, digest, auto-save and module switches.

## Standings, version check, and attendance

- **Attendance from raid presence:** while a raid is active, everyone who is
  in the raid group at any point is recorded (`GuildedDB.presence`).
  `/guilded attendance seen` (or the Raid tab button) marks them all PRESENT
  without overwriting anything already marked by hand.
- **Standings:** the companion writes `Standings.lua` (the bot's EP/GP per
  linked character) into this folder. After a `/reload` an officer's client
  shares it with the guild over the `GuildedSync` addon channel; members
  only accept standings sent by an officer. `/guilded standings [player]`.
- **Version check:** each client announces its version at login, and anyone
  running an older build gets told a newer one exists.

## In-game use

After login, an officer (guild rank 0 or 1 by default) can use:

```text
/guilded start Molten Core
/guilded attendance Player PRESENT
/guilded boss Ragnaros
/guilded award Player 10 Raid attendance
/guilded gp Player 25 Tier item
/guilded deduct Player 5 Mistake
/guilded loot Player [Tier Item] 25
/guilded inspect
/guilded character
/guilded share
/guilded consumes
/guilded consumes me
/guilded enchants
/guilded snapshot pre-pull
/guilded digest
/guilded peers
/guilded attune Onyxia Key
/guilded attune Player "Onyxia Key"
/guilded attune Player "Onyxia Key" clear
/guilded end
/guilded export
```

`/guilded attune <key>` records an attunement as complete for your own character.
Officers can record one for someone else with `/guilded attune <player> <key>`.
Append `clear`, `false`, or `no` to mark an attunement incomplete instead
(e.g. `/guilded attune Onyxia Key clear`). `/guilded inspect` also now captures your
known professions and skill levels (via the client's own profession API)
alongside gear - this is self-reported data, the same trust level as the
rest of `/guilded inspect`, not something inferred about other players.

`/guilded status`, `/guilded roster`, `/guilded inspect`, `/guilded diag`, and `/guilded help` are
available to everyone. If your guild's officer ranks are not rank index 0
and 1, the guild master can change it in game: `/guilded officer rank 2 on`, or
`/guilded officer add <name>` for one person (`/guilded officer list` shows the current
setup). SavedVariables are written on logout/reload.

An active raid survives `/reload` and disconnects; `/guilded end` closes it.
Player names are normalized ("bob", "Bob-Realm" -> "Bob"), so the same
character never ends up with two ledgers. `/guilded inspect` reports READY, PARTIAL
(e.g. no off-hand with a two-hander, or durability under 20%), or NOT_READY,
and names the empty slots it counted.

Every EPGP ledger entry gets a permanent id. Each export carries the whole
ledger, and the bot uses those ids to skip entries it already imported, so
importing every week never double-counts.

## Detection and communication

Login and guild roster updates are captured. Loot chat is stored as a **hint**;
it is not treated as an authoritative loot award. The combat log is not
captured at all: since patch 12.0.0 addons cannot register combat log events,
and WoW Forever inherits that restriction. Boss kills and attendance are
manual, so officers use the manual commands.

When the client provides `RegisterAddonMessagePrefix`, the addon registers
`Guilded` and broadcasts manual raid, attendance, boss, EPGP, and loot changes
through `SendAddonMessage` to the raid. Messages are informational; every client
keeps its own SavedVariables.

### Automatic readiness sync

A compact readiness digest (status, missing-gear count, lowest equipped
durability, professions and skill levels - no item names, enchants, or
consumables) is broadcast to the **guild** chat channel automatically:

- On login/zoning in (`PLAYER_ENTERING_WORLD`)
- On any gear change (`UNIT_INVENTORY_CHANGED`)
- Every 10 minutes while in a raid group

This is self-reported data - the same trust level as running `/guilded inspect`
yourself, just automatic - not something inferred about other players, so it
doesn't conflict with the "hints, not proof" rule above, which is specifically
about loot chat. Any other online client with this addon
receives these digests and stores them in `GuildedDB.peerRoster`, keyed by
character name. This means **one officer's `/guilded export`, run while others are
online, carries a live readiness/profession summary for the whole online
guild** - individual members don't each need to run `/guilded inspect` and export
for their data to reach the bot. A full `/guilded inspect` (with item names,
enchants, consumables) still only exists in the inspecting player's own
`GuildedDB.readiness` and export, not in peer digests.

Broadcasts use the `GUILD` channel (not `RAID`) so they reach everyone online,
not just your current raid group. `/guilded inspect` run manually broadcasts the
same way.

Exports are the SavedVariables file itself. The companion
(`companion/lua-export.mjs` in the bot repository) reads it and sends the
bot a normalized JSON export: EPGP ledger entries (with their permanent ids),
readiness and peer digests, attunements, finished raids with attendance and
presence, loot, and dungeon runs. An officer reviews and applies it with
`/import apply`; entries already imported are skipped.


## Version 2.0 additions

- **`/guilded share`** builds one code (`QGEXP1:...`) with your character, your last gear check, active consumables and attunements, in a box you copy. In Discord, `/character import code:<paste>` applies it. Nothing to install besides the addon; it only ever describes your own character.
- **Enchant check.** `/guilded inspect` reads the enchant id in each equipped item link and warns `Missing enchants: Chest, Legs.` for Chest, Legs, Feet, Wrist, Hands and Main Hand from level 60. `/guilded enchants off` or `/guilded enchants level 70` changes it for you.
- **Reason flags.** The guild digest now carries `F:NOFLASK,NOFOOD,ENCH:Chest+Legs` so an officer's export shows *why* someone is PARTIAL.
- **Login digest** (`/guilded digest`): new members, EPGP changes, finished raids and loot since your last login, from saved data only.
- **`GuildedAPI`** (see `Modules/API.lua`): read-only version 1 for WeakAuras and other addons.
- **Player identity.** `/guilded diag` now prints what this client returns for name and realm. WoW Forever has no real realms, so the addon never assumes one.

## Version 2.1 additions

- **One saved-data set per WoW guild.** If a WoW install has characters in two guilds, the addon keeps each guild's ledger, roster, raids and settings apart: the data of the guild you are not playing in is parked and comes back when you play there. The guild is only known a moment after login, so a "Guild changed" line (and a `/reload` suggestion) appears the first time you switch. `/guilded diag` shows which guild the data belongs to. The companion skips an upload whose data belongs to another guild if you set `"wowGuild": "Guild Name-Realm"` in `companion.config.json` (the exact text `/guilded diag` shows).
- **`/guilded backup` and `/guilded restore`.** A backup is one copyable code with this guild's saved data; restoring needs two presses (it shows what the backup holds first) and `/guilded restore undo` reverses it. Codes are checked (checksum), read by a plain parser that never runs code, and refused if they come from another guild.

## Version 2.2 additions

- **`/guilded autoinvite`** (officers): players whisper a phrase (default `ginv`) and get a guild invite. Off by default, rate limited (one invite per name per hour, 15 per hour), never in combat, skips known guild members.
- **TBC Anniversary:** the TOC now lists interface `20506` next to Forever's `16001`, so the same download loads on both. Anniversary-specific behaviour is untested.

## Version 2.3 additions

- **The character line uses semicolons** (`QG2;Ray;Realm;PRIEST;...`). The old `|` line broke in chat because WoW treats `|R` as a colour code and swallowed the start of names beginning with R.
- **Everyone announces who they are.** The guild gear digest now carries class, race, level and spec, so an officer's export discovers every guildmate running the addon. The bot links them to Discord automatically (see `COMMANDS.md`, "Automatic character sync").
- **A realm rename keeps your data.** If the guild name is the same and only the realm text changed, the saved data is kept and re-keyed instead of being parked.

## Version 2.4 changes

- **The casino is gone.** No wagers, no house games, no debt ledger, no trade settlement. `/guilded games` has fun roll games only (high roll, deathroll, duel). Old casino saved data is ignored.
- **Item tooltips** (module `tooltip`): hover an item that someone wishlisted in Discord (`/character wishlist`) or that was awarded before and you get up to three gold lines: who wants it, what it usually costs in GP, and your own PR and rank. The data comes from the bot with the standings and is shared with the guild the same way; items with no data show nothing. `/guilded modules off tooltip` turns it off.
- **Ready page** (in the window, and `/guilded ready`; officers and group leaders only, meaning guild officers plus the leader or an assistant of the current raid or party): who in your raid or party is ready. Each player is Ready, Issues, Not ready or No data, worst first, with the reason. It uses what each player's addon shared (gear, enchants, durability, flask, food) plus a live look at their buffs, so a player without the addon still shows flask and food. `ready ask` asks every addon in the group to check itself again; `ready post` posts the result to raid or party chat. Flask and food count only in a raid group.
- **Guilded chat tab** (module `chattab`): `/guilded chat tab` opens a chat window named Guilded and sends the addon's own lines there (bid results, sync status, answers to commands), so raid chat stays clean. `/guilded chat off` puts them back in the main chat. Raid, party and whisper messages are never moved.
- **`/guilded sync`** saves now so the companion can upload sooner, and **auto-save** does it by itself at safe moments (out of combat, outside instances, changes quiet for 90 seconds, at most every 10 minutes). It is **off by default**: nobody is reloaded without asking; officers get a small banner with a button, and logging out also saves. Turn it on with `/guilded sync auto on`.
- **The standings line says why** it has no number: not arrived yet, the bot has nobody linked yet, or this character is not linked.
- **A new tools window.** A sidebar with grouped pages (Overview, Raid night, Fun and runs, System) instead of a row of tabs, a **Home** page that answers "what is going on and is my data on Discord?", tooltips saying what each page is for, a page title, the Player field only where it is used, and a permanent **Send to Discord** button.
