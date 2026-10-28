> **28 October current listing source:** use [Guilded](curseforge/GUILDED_DESCRIPTION.md)
> and [Guilded Dungeons](curseforge/DUNGEONS_DESCRIPTION.md) for the 8.0.2 listings.
> The 7.3.2 draft below is historical and must not replace the current public text.
>
> **25 October release decision:** the owner explicitly authorized publication before
> the unavailable game/two-PC tests. Earlier hold instructions below are superseded.
> Tests remain pending follow-up, not passes; targets remain provisional. See
> [release decision](RELEASE_DECISION_2026-10-25.md) and [current notes](V7_3_2_RELEASE_NOTES.md).

# CurseForge listing copy: prepared for Guilded 7.3.2

Prepared 24 October 2026. **Public release is held until game/two-PC acceptance passes.**
This is draft copy, not a claim that 7.3.2 is publicly available. The existing listing led
with an approval gate that does not apply to the addon or to Guilded Lite.
Each block below is one field: copy the block, paste it in. Publishing steps:
[RELEASE_CURSEFORGE.md](RELEASE_CURSEFORGE.md). Older 6.x listing text is in git history.

---

## Project name
```
Guilded
```

## Summary (one line)
```
Free guild tools for WoW Forever: EP/GP and four loot systems, attendance, crafters, and dungeon seasons with public leaderboards. Works in game without Discord.
```

## Category
Raid & Instance (secondary: Guild, Miscellaneous)

## Logo
`docs/branding/guilded-logo-400.png` (400x400). Full size: `docs/branding/guilded-logo.png`.

## Game version and files
Game version **1.60.1 (Forever)**; the addon declares interfaces 16001 and 20506. Do not claim
untested client compatibility. If the live client reports a newer interface number on 4 November,
upload a re-tagged file the same day. Add **Guilded Dungeons** under Relations as an optional
companion project, and Guilded under Guilded Dungeons' relations.

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
# Guilded — guild tools and dungeon seasons for WoW Forever

**Free. Works entirely in game. Discord and the website are optional.**

See the file list for the current release and verified client version. English and French.

