# WoW Forever achievements: what to mirror in Guilded (7 November 2026)

Owner request: check Forever's in-game achievements and say which would be interesting to add. Status (8 November 2026): the profession
subset is built, the probe ran on a real Forever client (results below), and **every in-game achievement is now tracked and shown as a
generated badge** ("Built for every in-game achievement" below).

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

> The probe has done its job and was removed in 9.2 (`Modules/Probe.lua`); `/guilded probe` now prints a one-line "removed" message. The
> description below is the record of how the results were gathered.

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

### Probe results (real client, 8 November 2026)

Run by the owner on WoW Forever **1.60.1 (build 70862)** with `/guilded probe achievements` (PR #625). It answers step 1 above: Forever has the
standard achievement API, so no Legacy-specific code and no fallback (item 3) is needed.

- **APIs present:** `GetCategoryList`, `GetCategoryInfo`, `GetCategoryNumAchievements`, `GetAchievementInfo`, `GetAchievementCriteriaInfo`,
  `GetStatistic`, `GetTotalAchievementPoints`, `GetNumCompletedAchievements`, and `C_AchievementInfo` with `AreGuildAchievementsEnabled`,
  `GetRewardItemID`, `GetSupercedingAchievements`, `IsGuildAchievement`, `IsValidAchievement`, `SetPortraitTexture`.
- **Events:** `ACHIEVEMENT_EARNED` and `CRITERIA_UPDATE` both register.
- **Content:** 29 categories, 111 achievements visible, 0 completed on the probed character. First categories: 15425 "Do Not Display" (0),
  15577 "Druid" (3), 15587 "Alchemy" (3), 15597 "Ranks" (5), 15607 "Explorer" (3). Category 15425 is the game's hidden bucket and is never read.
- **Consequence:** the achievements are an ordinary list of ids and names, so Guilded generates its catalogue from what members report
  instead of keeping a hard-coded list that Forever's seasons would outdate.

## Built for every in-game achievement (9.0.x, roadmap item 8)

- **Addon** (`Modules/GameAchievements.lua`): the first scan of a character records every earned achievement silently, dated by the game
  (month/day/year from `GetAchievementInfo`, so history keeps its real dates). Later scans (12 seconds after login, once per session) and
  `ACHIEVEMENT_EARNED` record new ones. Category 15425 is skipped; everything is pcall-wrapped and hidden values are ignored. A client that
  answers nothing records nothing and tries again next login. Each record is a milestone of kind `ach`: `ref = ach:<id>`, `value = 1`, plus
  the name, description, category and points the client showed (saved in `GuildedDB.milestones`).
- **Guild chat:** the newest new achievement is announced (`<name> earned the achievement <achievement>!`) under the same rules as every
  milestone: ON by default after the one-time notice, `/guilded announce ach on|off`, the general member switch, and an officer's guild-wide
  off switch wins. The first scan and older achievements found together with a newer one are recorded silently.
- **Upload:** the existing milestone path. The companion exporter allows kind `ach` (name, description, category, points cleaned and cut) and
  drops an achievement with no name; the snapshot and importer now take up to 600 milestone rows (was 300) because a log with achievements is longer.
- **Bot catalogue (generated, no list in the code):** `GameAchievement` (migration `20270127000000_game_achievements`) keeps the first reported
  name, text, category and points of each id (a later report never renames it). Rows are `forever-ach-<id>` in `achievements-catalogue.ts`'s
  registry: WoW, Forever, one step, tier from points (under 5 bronze, 5 silver, 10 gold, 25 platinum, 50 epic, 100 legendary). They are never in
  `ACHIEVEMENTS`, so the evaluator cannot award one; `syncMemberAchievements` stores each one a member's addon recorded (date from the addon) into
  `MemberAchievement` like any other, and a later view never removes it.
- **Where they show:** the website achievements page and public profiles (a "WoW Forever · in-game achievements" section, earned ones only: nothing is
  known about achievements nobody has reported), the share cards (the achievements card and the unlock card), and the opt-in Discord unlock
  announcement. Forever and guild only, as before. Badge glyph: a keyword in the name or text (dungeon, raid, honor, quest ...), else one of sixteen
  chosen by the id, the same every time. Names are in the game's own language (no translation to keep in step).
- **Version:** catalogue version 9, so announcing guilds re-baseline quietly once and the first wave of reported achievements does not flood Discord.
- **Not done:** the phone app's album and the Guilded Clash badge cards still list only the fixed catalogue (they need a generated-list endpoint and
  a card rarity for generated rows); guild achievements (`GetGuildCategoryList`) and criteria progress (`GetAchievementCriteriaInfo`) are not read.

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

1. ~~Probe the Forever client~~ (done, results above; every in-game achievement is tracked).
2. PvP rank and BG reputation rows, then raid firsts once raids open.
3. Optional: mirror the nine-class level challenge as "class collector".
