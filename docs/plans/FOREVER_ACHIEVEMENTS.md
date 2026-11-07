# WoW Forever achievements: what exists, what to mirror, how to detect it

Written 7 November 2026 for the 9.0 achievements work. Status of each item is marked **built**, **planned** or **blocked on an in-game check**.

## What Forever has (research, 7 November 2026)

Sources: the Warcraft Wiki page "Legacy System" (warcraft.wiki.gg/wiki/Legacy_Tree) and the community addon Forever Echoes (CurseForge). Neither documents an addon API; treat the detection notes below as hypotheses to check in game.

- **The Legacy System is Forever's own take on achievements.** It has three tabs: Rewards, Challenges and Trees. Points are account-wide (65 at launch); each character spends them in trees (Professions, Adventure, Resourcefulness). It opens with `Y` after the first Legacy Point.
- **Challenges (the achievement list), 65 points at launch:**
  - Classes (27): reach level 25, 45 and 60 on each class.
  - Tradeskills (18): skill milestones in six non-gathering primary professions.
  - PvP (12): Honor System ranks, Exalted with four PvP factions, some Field of Honor journey weeks.
  - Dungeons (3): clears in Novice, Experienced and Master tiers.
  - Raids (3): Barrow Deeps, Hyjal Summit, Onyxia.
  - Adventure (2): a Lord Valthalak / Dungeon Set 2 questline and Explore Azeroth.
- **Rewards:** toy at 15 points, Spectral Bear Cub at 25, tabard at 40, mount at 55.
- **Forever Echoes** (third-party) shows "Forever Feats": world bosses (Azuregos, Kazzak, Dragons of Nightmare), Hogger, boars, exploration, kill counts, dungeons and faction-specific meme quests. It also imports Retail achievements as history, which are not Forever progress and are not mirrored here.
- Hardcore points do not carry over to Forever. Forever is outside Retail's continuity.

## What is worth mirroring

Guilded only adds an achievement when the bot can compute it from data it already holds (nothing self-reported, no points awarded; see `src/services/achievements-catalogue.ts`).

| Legacy challenge | Mirror | Data | Status |
|---|---|---|---|
| Classes: level 60 on each class | Three, six, nine different classes at the cap | `Character.className` + `level` (companion/addon sync) | **built** (`wow-forever-classes-maxed-*`) |
| Classes: levels 25 and 45 per class | Same ladder at 25 and 45 | same | planned: needs one ladder per level step; small change, held back to keep the first set short |
| Tradeskills: six non-gathering primaries | One, three, all six crafting professions at skill 300 | `ProfessionSkill` | **built** (`wow-forever-craft-mastery-*`) |
| Tradeskills: earlier skill milestones | 75 / 150 / 225 / 300 in any profession | `ProfessionSkill` | **built** (`wow-forever-profession-75/150/225/300`) |
| Dungeons: Novice / Experienced / Master tiers | Per tier clears | `DungeonRun` has the dungeon, not Forever's difficulty tier | blocked on an in-game check: find which field (`C_ChallengeMode`, instance difficulty id) names the Forever tier, then add it to the run record |
| Raids: Barrow Deeps, Hyjal Summit, Onyxia | Per raid clear | Officer-taken raid attendance has boss status but not a stable raid id | planned: add an instance id to the raid record, then a `raidInstanceClears` ladder |
| PvP: Honor ranks | Rank reached | The addon already reports lifetime honorable kills (`hk` milestones); rank is not reported | planned: add `GetPVPRankInfo` (or Forever's equivalent) to `Milestones.lua` as a `rank` milestone kind |
| PvP: Exalted with four PvP factions | Faction count | Not reported | planned: `GetFactionInfo` loop in the addon, same upload path |
| Adventure: Explore Azeroth, questlines | Per achievement | Not reported | blocked on an in-game check (below) |
| Forever Feats (world bosses, Hogger, meme quests) | Guild firsts and world-boss kills | Not reported | blocked: community content, not documented |

## How the addon would detect the unbuilt ones

The retail and Wrath APIs are `GetAchievementInfo(id)`, `GetCategoryList()`, `GetNumCompletedAchievements()` and the events `ACHIEVEMENT_EARNED` and `CRITERIA_UPDATE`. I could not confirm that Forever exposes any of them for the Legacy System, so the first step is an in-game probe, not code:

1. In game run `/dump type(GetAchievementInfo)`, `/dump type(C_AchievementInfo)` and `/dump GetCategoryList and GetCategoryList()`. If they return data, iterate the Legacy categories and read each entry's `completed` flag.
2. If not, search for Forever's own table: `/run for k in pairs(_G) do if k:lower():find("legacy") then print(k) end end`. The Legacy UI is a Blizzard frame, so its data source is a `C_Legacy*` namespace or a frame field.
3. Whichever works, add a function to `Modules/Milestones.lua` that reads completed challenge ids once at login and on the earn event, and records them as milestones with a new kind (`legacy`, ref = challenge id, value 1). Milestones already flow addon, SavedVariables, companion (`exportMilestones` in `companion/lua-export-content.mjs`), `importMilestones` in `src/services/addon-import.ts`, and `MemberMilestone`. No new table or migration is needed.
4. In `src/services/achievements.ts`, read `MemberMilestone` rows of kind `legacy` and add a metric (`legacyChallenges`) per mirrored challenge. The kind list is validated in the exporter and importer, so both need the new kind added together.

## What was built in this change

All computed on the bot from data it already had; no addon, companion or database change.

- **Profession steps:** 75 and 225 added to 150 and 300.
- **Craft mastery:** 1, 3 or all 6 crafting professions at 300 across the member's characters (alchemy, blacksmithing, enchanting, engineering, leatherworking, tailoring).
- **First to 300:** the first member Guilded recorded at skill 300. It uses the stored "Artisan 300" row of other members, so it means "first Guilded saw", not the game's own timestamp. Once earned it stays earned.
- **Rare recipes:** 1, 5 or 15 recipes known by the member's characters that at most two guild characters know, once five or more crafters have recorded recipes (so the first scans do not make everything rare). Sticky once earned. A curated list of truly rare Classic patterns would be better; that needs an in-game check of item ids.
- **Crafts for guildmates:** 1, 10 or 50 craft-board requests completed as the crafter for another member (`CraftRequest` status DONE).
- **Classes at the cap:** 3, 6 or 9 classes at level 60.
- Catalogue version 8: guilds that announce re-baseline quietly once, so nobody gets a burst of old achievements. All new rows are on by default; badges use the same art system (new glyphs: medal, crown, gem, heart, banner).
