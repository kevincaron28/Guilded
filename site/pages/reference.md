<p class="eyebrow">QUICK REFERENCE</p>

# Every Guilded command, on one page.

Short tables, nothing to read twice. **Everyone** can use a row marked so; **Officers** need the
Officer or Guild Master role; **Raid Leaders** need the Raid Leader role; **Admin** means a server
admin. Discord hides officer commands from members. New here? [Start here](/start/).

**Jump to:** [Discord bot](#discord-bot) · [WoW addon](#wow-addon) · [Windows companion](#windows-companion)

## Discord bot

Type `/` in Discord and pick the command. Each row is one command; the words after it are its
sub-commands.

### Members

| Command | What it does | Who |
| --- | --- | --- |
| `/help` | Lists the commands you can use | Everyone |
| `/character` `pair` `add` `import` `claim` `unlink` `list` | Link your main and alts to your Discord account | Everyone |
| `/character` `profile` `achievements` `who` | Your profile and achievements card; look up any player | Everyone |
| `/character` `profession` `attunement` `wishlist` `readiness` | Professions, attunements, item wishlist and your raid readiness | Everyone |
| `/epgp` `balance` `history` `leaderboard` | Your EP, GP and priority; the guild board | Everyone |
| `/loot` `bid` `history` `reserves` | Bid on an auction; loot history; soft reserves | Everyone |
| `/craft` `request` `list` `who` `mine` `claim` `done` `release` `cancel` | Ask crafters for an item, or pick up requests | Everyone |
| `/bank` `request` `mine` `cancel` | Ask the guild bank for an item | Everyone |
| `/apply` | Apply to a raid core | Everyone |
| `/tag` `show` `list` | Post a saved text (raid rules, consumables) | Everyone |
| `/community` `hub` `seasons` `leaderboard` `wallet` `dice` `badges` `honors` | Activity points, seasons, badges and hall of fame | Everyone |
| `/community` `lottery` `gaming` `challenge` | Join lotteries, gaming nights and challenges | Everyone |
| `/participation` `status` `nominate` `history` | Your Discord participation; recognise a helper | Everyone |
| `/report` `bug` `ping` `stats` | Send a private bug report; check the bot is up; guild activity | Everyone |
| `/automation` `recap` | Weekly recap by private message (off by default) | Everyone |
| `/wow` `list` `use` | Choose which in-game guild your commands use | Everyone |
| `/poe` `pair` `status` `runs` `summary` | Path of Exile 2 mapping journal | Everyone | <!--poe-->

### Raids

| Command | What it does | Who |
| --- | --- | --- |
| `/raid` `signup` `cancel-signup` `status` `roster` | Sign up for a raid; see who is coming | Everyone |
| `/raid` `progress` `report` | Boss progression; the summary of a finished raid | Everyone |
| `/raid wcl` `list` | Recent Warcraft Logs reports pulled in | Everyone |
| `/raid` `worldbuff` `worldbuffs` `worldbuff-remove` | Announce and list world-buff drops | Everyone |
| `/lead` `create` `edit` `cancel` `start` `end` | Create and run a raid | Raid Leaders |
| `/lead` `attendance` `attendance-voice` `boss` `note` `award-ep` `fill` | Attendance, boss kills, notes, EP for a raid, fill open spots | Raid Leaders |
| `/lead` `season` `history` `wcl-report` | Attendance seasons and history; pull a Warcraft Logs report | Raid Leaders |
| `/lead` `readiness-member` `readiness-raid` | Who is ready for the raid | Raid Leaders |
| `/core` `show` `list` | See raid cores and their rosters | Everyone |
| `/core` `setup` `edit` `create` `add` `character` `remove` `rules` `items` `post` `rename` `delete` | Build and run raid cores (rosters, bench, point rules, item prices) | Raid Leaders |
| `/team` `show` `list` `sessions` `view` `respond` | Weekly dungeon and PvP cores: roster, sessions, your answer | Everyone |
| `/team` `create` `member` `schedule` `session` `attendance` `lineup` `archive` | Run a weekly core | Team leaders |
| `/bg` `panel` `join` `leave` `mine` `upcoming` `view` `history` `privacy` | Battleground groups and your own private reports | Everyone |
| `/bg` `create` `manage` `setup` | Plan and manage battleground sessions | Leaders |

### PUG board

| Command | What it does | Who |
| --- | --- | --- |
| `/raid pug browse` | See other guilds' open raids | Everyone |
| `/raid pug share` `board` | Share one raid publicly; pick the channel for other guilds' raids | Officers |
| `/raid pugs ask` `close` `status` | Ask other guilds for PUGs; close the request | Officers |
| `/raid pugs join` `leave` `unblock` | Join or leave the opt-in board; unblock a guild | Officers |

### Dungeons

| Command | What it does | Who |
| --- | --- | --- |
| `/dungeon` `leaderboard` `season` `records` `player` `history` | Season rating, fastest clears, a player's runs | Everyone |
| `/dungeon` `archive` `hall-of-fame` `rules` `catalog` `keystones` `together` | Past seasons, scoring rules, dungeon list, this week's team goal | Everyone |
| `/dungeon` `group` `alerts` `watch` | Form a group with a voice channel; get pinged for groups that fit you | Everyone |
| `/officer dungeon` `invalidate` `award` `audit` `config` | Correct a run, adjust guild points, read the point history | Officers |
| `/organize dungeon-seasons preview` | See the current and next dungeon seasons | Organizers |

### Officers and setup

| Command | What it does | Who |
| --- | --- | --- |
| `/setup` `start` | Guided setup: language, roles, channels. Safe to rerun | Admin |
| `/setup` `system` `testraid` `selfroles` | Sync status and retries; fake test raid; role buttons | Officers |
| `/setup` `reset` `uninstall` | Erase Guilded's channels and data | Admin |
| `/config` `view` `set` `welcome` `farewell` `roles` `channel` `timezone` `weekly-report` … | Server settings: welcome, roles, time zone, reports, loot mode, auto-import | Officers |
| `/officer epgp` `award-ep` `award-gp` `decay` `reverse` | Give, decay or undo EP and GP | Officers |
| `/officer loot` `auction` `award` `close` `priority` | Run loot auctions and awards | Officers |
| `/officer character` `unclaimed` `link` `autolink` | Link reported characters to Discord members | Officers |
| `/officer export` | Download standings, EPGP, loot, attendance or roster as CSV | Officers |
| `/import` `upload` `apply` `held` | Preview and apply addon data | Officers |
| `/mod` `warn` `timeout` `kick` `ban` `history` | Moderation | Officers |
| `/mod` `application` `dni` | Review applications; do-not-invite list | Officers |
| `/mod` `faq` | The answer channel: write answers the bot replies with | Officers |
| `/mod` `page` `recruit` `leaderboard` `rankroles` | Public guild page, recruitment listing, public leaderboards, rank roles | Officers |
| `/report` `inactive` `guild` | Inactive members; guild health | Officers |
| `/organize` | Community seasons, quizzes, honors, lotteries, gaming nights, challenges | Organizers |
| `/poll` `create` `close` `weekly` | Polls and the weekly question | Officers |
| `/events` `board` `reminders` `disable` `status` `refresh` | Upcoming Events board and opt-in reminders | Officers |
| `/participation` `settings` `channels` `claims` `review` `reverse` | Participation settings, nominations and awards | Officers |
| `/wow` `add` `channel` `roles` | Add an in-game guild; bind a channel; set its roles | Officers |
| `/poe setup` | Turn PoE2 tracking on or off | Officers |
| `/automation` `question` `vacancies` | Automatic weekly question and dungeon-group matches | Officers |
| `/tag` `set` `delete` | Create or remove saved texts | Officers |
| `/craft permissions` · `/bank` `list` `handle` | Craft board permissions; handle bank requests | Officers |

### Owner

| Command | What it does | Who |
| --- | --- | --- |
| `/guilded-season` `status` `next` `rules` `cancel` | Schedule the shared dungeon season and its rules | Owner |
| `/guilded-console` `setup` `refresh` | The owner's private fleet board | Owner |

Both owner commands exist only in the bot owner's own server.

## WoW addon

Type `/guilded` (or `/gd`) in game. A bare `/guilded` opens the window; `/guilded help` lists
everything. Officer rows need the officer rank in your WoW guild.

### Everyday

| Command | What it does | Who |
| --- | --- | --- |
| `/guilded` | Open the Guilded window | Everyone |
| `/guilded help` | List every command you can use | Everyone |
| `/guilded standings [player]` | Standings, or one player's | Everyone |
| `/guilded history [player]` | Your EP/GP and loot history | Everyone |
| `/guilded share` | One paste with your character, gear check and attunements (Discord: `/character import`) | Everyone |
| `/guilded character` | A line to link this character in Discord | Everyone |
| `/guilded verify <code>` | Link all your characters to Discord at once (Discord: `/character pair`) | Everyone |
| `/guilded sync` | How to send your data to Discord now | Everyone |
| `/guilded attune <key>` | Mark your own attunement | Everyone |
| `/guilded inspect` · `enchants` · `slots` | Gear check; missing-enchant and empty-slot rules | Everyone |
| `/guilded score [player\|top]` | Dungeon scores from recorded runs | Everyone |
| `/guilded pug` | Browse open raids and copy the host's Discord link | Everyone |
| `/guilded reserve <item>` | Soft reserve an item | Everyone |
| `/guilded recipes who <item>` · `cooldowns` | Who can craft it; profession cooldowns | Everyone |
| `/guilded calendar` | The guild calendar, shared with Discord | Everyone |
| `/guilded sheet standings\|loot\|attendance\|raids\|dungeons` | Copy a table to paste into a spreadsheet | Everyone |
| `/guilded peers` · `diag` · `version` | Who runs which addon version; diagnostics | Everyone |

### Optional parts and settings

| Command | What it does | Who |
| --- | --- | --- |
| `/guilded modules` | Turn optional parts on or off (officers can do it for the whole guild) | Everyone |
| `/guilded options` | Guilded's page in the game's options | Everyone |
| `/guilded setup` | Choose in-game only or the optional Discord connection | Everyone |
| `/guilded minimap show\|hide\|reset` | The minimap button | Everyone |
| `/guilded chat tab\|off` · `chattags on\|off` | Own chat tab; show an alt's main name | Everyone |
| `/guilded digest` · `map` · `gbank` · `guildlog` | Changes since last login; guildmates on the map; guild bank; guild log | Everyone |
| `/guilded dungeon status\|results\|start\|complete\|abandon\|check` | Record and check dungeon runs | Everyone |
| `/guilded bgcapture` | Status of your own battleground result capture (always on where supported) | Everyone |
| `/guilded pugcheck on\|off\|now\|last` | Item level and enchants of non-guild group members | Everyone |
| `/guilded backup` · `restore` | Copy this guild's saved data as one code, or put it back | Everyone |
| `/guilded perf` | Record how long Guilded's work takes | Everyone |

### Officers and raid leaders

| Command | What it does | Who |
| --- | --- | --- |
| `/guilded start [title]` · `end` · `summary` | Start and end a raid; copy what it recorded | Officers |
| `/guilded attendance <name>\|group\|seen` · `boss <name>` · `note <text>` | Attendance, boss kills, notes | Officers |
| `/guilded award` · `gp` · `deduct` · `gpdeduct` · `void` · `undo` | Give or take EP and GP; take back the last entry | Officers |
| `/guilded loot <name> <item> [cost]` | Record loot | Officers |
| `/guilded drop <item link>` · `drops` · `price <item> <GP>` | Start an item by the core's loot rule; list drops; set a GP price | Officers |
| `/guilded bid` · `council` · `lootroll` | GP bidding; loot council; soft-reserve rolls | Officers |
| `/guilded core [name]` · `core roster` | Pick the raid core; who of the core is in your group | Officers (roster: Everyone) |
| `/guilded localcore` · `setup guild` | Raid cores and loot rules with no Discord | Officers |
| `/guilded ready` · `consumes` | Who in your group is ready; who is missing flask or food | Officers and group leaders |
| `/guilded export` · `import softres\|tmb\|history` | Export data; import soft reserves, TMB or loot history | Officers |
| `/guilded invite raid\|missing` · `autoinvite` | Invite the signed-up raiders; invite whisperers | Officers |
| `/guilded recruit` · `welcome` | Prospect list; whisper new guild members | Officers |
| `/guilded officer list\|add\|remove\|rank` | Who counts as an officer | Officers |
| `/guilded ledgersync` · `bridge` · `rosteradmin` · `sim` | Share EP/GP between officers; companion bridge; roster tools; test raid | Officers |

### Main window tabs

| Tab | What it shows | Who |
| --- | --- | --- |
| Home · My character · Open raids | What is going on, your gear check, raids with room for you | Everyone |
| Standings · Crafting · Availability | Guild standings, recipes, who is online | Everyone |
| Ready · Reserves · Loot · Council | Raid-night checks, soft reserves, bids and council answers | Leaders / Everyone / Officers |
| Raid · Administration · Gear | Run a raid, award EP/GP, item level per member | Officers |
| Calendar · Local guild · Roster admin · Officer tools | Guild calendar, no-Discord setup, roster tools, log and imports | Officers |
| Settings | Switch parts on or off, diagnostics | Everyone |

### Companion addons

| Command | What it does | Who |
| --- | --- | --- |
| `/gdungeons` (`/gdg`) | The separate Guilded Dungeons addon: status, results, score panel | Everyone |
| `/ggames` | The separate Guilded Games addon: party games, host only | Everyone |

## Windows companion

A small free Windows app. It is optional for the addon and needed for Discord and website
features. Full steps: [Companion app](https://github.com/kevincaron28/Guilded/releases/latest/download/Guilded.Companion.Setup.exe).

| What | Detail |
| --- | --- |
| What it does | Sends your addon's saved data to Discord and the website, and brings standings back into the game |
| Where to get it | [Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) (recommended, updates itself) or [GitHub](https://github.com/kevincaron28/Guilded/releases/latest) (unsigned fallback) |
| Platform | Windows only. No Mac, Linux or browser version |
| First run | Choose **Sign in with Discord**, pick your server (or public leaderboards only), choose your saved data |
| After playing | `/reload` in WoW and the companion syncs |
| Who should run it | Every member who wants Discord features; at least one officer per guild |
