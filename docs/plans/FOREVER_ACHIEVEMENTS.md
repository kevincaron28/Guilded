# WoW Forever achievements: what to mirror in Guilded (7 November 2026)

Owner request: check Forever's in-game achievements and say which would be interesting to add. Status: research done from public
sources only (no live client was available to this session); the profession subset is built; the rest needs an in-game API probe first.

## What Forever has

Forever does not ship the Retail/Wrath achievement frame as its main progression. Its achievement-like system is the **Legacy System**
(key Y): account-wide *Legacy Challenges* give Legacy Points that are spent in three perk trees (Professions, Adventure,
Resourcefulness). Reward milestones at 15, 25, 40 and 55 points. Sources: warcrafttavern.com/forever/guides/legacy, warcraft.wiki.gg
"Legacy System", wow.gg Forever legacy points guide. These are community pages; point counts may change per season.

Challenges (1 point each unless noted):

| Group | Challenge | Worth mirroring? |
|---|---|---|
| Classes | Level 25, 45, 60 on each of nine classes | Partly: Guilded has level rows per edition. A "class collector" row (a level 60 of N classes) is cheap from synced characters. Later. |
| Tradeskills | 150, 225, 300 in Alchemy, Blacksmithing, Enchanting, Engineering, Leatherworking, Tailoring | **Yes, built** (skill steps 75/150/225/300, mastery of several professions). |
| PvP | Ranks 3, 7, 10, 13, 14; Exalted with an AV/AB/WSG faction; Field of Honor journey weeks 4, 7, 10 | **Yes, next**: guild-visible PvP rank milestones fit the existing `hk`/`duel` milestone kinds. Needs the rank API (see probe). |
| Adventure | Explore Azeroth; the "An Earnest Proposition" questline | Maybe: one-off, personal, low social value. |
| Dungeons | Novice / Experienced / Master Spelunker | Overlaps Guilded's own dungeon variety rows; mirror only if the in-game criteria are readable. |
| Raids | Hyjal Summit (13 bosses), Barrow Deeps (8), Onyxia | **Yes, later**: raid firsts matter to a guild; first raids open 9 December. Guilded already records attendance and clears. |
| Hardcore | Separate challenge set | No (Forever-only focus, not guild-relevant). |

Guild-flavoured ones Forever lacks, which Guilded can add itself: guild firsts, crafts for guildmates, rare recipes (built below).

## How the addon would detect them

Unverified until probed on a live Forever client; do not ship detection code for these before the probe:

1. `/dump GetCategoryList()`, `/dump GetAchievementInfo(...)`, `/dump C_LegacySystem` or any global starting `Legacy` / `C_Legacy`
   (`/run for k in pairs(_G) do if k:find("Legacy") then print(k) end end`). The Legacy frame is likely Lua-driven, so a
   challenge-completed event or list function should exist.
2. If a list API exists: read completed challenge ids once at login (silent baseline, as `Milestones.lua` does) and record each new one as a
   milestone (`kind = "legacy"`, `ref = "legacy:<id>"`), then upload through the existing milestone path (companion `exportMilestones`,
   bot `importMilestones`). Rows for the bot catalogue are keyed by challenge id, so renamed texts never break stored rows.
3. If no list API: PvP rank via `UnitPVPRank`/`GetPVPRankInfo`, reputation via `GetFactionInfoByID` (standing 8 = Exalted), skill via
   `GetProfessions` (already used), raid kills via the existing Dungeon/raid recorders.

### Running the probe (chat `/run` is blocked on Forever)

`/guilded probe achievements` (addon, any player, read-only; `Modules/Probe.lua`) does the checks above without scripts. Everything is wrapped in pcall,
nothing protected is called, and nothing is sent. It prints to the Guilded chat tab:

- the client version and edition;
- which of `GetCategoryList`, `GetCategoryInfo`, `GetCategoryNumAchievements`, `GetAchievementInfo`, `GetAchievementCriteriaInfo`,
  `GetNumCompletedAchievements`, `GetTotalAchievementPoints` and `GetStatistic` exist, and whether `C_AchievementInfo` exists (with its function names);
- any global whose name contains "legacy" (names only, up to 20), to find Forever's Legacy system;
- whether `ACHIEVEMENT_EARNED` and `CRITERIA_UPDATE` can be registered;
- the category count, the first five categories (id, name, achievement count), the total and completed achievements, and the first achievement of the first category.

The same summary is saved in SavedVariables as `db.probes.achievements` (`apis`, `infoFunctions`, `legacyNames`, `events`, `categories`, `shown`, `total`, `completed`, `sample`), so
it can be read from the file when chat output is hard to copy. Run it once on a Forever character in game and paste the output here. Its answers decide step 1 of
the detection plan: no category API means falling back to item 3.

## Built in this change (professions)

- Skill steps 75/150/225/300 (`wow-forever-profession-*`; 150 and 300 kept their ids). Detected on the bot from synced professions
  and, for the date and the guild chat line, in the addon (`Milestones.lua`, kind `prof`, by skill line id so any language works;
  150 and 300 are announced, 75 and 225 recorded silently; per-kind switch `/guilded announce prof on|off`, ON by default like the rest).
- Master of Two / Many Trades: distinct professions at 300.
- First to 300 in the guild: only counted when the addon saw the character reach 300 live (`profnew:<key>` milestone), earlier than any other
  member's recorded 300. Skills already at 300 when an addon first ran can never win. Known limit: a guildmate whose addon is not
  installed cannot be seen.
- Rare recipes: recipes no other guild crafter knows (needs recipe scans from at least three crafters).
- Crafts for guildmates: completed craft-board requests where the crafter is not the requester, 1 to 250.
- Catalogue version 8, so announcing guilds re-baseline quietly once. No migration needed (new rows reuse `MemberAchievement` and
  `MemberMilestone`).

## Next steps

1. Probe the Forever client (items above); record the answers here.
2. PvP rank and BG reputation rows, then raid firsts once raids open.
3. Optional: mirror the nine-class level challenge as "class collector".
