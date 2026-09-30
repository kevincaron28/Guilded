# CurseForge copy-paste sheet: Guilded 5.0.0

Each block below is one field. Copy the block, paste it in.

---

## Project name
```
Guilded
```

## Summary (one line)
```
Raid attendance, EPGP, four loot systems, soft reserves, recipes, guild calendar, gear checks and roll games for WoW Forever guilds, with an optional Discord bot.
```

## Category
Raid & Instance (secondary: Guild, Miscellaneous)

## Logo
`docs/branding/guilded-logo-400.png` (400x400). Full size: `docs/branding/guilded-logo.png`.

## File to upload
`dist/Guilded-v5.0.0.zip` (top folder inside is `Guilded`). Release type: **Beta** for the first day, then **Release**.
Game versions: the WoW Forever / Classic entries closest to interface 16001 and 20506.

## License
Select **Custom License**, name it:
```
PolyForm Noncommercial 1.0.0
```
Then paste the full text of the `LICENSE` file in the project root (the first line is the
Required Notice, the rest is the official text). Optional link:
https://polyformproject.org/licenses/noncommercial/1.0.0

## Description (Markdown)
```markdown
# Guilded: the raid toolkit for WoW Forever guilds

Everything an officer needs to run a raid, inside the game, with no setup. Add the
free Discord bot when you want signups and reports outside the game too.

## In game
- **Raid tools:** start and end a raid, attendance with bench credit, boss kills, notes.
- **EPGP and loot:** award EP and GP, standings with priority (PR), and **four loot systems**
  you choose per raid core: GP bidding, loot council (BiS / upgrade / off-spec answers),
  soft reserves (reservers roll, with an SR+ bonus for reserves that went unwon) and EPGP
  priority (every item has a set GP price and goes to the highest PR of the players who want it;
  off-spec answers pay a share). One command, `/guilded drop <item>`, runs the
  right one. Raiders get a popup; whispers work for people without the addon.
- **Soft reserves** built in, with no website: reserve with an item link, the list is shared
  with the guild and shows on item tooltips.
- **Recipes and cooldowns:** open your professions once and the guild can ask who can craft
  what (`/guilded recipes who <item>`), see transmute and other cooldowns, and make a materials
  shopping list.
- **Guild calendar, both ways with Discord:** in-game event answers fill in Discord raid
  signups, and your Discord raids become in-game events with one click (if the game client
  offers the calendar to addons).
- **Ready page** (officers and raid leaders): see at a glance who in your raid is ready and who is not, and why (flask, food, enchants, gear, durability), with a one-click ready check.
- **Gear check before the raid:** empty slots, missing enchants, flasks, food and
  attunements, with a one-line readiness status for every raider.
- **Roll games:** high roll, deathroll, 1v1 duels, with a button that explains each game in chat. No gold, no wagers, no debts.
- **Guild map:** see guildmates on your world map and minimap.
- **Dungeon scores:** a score per player from recorded runs, on tooltips and the Scores page. No Discord needed.
- **Raid tools for leaders:** raid target icons, mark the tanks, world markers and boss plans shown on every
  raider's screen.
- **Mass invite:** `/guilded invite raid` invites everyone who signed up on Discord.
- **A friendly window:** click the gold coin on the minimap. The Home page shows your
  standing, what is going on, and whether your data reached Discord.
- **Item tooltips:** who wishlisted an item, what it usually costs in GP and your priority, right on the tooltip.
- **A Guilded chat tab** (optional) keeps the addon's messages out of raid chat.
- **Safe by design:** backups, per-guild saved data, French translation, and every
  module can be switched off.

## Optional Discord bot (self-hosted, free)
Signups with roles and waitlist, raid cores with their own loot system and item prices,
weekly raids, soft reserves and who-can-craft-what in Discord, calendar sync, dungeon
challenge and leaderboard, craft board, readiness board, polls, Warcraft Logs and
weekly reports. A small Windows companion app (tray icon) uploads your data after
each `/reload`.

## Getting started
1. Install and log in. Type `/guilded` (or `/gd`) for the command list, or click the coin.
2. Officers: open the Raid page and start a raid.
3. Want Discord? Follow the bot guide on the project page.

## Good to know
Made for WoW Forever (interface 16001 and 20506). Free for noncommercial use under the
PolyForm Noncommercial license. Not affiliated with or endorsed by Blizzard Entertainment.
```

