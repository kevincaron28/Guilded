# CurseForge copy-paste sheet: Guilded 6.0.0 Beta

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
`dist/Guilded-v6.0.0.zip` (top folder inside is `Guilded`). Display name: **Guilded 6.0.0 Beta**. Release type: **Beta**. Keep it Beta until the remaining acceptance checks pass.
Game versions: retain the project's existing verified Forever-compatible selection. The addon declares interfaces 16001 and 20506; do not claim untested client compatibility.

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

Guild attendance, loot and shared guild information inside the game. The Discord bot and companion are optional.

## In game
- **Raid tracking:** start and end a raid, attendance with bench credit, boss kills, notes.
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
1. Extract Guilded into your actual client's `Interface/AddOns`, log in, and click the gold coin. The ZIP includes `INSTALL.md`.
2. Addon-only users can start playing. For Discord sync, members install the matching companion and use their own guild's bot address and personal pairing code.
3. Guild owners: follow the [quick setup checklist](https://github.com/kevincaron28/Guilded/blob/main/docs/QUICK_START.md) and [owner guide](https://github.com/kevincaron28/Guilded/blob/main/docs/GUILD_OWNER_SETUP.md). The bot requires your own hosting and database; these are not bundled with the addon.

## Beta status
6.0.0 is for testing. Fresh guild setup, clean installation/recovery, concurrent awards and a full raid still need acceptance. Raid markers and boss plans are no longer included. Back up saved data before upgrading.

## Good to know
Made for WoW Forever (interface 16001 and 20506). Free for noncommercial use under the
PolyForm Noncommercial license. Not affiliated with or endorsed by Blizzard Entertainment.
```

## Changelog (paste for the file upload)
```markdown
## 6.0.0 Beta — 4 October 2026

This is a testing beta, not a stable release. Back up SavedVariables before upgrading.

- Loot responses show pending/confirmed feedback for raiders and visible responses for officers.
- Includes the tested off-spec pricing, GP import/reversal, personal pairing and standings workflows from the 5.0 beta stabilization work.
- Removes Raid tools entirely: target/floor markers, tank marking and boss plans will be developed later as an optional standalone addon. Saved plans and settings are preserved.
- Includes guild map diagnostics, automatic recipe sharing, and clearer member/owner setup guides.
- Bot, addon and companion source versions are aligned at 6.0.0; synchronization protocol remains 2.
- 5 October setup follow-up: fixes blank optional bot configuration fields, adds an offline owner setup check, refreshes the independent hosting/quick-start guides, and includes installation instructions in the addon ZIP. A clean local rehearsal is documented; live fresh-guild acceptance remains pending.

Remaining live acceptance includes fresh Alliance guild setup, Windows clean install/upgrade and recovery on a non-developer PC, competing/consecutive awards, concurrent officer uploads, permission revocation and a full real raid. Calendar and other game APIs depend on client support. Do not treat these pending checks as passes.

Install the complete Guilded folder, including Guilded.toc. Do not delete your saved data. For addon-only testing, keep WoW companion syncing paused. Discord integration needs the guild owner's configured bot and personal pairing; no database or Discord reset is part of this beta package.
```
