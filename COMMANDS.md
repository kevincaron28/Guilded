# Guilded command reference

Quick lookup for the in-game addon (`/guilded ...`) and the Discord bot (`/...`).
**Who** means who is allowed to run it: *Everyone*, *Officer* (in game: guild
rank 0/1 unless changed with `/guilded officer`; on Discord: the Officer or Guild
Master role, or Administrator), or the specific Discord role named.

## In game: `/guilded`

**Easiest way: click the gold coin on the minimap** (or type `/guilded menu`).
The window has a **sidebar** on the left with the pages grouped under headings:

- **Overview:** **Home** (what is going on right now, your standing from Discord, your gear check, and whether your data has reached Discord, with big buttons for the common things), **Me**, **Standings**
- **Raid night** (officers): **Raid**, **EPGP**, **Loot**
- **Fun and runs:** **Dungeons**, **Games**
- **System:** **Tools** (switch optional parts on or off, diagnostics)

Hover a page name for what it is for. The **Player** box (target someone, or **Me** / **Group...**) only appears on pages that act on a player. **Send to Discord** at the bottom of the sidebar saves your data (a UI reload) so the companion can upload it, and the label above it says whether anything is waiting. Buttons that affect everyone (whole-group EP, end raid) need a second click to confirm. Right-click the coin to check your gear. Everything also works as a typed command. Names are case-insensitive (`bob` = `Bob`).

### Everyone

