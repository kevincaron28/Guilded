# Changelog

## 4.0.0

The biggest release so far: four loot systems chosen per raid core, soft reserves, loot council, recipes and cooldowns, and the guild calendar, on top of the self-running Ready page and attunements.

**Upgrading from 3.x**
- Bot: run `npm run db:update` once (or start with `start-bot.bat`, which does it). Several new tables and columns are added; nothing is removed.
- Bot commands were merged: 17 commands instead of 34 (the list is below). The old top-level names are gone; the guided setup is now `/setup start`.
- Addon: copy the new `Guilded` folder over the old one. Saved data is kept.
- Companion: no change needed, but restart it so it sends the new data (recipes, reserves, calendar) and writes the loot rules.

**Discord bot**
- **Guild calendar sync.** In-game guild events and how each member answered them reach Discord with the companion's export. An event at the same time as a planned raid fills in the signups of players who have not answered on Discord (accepted signs up, tentative is a Maybe) through the normal role caps and waitlist. Declined answers and anyone who already answered on Discord are never changed, and the signup post refreshes. Events with no Discord raid are listed for the officers. No database change.
- **Loot systems per raid core.** Each core now decides how its loot is given out: GP bids, loot council, soft reserves, or the new **EPGP priority** (every item has a set GP price and goes to the highest PR of the players who want it). Pick it in `/core setup` or `/core rules loot_mode`; the guild default is `/setup config loot-mode`. Prices: `/core items` (per core or guild-wide, import from a file) and an **Item prices** form in `/core setup`. `/loot priority` shows who is next for an item, `/loot award` charges the set price when you leave out the GP, and reserves per player are set per core. The addon learns each core's system, prices and own-pool standings from the companion. Needs a database update: run `npm run db:update` once.
- **Who can craft what, and profession cooldowns.** The addon's recipe scan reaches Discord with the companion's export. `/craft who <item>` lists the guild's crafters, `/character profession cooldowns` lists everyone's cooldowns, and `notify: true` sends you a DM when one of yours is ready. Needs new database tables and a column: run `npm run db:update` once.
- **Soft reserves reach Discord.** The list kept in the addon goes up with the companion's export, and `/loot reserves [item]` shows who reserved what (the newest export replaces the old list; a cleared list clears it). Needs the new database tables: run `npm run db:update` once.
- **17 commands instead of 34.** Related commands now sit under one parent: `/setup` (`start`, `config`, `testraid`, `selfroles`), `/character` (also `who`, `profession`, `attunement`, `wishlist`, `readiness`), `/raid wcl`, `/dungeon admin`, `/mod application`, `/import upload` and `/import apply`, and a new `/report` (`stats`, `inactive`, `guild`, `export`, `ping`). The old top-level names are gone; the guided setup is now `/setup start`. Nothing else changed: same options, same permissions, same results.
- **`/character unlink <name>`.** Undoes a link: your own character any time, or (Officers/GM) anyone's. If the addon reports the character again afterwards, it goes back to unclaimed rather than staying linked.
- **Applications: Approve / Trial / Reject buttons.** A new application posts as a card in the applications channel (or the officer log) with the decision as buttons right there — `/application list|view|approve|reject|trial` still work as a fallback. Deciding either way updates the same card and removes the buttons, so it can't be decided twice.
- **Apply button on a core's roster.** Each raid core's live roster message (raid-roster channel) now has an **Apply** button that opens the application form straight to that core, no picker needed.
- **`/setup start`:** channel steps now lead with picking an existing channel over creating one, the "create the missing ones" buttons are safe to click more than once (no more double-created channels from a double-click), and the confusing all-at-once "Create the whole WoW section" button is gone in favor of the per-step one.
- **Legacy DKP is hidden.** It is gone from `/profile` and `/epgp dkp` is no longer offered; the stored data and the addon import are untouched.
- `/setup config channel` replaces the eleven separate `/config ...-channel` commands: pick which channel from a list, then the channel.

