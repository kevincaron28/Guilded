# Recipe reagents (shipped with the addon)

The Crafting tab shows what every recipe needs (have/need from your bags) as soon as you pick it, with no need to open the
profession window first. The list is code, not saved data: `addon/Guilded/Data/Reagents.lua`, generated from files you can edit.

## How it works in game
- `ns.recipes.matsFor(key)` (Modules/Recipes.lua) answers for a recipe key: an item id, or minus the spell id for an enchant (the
  key Recipes.lua already stores).
- **Your own profession scan wins.** When you open a profession window, what the game lists for a recipe is saved and used from then
  on. WoW Forever may change a recipe, and the game is the truth.
- A scan that **differs** from the shipped list, or a recipe the list lacks, is noted once per recipe and session in `/guilded diag`
  (kind `RECIPES`, never printed in chat). Send those lines to whoever maintains `data/recipes/` and they become one CSV line.
- An empty reading never replaces known reagents.
- Names: `GetItemInfo(id)` in the player's language, the English name from the data only while the game has not cached the item.
- Used by the Crafting tab detail pane and shopping list, and by `/guilded recipes mats`.
- Not done: relaying learned reagents between guildmates. The shipped list plus each member's own scan already cover it.

## Where the data comes from
`scripts/extract-recipes.mjs` reads the WoW Forever client's own tables (SkillLineAbility, SpellEffect, SpellReagents, SpellName,
ItemSparse) from the DB2 exports wago.tools publishes per build (product `wowf`, the 1.60.x client). Ids, counts and names are facts
about the game, derived from the game's data; nothing is copied from a third-party recipe database. The first extraction
(build 1.60.1.71037, 22 Nov 2026) gave 2502 recipes: Alchemy 192, Blacksmithing 506, Cooking 132, Enchanting 261, Engineering 274,
First Aid 32, Leatherworking 590, Mining (smelting) 18, Poisons 26, Tailoring 471. 139 profession abilities were skipped because
they make no item and enchant nothing (skill and tool spells). When two spells make the same item the older spell is kept.

## Files in `data/recipes/`
| File | What it is |
| --- | --- |
| `recipes.csv` | One line per recipe: `key,profession,spell,count,name,reagents,reagent_names`. Written by the extractor. |
| `overrides.csv` | Your own lines, same columns. Survives a re-extraction. |
| `items.csv` | `id,name`: English reagent names (fallback only). Written by the extractor. |
| `items-extra.csv` | Optional `id,name` for reagents only your overrides use. |
| `SOURCE.txt` | Build and counts of the last extraction. |

`reagents` is `itemId:count;itemId:count` (1 to 8). `count` is how many one craft makes. `reagent_names` is only for reading and is
ignored. Lines starting with `#` in overrides.csv are comments.

## Add or fix a recipe (one line)
1. Open `data/recipes/overrides.csv` and add a line. A line with the **same key** replaces that recipe, a **new key** adds one:
   `key,profession,spell,count,name,reagents,reagent_names`
   `2454,Alchemy,2329,1,Elixir of Minor Strength,2449:2;765:1;3371:1,` (an example: makes the recipe need 2 Earthroot)
2. To remove a recipe, write its key with profession `-`: `2454,-,,,,`.
3. `npm run reagents:build` writes `addon/Guilded/Data/Reagents.lua` (it refuses a malformed line and names the file and line).
4. `npx vitest run tests/reagents-data.test.ts tests/lua/recipe-reagents.test.ts`, then commit the CSV and the generated file.
   `tests/reagents-data.test.ts` fails when `Reagents.lua` is not what the CSV files give.

## After a WoW Forever update
1. `npm run reagents:extract` (latest `wowf` build) or `node scripts/extract-recipes.mjs --build <version>`. Needs network.
2. `git diff data/recipes/` shows exactly which recipes changed. Fix anything wrong with a line in `overrides.csv`.
3. `npm run reagents:build`, run the tests, open a PR. A new reagent without a name gets "item <id>" until the game caches it:
   add it to `items-extra.csv` if you want a fallback.

## Checks owed in game
Open Crafting, pick a recipe you have never opened a window for (the reagents appear with have/need). Open its profession window,
pick the same recipe again: the reagents stay or update. `/guilded diag` lists any `RECIPES` difference.
