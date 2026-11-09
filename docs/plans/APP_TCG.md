# Phone app trading-card game plan (ROADMAP item 22, Track M)

Status: **plan only, 7 November 2026.** Plan until the owner picks a design. Nothing is built.

## Goal

A collectible card layer in the Expo app (`mobile/`) built on what Guilded already tracks: the 89-row achievement catalogue (`docs/ACHIEVEMENTS.md`, `MemberAchievement`), community badges, dungeon and raid records, and the characters a member plays. Members earn **packs from dailies**, open them, build a collection, and (later) trade or show off. It must be a free, social extra, not a gambling mechanic.

## What popular digital TCGs teach

Sources are linked at the end; numbers come from those pages.

- **Hearthstone**: each expansion has its own pity timer: a Legendary guaranteed at least every 40 packs and an Epic every 10; duplicates are recycled into dust, and 100 packs are worth roughly 40% of an expansion's dust value ([pity timer](https://hearthstone.wiki.gg/wiki/Pity_Timer), [pack statistics](https://hearthstone.wiki.gg/wiki/Card_pack_statistics)). Lesson: **a pity timer and a duplicate-to-currency conversion make a free economy feel fair.**
- **Marvel Snap**: no random packs to buy; cards arrive on a **Collection Road** as you level, with Collector's Tokens that let you pick a card from a shop, and later Snap Packs that never give a card you own ([Collector Tokens](https://marvelsnapzone.com/collector-tokens/), [Snap Packs](https://www.pocketgamer.com/marvel-snap/snap-packs-2025)). Lesson: **progress-based unlocks and "no duplicates" packs remove most frustration.**
- **Pokémon TCG Pocket**: free packs on a timer, collection UI by set with rarity diamonds/stars, friend-only trading powered by Trade Stamina and Trade Tokens (tokens earned by exchanging duplicates; cost scales from 25 for a 3-diamond card to 1,500 for a Crown). The launch drew heavy backlash because rare cards were untradeable and tokens were costly, and developers moved to rework it ([VGC](https://videogameschronicle.com/news/pokemon-tcg-pockets-trading-feature-is-changing-after-fan-backlash), [esports.gg](https://esports.gg/news/pokemon-tcg-pocket/pokemon-tcg-pocket-to-remove-trade-tokens-and-require-shinedust-for-trades)). Lesson: **trading is loved but must be simple, friend-scoped and not punitive; keep it out of the MVP.**
- **Collection UI conventions**: a grid by set with owned/unowned silhouettes (Guilded already has locked-badge silhouettes in `achievement-badges.ts`), "NEW" markers, rarity borders, completion bars per set, a card detail with art and flavour, pack-opening animation with a tap-to-reveal.

## Money, ethics, rules

- **No real-money purchases, ever.** Packs come only from dailies and play. Randomised paid items are regulated: Apple requires odds disclosure for randomised virtual items for purchase (guideline 3.1.1) and Google Play requires the same, and several countries regulate loot boxes as gambling ([Apple rule coverage](https://www.pcgamer.com/apple-now-requires-app-store-games-to-disclose-loot-box-odds/), [Google Play](https://www.fenwick.com/insights/publications/google-play-now-requires-disclosure-of-loot-box-odds)). With nothing purchasable none of that applies. Keep it that way.
- **Cards have no cash or EP/GP value.** They can never convert into anything that affects raid fairness (see [MONETIZATION.md](MONETIZATION.md)).
- **Show the drop rates in the app anyway** and let the owner stand behind them.
- **WoW art**: do not use Blizzard art, icons or screenshots on cards in a distributed app; use Guilded's own badge glyphs (SVG, `achievement-badges.ts`) and original illustrations. Card names may reference classes and dungeons as plain text.
- **Children**: the app should not collect new personal data; the TCG uses the existing companion credential.
- Opt-in per server like other 9.0 features (on by default per the owner's rule, with officer and member off switches).

## Proposed design: "Guilded Collection"

### Card families

| Family | Source | Examples |
| --- | --- | --- |
| **Badges** | one card per achievement in the catalogue (89), same name/art/tier | "First Blood", "Race to 60: Top 10" |
| **Classes** | 9 Forever classes x 3 art treatments | Paladin, Rogue |
| **Dungeons and bosses** | Forever dungeons/bosses (text and original art) | Ragefire Chasm, Deadmines |
| **Guild cards** | per-guild: guild emblem, a member card for each linked member (a real character as a collectible "profile card", opt-in) | the guild's own set |
| **Seasonal** | Season 1 etc., limited drop pool | "Season 1: Launch" |

Rarity: Common, Uncommon, Rare, Epic, Legendary (matching WoW item quality colours so it looks native). Achievement-linked cards unlock **guaranteed copies** when the real achievement is earned (the card is the reward), so the collection reflects real play.

### Earning packs (free only)

- **Daily check-in**: 1 pack every 20 hours, stockpile cap of 3.
- **Daily quests** (3 per day, from data we already have): e.g. "Complete a dungeon run", "Send a message in a guild channel", "Win a duel", "Log in to the app". Each pays progress toward a pack; 3 done = bonus pack.
- **Weekly goal** (raid attended, a milestone) = a bigger pack with a guaranteed Rare.
- **Achievement unlocks** = a guaranteed matching card plus a pack.
- No pack can be bought; no energy gating beyond the cap.

### Pack and economy rules

- Pack = 5 cards (4 Common/Uncommon-weighted + 1 Rare+ slot).
- Odds shown in the app: Common 60%, Uncommon 25%, Rare 11%, Epic 3.5%, Legendary 0.5% for the Rare+ slot weights (to be tuned).
- **Pity**: Epic guaranteed every 10 packs, Legendary every 40 (Hearthstone's numbers).
- **Duplicate protection**: packs prefer cards you do not own until the set is complete (Snap's lesson).
- Duplicates convert to **Dust**; Dust crafts a missing card of Rare or lower from the current sets (cost scales by rarity). Legendary cards cannot be crafted, only dropped or earned via achievements.
- Set completion rewards: a profile frame, card back and a title, cosmetic only.

### Screens

1. **Home**: daily pack ready button, dailies progress, next reward.
2. **Pack opening**: tap to open, cards flip one by one, "NEW" tags.
3. **Collection**: grid by family and set, filters (owned, rarity), completion bars, silhouettes for unowned.
4. **Card detail**: art, rarity, how to get it, owned count, craft button.
5. **Profile showcase**: pick 3 cards to display; shown on the website player page and in share cards (existing card renderer).
6. Later: **Trade** with guildmates (friend/guild scoped; see below).

### Trading (phase 2, not in the MVP)

Guild-scoped, 1-for-1, same-rarity only, no currency, a short daily cap, mutual confirmation, an audit log. Avoid Pocket's token wall; keep rare cards tradeable.

## Data needed

New tables (bot side; migration hand-written):

- `CardDefinition` (key, family, set, rarity, name EN/FR, art key, achievementKey?, seasonKey?, enabled)
- `MemberCard` (memberId, cardKey, count, firstSeenAt) unique (memberId, cardKey)
- `MemberPackState` (memberId, nextFreeAt, banked, pityEpic, pityLegendary, dust)
- `PackOpening` (id, memberId, source, cards JSON, openedAt) for audit and replay
- `DailyQuestProgress` (memberId, day, questKey, progress, claimedAt)
- Phase 2: `CardTrade` (id, fromMember, toMember, offered, requested, status)

API (companion credential): `GET /api/v1/cards/state`, `POST /api/v1/cards/open`, `POST /api/v1/cards/craft`, `POST /api/v1/cards/dailies/claim`. All server-authoritative: the phone never decides what a pack contains.

Reads from existing data: `MemberAchievement`, `DungeonRun`, `RaidAttendance`, `CommunityParticipationDay`, duel records, `Character`.

Anti-abuse: server-side rolls, idempotent claims, per-day caps, no client-supplied randomness, rate limits, and quests computed from the bot's records (not self-reported).

## MVP scope (recommended, about 3-4 weeks including art)

Include: Badges family (89 cards, art already exists as SVG glyphs), Classes family (9 cards), daily pack, 3 dailies from existing data, pack opening, collection grid, card detail, pity and duplicate protection, dust and crafting for Rare or lower, odds screen, English and French, off switches.

Exclude: trading, guild member cards, dungeon/boss art set, showcase on the website, seasonal sets, push notifications (on-device reminders only, as in the app today).

## Options for the owner

| Option | Scope | Effort |
| --- | --- | --- |
| **1. Badge album (lightest)** | Only badge cards, one per achievement, unlocked when earned; no packs, no randomness. A collection view of achievements. | S-M, about 1 week |
| **2. MVP above (recommended)** | Badges + Classes, packs, dailies, pity, dust. | M-L, 3-4 weeks |
| **3. Full game** | MVP + trading, guild cards, dungeon set, seasonal sets, showcase. | XL, 8+ weeks |

Recommendation: start with **Option 1 as the foundation (it is a subset of 2)** and build **Option 2** once the owner approves the card art style. Keep trading as a separate decision after real members use the collection.

## Risks

- Art workload for non-badge families; badges reuse existing glyphs.
- Balance of dailies vs. grind; tune from real use.
- Perception of gambling: mitigated by no purchases, pity timers and visible odds.
- Blizzard IP: original art only.
- The app is not yet released in the stores (EXPO_TOKEN, Play and Apple setup still open); the TCG should not block that launch.

## Sources

- [Hearthstone pity timer](https://hearthstone.wiki.gg/wiki/Pity_Timer), [card pack statistics](https://hearthstone.wiki.gg/wiki/Card_pack_statistics)
- [Marvel Snap Collector's Tokens](https://marvelsnapzone.com/collector-tokens/), [Snap Packs](https://www.pocketgamer.com/marvel-snap/snap-packs-2025)
- [Pokémon TCG Pocket trading overhaul](https://videogameschronicle.com/news/pokemon-tcg-pockets-trading-feature-is-changing-after-fan-backlash), [trade tokens vs shinedust](https://esports.gg/news/pokemon-tcg-pocket/pokemon-tcg-pocket-to-remove-trade-tokens-and-require-shinedust-for-trades)
- [Apple loot box odds rule](https://www.pcgamer.com/apple-now-requires-app-store-games-to-disclose-loot-box-odds/), [Google Play loot box odds](https://www.fenwick.com/insights/publications/google-play-now-requires-disclosure-of-loot-box-odds)