**In game**
- **Guild calendar, both ways.** `/guilded calendar sync` (officers; it also runs by itself now and then) reads the guild's calendar events and each member's answer, and the companion sends them to Discord. The new **Calendar** tab lists the upcoming Discord raids (the companion writes them next to the standings) and has buttons to make the in-game events (a real click, which some clients need). `/guilded calendar list` and `create`. It works only if the game client offers the calendar to addons: `/guilded calendar check` tells you, and everything says so plainly when it cannot.
- **`/guilded drop <item>` runs the loot the way the raid core does it.** GP bids, loot council, soft reserves or EPGP priority, chosen per core on Discord. `/guilded core <name>` picks the core you are running (it follows the next raid by itself). **EPGP priority** opens an "I want it / Pass" popup at the item's set price and, when time is up, gives it to the highest PR among those who want it and charges the price. `/guilded reserve open` uses the core's reserves per player.
- **Recipes and cooldowns.** Open a profession window and Guilded reads your recipes, what they need and any cooldown, then shares them with the guild in a few short messages. `/guilded recipes who <item>` says who can craft it, `/guilded recipes mats <item link> [count]` is a shopping list with what you already carry, `/guilded cooldowns` lists profession cooldowns (all transmutes as one line), and item tooltips say who can craft the item.
- **Soft reserves, built into the addon.** No website needed: an officer runs `/guilded reserve open`, everyone reserves with `/guilded reserve [item link]` (or the new Reserves tab), and the list is shared with the guild. Lock it when the raid starts; when an item drops, `/guilded reserve roll [item link]` rolls between only the players who reserved it and `/guilded reserve award <player> [item link]` records the loot and uses up the reserve. Players without the addon whisper `res [item link]` to the officer. Item tooltips say who reserved the item, and the loot council list puts reservers first.
- **Loot council answers.** A new Council tab and `/guilded council start <item>` for loot council guilds: raiders get a popup with BiS, Upgrade, Off-spec and Pass (players without the addon whisper `bis`, `upgrade`, `os` or `pass`). Officers see the answers ranked (BiS, Upgrade, Off-spec, then PR), with what each player wears in that slot and a mark when the item is on their wishlist, and award to whoever the council picks. `/guilded sim council` tries it alone in a test raid.
- **The Ready page now runs by itself.** When anyone starts Blizzard's ready check, every Guilded in the group looks at itself and reports what it carries to the group (flask, food, augment and vantus rune, raid buffs, weapon enchant, durability), spread over a second or two. When the check ends, the leader or officer sees a summary of who has a problem in their chat window. Nothing to press. Guilded also reports again by itself when your flask or food changes, and when you join a group (never in combat, only when something changed).
- **One icon per check** on the Ready page: ready check answer, flask, food, weapon enchant, augment rune, vantus rune, raid buffs, durability and gear. A green tick is there, red is missing, grey is missing but not required, amber is running out, and a question mark means nobody could tell. Hover a row for the full reasons and where they came from. Class-coloured names, and a line for how the latest ready check went.
- **A hidden buff is never "missing".** Buffs are read by spell id and icon, so a French client works as well as an English one, and a player who is out of range, phased, offline or whose buffs the game hides shows a question mark (or comes from their own addon's report), not "no flask".
- **Running out** (flask, food or weapon enchant under 10 minutes), **raid buffs** (only the ones someone in the group can give), **weapon enchant, augment rune and vantus rune** (off by default) and **durability** are checked. Officers choose what counts with `/guilded ready require <flask|food|buffs|weapon|augment|vantus> on|off`, `/guilded ready expiry <minutes>`, `/guilded ready durability <percent>`, `/guilded ready report on|off` and `/guilded ready autopost on|off` (tell the group at the end of a ready check); `/guilded ready settings` shows them.
- Blizzard's own answers are shown too: who said ready, who said not ready (that makes them Not ready), and who never answered.
- Only the player themselves can report themselves, and only through raid or party chat.

- **Attunements track themselves.** Tell your addon once which quest (or reputation) an attunement needs: `/guilded attune track "Hyjal Summit" quest <id>` (or `rep <factionId> <standing>`). From then on it records the attunement by itself when you complete it and tells the guild; no more filling it in. Nothing is built in, because WoW Forever's raids (Barrow Deeps, Hyjal Summit, Onyxia's Lair) differ from the old ones. `/guilded attune tracked`, `untrack` and `auto` (look now) manage it. It only adds, never clears; `/guilded attune` by hand still works. Officers keep what each guildmate reports about themselves.
- **One player, one name.** "Ann" and "Ann Forever" (a name plus a realm written with a space) are now the same person in the group list and everywhere else.

**Credits:** spell ids and the approach follow Ready Check Consumables (MIT); see `docs/CREDITS.md`.

## 3.3.0

**In game**
- **Ready page** in the Guilded window (and `/guilded ready`): everyone in your raid or party, worst first, coloured Ready / Issues / Not ready / No data, with the reason (no flask, no food, missing enchants, empty gear slots, low durability, old data, offline, no addon). It combines what each player's addon shared with a live look at their buffs, and updates by itself while the page is open. It is **for officers and group leaders only** (guild officers, and the leader or an assistant of the current raid or party); other members do not see the page and `/guilded ready` tells them so.
- **Ready check:** "Ask everyone to check" (`/guilded ready ask`) makes every addon in the group look at itself again and answer within seconds; "Post to group chat" tells the group who needs attention. Addons answer a request only when it comes from an officer, the group leader or an assistant, through raid or party chat, never in combat, and at most every 20 seconds.

## 3.2.0

**In game**
- **Guilded chat tab** (optional): `/guilded chat tab` opens a chat tab named Guilded and sends the addon's own lines there (bid results, sync status, command answers), keeping raid chat readable. `/guilded chat off` goes back. Messages to the raid, party and whispers are not affected.
- Item tooltips speak French on a French client.