| Command | What it does |
| --- | --- |
| `/guilded help` | List commands |
| `/guilded inspect` | Check your gear, durability, professions, and item level. Shows READY / PARTIAL / NOT_READY and names empty slots. Also shares a summary with the guild |
| `/guilded status` | Show the active raid, if any |
| `/guilded roster` | List characters the addon knows about |
| `/guilded attune <key>` | Mark your own attunement done, e.g. `/guilded attune Onyxia Key` |
| `/guilded attune <key> clear` | Mark it not done |
| `/guilded diag` | Show recent addon errors / blocked actions (send this when reporting a bug) |
| `/guilded menu` | Open the tools window |
| `/guilded share` | One paste with your character, latest gear check, consumables and attunements (a box to copy). In Discord: `/character import` |
| `/guilded character` | One line with your character (name, class, race, level, spec, professions) for `/character import` |
| `/guilded enchants [on/off/level <n>]` | Show or change the missing-enchant check (which slots, from what level) |
| `/guilded ready` / `ready ask` / `ready post` | Officers and group leaders (raid leader or assistant): who in your raid or party is ready: a summary and everyone who is not. It runs by itself on every Blizzard ready check (each addon reports what it carries, and you get a summary when it ends). `ask` asks every addon to check again without a ready check; `post` tells the group who needs attention. The window's **Ready** page (officers and group leaders only) shows an icon per check |
| `/guilded ready settings` / `ready require <flask\|food\|buffs\|weapon\|augment\|vantus> on\|off` / `ready expiry <minutes>` / `ready durability <percent>` / `ready report on\|off` / `ready autopost on\|off` | Officers: what the ready check requires (flask, food and raid buffs by default), how many minutes left counts as running out (10), the lowest durability that is fine (20), whether you get the end-of-check summary, and whether it is also posted to the group |
| `/guilded consumes` / `/guilded consumes me` | Officers: who in the group lacks a flask/elixir or food. Anyone: your own active consumables |
| `/guilded invite raid` / `/guilded invite missing` | Officers: invite everyone signed up for the next Discord raid (their main characters, from the companion's Standings.lua, for raids in the next 36 hours), or just list who is not in your group yet. Invites go out 0.6 seconds apart; convert to a raid yourself when the group passes 5 |
| `/guilded autoinvite on [phrase]` / `off` / `status` | Officers: guild-invite anyone who whispers you the phrase (default `ginv`). Off by default; skips people already in the guild, never in combat, max 15 invites an hour |
| `/guilded backup` | A box with one code (`QGBKP1:...`) holding this guild's saved data (raids, EPGP ledger, roster, attendance, loot, settings). Copy it somewhere safe |
| `/guilded restore` / `/guilded restore undo` / `/guilded restore forget` | Paste a backup code and press Restore twice (first shows what it holds, then replaces your data). A backup from another guild is refused; `undo` puts back what was there before (kept 7 days); `forget` drops that undo copy now. Recipes, calendar and consumable scans are not in a backup: they rebuild themselves |
| `/guilded digest [on/off]` | What changed since your last login (also shown once at login) |
| `/guilded peers` | Which guildmates run which addon version this session |
| `/guilded snapshot [label]` / `/guilded snapshot list` | Officers: record who is in the group right now (also counts as presence for the active raid) |
| `/guilded calendar check` | Checks whether this client's guild calendar works for addons (read only) |
| `/guilded calendar sync` / `list` / `create [n]` | Officers: read the guild's calendar events and answers for Discord; list the upcoming Discord raids and which are in the game calendar; make the in-game event for the next (or nth) one. The Calendar tab has the same buttons |
| `/guilded lang en` / `fr` / `auto` | Language of your window and bid popup (auto = same as your game client) |
| `/guilded standings [player]` | EPGP standings from Discord (top 10, or one player) |
| `/guilded dungeon status` | The dungeon run being recorded: state, timer, bosses, deaths |
| `/guilded dungeon start` / `complete` / `abandon` | Fix a run by hand when detection missed it (group leader, officer, or solo) |
| `/guilded dungeon check` | Checks which dungeon features work on this client (send the result to an officer) |
| `/guilded version` | Your addon version. You're also told automatically when a guildmate has a newer one |
| `/guilded minimap show` / `hide` / `reset` | Control the minimap button (Guilded is also in the addon list under the minimap, the Addon Compartment) |
| `/guilded options` | Guilded's page in the game's options (Esc > Options > AddOns): minimap button, chat tab, login digest and your module switches |
| `/guilded sync` | How to send your data to Discord now: press **Send to Discord** in the window (or the officers' banner), or type `/reload`. The game only reloads on your own click |
| `/guilded officer list` | Show which ranks count as officers, and whether you do |
| `/guilded modules` | List the optional parts (games, bidding, council, reserve, recipes, dungeon, calendar, sim ...) and whether each is on |
| `/guilded modules off\|on <module>` | Turn one off or back on just for you (also in the Tools tab). Back on after being off at login needs `/reload` |

### Officers: raid and EPGP

| Command | What it does |
| --- | --- |
| `/guilded start <title>` | Start a raid, e.g. `/guilded start Molten Core` (survives /reload) |
| `/guilded attendance <player> [PRESENT\|LATE\|ABSENT]` | Record attendance (default PRESENT) |
| `/guilded attendance seen` | Mark PRESENT everyone who was in the raid group at any point since `/guilded start` (tracked automatically; keeps anything already marked) |
| `/guilded attendance group [status]` | Mark everyone in the group right now |
| `/guilded boss <name>` | Record a boss kill |
| `/guilded award <player> <amount> [reason]` | Give EP |
| `/guilded award group <amount> [reason]` | Give EP to everyone in the group |
| `/guilded gp <player> <amount> [reason]` | Charge GP for an item |
| `/guilded deduct <player> <amount> [reason]` | Remove EP |
| `/guilded loot <player> <item> [cost]` | Record who got an item (shift-click links work) |
| `/guilded attune <player> <key> [clear]` | Set someone else's attunement, e.g. `/guilded attune Bob "Onyxia Key"` |
| `/guilded end` | End the raid |
| `/guilded export` | Mark a sync point, then `/reload` so the game saves, then run the companion |

### Officers: GP bidding (Loot tab)

Shift-click the item into the Loot tab, set the minimum GP and time, press
**Open bidding**. Raiders with the addon get a popup (with their PR) and bid
from it; anyone else whispers you a number, like `25`. Bids are sealed. At
the end the highest bid wins (tie: higher PR, then first to bid). Press
**Award winner** to record the loot and GP. Chat gets one line to open and
one for the winner.

| Command | What it does |
| --- | --- |
| `/guilded bid start <min GP> <item> [seconds]` | Open bidding (default 30 s) |
| `/guilded bid close` | Stop early and show the leader |
| `/guilded bid award` | Give it to the winner at their bid (records loot + GP) |
| `/guilded bid cancel` | Cancel, nothing recorded |
| `/guilded bid status` | Current bids |

### Loot systems per raid core

Each raid core decides how its loot is given out (a core that says nothing follows the guild's
choice, `/setup config loot-mode`). Pick it in `/core setup` (step 3, the loot system menu) or with
`/core rules core:<name> loot_mode:<system>`.

| System | How it works |
| --- | --- |
| **GP bids** | Players bid GP; the highest bid wins and pays it. |
| **Loot council** | Raiders answer BiS / upgrade / off-spec; officers decide. GP only if you name a price. |
| **Soft reserves** | Players reserve items before the raid; when it drops, the reservers roll for it. Reserves per player are set per core (`/core rules reserves:2`, or the button in `/core setup`). |
| **EPGP priority** | Every item has a **set GP price**. It goes to the **highest PR of the players who want it** and they pay the price. |

**EPGP priority prices.** Set them per core (the core's price wins), or for the whole guild (every core uses it unless it has its own):

| Command | What it does |
| --- | --- |
| `/core items action:set core:<core> item:<name or id> gp:<price>` | One price. Leave `core` out for the guild-wide list |
| `/core items action:import core:<core> file:<file>` | A text or CSV file, one `item = price` per line (`Sulfuras, Hand of Ragnaros = 250`, `Bindings;120`, `19019 = 90`) |
| `/core items action:list` / `remove` / `clear` | Look at, remove one, or empty a list. Anyone can list; changing is for Raid Leaders |
| **Item prices** button (`/core edit` or `/core setup`) | The easiest way: a list already filled in with the core's prices, then the items people wishlisted or were given before that have no price yet, with the average GP paid as a suggestion. Edit the numbers and save; lines left as `= ?` are skipped |
| `/guilded price <item> <GP>` (in game, officers) | Set a price for the core you are running. `/guilded drop` also asks for a price when an item has none. Prices set in game reach Discord with the next companion upload (the newer price wins) |
| **Item prices** button in `/core setup` | Paste a list into a form |
| `/loot priority item:<item> [raid:<raid>]` (officers) | Who is next for an item: the wishlist members of the raid's core, highest PR first (that core's pool when it has its own), with the price |
| `/loot award item player [gp]` | In priority raids, leaving out `gp` charges the item's set price |

`/loot auction` and `/loot bid` only work for GP bids cores; the other systems tell you how they work.

**In game** the officer's addon knows each core's system, prices and own-pool standings from the
companion (they arrive with the standings). Which core is being run: the raid the bot expects next,
or `/guilded core <name>` (`auto` goes back). Then one command for every system:

| Command | What it does |
| --- | --- |
| `/guilded drop <item link> [seconds]` | An item dropped: starts it the way this core does it. GP bids: opens bidding at the guild's minimum. Loot council: opens the council. Soft reserves: rolls between the reservers (or a free roll when nobody reserved it). EPGP priority: opens "I want it / Pass" at the set price |
| `/guilded drop mode [system\|auto]` | Show the loot system, or override it for tonight |
| `/guilded core [name\|auto]` | Show or pick the raid core you are running |
| `/guilded council priority <GP> <item> [seconds]` | EPGP priority with a price you give (for an item with no set price) |

In EPGP priority raiders get a popup (or whisper `want` / `pass`); when the time is up the highest
PR among those who want it gets the item and is charged the set price by itself. PR uses the core's own
point pool when it has one. Nothing else to press: cancel before the timer ends with `/guilded council cancel`.

### Guild calendar

The in-game guild calendar and Discord raids, both ways (in game: officers, the Calendar tab or `/guilded calendar ...`).

- **In game to Discord:** `/guilded calendar sync` reads the guild's calendar events and how each member answered. The companion sends them with the rest of the export. An event at the same time (within 90 minutes) as a planned Discord raid fills in signups for players who have **not answered on Discord**: accepted signs up, tentative is a Maybe, through the normal role caps and waitlist (core members get their core role, others DPS). Declined answers and anyone who already signed up or cancelled on Discord are never changed. Players are matched by character name. Events with no Discord raid and unlinked names are listed for the officers in the officer log and the `/import apply` reply.
- **Discord to in game:** the companion writes the next three weeks of planned raids next to the standings. The Calendar tab (or `/guilded calendar create`) makes the in-game guild event for one. It will not make a duplicate of an event that is already there.
- It works only if WoW Forever's client offers the calendar to addons; `/guilded calendar check` tells you, and every calendar command says so when it cannot.

### Recipes and cooldowns

Open each of your professions once and Guilded reads every recipe you know (and what it
needs, and any cooldown), then tells the guild in a few short messages. After that anyone
with the addon can ask who can craft something, and the list reaches Discord with the
companion's export. Only players with the addon who have opened their profession window
show up. Item names of other players' recipes fill in as the game learns them.

| Command | What it does |
| --- | --- |
| `/guilded recipes who <item link or name>` | Who in the guild can craft it |
| `/guilded recipes mine` | What your professions hold, and how many guildmates' lists you have |
| `/guilded recipes mats <item link> [count]` | Shopping list for a recipe you know, with how many you already carry |
| `/guilded recipes share` | Send your recipes to the guild again (it also does this by itself once in a while) |
| `/guilded cooldowns [mine]` | Profession cooldowns (transmutes and so on), soonest first. Recipes that share a cooldown show as one line |
| `/craft who <item>` (Discord) | Who can craft it, with their profession and Discord name. Pick from the list or type part of the name |
| `/character profession cooldowns [mine] [notify]` (Discord) | The guild's cooldowns. `notify: true` DMs you once when a cooldown of yours is ready |

Item tooltips also say "Crafted by ...".

### Soft reserves (Reserves tab)

Reserve items for a raid without a website. An officer opens the list; everyone
reserves; the list is locked when the raid starts; when an item drops, the
reservers roll for it. Items are kept by item id, so **shift-click the item**.

1. Officer: `/guilded reserve open 1 Onyxia night` (1 = reserves per player, default 1, up to 5). That officer keeps the list.
2. Everyone: `/guilded reserve [item link]`, or paste the item into the Reserves tab. With 1 per player a new reserve replaces the old one. Players without the addon whisper the keeper: `res [item link]`.
3. Officer, when the raid starts: `/guilded reserve lock`.
4. When an item drops: `/guilded reserve who [link]`, then `/guilded reserve roll [link]` (a high roll between only the reservers), then `/guilded reserve award <player> [link] [GP]` (records the loot and uses up that reserve).

The list also reaches Discord: the companion sends it with the rest of the export and
`/loot reserves [item]` shows it there (see below). It is shared with the guild automatically, shows on item tooltips ("Reserved by ...")
and puts reservers first in the loot council list. It survives `/reload`.

| Command | Who | What it does |
| --- | --- | --- |
| `/guilded reserve [item link]` (or `add`) | everyone | Reserve an item |
| `/guilded reserve remove [item link]` | everyone | Take a reserve back (while the list is open) |
| `/guilded reserve list` | everyone | The list and your reserves |
| `/guilded reserve who [item link]` | everyone | Who reserved an item |
| `/guilded reserve open [per player] [title]` | officers | Start a fresh list (you become the keeper) |
| `/guilded reserve lock` / `unlock` | officers | Stop or allow changes (keeps the list) |
| `/guilded reserve add <player> [item link]` / `remove <player> [item link]` | the keeper | Change someone else's reserves, even when locked |
| `/guilded reserve roll [item link]` | officers | High roll between the players who reserved it |
| `/guilded reserve award <player> [item link] [GP]` | officers | Record the loot (GP only if given) and use up the reserve |
| `/guilded reserve clear` | officers | Close and forget the list |

### Officers: loot council (Council tab)

For loot council guilds: officers open an item, raiders say how much they
want it, and the officers decide. Shift-click the item into the Council tab
and press **Open council**. Raiders with the addon get a popup with **BiS**,
**Upgrade**, **Off-spec** and **Pass** (it also sends what they wear in that
slot); anyone else whispers you `bis`, `upgrade`, `os` or `pass`. Answers are
private and listed best first: BiS, then Upgrade, then Off-spec, then higher
PR, then first to answer; a player whose Discord wishlist names the item is
marked. The list is a guide, you award to whoever the council picks. Award
records the loot (and GP only if you give a price) like any other award.

| Command | What it does |
| --- | --- |
| `/guilded council start <item> [seconds]` | Open the council (default 60 s) |
| `/guilded council close` | Stop early and show the list |
| `/guilded council award [player] [GP]` | Give it to a player (default: the top pick, 0 GP) |
| `/guilded council cancel` | Cancel, nothing recorded |
| `/guilded council status` | Current answers |
| `/guilded council bis\|upgrade\|os\|pass` | Members: answer from the keyboard |
| `/guilded sim council` | Fake raiders answer the open item (test raid) |

### Officers: test raid (no raids are out yet)

| Command | What it does |
| --- | --- |
| `/guilded sim start` | Start a `[TEST]` raid with fake raiders (Testalpha, Testbravo, ...) in the group |
| `/guilded sim bids` | Fake raiders bid on the open item |
| `/guilded sim end` | Kill 3 test bosses, mark attendance, give a test item, end it |
| `/guilded sim dungeon [minutes]` | Save a finished fake dungeon run (you + 4 fake players) to test the export, points and records |
| `/guilded sim clear` | Remove every test raid and the EP/GP it recorded, and test dungeon runs |

### Officers: modules for the whole guild

| Command | What it does |
| --- | --- |
| `/guilded modules guild off\|on <module>` | Turn a module off (or back on) for everyone. Shared with online members and with members when they log in; nobody can turn a guild-off module back on for themselves |

### Guild master only

| Command | What it does |
| --- | --- |
| `/guilded officer rank <index> on\|off` | Make a guild rank count as officer (0 = GM, 1 = next rank...) |
| `/guilded officer add\|remove <name>` | Make one person an addon officer |

### Roll games (fun only: no gold, nothing owed)

Anyone in a party or raid can run one; your client is the referee. Players type `1` in party/raid chat to join and use the game's own `/roll`; they don't need the addon.

| Command | What it does |
| --- | --- |
| `/guilded games highroll [max]` | Everyone rolls, the highest wins (a tie rolls off) |
| `/guilded games deathroll [max]` | Everyone rolls, the lowest is out, again until one is left |
| `/guilded games duel <player> [max]` | Two players, classic deathroll: each rolls the last number, whoever rolls 1 loses |
| `/guilded games roll` / `remind` / `add <p>` / `remove <p>` / `cancel` / `status` | Call the roll, nudge, add or remove a player, stop, see what is running |

The gold casino (wagers, house games, the debt ledger) was removed on purpose: gambling gold inside a guild is too risky.

## Discord bot

Tips: wherever a command asks for a raid, auction, request, or entry, **start
typing its name and pick it from the list** (no IDs to copy). Raid signup
posts have buttons, so members rarely need `/raid signup`. Member-facing
messages follow the language chosen in `/setup start` (English or French).

### Where things live

There are 17 commands, not 34: small ones sit under a parent, so typing `/` shows a short list.

| Command | What is under it |
| --- | --- |
| `/setup` | `start` (the guided setup), `config` (every setting; `config channel` picks where each kind of post goes), `testraid`, `selfroles` |
| `/character` | `add`, `list`, `claim`, `import`, ..., plus `who`, `profession`, `attunement`, `wishlist`, `readiness` |
| `/raid` | the raid commands, plus `wcl` (Warcraft Logs) |
| `/epgp` | EPGP points (the old DKP commands are hidden) |
| `/dungeon` | the challenge, plus `admin` (officer tools) |
| `/mod` | moderation, plus `application` (handle guild applications) |
| `/import` | `upload` (preview an addon file), `apply` (apply it) |
| `/report` | `stats`, `inactive`, `guild` (health), `export`, `ping` (is the bot online) |
| `/help` `/profile` `/loot` `/craft` `/bank` `/apply` `/poll` `/core` `/tag` | unchanged |

### Everyone on Discord

| Command | What it does |
| --- | --- |
| `/help` | The commands you can use (shows more for officers and leaders) |
| `/report ping` | Is the bot online? |
| `/report bug <description> [screenshot]` | Report a bug or problem. Also captured automatically whenever a command errors, for the developer to review |
| `/profile` | Your profile: characters (race, class, professions, last seen), EP/GP/PR |
| `/character who <character>` | Look anyone up: main and alts, professions, EP/GP/PR, 30-day attendance, last seen |
| `/character pair` | Generate a one-time code to link your Companion to your Discord account; future uploads link your own character when applied |
| `/character add <name> <realm> <class> <main> [spec] [level] [race]` / `/character list` | Link your WoW characters (needed before imports can match you) |
| `/character claim <name>` | Link a character your addon already reported (pick it from the list; nothing to type or paste). Most people never need it: characters whose name matches the Discord nickname are linked automatically |
| `/character import <code> [main]` | Link or refresh a character: paste the line `/guilded character` shows (name, realm, class, race, level, spec, professions), or the code `/guilded share` shows (also records a gear check, consumables and attunements) — no typing |
| `/character unlink <name>` | Unlink a character: yours, or (Officers/GM) anyone's. If the addon reports it again it goes back to unclaimed |
| `/raid wcl check [raid] [url]` | Officers: the private check of a raid's log: who is in the log but not credited (or the reverse), characters not linked to anyone, EP not yet awarded, who came to boss pulls without a flask or food, and deaths. No damage or parse numbers |
| `/raid wcl list` | The latest Warcraft Logs reports the officers pulled in |
| `/apply <core> <character> <class> <spec> <experience> <availability> <role> [notes]` | Apply to a raid core, with your raid role (Tank, Healer or DPS). Or press **Apply to `<core>`** on that core's own roster message (raid roster channel): pick your role, then a short form. Officers decide on the card: **Trial** adds you to the core as a trial member (shown apart on the roster) and keeps **Approve** and **Reject** on the card to settle it later; **Approve** makes you a full core member |
| `/raid signup <raid> <role> [availability]` | Sign up (Tank, Healer, DPS). `availability:Maybe` doesn't take a slot. If your role is full you go on the **waitlist** and get a DM when a slot opens |
| `/raid cancel-signup <raid>` | Drop out (the next waitlisted player moves up) |
| `/raid status <raid>` / `/raid roster <raid>` | Raid info and roster |
| `/raid progress` | Guild boss progression: first kill, number of kills, latest kill |
| `/epgp balance` / `history` / `leaderboard` | Your EP, GP, PR, and the leaderboard |
| `/loot bid <auction> <amount>` | Bid GP on an auction |
| `/loot reserves [item]` | Who soft-reserved what, from the list kept in the game addon (`/guilded reserve`). It updates when the companion uploads. Type part of an item name, or a character name, to narrow it |
| `/loot history` | Awarded loot: item, boss/raid, winner, GP, GP before → after, who awarded it, date |
| `/character readiness me` | Your latest gear check from the addon |
| `/character attunement set` / `list` | Your characters' attunements |
| `/character profession set` / `list` | Your characters' professions |
| `/character profession who <profession>` | Everyone with that profession, highest skill first (partial names work: `alch`) |
| `/character profession coverage` | How many have each profession, and who's highest |
| `/character wishlist add` / `remove` / `list` / `item` | Your wanted items; `item` shows who wants something |
| `/tag show <name>` / `/tag list` | Post a saved answer |
| `/raid report <raid>` | Post a raid summary: duration, raiders, bosses, EP awarded, loot and GP spent |
| `/report stats [days]` | Guild activity (default last 7 days): raids, boss kills, EP, loot, new members, applications, most raids attended |
| `/bank request <item> [quantity] [note]` | Ask the guild bank for something; you get a DM when it's handled |
| `/bank mine` / `/bank cancel <id>` | Your requests / cancel an open one |
| `/craft request <item> [profession] [quantity] [materials] [note]` | Ask a guild crafter to make something; shows who has that profession |
| `/craft list [profession]` / `/craft claim <id>` | Crafters: see open requests and take one |
| `/craft permissions` | Officers: put the craft board permissions right (members talk in a request post and press its buttons; only the bot and leadership start posts) |
| `/craft done <id>` / `release <id>` / `mine` / `cancel <id>` | Finish, give back, see yours, or cancel. The requester gets DMs |

### Dungeon challenge

Run a dungeon with the addon installed (one person in the group is enough;
more is better for death tracking). It is recorded automatically: the timer
starts on the first pull and stops on the last boss. An officer imports it
like everything else (`/import apply`) and points are given out:
completion 50, no deaths 25 (1 death 15, 2 deaths 5), first clear of that
dungeon 25, personal record 15, guild record 25, full guild group 20.
The same dungeon more than once a week is worth 50%, then 0% (resets
Tuesday). Runs under 3 minutes, over 4 hours, or with more than 5 players
are not counted.

Achievements are permanent and give no points: First Blood (first dungeon),
No One Dies (every player tracked, nobody died), Speed Demon (beat a target
time), Record Breaker (new guild record), Guild Squad (5 guild members),
Dungeon Master (10 different dungeons, adjustable) and Season Champion (most
points when a season ends). They show in the run post and on `/dungeon player`.

| Command | What it does |
| --- | --- |
| `/dungeon leaderboard [period] [dungeon]` | Most points this week, this season (default) or all time; optionally one dungeon |
| `/dungeon records [dungeon]` | Fastest clear of every dungeon, or the top 5 times of one |
| `/dungeon player [member | character]` | Points, runs, best times and recent runs (default: you) |
| `/dungeon history [member]` | Last 10 runs, including ones that did not count and why |
| `/dungeon season` | Current season and its top 5 |
| `/dungeon guide` | Post or repair the pinned **Post a dungeon group** button in the configured dungeon signup channel |
| `/dungeon group <title>` | Form a dungeon group: a post in the dungeon signups channel with Tank / Healer / DPS / Leave buttons (1 tank, 1 healer, 3 DPS, extras waitlist). Members can also create these posts from the pinned guide button. At 5 players, or when the leader presses **Start now**, the bot creates a **private temporary voice channel** for the group (only its players, the leader and Officers can join). The channel is deleted after 5 empty minutes or when the group is closed; unfinished groups close after 24 hours. Needs the bot to have Manage Channels |

After each import, completed runs and new records are posted once in the dungeon channel (`/setup config channel`, also in `/setup start`), or the notify channel if none is set.

### Raid Leaders (and Officers)

| Command | What it does |
| --- | --- |
| `/raid create <title> <time> [description] [bosses] [core] [weekly] [tanks] [healers] [dps]` | Create a raid. Time like `friday 8pm`, `tonight 20:00`, `vendredi 20h`, `2026-10-03 20:00` (your server's timezone). `weekly:true` makes ending it create the next one a week later. Posts the signup message with Tank / Healer / DPS / Maybe / Can't come buttons |
| `/raid edit` / `cancel` / `start` | Manage the raid (raising a cap moves waitlisted players in) |
| `/raid end <raid>` | End the raid and see the **proposed EP** with Approve / Cancel buttons |
| `/raid award-ep <raid>` | Show the proposed EP again (e.g. after `/import apply` added attendance) |
| `/raid boss <raid> <name> <Killed\|Pending>` | Boss status |
| `/raid attendance <raid> <player> <status> [notes]` | Record attendance |
| `/raid note <raid> <text> [boss]` | Officer note (general, per boss, what to improve); shown in `/raid status` to raid leaders |
| `/character readiness raid` also shows a **Consumables** section (who has no flask/elixir or food) from the officer's last in-game `/guilded consumes` scan, if it is under 3 hours old |
| `/character readiness member <player>` / `/character readiness raid` | Check other people's readiness (also Guild Master, Loot Leader, Class Leader). `/character readiness raid` posts the whole-guild board in the private **raid-readiness** channel when one is set (otherwise it replies only to you). The board is also refreshed after every `/import apply` that carries gear checks |

Proposed EP = attendance EP (present or late) + boss kills × boss EP + a
full-clear bonus, all from `/setup config set`. Only EPGP officers can press
Approve, and a raid can never be paid twice.

### DKP Officers (and Officers)

| Command | What it does |
| --- | --- |
| `/epgp award-ep <player> <amount> <reason>` | Give EP |
| `/epgp award-gp <player> <amount> <reason>` | Charge GP |
| `/epgp history player:<member>` | Anyone's history, with entry IDs |
| `/epgp reverse <entry> <reason>` | Undo a mistaken entry (adds the opposite entry; both stay in history) |
| `/epgp decay` | Apply the weekly EPGP decay |

### Officers

| Command | What it does |
| --- | --- |
| `/report inactive [days]` | Members not seen in game for N days (default 30): a read-only report, nobody is changed |
| `/report export <what>` | CSV file of the roster, raid attendance, loot history or the EPGP ledger (only you see it) |
| `/report guild` | Class / race / level mix, retention at 30 / 60 / 90 days, and what needs attention |
| `/poll create <question> <option1> <option2> [option3-5] [closes]` / `/poll close <poll>` | Poll answered with buttons; one vote each, changeable; the result bars update live |
| `/loot award <item> <player> [gp] [boss] [raid]` | Give an item straight to a player (loot council or manual); GP is charged only if you give a price; lands in `/loot history` |
| `/setup config loot-mode <EPGP\|Council>` | Council mode turns `/loot auction` and `/loot bid` off; officers decide with `/loot award` |
| `/character unclaimed` / `link <name> <player>` / `autolink` | Characters the addons reported that nobody has linked: list them, link one by hand, or link every one whose name matches a Discord member |
| `/setup config auto-import <true/false>` | Apply what the companion uploads by itself (ledger, attendance, loot, dungeon runs, gear checks, discovered characters) with no `/import apply`. Also a button in `/setup start` step 7 |
| `/setup start` | **Start here.** Guided setup: roles, channels (core, dungeon, extras; one button makes the whole WoW section under a "Guilded" category), welcome, EPGP values. `/setup start status:true` shows the checklist |
| `/raid wcl report <url> [raid] [post]` | Pull a Warcraft Logs report (link or code): zone, duration, boss kills and wipes, player list. Saved, posted to the raid logs channel, and linked to a Discord raid if you give its id. Needs `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` in `.env.local` |
| `/setup testraid start [raiders] [starts_in] [realm]` | Fake `[TEST]` raid with fake raiders signed up (hits role caps, Maybe, waitlist) |
| `/setup testraid finish <raid> [via_addon]` | Play it: attendance (late, no-show, walk-in), boss kills, loot, end, EP proposal. `via_addon` sends attendance through `/import apply` instead |
| `/setup testraid dungeon [minutes] [deaths]` | Fake dungeon run by 5 test characters through the real import: points, records, `[TEST]` announcement. Run twice to see the weekly repeat share |
| `/setup testraid cleanup` | Delete every test raid, test dungeon run and fake raider with their EPGP, points and loot. Real data is untouched |
| `/loot auction <item> <minimum> <increment> <duration> [boss] [raid]` / `/loot close <auction>` | Run a GP auction (boss/raid show up in loot history) |
| `/import upload <file>` then `/import apply <id>` | Preview then apply an addon export. Entries already imported are skipped; in-game raids fill Discord attendance and list no-shows and walk-ins |
| `/dungeon admin invalidate <run> <reason>` | A run stops counting and its points are taken back (records update by themselves) |
| `/dungeon admin award <amount> <reason> [member | character]` | Give dungeon points by hand; a negative amount takes them away |
| `/dungeon admin audit [member | character | run]` | Point history: what, why, automatic or which officer |
| `/dungeon admin config [rule] [points] [weekly] [dungeon_master]` | See the point rules, change one, the weekly repeat share (e.g. `100,50,0`), or how many dungeons Dungeon Master needs |
| `/dungeon admin target <dungeon> <minutes>` | Target time; beating it earns the underTarget bonus. 0 removes it |
| `/dungeon admin season-start <name>` | End the season (kept) and start a new one |
| `/mod application list` / `view` / `approve` / `reject` / `trial` | Handle applications |
| `/mod warn` / `timeout` / `kick` / `ban` / `history` | Moderation (logged) |
| `/tag set` / `/tag delete` | Manage saved answers |
| `/setup selfroles <title> <role1> [role2..5]` | Post a role button panel |
| `/setup config view` | Show settings |
| `/setup config set <setting> <value>` | Attendance / late / boss-kill EP, auction defaults, decay %, **base GP**, raid reminder minutes, full-clear bonus |
| `/setup config channel` | Where raid started/ended, boss kills, loot awards, EPGP changes, and raid reports are announced |
| `/setup config weekly-report <true\|false>` | Post `/report stats` for the week in the notify channel every 7 days |
| `/bank list [status]` / `/bank handle <id> <Approve\|Fulfilled\|Deny> [reply]` | Guild bank queue (new requests also appear in the log channel) |
| `/setup config welcome [channel] [message] [send_to] [role_prompt] [preview]` | Welcome message: in a channel, by DM, or both; role buttons are picked in `/setup start` step 3. `preview:true` sends it to you |
| `/setup config farewell` | Leave message |
| `/setup config timezone <zone>` | Timezone for typed raid times (also in `/setup start`) |
| `/setup config roles` | Auto-assigned applicant/member roles |
| `/setup config channel` | Where raid signup embeds and raid reminders go |
| `/setup config channel` | Where join/leave/moderation logs go |
| `/setup config wcl-guild [guild] [off]` | Set the guild's Warcraft Logs page link; from then on the bot finds new public reports by itself every 10 minutes (last 3 days), posts each in the raid logs channel, matches it to the raid by time and sends the officer check to the officer log |
| `/setup config channel` | Where raid summaries (raid reports, Warcraft Logs) go; default: the notify channel |
| `/setup config channel` | Where loot awards and EP/GP changes go; default: the notify channel |
| `/setup config channel` | Channel showing each raid core's roster as one live message |
| `/setup config channel` | Private channel (officers and raid leaders only) where the raid readiness board is posted. `/setup start` step 4 can create it with the right permissions |
| `/setup config channel` | Where craft requests are posted so crafters see them; default: the officer log |
| `/setup config channel` | Private channel (officers only) where new `/apply` applications are announced; default: the officer log. `/setup start` step 3 can create it with the right permissions |
| `/setup config channel` | Channel with one auto-updated dungeon leaderboard message (refreshed after every dungeon import) |
| `/setup config channel` | Channel for dungeon signups; setting it posts the pinned group-creation guide automatically. `/setup start status:true` checks the channel and guide; `/dungeon guide` repairs a missing guide |
| `/setup config merit <true\|false>` | Rank the leaderboard by PR x attendance |

**Base GP:** PR = EP / (GP + base GP). With base GP 100, someone with 50 EP
and 0 GP has PR 0.5 instead of an undefined or huge number. The addon uses
the same formula.

**Raid reminders:** signed-up players are pinged in the raid's signup
channel once, `raidReminderMinutes` before start (default 60, 0 = off).

## Getting addon data into Discord

1. In game (officer): `/guilded export`, then `/reload`.
2. Keep the companion running on your PC (`npm run companion:watch`). When the game
   saves, it uploads automatically and prints the `/import apply` line to use.
3. On Discord: `/import apply <id>` with the id the companion printed.

The companion also writes the bot's EPGP standings into the addon folder
every 15 minutes. After a `/reload`, your client shares them with online
guildmates, so everyone gets `/guilded standings` and the Discord numbers in the
EPGP tab.

Readiness from everyone who was online with the addon rides along in your
export, so members don't need to export anything themselves.

## Raid cores

A **raid core** is a named roster (e.g. "Tuesday MC core"); a guild can have several. Core members get **priority at signups for raids created for that core**: when a role is full and a core member signs up, they take the slot of the most recent non-core signup in that role, who moves to the front of the waitlist (and gets a DM). Core members are never bumped, and a raid without a core behaves as before. Signup posts mark core members with a star. Each core's roster is one live message in the roster channel (`/setup config channel` or `/setup start` step 3).

| Command | What it does |
| --- | --- |
| `/core setup` | **Start here.** A guided message: name the core in a form (with an optional raid-nights schedule), pick its tanks, healers and DPS from member menus (main roster or bench/reserve), then choose its rules (same as the guild by default; own point pool, loot council or EP values are buttons). Saved as you go (Raid Leaders) |
| `/core rename <core> <name>` | Rename a core (Raid Leaders). Raids, prices, the roster message and the addon follow |
| `/core edit <core>` | **Easiest way to change a core.** One message: pick how to add (Tank / Healer / DPS, main roster or **bench**), pick the players (players already in the core are moved to that role or spot), pick players to remove, rename. The roster message updates at once (Raid Leaders) |
| `/core create <name> [description] [schedule]` | Create a core with a command instead (Raid Leaders) |
| `/core add <core> <player> [role] [bench]` / `/core remove <core> <player>` | Manage its players (Raid Leaders); role Tank / Healer / DPS; `bench:true` makes them a replacement (shown with a chair, no signup priority) |
| `/core rules <core> [attendance] [late] [boss] [clear] [base_gp] [decay] [loot_mode] [pool] [schedule] [reset]` | The core's point rules, plus its raid-nights schedule. **Every core follows the guild's settings** (`/setup config`, `/setup start`) **unless you change a value here**; with no options it shows the effective rules and which differ. `pool:separate` gives the core its own EP/GP pool (from now on), `loot_mode` can make one core loot council, `schedule` sets or clears the raid-nights text shown on the roster message, `reset` goes back to the guild defaults (schedule and description are untouched by reset) |
| `/core show <core>` / `/core list` | See a roster / all cores (everyone) |
| `/core post [core]` | Refresh the roster message(s) in the roster channel |
| `/core delete <core>` | Delete a core; raids made for it keep their signups |
| `/raid create ... core:<name>` | Create a raid whose signups give that core priority |

### Point pools

By default everyone has **one guild pool** of EP/GP, whatever raid core they raid with. A core can opt into **its own pool** (`/core rules pool:separate`): from then on its raids pay attendance and boss EP into that pool, GP from its loot auctions and `/loot award` is charged to it, and its standings are separate. Use the `core:` option on `/epgp balance`, `history`, `leaderboard`, `award-ep`, `award-gp` and `decay` to work on a pool; without it you get the guild pool (`/epgp balance` also lists your standing in every separate pool). Decay uses the core's own percentage when set. The in-game standings (`/guilded standings`, Standings.lua) show the **guild pool** only. A core that has points in its own pool can't be deleted or switched back to the shared pool.

## Automatic character sync

1. Every addon tells the guild who it is (name, class, race, level, spec, professions) in its normal gear digest, so an officer's upload (the companion) carries everyone who was online.
2. The bot remembers new names as *unclaimed* characters and refreshes the linked ones.
3. A member can pair their own Companion with `/character pair`; its one-time code establishes an account credential, and the uploader's own character is linked on its next upload. The first character becomes the main.
4. Without pairing, a character may still be linked automatically when the Discord name matches (`Ray`, `[GOLD] Ray`, `Ray | Priest`; exactly one member must fit). Anyone left over can use `/character claim` or an officer can use `/character link`.
5. With `/setup config auto-import true`, the guild-wide import (including the shared digest and ledger) is applied right after each upload. Otherwise an officer runs `/import apply`.

The addon's `/guilded character` and `/guilded share` codes still work as a fallback. Linking trusts the Discord name or the person's own pick (small, trusted guild); officers can see and fix links with `/character unclaimed` and `/character link`. Discord does not let a bot see a member's Battle.net connection without a separate login page, and Blizzard has no character list for Forever, so "linked WoW account" cannot be used.

## Fewer things to type

Where a value comes from a fixed list you pick it instead of typing: **class** and **profession** are dropdowns (`/character add`, `/apply`, `/character profession`, `/craft`). These offer suggestions as you type, and anything else still works: **spec** (for the class you chose), **race**, **your characters** (`/character profession set`, `/character attunement`, `/character wishlist`), **attunement names** already in use, **wishlist items** the guild has seen, **tag names**, **raid titles** you used before, **raid times** ("friday 8pm" shows the exact moment it means), **EP/GP reasons**, **auction length**. `/character add` no longer needs the realm (it uses your guild's). `/loot auction` only needs the item: minimum bid, increment and length come from `/setup config` unless you fill them in.

## The craft board

`/setup start` creates **craft-board** as a **forum channel**: every craft request is its own post with tags (🟢 Open / 🟡 Claimed / ✅ Done, plus a profession tag) and buttons inside the post. Nobody types a command:

- **Ask for a craft:** press **Request a craft** on the pinned "Start here" post (a small form: item, profession, how many, details) or use `/craft request`. The post shows who asked, which guild crafters have that profession, and any note.
- **Crafters:** filter the forum by your profession tag, open a post, press **I'll craft it**; **Mark done** when it is made (the requester gets a DM); **Give back** if you cannot.
- **Cancel:** the requester (or an officer) presses **Cancel request**.
- Finished and cancelled posts get their tag, close and lock by themselves. Members cannot post in the forum; only the bot and officers can, so it stays tidy.
- If the craft channel is an ordinary text channel (older setups), requests are announced there as before. To switch to the forum: `/setup config channel disable:true`, then `/setup start` step 3 and "Create them for me".
