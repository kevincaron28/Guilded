# Guild overview panel plan (ROADMAP item 17)

Status: **plan only, 7 November 2026.** Layout proposal first, as the owner asked; nothing is built.

## What other addons show

From CurseForge listings:

- **GuildMasterTools** ([page](https://www.curseforge.com/wow/addons/guild-master-tools-forgedmc)): a guild-wide overview with class distribution and offline visibility, plus a **Guild Professions** tab (who can craft what).
- **GuildWatch** ([page](https://www.curseforge.com/wow/addons/guildwatch)): roster with profession slots and a **Composition** view: class breakdown with online/offline split, profession tier columns, level distribution chart.
- **FOCUS** ([page](https://www.curseforge.com/wow/addons/f-o-c-u-s)): profession directory, member roster, attunement tracking, raid planner with sign-ups, and a 25-man raid composition tool with class counts and buff coverage.
- **Warbanner** ([page](https://www.curseforge.com/wow/addons/warbanner)): class-coloured roster, drag-and-drop groups, role and class breakdown.
- **Guild Functions** ([page](https://www.curseforge.com/wow/addons/guild-functions)): a roster viewer with class, race, level and professions.

Patterns worth copying: class-coloured bars (using `RAID_CLASS_COLORS`), an online/offline split, a level histogram, profession directory searchable by profession and skill, and core rosters grouped by role with buff coverage. Patterns to skip: dense multi-column spreadsheets that do not fit the default UI.

## What Guilded's addon already has

- `db.peerRoster[name]` (Core.lua): per guildmate, from shared readiness digests: level, class, race (via `identity`), professions (`"Alchemy:300,Herbalism:300"`), readiness status, missing count, min durability, flags, `seenAt`. Only members running Guilded appear, so coverage is partial; the page must say "N of M guild members have Guilded".
- The game's own guild roster (`GetNumGuildMembers`, `GetGuildRosterInfo`): name, rank, level, class, zone, online, note. Complete, but no professions.
- `RosterProfessions.lua` (8.5 track C4): parses and sorts profession skills, abbreviations and icons.
- `RosterTools.lua` and `RosterAdmin.lua`: officer roster tools.
- `CorePresentation.lua` / `Core.lua`: raid core (team) data and roles; the bot has `RaidCore` / `RaidCoreMember`, and cores arrive at the addon with standings.
- `Presence.lua`, `GuildMap.lua`: online presence and map pins.
- `GuildSnapshot.lua`, `History.lua`: snapshots and history that can feed "joined this week".

Data we lack in-game: members without Guilded (professions, readiness), class/spec for offline members beyond the roster's class, core membership for non-linked characters.

## Design principles

1. **Native look**: Blizzard frame templates (`InsetFrameTemplate`, `UIPanelButtonTemplate`, `StatusBar` with the standard bar texture), default fonts (`GameFontNormal`, `GameFontHighlight`), 4-8 px spacing, class colours from `RAID_CLASS_COLORS`. No custom skins.
2. **Read-only and cheap**: build from data already in memory; no new messages. Refresh on show, on `GUILD_ROSTER_UPDATE` (throttled) and on a button.
3. **Honest coverage**: every Guilded-only number carries "from members with Guilded".
4. **Fits the Guilded window** (same width as other tabs); scrolls vertically; works at the smallest UI scale.
5. Out of combat only, like other windows.

## Proposed layout

A new **Overview** tab, first in the Guilded window for guild members. Four panels plus a header; each panel clicks through to the existing page (roster, professions, cores).

```
+--------------------------------------------------------------------------+
| Quebec Gold                  238 members   41 online   Guilded: 57 / 238 |
+------------------------------------+-------------------------------------+
| CLASSES (online / total)           | LEVELS                              |
| Warrior   |#########......  31 /52 |  60      |########            22     |
| Paladin   |######.........  18 /34 |  50-59   |#########           27     |
| Hunter    |#####..........  15 /30 |  40-49   |####                12     |
| Rogue     |####...........  12 /26 |  30-39   |###                 9      |
| Priest    |###............  10 /22 |  10-29   |#####               14     |
| Mage      |###............   9 /20 |  <10     |#                   3      |
| Warlock   |##.............   6 /14 |                                     |
| Druid     |##.............   5 /12 |  Active this week: 112              |
| Shaman    |#..............   3 / 9 |  New this week: 6   Left: 2         |
+------------------------------------+-------------------------------------+
| PROFESSIONS (members with Guilded)                      [Open directory] |
| Alchemy 8 (top 300)   Blacksmithing 5   Enchanting 4   Engineering 6      |
| Leatherworking 5      Tailoring 7       Mining 11      Herbalism 9        |
| Cooking 14            First Aid 21      Fishing 6      Skinning 8         |
|  click a profession -> list of members, skill, last seen                  |
+--------------------------------------------------------------------------+
| RAID CORES                                                  [Open cores] |
| Core Alpha  (T 2  H 3  D 5)  Wed/Sun   Ready 9/10   buffs: ok            |
| Core Beta   (T 1  H 2  D 6)  Thu       Ready 6/9    missing: Fort, MotW  |
| Unassigned level 60: 14                                                  |
+--------------------------------------------------------------------------+
| Needs attention:  3 members below 80% durability   5 inactive 30+ days   |
+--------------------------------------------------------------------------+
```

Notes:
- Class rows are `StatusBar`s coloured with the class colour; the label shows online / total. Clicking a class filters the roster tab.
- Levels use the same bar widget; the Forever level cap row is on top.
- Professions: counts from `peerRoster.professions`, "top" = highest skill. Click opens the directory (extending `RosterProfessions`) with a search box.
- Raid cores: names, role counts, readiness from the digests, buff coverage from `RaidBuffCatalog.lua`. Officers see edit shortcuts; members see read-only.
- "Needs attention" is officer-only (inactive members, low durability), off for plain members.

## Variants for the owner to choose

| Option | What | Effort |
| --- | --- | --- |
| **A. Minimal (recommended first)** | Header + classes + levels from the game roster only. No dependence on Guilded coverage; works for everyone. | S, about 2 days |
| **B. Full overview (recommended target)** | A plus professions and cores as above. | M, about 1 week |
| **C. Overview + planning** | B plus raid-comp helper (class counts, buff gaps, "who is missing for 25"). | L, 2 weeks; overlaps existing core planning |

Recommendation: ship **A** as part of a 9.1 addon UX release, then **B** once the profession directory has enough coverage. Leave C to the core tooling.

## Phone and Discord echoes

- Discord `/guild overview` could post the same class and level bars as a card (data from the bot's `Character` rows, which cover linked members only).
- The phone app Guild screen could show the class mix and online count; same caveat on coverage.

## Risks

- Coverage bias (only Guilded users have professions) is the main honesty issue.
- Large guilds: roster loops must be throttled; reuse the existing roster cache.
- Layout must fit the native window at each locale; French strings go in `Locale.lua` with escapes.
- Real-client verification is needed (this cannot be tested by the Lua harness for visuals).

## Sources

- [GuildMasterTools](https://www.curseforge.com/wow/addons/guild-master-tools-forgedmc)
- [GuildWatch](https://www.curseforge.com/wow/addons/guildwatch)
- [FOCUS](https://www.curseforge.com/wow/addons/f-o-c-u-s)
- [Warbanner](https://www.curseforge.com/wow/addons/warbanner)
- [Guild Functions](https://www.curseforge.com/wow/addons/guild-functions)