**Discord bot**

**Français / French**
- `/setup` now starts with a language choice (English / Français). In French the whole setup guide and its checklist are French, and it creates a French server: categories (Guilde, Raids, Donjons, Artisanat, Officiers), channels (`guilded-annonces`, `inscriptions-raid`, `cores-de-raid`, `rapports-raid`, `butin`, `inscriptions-donjon`, `classement-donjons`, `donjons-termines`, `tableau-artisanat`, `journal-officiers`, `preparation-raid`) with French topics, and French permission roles (Maître de guilde, Officier, Chef de raid, Officier DKP, Chef du butin, Chef de classe). Both spellings of a role or channel are recognized, so an existing English server keeps working and can be mixed.
- French for what members see in channels: the raid signup post, the core roster, the craft board (tags, posts, buttons, forms, direct messages), dungeon groups, polls and the Warcraft Logs card, plus the announcements and reminders that were already translated.
- Still English for now: officers' own screens and replies (core wizard and editor, EP proposals, readiness board, most command replies), and the slash command descriptions.

## 3.1.0

**In game**
- **Item tooltips:** an item wanted by someone on the guild's wishlists (or awarded before) shows who wants it, what it usually costs in GP and your own priority (PR and rank). It comes from the bot and is shared with the guild like the standings; turn it off with `/guilded modules off tooltip`.

**Discord bot**

- **Warcraft Logs, automatic:** `/config wcl-guild guild:<page link>` makes the bot find the guild's new public reports itself, post them in the raid logs channel and attach each to the raid it matches by time.
- **Officer check** (`/wcl check`, also sent to the officer log for every new report): players in the log but not credited or the reverse, characters not linked to a Discord member, EP not awarded yet, who came to boss pulls without a flask or food, and deaths. No damage or parse numbers.

## 3.0.2

**In game**
- The game is never reloaded on its own any more. Auto-reload is off for everyone (opt in with `/guilded sync auto on`); officers get a small banner with a Send to Discord button, and logging out also saves.
- `/guilded modules on <module>` now confirms.

**Discord bot**
- Raid signup posts list the players in every role with the count and FULL, mark core members (⭐) and the bench (🪑), and show which core members have not signed up yet.
- New `/core edit`: add or move players, change roles, use a bench of replacements, remove players and rename a core from one message. `/core add` has a `bench` option.
- Fixed the "invalid string length" error on step 3 of `/core setup`.
- Craft board: members can talk inside a request post and press its buttons but not start posts; officers fix an older board with `/craft permissions`.
- The addon-import notice goes to the private officer log.

## 3.0.1

Renamed to **Guilded** (`/guilded`, short `/gd`; the old `/qg` is gone, saved data from the old name is adopted once).

- Me page: the Attunements block no longer overlaps a long gear result; readiness shows as Ready / Partly ready / Not ready.
- Bidding: officers can try it alone inside a test raid (`/guilded sim start`, then `/guilded sim bids`); nothing is sent to chat.
- Bot: no crash when Discord drops a slow command, database keepalive, clearer message when a character is already linked.

## 3.0.0

A big release: everything below since 1.x, polished for the public.

**In game (addon)**
- A new tools window: a sidebar with grouped pages, a **Home** page (what is going
  on, your standing, your gear check, whether your data reached Discord) and
  tooltips. Officers get Raid, EPGP and Loot pages.
- **Send to Discord**: one button (or `/guilded sync`) saves your data; officers'
  addons also do it by themselves at safe moments (out of combat, outside instances).
- **Roll games** (high roll, deathroll, duel). No gold, no wagers, no debts.
- **Mass invite**: `/guilded invite raid` invites everyone signed up for the next raid on Discord;
  `/guilded invite missing` lists who is not in your group.
- **Gear and consumable checks**: missing enchants, flasks, food; a readiness line
  for the whole raid.
- **Backup and restore** of your saved data (`/guilded backup`, `/guilded restore`), separate
  saved data per WoW guild.
- **Auto-invite** by whisper, login digest, read-only API for other addons
  (`GuildedAPI`), `/guilded diag` with slow-handler timings.
- Clear reasons when standings are missing instead of a generic "not linked".

**Discord bot (optional)**
- `/setup` wizard that makes and organises every channel with the right permissions.
- Raid cores with signup priority, per-core point rules and pools, `/core setup`.
- Weekly repeating raids, dungeon groups with temporary voice channels, polls,
  loot council mode, bench credit, Warcraft Logs import.
- Craft board as a forum: one post per request with tags and buttons.
- Automatic character discovery and linking; `/character import` for anyone.
- Dropdowns and suggestions instead of typing.
- Companion desktop app with a tray icon, settings window and activity log.
- Deploy kit for a free Oracle Cloud server.

**Removed**: the casino games and the gold debt ledger; the recruitment posts.

## 2.x and 1.x

See ROADMAP.md, "Progress log".
