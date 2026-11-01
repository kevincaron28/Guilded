# December raid pricing

Use **Raid prices** in the online or installed companion. A Raid Leader can create a new core with the December preset, enable prices on an existing core, or edit every slot price. Members can read the prices, exceptions, rules, priority calculator and leaderboards. Server permissions decide who may save.

The preset is an editable guild policy, not a claim that these numbers are mathematically optimal for every class or that unrevealed raid loot is verified. It applies to Forever, Classic Era, TBC, Mists and Retail within each guild's edition. No balances or existing core rules change on upgrade.

## Recommended setup

- Create a new core for the December roster. It starts with an empty, separate point pool and `PRIORITY` loot mode (fixed-price EPGP). `EPGP` mode means GP bidding.
- Attendance is 100 EP; late/partial attendance is 50 EP instead of 100. Boss and completion bonuses are zero. Use one scheduled session across the evening's instances. Approved standby is credited through the existing attendance workflow.
- Base GP is 100; earned GP starts at zero. Priority is EP / (earned GP + base GP). Characters belonging to the same member share points. Changing the main character does not reset them.
- Weekly decay is 10% of EP and earned GP, with the existing rounding-up deduction. Base GP does not decay. New preset pools enable their own scheduler at Tuesday 15:00 UTC; no decay is applied immediately on creation. Connected active raids defer it. Finish and upload offline raids before reset because the server cannot observe them.
- `/officer epgp decay core:<name> weekly:false` disables that preset core's schedule; `weekly:true` enables it. Manual and automatic decay for a preset core use the same weekly reference, preventing a second decay that week. Guild-wide scheduling remains independent.
- Off-spec costs 50%, rounded to the nearest whole GP: 75 → 38, 25 → 13. Main spec takes precedence; highest unrounded PR wins within eligibility. Exact ties use a visible `/roll 100`, repeating ties. The officer confirms usability and tradeability before awarding.

## Default prices

| Equipment | Main GP | Off-spec GP |
|---|---:|---:|
| Head, chest, legs | 100 | 50 |
| Shoulders, hands, waist, feet | 75 | 38 |
| Wrist, neck, cloak, ring | 50 | 25 |
| Trinket | 100 | 50 |
| One-hand weapon, including weapon off-hand | 100 | 50 |
| Shield or held off-hand | 100 | 50 |
| Two-hand weapon | 200 | 100 |
| Bow, gun, crossbow | 200 | 100 |
| Wand, thrown weapon, relic | 25 | 13 |
| Bag or verified utility exception | 0 | 0 |
| Completed legendary | 400 | 200 |
| Unknown item: provisional, explicit confirmation | 100 | 50 |

## Editing and audit history

Core overrides take precedence over guild overrides, then equipment slot prices. Guild prices are excluded when core-only loot is enabled. Within a scope, an item-level override precedes a name override, then the generic item ID. Use **Roster & loot settings** for individual exceptions:

```text
id:12345 = 100
id:12345@ilvl:100 = 150
Localized item name = 75
```

The variant syntax distinguishes item levels, not every bonus-ID/difficulty combination. Prefer IDs over localized names. The full item link is retained in a preset award's audit snapshot.

Start `/guilded start` before preset loot. The raid pins its price table, revision, overrides, base GP, minimum EP and off-spec rule across refreshes and reloads. Edits apply to the next started raid. The officer can confirm a provisional quote or set an explicit GP amount on an award; the saved quote records that decision. Historical awards never recalculate. Concurrent companion edits are rejected when their revision is stale, and failed saves retain the draft.

Preset awards save edition, core, revision, item link, base price, final GP, response and source. Imports check the quote against awarded GP and the matching guild/edition/core raid; duplicate references do not create another award. A mismatched or not-yet-uploaded raid holds the award for review/retry.

All configured exceptions are exported; there is no 400-price truncation. An import over 500 lines is refused in full with a split-batch instruction.

Discord cannot determine equipment metadata from a name. Direct Discord awards for preset cores require an explicit base `gp:` quote (including an explicit zero for free items); `offspec:true` applies the percentage once. The officer quote is retained in history. Use the addon's saved raid quote for the correct revision. Discord wishlist priority reports ties without declaring the earliest wish the winner.

## Tokens, quests and new raids

Set verified token/quest exceptions at the highest possible reward-slot cost. Charge once at the token or reward, according to the published guild list, never both. Legendary fragments use verified zero-price exceptions; charge the completed item once. Unknown metadata never silently becomes a free item.

The launch loot tables for Forever's new raids must be verified when available. Historical Onyxia item IDs are research candidates, not an automatically activated Forever catalog. Until a verified exception exists, the addon asks for an explicit provisional price for an unrecognized token or uncached item. This is the remaining data-dependent work before December; ordinary known equipment is priced by slot without maintaining a separate list for every raid.

## Companion leaderboards

**Leaderboards → Raid priority** shows the selected core's active members, EP, earned GP, PR, minimum-EP status and the current player. Alts do not create extra leaderboard entries. Exact ties share a rank. The page identifies shared versus separate point pools and the last refresh time.

**Dungeon scores** uses the existing guild score service: current season, this week and historical seasons, with separate level-bracket ranks and provisional-target notices. Boards contain up to 50 reported scores; an unavailable service is shown as unavailable. These pages require a connected guild account and do not publish private Battle.net discovery lists.

## December rehearsal

Automated checks cover TS/Lua quote parity, unknown items, variants, pinned revisions, off-spec rounding, visible ties and reload recovery. PostgreSQL rehearsal covers permissions, concurrent saves, preserving existing pools, alt-safe ranking, quote imports and 501 exceptions.

Before the first real raid, install matching addon/companion versions, connect the guild, populate the core roster, start a test session, quote a known item and an unknown token, resolve a tied roll, upload twice, and verify one award with the expected GP. Confirm standby attendance and weekly decay in that test pool. Automated Lua tests do not replace an actual client rehearsal, and the target of over 95% of normal drops requiring no edit remains an acceptance target until measured in raids.
