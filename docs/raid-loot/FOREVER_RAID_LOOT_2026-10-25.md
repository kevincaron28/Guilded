# WoW Forever raid loot — sourced reference, 25 October 2026

Forever's first raids open on 9 December 2026: Barrow Deeps (10), Hyjal Summit (20) and
Onyxia's Lair (40). This page records what public sources actually publish so officers can
prepare `/core items` prices. Nothing here is invented: no prices, encounter IDs or drop
tables beyond what the sources below show.

## Status by raid

| Raid | Loot published? | What to do |
| --- | --- | --- |
| Barrow Deeps (10) | **No.** Raid items are among the ~12,500 items Blizzard shipped without stats; loot-table sites list the bosses with "no drops discovered yet". | Wait for launch data (Wowhead Forever database) or record drops in game. |
| Hyjal Summit (20) | **No.** Tier set *models* tagged to Hyjal were datamined (Wowhead, 16 September); the actual items, stats and set bonuses are not. | Same. |
| Onyxia's Lair (40) | **Classic baseline only.** Two Forever sites list the Classic Era table with item IDs from the Forever beta client (build 1.60.1.70532); none of the 17 items is marked as changed in that build. Blizzard has not confirmed the Forever table. | Prepare prices from the list below; check the real drops on the first kill. |

## Onyxia's Lair — Classic baseline (unconfirmed for Forever)

Drop chances are Classic 1.12 values from the CMaNGOS Classic database, as republished by
The Forever Era. They are not Forever data. Tier 2 helms drop for the classes listed.

| Item | Item ID | Item level | Slot | Classic drop chance |
| --- | ---: | ---: | --- | ---: |
| Onyxia Hide Backpack | 17966 | 55 | Bag | 100% |
| Ancient Cornerstone Grimoire | 17067 | 76 | Held in off-hand | 25% |
| Ring of Binding | 18813 | 73 | Finger | 25% |
| Sapphiron Drape | 17078 | 72 | Back (cloth) | 25% |
| Eskhandar's Collar | 18205 | 71 | Neck | 25% |
| Bloodfang Hood (Rogue T2) | 16908 | 76 | Head (leather) | 21% |
| Stormrage Cover (Druid T2) | 16900 | 76 | Head (leather) | 21% |
| Dragonstalker's Helm (Hunter T2) | 16939 | 76 | Head (mail) | 21% |
| Helmet of Ten Storms (Shaman T2) | 16947 | 76 | Head (mail) | 21% |
| Halo of Transcendence (Priest T2) | 16921 | 76 | Head (cloth) | 21% |
| Nemesis Skullcap (Warlock T2) | 16929 | 76 | Head (cloth) | 21% |
| Netherwind Crown (Mage T2) | 16914 | 76 | Head (cloth) | 21% |
| Helm of Wrath (Warrior T2) | 16963 | 76 | Head (plate) | 21% |
| Judgement Crown (Paladin T2) | 16955 | 76 | Head (plate) | 21% |
| Deathbringer | 17068 | 75 | One-hand axe | 8% |
| Vis'kag the Bloodletter | 17075 | 74 | One-hand sword | 8% |
| Shard of the Scale | 17064 | 71 | Trinket | 8% |

Quest drops (not priced in the template): **Head of Onyxia** (18422, starts the reward quest)
and **Mature Black Dragon Sinew** (18705, hunter quiver quest; add it with a price if your
guild charges GP for it).

## Using the price template

[`forever-onyxias-lair-prices.txt`](forever-onyxias-lair-prices.txt) lists the 17 items above
as `Item = ?`. Replace each `?` with your guild's GP price and import it:
`/core items action:import file:<the edited file>` (Raid Leaders; add `core:` for one core's
own prices). Lines still ending in `= ?` are skipped, so a partly filled file is safe. The
companion's **Cores & prices** screen and the **Item prices** button in `/core edit` accept
the same lines. Guilded proposes no GP values: prices are each guild's policy.

When Forever's Onyxia table is confirmed (or differs on the first kill), update this page and
the template from the real drops; do the same for Barrow Deeps and Hyjal Summit.

## Sources (checked 25 October 2026)

- The Forever Era — Onyxia's Lair (Forever beta item IDs/levels, change check, Classic drop
  chances): https://theforeverera.com/en/raids/onyxias-lair/
- WoW Forever Codex — Onyxia's Lair loot table (same items and IDs, Classic Era table):
  https://wowforevercodex.com/raids/onyxias-lair
- wowtbc.gg — WoW Forever raid loot tables (Barrow Deeps: no drops discovered yet):
  https://wowtbc.gg/warcraftforever/loot-tables/raids/
- Wowhead — Raid tier set models datamined for WoW: Forever (16 September 2026):
  https://www.wowhead.com/forever/news/raid-tier-set-models-datamined-for-wow-forever-382938
- Icy Veins — WoW Forever hid over 12,500 items from dataminers:
  https://www.icy-veins.com/wow-forever/news/wow-forever-hid-over-12500-items-from-dataminers-heres-whats-still-secret/