* **No setup to start.** Install, click the gold coin on your minimap, done. Officers share EP/GP with each other in game; no Discord, website or account needed.
* **Dungeon Season 1 is scheduled for launch**, 4 November 2026 at 3 PM Pacific: eligible runs on verified routes earn scores on Raider.IO-style [public leaderboards](https://guilded.kcaron.top/leaderboards/). Targets are provisional; missing routes remain unrated.
* **Nothing behind a payment.** Every feature is free; tips only help pay for hosting.

***

## Dungeon runs and seasons

* Runs are recorded automatically: total time, boss times and a short result card when you leave the dungeon.
* Scores by level bracket on your tooltip and the dungeon finder's Guilded tab, with weekly and monthly boards (the week follows Tuesday's weekly reset).
* Public [leaderboards](https://guilded.kcaron.top/leaderboards/) with character pages, guild rankings and runs confirmed by their party. Uploading needs the free companion (Sign in with Discord, nothing to type).
* Only want dungeons? **[Guilded Dungeons](https://www.curseforge.com/wow/addons/guilded-dungeons)** is the standalone tracker, no guild needed. Both addons together count each run once.

## Raid nights and loot (Forever raids open 9 December)

* **Raid journal:** attendance, bench credit, boss kills and notes that survive reloads and disconnects.
* **Readiness:** gear, enchants, durability and consumables; level-aware raid reports; attunement tracking with Barrow Deeps, Hyjal Summit and Onyxia's Lair presets.
* **Four loot systems, per raid core:** GP bidding, loot council, soft reserves (with SR+) and EPGP priority. Start with `/guilded drop <item>`; players without the addon answer by whisper.
* **EP/GP:** awards, priority standings and a full ledger (decay with the Discord bot). Officers publish standings in game; reserves and prices show on item tooltips.

## Guild life

* **Crafters:** recipes and cooldowns shared automatically; `/guilded recipes who <item>` finds who can make it.
* **Guild map:** guildmates on your map and minimap, with a privacy switch.
* **Copy for Excel:** `/guilded sheet` copies standings, loot, attendance, raids or dungeons to paste into a spreadsheet.
* One window with a Home page, a Guilded chat tab, modules you can switch off, and backup, restore and undo per guild.

## Optional: Discord bot and website

* **Hosted Discord bot:** [add it](https://discord.com/oauth2/authorize?client_id=1552633893587394590&scope=bot+applications.commands&integration_type=0&permissions=2269718703631440) and run `/setup start`. Guilded Lite (setup, help, bug reports, dungeon groups, basic signups) works right away; approval unlocks addon sync, EP/GP, seasons and the guild page. Approval can be automatic when the host enables it and the server meets its activity requirements. You can also host your own.
* Raid signups with roles, waitlist and cores; standings, wishlists, polls, Warcraft Logs and weekly reports in Discord.
* **Website:** a [recruitment board](https://guilded.kcaron.top/recruitment/) with applications that arrive in Discord, open raid spots from other guilds, and public [player profiles](https://guilded.kcaron.top/players/).
* **Companion** (browser, or Windows for automatic sync): Sign in with Discord, Sync now, and Export to spreadsheet.

***

## Getting started

1. Install with the CurseForge app, or extract the **Guilded** folder into `Interface/AddOns` of the Forever client you launch.
2. Log in and click the **gold minimap coin**, or type `/guilded` (`/gd`).
3. Optional: [the companion](https://guilded.kcaron.top/companion/) and [the Discord bot](https://guilded.kcaron.top/docs/HOSTED_PILOT/).

[Install guide](https://guilded.kcaron.top/docs/MEMBER_INSTALL/) · [Features](https://guilded.kcaron.top/features/) · [Website](https://guilded.kcaron.top/)

## Compatibility

Designed for **WoW Forever** (interface 16001). Shared features need guildmates running Guilded. Back up your SavedVariables before upgrading. Raid markers and boss plans are not included; they are coming in Pullscript, a separate addon now in beta.

Free for noncommercial use under the **PolyForm Noncommercial 1.0.0** license. Not affiliated with or endorsed by Blizzard Entertainment.

## Support

Guilded is an independent project by [KCaron](https://kcaron.top/). If it helps your guild, [buy me a coffee on Ko-fi](https://ko-fi.com/wowguilded). Tips never buy approval, priority or features.

**Français :** Guilded est gratuit et fonctionne entièrement en jeu, sans Discord. La saison 1 des donjons commence au lancement, le 4 novembre 2026 à 15 h (heure du Pacifique), avec des [classements publics](https://guilded.kcaron.top/leaderboards/?lang=fr). Le bot Discord hébergé fonctionne tout de suite en mode Guilded Lite; l'approbation de KCaron débloque le reste. Interface en français incluse.
```

## Candidate changelog (publish only after acceptance)
```markdown
## 7.3.2

- Dungeon scores show recorded roles, best-N improvement scenarios and season history. Guilded Dungeons receives its own personal public-score snapshot.
- Stronger run confirmation and completion evidence; missing routes remain unrated and calibration requires representative real runs.
- Companion detects a newer live game folder, shows the watched path and last upload, and fixes installed-app startup.
- Clearer English/French installation, Discord sign-in and officer-assisted character-linking instructions.
- Bot UTC timestamp handling and safer staged update/recovery. Old offline runs cannot recreate deliberately reset history when the host sets its reset boundary.

Back up your SavedVariables before upgrading. Use matching addon and companion versions. Full notes: https://github.com/kevincaron28/Guilded/releases/latest
```

## Guilded Dungeons summary (one line, its own project)
```
Dungeon timer, run results and scores for WoW Forever, with public leaderboards. No guild needed.
```