## Changelog (paste for the file upload)
```markdown
## 5.0.0

**New in 5.0**
- **Guild map:** guildmates as dots on your world map and minimap (never shared in instances or combat).
- **Dungeon scores:** a Raider.IO-style score from the dungeon runs Guilded records, on player tooltips.
- **Raid tools:** raid target icons, mark the tanks, world marker buttons, and boss plans on every raider's screen.
- **Deduct GP**, **explain the roll games in chat**, and **standings without the bot** (an officer shares their ledger).
- Discord bot (optional): each raid core's channels are made and archived by themselves, group alerts matched to your level and roles, and an answer channel with officer-written answers (optional free AI answers).

## 4.6.0

**New in 4.6**
- **Off-spec** answers in EPGP priority (they pay a share of the price, 50% by default) and a **minimum EP** per raid core.
- **Officer votes** on the loot council, **SR+** soft reserves (+10 per week a reserve goes unwon).
- **Drops noted by themselves** on the Loot page with a Drop button, and **trade reminders** for the 2-hour window.
- **GP price suggestion** from the item level and slot.
- **Tools window:** Test tools, a Crafting page, Export and send, remembered position and size, a key binding, French on every page.
- Discord bot (optional): a role and channels per raid core, a group finder for every kind of group, a weekly report with dungeons and players of the week, and a setup checklist that checks every bot message.

## 4.5.0

**New in 4.5**
- **Send to Discord works again** on newer clients (it is now the game's own secure button running /reload).
- **Prices at the drop:** `/guilded drop` asks for a GP price when an item has none; `/guilded price <item> <GP>` sets one. They reach Discord with the next upload.
- **Recipes fill in by themselves:** opening a guildmate's profession saves their recipes under their name; a one-time reminder for professions never read.
- **Safer loot:** whispered bids and answers only count from your raid or party; open bidding and loot council survive a /reload.
- **Options page** (Esc > Options > AddOns > Guilded) and an **Addon Compartment** entry.
- Many fixes: paced addon messages (nothing lost in big raids), reserve lists arrive whole, tooltips on comparison items, pugs no longer counted as guild members.

## 4.0.0

**Loot, crafting and the calendar**
- **Loot systems per raid core:** GP bids, loot council, soft reserves or EPGP priority (set item prices, the highest PR of those who want it wins). Chosen per core on Discord; `/guilded drop <item link>` runs the right one, and `/guilded core <name>` picks the core you are running.
- **Loot council:** a popup with BiS, Upgrade, Off-spec and Pass (whispers work too); officers see the answers ranked, with what each player wears in that slot, and award.
- **Soft reserves:** `/guilded reserve open`, then everyone reserves with an item link (or the Reserves tab). Lock it, roll between the reservers, award. Item tooltips say who reserved the item.
- **Recipes and cooldowns:** open each profession window once. `/guilded recipes who <item>`, `/guilded recipes mats <item link>` (a shopping list), `/guilded cooldowns`; tooltips say who can craft an item.
- **Guild calendar:** `/guilded calendar sync` reads guild events and answers for Discord; the Calendar tab makes in-game events from your Discord raids. Works only if the game client offers the calendar to addons (`/guilded calendar check`).
- **Ready page runs by itself:** when anyone starts the ready check, every Guilded in the group reports flask, food, augment and vantus rune, raid buffs, weapon enchant and durability; one icon per check.
- **Attunements track themselves:** tell it once which quest an attunement needs (`/guilded attune track`).

**Discord bot (self-hosted)**
- Commands merged into 17 parents (`/setup`, `/character`, `/raid`, `/core`, `/loot`, `/craft`, `/report` and more).
- Per-core loot systems and item prices (`/core items`, `/loot priority`), `/loot reserves`, `/craft who`, `/character profession cooldowns`, calendar sync into raid signups. Run `npm run db:update` once when upgrading.
- Applications get Approve / Trial / Reject buttons right on the officer card, and a core's roster message has its own Apply button. `/character unlink` undoes a character link. `/setup start`'s channel steps are safe against a double-click.

Credits: spell ids and the approach of the Ready page follow Ready Check Consumables (MIT).

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
- `/setup start` now starts with a language choice (English / Français). In French the whole setup guide and its checklist are French, and it creates a French server: categories (Guilde, Raids, Donjons, Artisanat, Officiers), channels (`guilded-annonces`, `inscriptions-raid`, `cores-de-raid`, `rapports-raid`, `butin`, `inscriptions-donjon`, `classement-donjons`, `donjons-termines`, `tableau-artisanat`, `journal-officiers`, `preparation-raid`) with French topics, and French permission roles (Maître de guilde, Officier, Chef de raid, Officier DKP, Chef du butin, Chef de classe). Both spellings of a role or channel are recognized, so an existing English server keeps working and can be mixed.
- French for what members see in channels: the raid signup post, the core roster, the craft board (tags, posts, buttons, forms, direct messages), dungeon groups, polls and the Warcraft Logs card, plus the announcements and reminders that were already translated.
- Still English for now: officers' own screens and replies (core wizard and editor, EP proposals, readiness board, most command replies), and the slash command descriptions.

## 3.1.0

**In game**
- **Item tooltips:** an item wanted by someone on the guild's wishlists (or awarded before) shows who wants it, what it usually costs in GP and your own priority (PR and rank). It comes from the bot and is shared with the guild like the standings; turn it off with `/guilded modules off tooltip`.

**Discord bot**

- **Warcraft Logs, automatic:** `/setup config wcl-guild guild:<page link>` makes the bot find the guild's new public reports itself, post them in the raid logs channel and attach each to the raid it matches by time.
- **Officer check** (`/raid wcl check`, also sent to the officer log for every new report): players in the log but not credited or the reverse, characters not linked to a Discord member, EP not awarded yet, who came to boss pulls without a flask or food, and deaths. No damage or parse numbers.

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
```
