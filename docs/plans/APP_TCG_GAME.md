# Guilded Clash: the 1v1 card game (full design, plan only)

Status: **plan only, 8 November 2026.** Nothing here is built. For the owner to approve; the numbered decisions are at the end ([section 10](#10-what-the-owner-must-decide)).
"Guilded Clash" is a working title (the collection layer stays "Guilded Collection"). Builds on [APP_TCG.md](APP_TCG.md) (option 2, approved), its server stage 1 in PR #626 (`claude/tcg-server`: `TcgAccount`, `TcgCard`, `TcgLog`, `tcg.ts`, `tcg-store.ts`, `tcg-catalogue.ts`) and the frame style in [APP_TCG_ART.md](APP_TCG_ART.md) (gold and stone, style A; painted Magic-style illustrations are being generated and the owner approves the final art).

Owner request (8 Nov): the TCG "should be really complete and full": research popular TCGs, plan it to be optimal from the start, with **trading and 1v1 games**, full and optimal rules, themed around WoW Forever.

## 0. Summary

- **The game.** Two Champions of one of the 9 classes, 20 Health each. 24-card decks, mana 1 to 8, units fight on a 5-slot board, one shared **Zone** (a dungeon-like place that changes the rules) and one **Standard** per player (a guild card earned from real achievements). Three phases a turn (Start, Main, End), about 5 to 7 minutes a match.
- **Why this shape.** Hearthstone's clarity (one resource, units, spells, gear), Marvel Snap's and Pocket's short matches and small decks, Runeterra's generosity and keyword clarity, Gwent's comeback ideas. Differentiators that are ours: a **party rule** (Tank, Healer, Damage on board = a discount, the dungeon trinity), **Zones** as original dungeon analogues, and **Guild Standards** from Guilded achievements.
- **Phone first and async.** Live matches use a 60 s turn clock; friendly and guild matches can also be played async (24 h per turn). The full state lives on the server; the phone only sends intents.
- **A small community needs a plan.** Québec Gold has about 240 members, so a live-only ranked queue would often be empty. The plan adds the guild ladder, a cross-server ladder for hosted servers, an AI opponent and a PvE dungeon gauntlet from the start, so there is always someone to play.
- **Trading.** Guild-only swaps first (limits, cooldowns, bound achievement cards, audit log), cross-guild only later. No gold, no EP/GP, no real money, ever.
- **Economy.** Free packs, quests, dust and crafting (including Epic and Legendary, which #626 does not allow yet), pity, nerf-refund. About 183 packs (median, simulated) to complete every playset of set 1.
- **Card list v1.** 150 cards: 99 class cards (9 x 11), 39 neutral (33 + 6 Zones), 12 Guild Standards. Every unit checked against a cost-curve formula.
- **Law and IP.** Free packs and no cash-out keep us clear of gambling definitions; odds are shown anyway. Names are original; a short list of what needs a legal check is in [section 3.4](#34-ip-what-we-can-name-and-what-needs-care).
- **Build.** A deterministic TypeScript engine with replay tests first, in 7 stages ([section 9](#9-architecture-and-build-plan)).

## 1. Research

### 1.1 What each game teaches

Rules facts below were checked against the linked pages where a link is given; items marked *(known)* come from general game knowledge and should be re-checked against the game's own documentation before we quote them publicly.

| Game | What makes it work | What we take | What we avoid |
| --- | --- | --- | --- |
| **Hearthstone** | One resource (mana crystals up to 10), a 30-card single-class deck, heroes with a power, keywords like Taunt and Charge; Fatigue damages a player who draws from an empty deck ([deck](https://hearthstone.wiki.gg/wiki/Deck), [Fatigue](https://hearthstone.wiki.gg/wiki/Fatigue)). Reconnect feature and concede are first-class ([reconnect](https://hearthstone.wiki.gg/wiki/Reconnection_feature), [concede](https://hearthstone.wiki.gg/wiki/Concede)). | Class power per Champion, one resource, board of units, deck tied to a class, an Exhaustion rule that ends stalled games, reconnect. | 30-card, 10-mana games run 10 to 15 minutes; random "generate a card" effects that make results feel luck-driven. |
| **MTG Arena** | Rich card types and a Best-of-One mode with "hand smoothing" that biases opening hands toward a playable land/spell mix; sources disagree on whether it also covers mulligans ([MTG Arena Zone](https://mtgazone.com/mtg-arenas-opening-hand-algorithm-and-smoothing/), [Draftsim](https://draftsim.com/mtg-arena-bo1-hand-smoothing/)). A 5th copy of a card never yields a wildcard, protecting the economy ([beginner's guide](https://sites.google.com/view/asap-bg-to-mtga/inner-workings)). | Opening-hand smoothing (at least one cheap card), a mulligan, Wildcard-style crafting ideas, a hard cap on useful copies. | Mana-screw and flood variance (our single resource removes it); a 60-card deck is far too long for a phone. |
| **Marvel Snap** | 12-card decks, three Locations revealed one per turn, six turns, win two of three Locations ([Shacknews](https://shacknews.com/article/132689/how-to-play-marvel-snap), [Marvel.com](https://marvel.com/articles/games/a-starter-guide-on-how-to-play-marvel-snap)). Cards arrive on a Collection Road with tokens, not paid random packs ([Collector's Tokens](https://marvelsnapzone.com/collector-tokens/)). | Locations as rule-changing cards (our Zones), short matches, progress-based unlocks, no duplicates frustration. | Retreat/snap cubes (a betting layer we do not need); no trading. |
| **Legends of Runeterra** | 40-card decks, up to 3 copies, up to 6 champions, 1 or 2 regions; champions level up by completing a mini-quest ([Inven](https://invenglobal.com/articles/9832/guide-how-do-you-build-a-deck-in-legends-of-runeterra), [Mobalytics](https://mobalytics.gg/blog/legends-of-runeterra-guide/)). Known for a generous free economy and an attacker/defender turn *(known)*. | Generous free progress; keyword clarity; a "level-up" feel (our Frenzy and Standards). | Region pairing and attack tokens add rule weight we do not need on a phone. |
| **Pokémon TCG Pocket** | 20-card decks, an Energy Zone that makes one Energy per turn, 3 points to win, 3 bench spots ([Serebii](https://serebii.net/tcgpocket/battles.shtml), [Pokémon.com](https://www.pokemon.com/uk/strategy/learn-how-to-build-a-deck-in-pokemon-tcg-pocket)). Trading is friend-only and launched with Trade Stamina and Trade Tokens; after heavy backlash shinedust became the trade currency ([esports.gg](https://esports.gg/news/pokemon-tcg-pocket/pokemon-tcg-pocket-to-remove-trade-tokens-and-require-shinedust-for-trades), [Pocket Tactics](https://www.pockettactics.com/pokemon-tcg-pocket/trade-tokens)). | Short smaller decks, "points to win" thinking, friend-scoped trading, one simple resource. | A token wall that made rare cards effectively untradeable. |
| **Gwent** | Rounds (best of three) so a bad turn is not a lost game; comeback is built in *(known; not verified in this research)*. | A Second Wind comeback rule and optional best-of-three for events. | Round-based point totals do not fit a board-and-hero game. |
| **Shadowverse (Evolve)** | A once-per-turn power-up (Evolve) with different timing for the first and second player: 2 points to the first player, 3 to the second, usable from turn 5 and 4 ([rules PDF](https://en.shadowverse-evolve.com/wordpress/wp-content/uploads/2023/07/14102706/SVEE-Comprehensive-Rules-1.31-July-11-2023.pdf)). | Compensating the second player, a mid-game spike. | An extra resource track; we use the Loot Bag and Second Wind instead. |
| **Artifact** (cautionary) | Cards sold on the Steam market; press blamed the market for pay-to-win and a bot flood, and 2.0 removed the marketplace ([mein-mmo](https://mein-mmo.de/en/steam-flop-artifact-aims-to-do-everything-better-with-2-0-removes-card-trading), [PCGamesN](https://www.pcgamesn.com/artifact/beta)). Valve gave no official reason; this is press inference. | Never connect trading to money. | Open markets. |

### 1.2 Economy and trading patterns

- **Pity timers and duplicate protection** are the common answer to "random packs feel bad": Hearthstone guarantees a Legendary at least every 40 packs ([pity timer](https://hearthstone.wiki.gg/wiki/Pity_Timer)); #626 already uses 10 and 40.
- **Crafting from dust** lets a player fix a collection without luck (Hearthstone, Arena wildcards). Games that forbid trading (Hearthstone, MTG Arena, Marvel Snap) rely on crafting alone *(known)*; Pocket is the one mobile example with trading, and it learned that gates which make rare cards untradeable create anger.
- **Abuse seen in the field.** Real-money trading and bots follow any convertible asset (Artifact's market, and MMOs in general: [Lost Ark RMT reporting](https://piunikaweb.com/blog/lost-ark-rmt-breaking-game-economy-players-are-frustrated)); alt-account farming follows free rewards that can be moved to a main account. Our design removes the convertibility (no currency, no cash-out) and the movement paths (bound cards, limits, age gates, see section 6).

### 1.3 Lessons applied

1. **One resource, small decks, short matches** (Hearthstone clarity, Snap and Pocket length).
2. **A free, readable economy** with pity, crafting for every rarity and nerf protection.
3. **Trading that is generous but bounded**, learned from Pocket's backlash and Artifact's market.
4. **Fairness for the second player** (Loot Bag, Shadowverse's timing idea), **comeback** (Second Wind, Gwent's spirit) and **stall-breakers** (Exhaustion).
5. **Population realism**: a small guild needs AI, async and a PvE path (not in the sources; our own conclusion from 240 members).

## 2. The rules

### 2.1 Overview

1v1. Each player is a **Champion** of one of 9 classes with **16 Health** (20 until the balance review of 10 November 2026, `docs/plans/CLASH_BALANCE_REVIEW_2026-11-10.md`). You win by reducing the opposing Champion to 0 Health. You build a **24-card deck** from your class and neutral cards. Units fight on the board, spells and gear shape the fight, a **Zone** changes the rules for both sides, and your **Standard** (optional) gives you a permanent edge.

### 2.2 Components and limits

| Item | Rule |
| --- | --- |
| Champion | 16 Health, no attack of its own. Armor absorbs damage before Health. Health cannot be healed above 16. |
| Deck | Exactly 24 cards. |
| Hand | 8 cards maximum; a card drawn into a full hand is burned. |
| Board | 5 unit slots per side. A 6th unit cannot be played (or is destroyed if summoned). |
| Zone | One shared Zone slot. Playing a Zone replaces the current one. |
| Standard | One slot per player, filled by playing a Standard card (cost 2). Standards cannot be removed in v1. |
| Mana | See below. |

### 2.3 Mana (the only resource)

- On your **n-th turn** you have **min(n, 8)** mana. Unused mana is lost.
- Temporary mana (from cards such as Caravan Master or the Loot Bag) is added for that turn only; the total can never exceed 10.
- **Second player:** draws 4 cards (first player 3) and gets a **Loot Bag**, a 0-cost card that gives 2 temporary mana (changed from 1 in the balance pass), playable once.

### 2.4 Turn structure

1. **Start phase.** Ready your units (they can attack again), refresh mana, draw 1 card (since 10 November 2026 the first player draws on their first turn too). Start-of-turn effects trigger; if your deck is empty you take Exhaustion damage (see 2.9).
2. **Main phase.** In any order, as many times as you can afford: play cards, use your class power once (2 mana), attack with ready units. Each unit may attack once (Twin Strike: twice). A unit that entered play this turn is exhausted and cannot attack unless it has **Swift**.
3. **End phase.** End-of-turn effects trigger, temporary effects expire, and the turn passes. Chill, if applied to your units, wears off at the end of the turn in which they were prevented from attacking.

Attacks, spells and Rally effects resolve immediately and fully, one at a time (no stack, no interrupts). Deaths are processed after each effect; Last Stand effects then trigger, the active player's first.

### 2.5 Card types

| Type | Rule |
| --- | --- |
| **Unit** | Attack/Health. Enters the board; fights. Dies at 0 Health. May have keywords and a Rally or Last Stand effect. Printed with a **role**: Tank (Guard units), Healer (units with Mend), or Damage (everything else). |
| **Spell** | One-shot effect, then discarded. |
| **Gear** | Attaches to a friendly unit (one Gear per unit); gives the printed bonus and effect; destroyed with the unit. |
| **Zone** | A shared place with a continuous effect. A new Zone replaces the old. Zones are the dungeon analogue: cheap, readable rule changes. |
| **Standard** | A guild card (see 3.3): a permanent aura in your Standard slot. Max 1 in a deck. |

**Party rule ("Full Party").** At the start of your turn, if you control a **Tank, a Healer and a Damage** unit, the first card you play that turn costs 1 less. It is small on purpose: it nudges deck-building toward the dungeon trinity (the WoW fantasy) without forcing it.

### 2.6 Combat

- An attacker picks a target: an enemy unit or the enemy Champion.
- **Guard:** while an enemy unit with Guard is on the board, attackers must target Guard units first.
- **Shadow:** cannot be attacked or targeted by enemy effects until it attacks; it then loses Shadow.
- **Damage** is dealt simultaneously. Armor, then Shield, then Health, as described in 2.7.
- A unit attacking a Champion takes no damage back.

### 2.7 Keywords (16)

| Keyword | Meaning |
| --- | --- |
| **Guard** | Enemies must attack Guard units first. |
| **Swift** | Can attack the turn it enters play. |
| **Shield** | Prevents the next damage this unit would take; the Shield is then removed. |
| **Shadow** | Cannot be attacked or targeted until it attacks. |
| **Venom** | A unit damaged by this unit's attack is destroyed (not a Champion). |
| **Drain** | Damage this unit deals also Mends your Champion by the same amount. |
| **Twin Strike** | May attack twice each turn. |
| **Rally** | Triggers when the card is played from your hand. |
| **Last Stand** | Triggers when this unit dies. |
| **Frenzy** | Triggers the first time this unit survives damage. |
| **Loot** | Look at 3 cards from your own deck and put one in your hand; the others are shuffled back. (Never creates new cards, so decks stay predictable.) |
| **Dispel** | Remove all keywords, Shield and Gear effects from a unit. |
| **Cooldown N** | Your next turn starts with N less mana (applied once). |
| **Chill** | The unit cannot attack during its controller's next turn. |
| **Mend N** | Restore N Health to a character (up to its maximum). |
| **Armor N** | A Champion-only buffer; damage reduces Armor before Health. |

### 2.8 Class powers

Each Champion has one power, usable once a turn for 2 mana unless noted.

| Class | Power | Effect |
| --- | --- | --- |
| Warrior | Brace | Gain 2 Armor. |
| Paladin | Ward | Give a friendly unit Shield. (3 mana until 10 November 2026.) |
| Hunter | Call Companion | Summon a 1/1 Beast with Swift. |
| Rogue | Sinister Jab | Deal 1 damage to an enemy unit. |
| Priest | Mending Word | Mend 3 a friendly character. |
| Shaman | Stone Totem | Summon a 0/2 Totem with Guard. |
| Mage | Ember Spark | Deal 1 damage to any target. |
| Warlock | Soul Pact | Take 2 damage to your Champion, then draw a card. |
| Druid | Growth | Give a friendly unit +1/+1. |

### 2.9 Mulligan, comeback, stalls, draws, timers

- **Mulligan.** You see your opening hand and may replace any cards once; replaced cards are shuffled back after you draw. Opening-hand smoothing: each hand contains at least one card costing 2 or less (MTG Arena has a comparable idea, whose details sources dispute).
- **Second player help.** One extra card and the Loot Bag. Tuning target: first player wins 48 to 52% of games (section 8.3).
- **Second Wind.** The first time your Champion starts your turn with 6 Health or less, you draw an extra card and gain 2 Armor. Once per game.
- **Exhaustion / Sudden Death (stall breaker).** From the 8th round on, and at any time your own deck is empty, you take Exhaustion damage at the start of your turn: 2, then 4, 6, and so on (the counter is per player). (Before 10 November 2026: from round 13, 1, 2, 3.)
- **Draws.** If both Champions fall to 0 together the match is a draw (no rating change, no win-based quest progress). Hard cap: the match ends after round 9; the Champion who lost less Health (Armor counts as Health) wins, and equal losses are a draw. (Before 10 November 2026: round 20, always a draw.)
- **Timers (live).** 60 seconds per turn (90 on your first), a warning at 15 s. On timeout your turn ends automatically; three timeouts in a row forfeit the match. **Async:** 24 hours per turn, 3 missed turns forfeit, reminders via the app's on-device notifications.
- **Concede.** Any time; counts as a loss.
- **Disconnect (live).** State is on the server, so rejoining is seamless within a 90 s grace; during it your turn clock keeps running. A match is only lost by forfeit or timeouts. One free reconnect per day does not count toward timeout forfeits.
- **Match length.** Target 2 to 5 minutes (owner, 10 November 2026): median 7 rounds; see the balance review for the simulated times.

### 2.10 Deck building

- **24 cards, class + neutral.** Pick one class; you may use that class's cards and any neutral card.
- **Copies:** 2 of any card, **1** of a Legendary. Max **2 Legendaries** per deck. A deck may include **one** Guild Standard (it counts as one of the 24).
- **Starter decks:** one complete 24-card deck per class, free (Commons and Uncommons only), so everyone can play on day one. The first class is picked at the start; the others unlock after three matches with the starter of another class ("class trials").
- **Deck slots:** 10 saved decks; share a deck as a short code.

### 2.11 Sample turn walkthrough

Warrior (first player, "P1") against Mage ("P2"). Cards from section 8.

1. **P1, round 1** (1 mana, no draw). Plays **Gate Brawler** (2/1). It is exhausted. End.
2. **P2, round 1** (1 mana, draws, has the Loot Bag). Plays **Apprentice Spark** (1/2). End.
3. **P1, round 2** (2 mana, draws **Shield Wall Recruit**). Plays it (2/2 Guard). **Gate Brawler** attacks the Mage Champion (no Guard on that side): 20 to 18.
4. **P2, round 2** (2 mana + Loot Bag = 4). Draws **Rime Adept**, plays it (2/3). Rally: **Chill** the Shield Wall Recruit, which cannot attack on P1's next turn. Apprentice Spark stays home (it would have to attack the Guard).
5. **P1, round 3** (3 mana, draws **Cleaving Strike**). Plays it on Rime Adept: 3 damage kills it, so no recoil. Gate Brawler attacks: Mage 18 to 16. The Recruit is Chilled, so it stays. 1 mana unspent (Brace costs 2). End.
6. **P2, round 3** (3 mana, draws **Ember Bolt**). Casts it on Gate Brawler (3 damage, destroyed). Apprentice Spark has no target worth hitting. Board: P1 has the Recruit; P2 has Apprentice Spark. Champions: P1 20, P2 16.

The Mage is ahead on cards but behind on health. A Full Party bonus did not apply (no Healer on either board), and Second Wind is far away: a typical early game, roughly 2 minutes in.

## 3. Theme, factions and IP

### 3.1 The 9 classes and roles

Warrior, Paladin, Hunter, Rogue, Priest, Shaman, Mage, Warlock and Druid are the WoW Forever classes; they are generic English words. Identity in this set:

| Class | Role lean | Plays like |
| --- | --- | --- |
| Warrior | Tank / Damage | Armor, Guard bodies, Frenzy |
| Paladin | Tank / Healer | Shield, buffs, Mend |
| Hunter | Damage | Beasts, Swift, ranged damage |
| Rogue | Damage | Shadow, Venom, Loot, card flow |
| Priest | Healer | Mend, Drain, Last Stand |
| Shaman | Tank / Damage | Totems, Twin Strike, Cooldown |
| Mage | Damage / control | Spells, Chill, cost reduction |
| Warlock | Damage | Self-damage for cards, Drain, sacrifices |
| Druid | Healer / Tank | Growth, mana tricks, flexible choices |

### 3.2 Factions

A generic two-sided split: the **Sunward League** and the **Ashen Host** (placeholder names). A faction is a flavour tag on some cards and card backs; **it never restricts deck building**, and a few cards care about it ("League" or "Host"). This keeps the mood of the game without using the protected faction names.

### 3.3 Zones, Guild Standards and seasonal sets

- **Zones** are original analogues of dungeons and wild places (Emberdeep Chasm, The Sunken Mine, Wailing Warrens, Briar Hollow, Cairn of Kings, Ashfall Plain). Real dungeon names are not used (see 3.4).
- **Guild Standards (12)** are playable cards earned from real Guilded activity, one per achievement family (Dungeon, PvP, Social, Craft, Raid) and tier. They are **account-bound** (not tradeable), and the matching badge card from #626 stays as a cosmetic. This is the "guild card" idea: your play in the game funds a card in the card game.
- **Seasonal sets tied to the WoW Forever calendar.** Set 1 "Dawn of Forever" at launch. **Set 2 aligns with the first raids opening on 9 December**: three mini-sets of about 15 cards, one per raid size (10, 20 and 40 players), each with an original raid Zone and a Legendary boss, plus about 15 class and neutral cards (about 60 cards). Later sets follow the game's patches. After set 4 the oldest two sets rotate into a "Classic" format (a decision for later; not needed in year one).

### 3.4 IP: what we can name and what needs care

| Can name | Needs care or a legal check |
| --- | --- |
| The 9 class names, role words (Tank, Healer, Damage), generic fantasy words (Zone, Guard, Dungeon, Raid) | **"World of Warcraft", "Warcraft", "Azeroth", "Alliance", "Horde", "Forever"** as a product name. We may say "for players of WoW Forever" with the existing independence disclaimer; we do not name the game "WoW Forever Cards". |
| Original card, zone and faction names (this document's) | Any named dungeon, raid, boss, NPC or item from the game (for example the real dungeons, Onyxia, Hyjal, item names such as famous swords). We keep original analogues. |
| Generic mechanics (mana, units, spells, armor) | Hearthstone-specific words and text (Battlecry, Deathrattle, card names). We use Rally and Last Stand. Rules are not protected, but verbatim text and names are. |
| Our own art and the Guilded badge glyphs | Blizzard art, icons, logos, screenshots; and art generators prompted with Blizzard characters. The illustrations being generated must be prompted with original descriptions, not Blizzard names. |

During drafting, about 24 names that collided with WoW or Hearthstone terms were replaced (for example spell and item names), and `tests` should lock this: a **forbidden-names list** in the card data test fails the build if a card uses a listed protected term. **Recommendation:** an owner or lawyer check of the name list and the art prompts before the first store release; the project is non-commercial and free, which lowers but does not remove the risk. A WoW-themed card game sits closer to Blizzard's own Warcraft card game business than an add-on does, so this is the single most important legal check of the project.

## 4. Modes, matchmaking, engine

### 4.1 Modes

| Mode | Who | Rules |
| --- | --- | --- |
| **Practice vs AI** | Anyone | Three AI levels; no rating; counts for quests and the pack-per-3-wins track (capped). Always available. |
| **Dungeon run (PvE)** | Anyone | A gauntlet of 5 AI bosses with a Zone each; rewards packs and dust; a weekly featured run. Gives a single player a reason to play. |
| **Casual** | Anyone online | Live queue, no rating. |
| **Ranked** | Anyone | Seasonal ladder, below. |
| **Friendly challenge** | Two guildmates | Direct invite, live or async, any deck; bo1 or bo3; no rewards except quest credit (anti-farming). |
| **Guild vs guild event** | Two guilds | Each guild fields a team (5 to 10); each member plays one async match against a matching opponent; team score = wins; weekly/monthly event with a cosmetic reward and a result card posted in Discord. |

### 4.2 Ranked ladder

- Seasons are one month and match the existing monthly seasons. A hidden rating (Glicko-2) drives matchmaking; the visible ladder is **Initiate, Adept, Veteran, Elite, Legend** with four divisions each (Legend is a numbered leaderboard).
- Stars: win +1, loss -1 (no loss protection at Initiate and Adept), a win streak of 3 gives +2. Divisions need 3 to 5 stars. Season end: partial reset by rating.
- Rewards are cosmetic (card backs, frames, titles, a few packs); no power that is not available to everyone.
- **Guild ladder and global ladder.** Every server has its own ladder (your guild rank) and a hosted cross-server ladder; a match counts for both. Queue pools widen over time (rating window plus time in queue), and fall back to an AI opponent labelled as such (no rating change) after 45 seconds in off-peak hours.

### 4.3 Server-authoritative engine

- A pure, deterministic TypeScript module `tcg-engine.ts`: `createMatch(seed, decks)`, `legalActions(state, player)`, `apply(state, action)` returning the new state and an event list. All randomness comes from a seeded PRNG whose state is part of the match state; no use of `Math.random`.
- The phone receives a **projection** of the state (never the opponent's hand or deck order) and sends **intents** (play card X on target Y). The server validates every intent against `legalActions`.
- Every match is stored as `{seed, decks, actions[]}`; replaying the actions must reproduce the final state hash. That gives replays, audits and bug repro for free.
- **Transport.** The Worker gives up after 20 s and the site uses 12 s long polls ([CLAUDE.md](../../CLAUDE.md)); matches are discrete turns, so `GET match?since=N` long polls plus `POST action` suffice. On-device notifications cover async turns. Push notifications would need the Firebase setup that is still open for the Android app.

### 4.4 Anti-cheat and fair play

- Client authority is zero: no client-supplied results, randomness or hidden data.
- **Win-trading and collusion.** After three ranked matches against the same opponent in 24 hours, further games between them give no rating change; fast concede patterns and mirrored play are flagged to officers.
- **Bots.** Timing statistics per account (turn-time variance, 24/7 activity); suspicious accounts are queued for review, not auto-banned.
- **Alt accounts.** Accounts are tied to Discord plus a companion-linked character; ranked rewards and trading need an age and a match count (section 6).
- **Disconnect abuse.** Free reconnect limited per day; leaving a match you are losing is a forfeit, not a free exit.
- **Reports.** A "Report player" action with the replay attached, routed to the existing officer/report channel.

## 5. Economy

It builds on #626 (`tcg.ts`: 5-card packs, 4 Common/Uncommon slots plus 1 Rare-or-better slot, pity Epic 10 and Legendary 40, dust, daily pack every 20 h with a bank of 3). Changes needed for a competitive game:

| Topic | #626 today | Change for Clash |
| --- | --- | --- |
| Duplicates | Any duplicate becomes dust at once | Keep up to a **playset** (2 copies, 1 for Legendary); only extras become dust. Soft protection: packs prefer cards below the playset. |
| Crafting | Common 30, Uncommon 60, Rare 150; Epic and Legendary not craftable | Add **Epic 600, Legendary 1,600**. A competitive game needs every deck to be reachable without luck. |
| Dust from extras | C 5, U 10, R 25, E 100, L 400 | Keep. Add manual disenchant of extra copies at the same rates. |
| Catalogue | 27 class + one badge card per achievement | Add the 138 playable set cards. The 27 class cards become cosmetic **Champion portraits**; badge cards stay cosmetic; the 12 Standards are playable and bound. |
| Card counts | `TcgCard.count` | Add `boundCount` (achievement-granted copies, not tradeable). |
| Account | Keyed on `discordUserId` | Fine; reuse for decks, ratings and trades. |

**Sources of packs (all free):** the 20-hour daily pack (bank 3); **every 3 wins = 1 pack** (cap 3 a day from play, so grinding is bounded); 3 daily quests (each worth progress toward a pack; example: win 1, play 3 matches, cast 10 spells, play a Zone); weekly quest chain; season-end rewards; achievements (the Standard cards and badge cards). Estimated 2 to 3 packs a day for an active player.

**Simulated completion.** With the pack odds from #626, the playset rule and an 85% soft duplicate protection, spending dust on the cheapest missing card each time, a simulation of 60 players needed a **median of 183 packs** (p10 154, p90 206) to complete every playset of the 138 pack-obtainable cards, about two to three months at 2 to 3 packs a day. Full-collection craft value is 46,340 dust. Tuning is expected after real play.

**Nerf protection.** If a card is nerfed, owners may disenchant it at its full craft cost for 14 days. **Set rotation** is not used in year one.

**What cards are not.** No cash value, no EP/GP conversion, no effect on raid fairness ([MONETIZATION.md](MONETIZATION.md)). The app has no purchases of packs or cards. If that ever changes, the odds screen, law notes (section 6.3) and a legal check must come first.

## 6. Trading

### 6.1 Scope and rules

- **v1: guild-only swaps** between two members of the same Discord server. **Later:** cross-guild between servers that both switch it on, for accounts at least 30 days old.
- A trade is a **swap**: up to 5 cards each side, at least 1 card each way. Gifts exist only for Common and Uncommon extras (3 a day).
- **Value limit:** each card has a trade value (Common 1, Uncommon 3, Rare 10, Epic 40, Legendary 120). The two sides' totals must be within 25% or 5 points of each other, which stops lopsided "gifts" being used to funnel cards between accounts.
- **Window:** an offer expires after 24 hours. Both sides confirm on a screen showing every card; after any change both confirmations reset and a 10-second lock applies. No take-backs after confirm.
- **Cooldowns and caps:** 5 trades a day, 1 Legendary trade a week, a **24-hour trade lock** on cards just opened from a pack or crafted (stops open-and-flip behaviour).
- **Bound cards:** cards granted by achievements (Standards, badge cards) and any copy that came from a quest reward are **bound** to the account. Dust is never tradeable.
- **Eligibility:** both accounts need a linked character in the guild, 7 days of account age and 5 played matches.
- **Audit log:** every trade is stored (`TcgTrade`); officers see counts and flags, members see their own history. Officers can switch trading off per server (ROADMAP rule 5), and members can switch it off for themselves.
- **No money, no gold, no EP/GP, no outside-Discord trading hooks.** Terms of use say so; any detected sale or cash-out attempt removes trading for the account.

### 6.2 Abuse model

| Abuse | Control |
| --- | --- |
| Alt farming (collect rewards on many accounts, move to one) | Eligibility (linked character, age, match count), bound rewards, value balance, daily and weekly caps, flag when one account receives more than a threshold of net value in 7 days from accounts that never played ranked. |
| Bots farming wins/packs | Pack-per-win cap, timing statistics, no rewards from friendly matches, AI matches capped. |
| Real-money trading | No convertible currency, no marketplace, short trade window, audit log, ban on advertising trades in the bot's channels. |
| Scams (swap then regret) | Two-step confirm showing every card, 10 s locks, clear Rarity and art, no hidden value. |
| Account sharing | Discord identity plus companion credential; sudden location/device changes flagged. |

### 6.3 Store rules and law (not legal advice)

- **The key fact: the game sells nothing.** Packs are earned by playing and by timers, there is no payment and no cash-out, so there is no "consideration" or prize of money, which is what gambling definitions need. This is the design's main protection, and the reason trading never touches money.
- **Belgium.** The Belgian Gaming Commission concluded in April 2018 that *paid* loot boxes meet its definition of games of chance, with enforcement against some mobile games ([Inquirer summary](https://technology.inquirer.net/75306/loot-boxes-in-video-games-considered-criminal-offense-in-belgium), [Kotaku](https://kotaku.com/belgium-says-loot-boxes-in-games-like-overwatch-are-ill-1825533879)). A free-only game is outside that reasoning; the risk would appear only if we ever sold packs and allowed trading.
- **Netherlands.** Sources conflict: one reports it also treated loot boxes as illegal gambling; another says a fine against EA was reversed because the mechanic was part of the gameplay. The position has also shifted toward consumer-protection handling ([Osborne Clarke](https://www.osborneclarke.com/insights/loot-box-update)). Treat as unsettled.
- **Quebec and Canada.** No Quebec statute specific to loot boxes was found. The live questions are court class actions in Quebec and British Columbia (allegations, not rulings), and Quebec's Consumer Protection Act has banned advertising to children under 13 since 1978 ([Slater Vecchio class action](https://slatervecchio.com/wp-content/uploads/2024/10/loot-boxes-re-amended-application-for-authorization.pdf), [BC Supreme Court release](https://www.newswire.ca/news-releases/bc-supreme-court-says-loot-box-claim-may-proceed-803161241.html)). Free packs, no ads aimed at children, and no new personal data are the conservative answer. Quebec's Law 25 applies to match history and trades as personal data: they are covered by Delete my data.
- **Apple and Google.** Apple requires odds disclosure for paid randomised items ([PC Gamer](https://www.pcgamer.com/apple-now-requires-app-store-games-to-disclose-loot-box-odds/)); Google Play has comparable rules ([Fenwick](https://www.fenwick.com/insights/publications/google-play-now-requires-disclosure-of-loot-box-odds)). We show **odds on a screen in the app anyway** (#626 already exposes the table). Apple's and Google's wording for apps with no purchases was not checked in detail: confirm before store submission.
- **Before ever adding a purchase:** a lawyer check in Belgium, the Netherlands, Quebec and the store policies is required; this plan does not authorise it ([MONETIZATION.md](MONETIZATION.md)).

## 7. Balance method (summary; the card list is in section 8)

1. **Vanilla test.** A vanilla unit (no text) of cost *c* has **Attack + Health = 2c + 1** stat points (cost 1 = 2/1 or 1/2, cost 3 = 3/4, cost 5 = 5/6).
2. **Rate card** (points that count against the same budget):

| Item | Points | Item | Points |
| --- | --- | --- | --- |
| Guard | 1 | Twin Strike | 1.5 |
| Swift | 1.5 | Venom | 2 |
| Shield | 2 | Drain | 1 |
| Shadow | 1 | Loot | 2 |
| Dispel | 1 | Draw a card | 2 |
| 1 damage (unit) | 1 | 1 damage (Champion) | 0.7 to 1 |
| Mend 1 | 0.7 | +1 Attack or +1 Health (permanent) | 1 |
| Last Stand with a medium effect | 2 to 4 | Rally with a medium effect | 1 to 3 |

3. **Spells** budget about 1.5 x cost + 1.5 points; Gear about 1.5 x cost + 1; Legendary and Epic units may exceed the budget by up to 3 and 2.5 points (their text is the reason to run them); Common units must stay within 1 below to 1 above.
4. **Check in code.** The 103 units of set 1 were checked with this formula (20 had too few points and had their Health raised); all are now inside the tolerances. This script becomes a unit test of the card data.
5. **Simulation plan.** An AI self-play harness (greedy plus a one-ply search first, a Monte Carlo search later) runs 20,000 games per class pairing with the starter decks and with 3 tuned decks per class. Targets: every class between 45% and 55% against the field; first-player win rate between 48% and 52%; no card above 60% win rate when drawn; median match 6 to 9 rounds; fewer than 2% of games reach Exhaustion. Failures create a ticket for the card; a nightly CI job reports the matrix. After launch the same numbers come from real match logs (play rate and win rate per card).
6. **Change control.** Balance patches are data-only, versioned (`setVersion`), applied with the nerf-refund window.

Known weak spot of this first draft: **class identity is thin** (11 class cards against 39 neutral). The dedicated draft fixes it by moving 3 to 4 neutral cards per class into the class column before the art is final; the set-2 plan adds 12 or more class cards per class.

## 8. Card list v1: "Dawn of Forever" (150 cards)

Counts: 150 cards = 99 class (9 x 11), 33 neutral units/spells/gear, 6 Zones, 12 Guild Standards; 60 Common, 32 Uncommon, 27 Rare, 16 Epic, 15 Legendary. Of these 138 are obtainable from packs; the 12 Standards are earned.

Notes for reading the table: *Rally* triggers when played from hand; *Last Stand* when the unit dies; "Loot" always draws from the player's own deck. Stats are Attack/Health (Gear: bonus). Roles are derived (Guard = Tank, Mend = Healer, otherwise Damage). Flavour lines are placeholders for the writing pass and French translation.

### 8.1 The cards

#### Warrior

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 001 | Gate Brawler | Unit | Common | 1 | 2/1 |  | *He lost the argument and found the door.* |
| 002 | Cleaving Strike | Spell | Common | 2 | - | Deal 3 damage to a unit. If it survives, it deals 2 damage to your Champion. | *Not every swing is clean.* |
| 003 | Shield Wall Recruit | Unit | Common | 2 | 2/2 | Guard | *Stand where you are told.* |
| 004 | Scarred Veteran | Unit | Common | 3 | 3/3 | Frenzy: gain +2 Attack the first time this survives damage. | *Every scar is a lesson.* |
| 005 | Battle Cry | Spell | Uncommon | 3 | - | Give all friendly units +1 Attack this turn and Swift. | *Charge!* |
| 006 | Ironhide Captain | Unit | Uncommon | 3 | 2/3 | Guard. Rally: gain +1 Health per damaged friendly unit. | *He counts the wounded twice.* |
| 007 | Banner Carrier | Unit | Common | 4 | 3/4 | Rally: your Champion gains 2 Armor. | *Up the colours!* |
| 008 | Berserker Chieftain | Unit | Rare | 5 | 4/4 | Twin Strike | *Two swings, no questions.* |
| 009 | Unbroken Bulwark | Unit | Rare | 6 | 5/6 | Guard, Shield | *It outlasts the war.* |
| 010 | Warlord of the Pass | Unit | Epic | 7 | 7/7 | Guard. Rally: your Champion gains 6 Armor. | *The road ends here.* |
| 011 | Last Shield of the Vale | Unit | Legendary | 8 | 6/8 | Guard, Shield. Last Stand: your Champion gains 10 Armor. | *One more stand.* |

#### Paladin

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 012 | Chapel Acolyte | Unit | Common | 1 | 1/2 |  | *Keeps the candles lit.* |
| 013 | Boon of Strength | Spell | Common | 2 | - | Give a unit +3 Attack this turn. | *A hand on the shoulder.* |
| 014 | Oathsworn Squire | Unit | Common | 2 | 2/2 | Shield | *Sworn on his first day.* |
| 015 | Shieldmaiden | Unit | Common | 3 | 3/4 | Guard | *Shoulders first.* |
| 016 | Dawn Healer | Unit | Common | 4 | 3/3 | Rally: Mend 4 a friendly character. | *Light finds the hurt.* |
| 017 | Reckoning | Spell | Uncommon | 4 | - | Destroy a unit with 5 or more Attack. | *The scales tilt.* |
| 018 | Dawn Avenger | Unit | Rare | 4 | 3/3 | Shield. Rally: give a friendly unit Shield. | *Take mine too.* |
| 019 | Crusader of the Ember | Unit | Uncommon | 5 | 5/5 | Shield | *Burns brighter hurt.* |
| 020 | Sunward Marshal | Unit | Rare | 6 | 5/5 | Guard. Rally: give your other units +1/+1. | *League standard.* |
| 021 | Archon of the Sunspire | Unit | Epic | 7 | 6/6 | Shield, Drain | *A star pretending to be a man.* |
| 022 | Avatar of Aegis | Unit | Legendary | 8 | 7/7 | Guard, Shield. Rally: Mend 8 your Champion. | *The light bows to no one.* |

#### Hunter

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 023 | Trail Scout | Unit | Common | 1 | 2/1 |  | *First to the clearing.* |
| 024 | Hunting Wolf | Unit | Common | 2 | 3/1 | Swift | *Faster than the arrow.* |
| 025 | Snare Trap | Spell | Uncommon | 2 | - | Deal 4 damage to a unit that attacked this turn. | *Mind the grass.* |
| 026 | Pack Rat Trapper | Unit | Common | 3 | 3/3 | Rally: deal 1 damage to an enemy unit. | *Sets traps; trips on his own.* |
| 027 | Skewer Shot | Spell | Common | 3 | - | Deal 4 damage to a unit. | *One arrow. Plenty.* |
| 028 | Bow Master | Unit | Common | 4 | 4/3 | Rally: deal 2 damage to the enemy Champion. | *He never counts the arrows.* |
| 029 | Hawk Ranger | Unit | Uncommon | 4 | 3/3 | Swift. Rally: deal 1 damage to an enemy unit. | *Eyes on the road.* |
| 030 | Cave Stalker | Unit | Rare | 5 | 4/3 | Shadow, Swift | *You hear it after.* |
| 031 | Wildheart Beastmaster | Unit | Rare | 6 | 4/5 | Rally: summon a 3/3 Beast with Guard. | *The pack answers.* |
| 032 | King of the Marches | Unit | Epic | 6 | 6/4 | Swift. Rally: deal 3 damage to each enemy unit. | *The wild answers to him.* |
| 033 | Ancient Stag-Spirit | Unit | Legendary | 7 | 5/5 | Guard. Last Stand: summon two 3/3 Beasts with Swift. | *It never really dies.* |

#### Rogue

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 034 | Alley Cutpurse | Unit | Common | 1 | 2/1 |  | *Your purse is in my pocket.* |
| 035 | Cutthroat Strike | Spell | Common | 1 | - | Deal 3 damage to an undamaged unit. | *The oldest trick.* |
| 036 | Shadow Footpad | Unit | Common | 2 | 2/2 | Shadow | *Gone before you blink.* |
| 037 | Quick Fingers | Spell | Uncommon | 2 | - | Draw 2 cards. | *Look away.* |
| 038 | Swindler | Unit | Common | 3 | 2/4 | Rally: Loot a card from your deck: choose 1 of 3. | *Fingers fast.* |
| 039 | Venom Dagger Acolyte | Unit | Common | 3 | 2/2 | Venom | *Poisoned wit, poisoned blade.* |
| 040 | Assassin of the Veil | Unit | Uncommon | 4 | 3/2 | Shadow, Venom | *Whispers, then silence.* |
| 041 | Master Lockpick | Unit | Uncommon | 4 | 3/3 | Rally: draw a card. | *No lock stays shut.* |
| 042 | Nightblade Legend | Unit | Legendary | 5 | 5/2 | Shadow, Venom, Twin Strike | ** |
| 043 | Veilmaster | Unit | Rare | 6 | 5/3 | Shadow, Twin Strike | ** |
| 044 | Prince of Thieves | Unit | Epic | 6 | 5/7 | Shadow. Rally: steal a random card from the enemy hand. | *Everything is a loan.* |

#### Priest

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 045 | Temple Novice | Unit | Common | 1 | 1/2 |  | *Lights the candles.* |
| 046 | Hospice Healer | Unit | Common | 2 | 1/3 | At the end of your turn, Mend 1 a damaged friendly character. | *Every ward needs one.* |
| 047 | Radiant Lash | Spell | Common | 2 | - | Deal 3 damage to a unit. | *Burn.* |
| 048 | Circle of Mending | Spell | Uncommon | 3 | - | Mend 3 each friendly character. | *For the whole room.* |
| 049 | Spirit Warden | Unit | Uncommon | 3 | 2/2 | Last Stand: Mend 5 your Champion. | *Still watching.* |
| 050 | Cleric of the Veil | Unit | Common | 4 | 3/3 | Rally: Mend 4 a friendly character. | *Light finds the hurt.* |
| 051 | Herald of the Dawn | Unit | Uncommon | 5 | 4/4 | Rally: give a friendly unit +2 Health. | *His voice carries.* |
| 052 | Soul Binder | Unit | Rare | 5 | 3/4 | Drain. Last Stand: return this to your hand. | *Death is a door.* |
| 053 | Shadowhymn Confessor | Unit | Rare | 6 | 4/6 | Rally: Dispel an enemy unit and deal 2 damage to it. | *Silence, please.* |
| 054 | Resurrected Saint | Unit | Legendary | 6 | 4/4 | Shield. Last Stand: summon a copy of this with Shield. | *Sainthood is a process.* |
| 055 | Matriarch of the Order | Unit | Epic | 7 | 5/8 | Drain. Rally: Mend 5 each friendly character. | *Order, now.* |

#### Shaman

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 056 | Totem Tender | Unit | Common | 1 | 1/2 |  | *Always one stone away.* |
| 057 | Lightning Lance | Spell | Common | 2 | - | Deal 3 damage to a unit. Cooldown 1. | *Sky unspooled.* |
| 058 | Stoneward Totem | Unit | Common | 2 | 0/4 | Guard | *Hums when it is angry.* |
| 059 | Wind Rider | Unit | Common | 3 | 3/2 | Twin Strike | *Two for one.* |
| 060 | Spirit Link | Spell | Uncommon | 3 | - | Give a unit Shield and +2 Attack this turn. | *Not alone.* |
| 061 | Stormcaller | Unit | Uncommon | 3 | 2/2 | Rally: deal 2 damage randomly split among enemy characters. | *Thunder is a promise.* |
| 062 | Spirit Wolf Pack | Unit | Common | 4 | 3/3 | Guard. Rally: summon a 2/2 Wolf. | *They run together.* |
| 063 | Emberbrand Adept | Unit | Rare | 4 | 3/4 | Your Gear costs 1 less. Rally: gain +1 Attack for each Gear you control. | *Hands warm.* |
| 064 | Tempest Spirit | Unit | Rare | 5 | 4/4 | Twin Strike. Cooldown 1. | *Steel, wind and tempers.* |
| 065 | Earthmother's Avatar | Unit | Epic | 7 | 6/7 | Guard. Rally: summon two 2/3 Stone Totems with Guard. | *The mountain nods.* |
| 066 | Storm Colossus | Unit | Legendary | 8 | 8/10 | Twin Strike. Cooldown 2. | *Thunder wears a face.* |

#### Mage

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 067 | Apprentice Spark | Unit | Common | 1 | 1/2 |  | *Please stop touching that.* |
| 068 | Ember Bolt | Spell | Common | 2 | - | Deal 3 damage to any target. | *The classic.* |
| 069 | Rime Adept | Unit | Common | 3 | 2/3 | Rally: Chill an enemy unit. | *Cold as a creditor.* |
| 070 | Staff of the Archive | Gear | Common | 3 | +1/+2 | Equipped unit: whenever you cast a spell, deal 1 damage to a random enemy. | *Overdue.* |
| 071 | Archmage Disciple | Unit | Uncommon | 3 | 2/3 | Your spells cost 1 less. | *Quick study.* |
| 072 | Rime Lance | Spell | Uncommon | 3 | - | Deal 2 damage to a unit and Chill it. | *Cold shoulder.* |
| 073 | Mirror Illusionist | Unit | Uncommon | 4 | 2/3 | Rally: summon a copy of this with 1 Health. | *Look again.* |
| 074 | Chronomancer | Unit | Rare | 5 | 4/4 | Rally: your next spell this turn is free. | *Time is a courtesy.* |
| 075 | Whiteout Weaver | Unit | Rare | 6 | 4/5 | Rally: Chill all enemy units. | *Winter takes the floor.* |
| 076 | Meteor Fall | Spell | Epic | 7 | - | Deal 6 damage to each enemy unit. | *Night sky, brought down.* |
| 077 | Archmage of the Tower | Unit | Legendary | 7 | 5/8 | Rally: Loot a spell: choose 1 of 3 from your class. | *Knowledge is power. Power is knowledge.* |

#### Warlock

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 078 | Cult Initiate | Unit | Common | 1 | 2/1 |  | *Reads the wrong books.* |
| 079 | Blood Tithe | Spell | Uncommon | 1 | - | Deal 3 damage to your Champion. Draw 2 cards. | *What are friends for?* |
| 080 | Cursed Grimoire | Gear | Common | 2 | +0/+2 | Equipped unit: Last Stand: draw a card. | *Bound in something.* |
| 081 | Gloom Bolt | Spell | Common | 3 | - | Deal 4 damage to a unit. | *The oldest fear.* |
| 082 | Void Shade | Unit | Common | 3 | 2/4 | Guard | *Never asked for this.* |
| 083 | Pact Binder | Unit | Uncommon | 3 | 3/4 | Rally: sacrifice a friendly unit to draw 2 cards. | *The price was clear.* |
| 084 | Soul Siphoner | Unit | Common | 4 | 3/3 | Drain | *A little for me.* |
| 085 | Pact Overseer | Unit | Rare | 5 | 4/4 | Rally: destroy a friendly unit and gain +3/+3. | *Everything is a trade.* |
| 086 | Infernal Brute | Unit | Rare | 6 | 6/7 | Rally: deal 3 damage to each other unit. | *Subtle it is not.* |
| 087 | Dread Pretender | Unit | Epic | 7 | 7/7 | Drain. Rally: deal 4 damage to your Champion. | *Try again.* |
| 088 | Void Sovereign | Unit | Legendary | 8 | 7/11 | Drain. Rally: destroy all other units. | *The hollow king.* |

#### Druid

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 089 | Sapling Guardian | Unit | Common | 1 | 1/2 |  | *Takes root.* |
| 090 | Thornbark Vest | Gear | Common | 2 | +0/+3 | Equipped unit deals 1 damage to any attacker. | *Hug it.* |
| 091 | Bearskin Guardian | Unit | Common | 3 | 3/4 | Guard | *Has words with trespassers.* |
| 092 | Spring Bloom | Spell | Common | 3 | - | Mend 5 a friendly character and draw a card. | *Good rain.* |
| 093 | Overgrowth Sage | Unit | Uncommon | 3 | 2/3 | Rally: draw a card; your next card this turn costs 1 less. | *Patience grows.* |
| 094 | Grove Keeper | Unit | Common | 4 | 3/3 | Rally: give a friendly unit +2/+2. | *Water and wait.* |
| 095 | Grove's Fury | Spell | Uncommon | 4 | - | Choose: deal 4 damage to a unit; or give a friendly unit +3/+3. | *Choose a face.* |
| 096 | Treant Matriarch | Unit | Rare | 5 | 3/4 | Rally: summon two 1/2 Treants with Guard. | *The grove listens.* |
| 097 | Elder of Lore | Unit | Rare | 6 | 5/5 | Rally: choose: draw 2 cards; or Mend 6 your Champion. | *Old as the oak.* |
| 098 | Archdruid of the Moon | Unit | Epic | 7 | 6/8 | Shadow. Rally: Mend 6 your Champion and gain 2 temporary mana. | *The moon bends.* |
| 099 | Elder Tree Spirit | Unit | Legendary | 8 | 6/8 | Guard. Last Stand: summon a 4/4 Treant with Guard. | *One acorn, one forest.* |

#### Neutral units

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | Roadside Mercenary | Unit | Common | 1 | 1/2 |  | *Pays double after dark.* |
| 101 | Tavern Bard | Unit | Common | 1 | 1/1 | Rally: Mend 1 your Champion. | *A little song for the road.* |
| 102 | Militia Guard | Unit | Common | 2 | 2/3 |  | *Nine-to-five.* |
| 103 | Village Defender | Unit | Common | 2 | 1/3 | Guard | *It's his house.* |
| 104 | Wanderer of the Waste | Unit | Uncommon | 2 | 2/2 | Shadow | *Where is he? There.* |
| 105 | Field Medic | Unit | Common | 3 | 2/2 | Rally: Mend 3 a friendly character. | *Hold still.* |
| 106 | Fort Archer | Unit | Common | 3 | 3/2 | Rally: deal 1 damage to the enemy Champion. | *Aim high.* |
| 107 | Sellsword | Unit | Common | 3 | 3/4 |  | *Reliable until payday.* |
| 108 | Dungeon Warden | Unit | Uncommon | 3 | 2/3 | Guard. Rally: Mend 2 your Champion if you control a Zone. | *Keys on a ring.* |
| 109 | Sapper | Unit | Uncommon | 3 | 2/3 | Last Stand: deal 3 damage to a random enemy unit. | *Fuse lit.* |
| 110 | Cavalry Rider | Unit | Common | 4 | 4/3 | Swift | *Charge!* |
| 111 | Ogre Bruiser | Unit | Common | 4 | 5/4 |  | *Thinks slowly, hits fast.* |
| 112 | Relic Hunter | Unit | Common | 4 | 3/3 | Rally: Loot a card: choose 1 of 3 from your deck. | *Always brings something.* |
| 113 | Caravan Master | Unit | Uncommon | 4 | 3/3 | At the start of your turn, gain 1 temporary mana. | *Always one more crate.* |
| 114 | Crypt Delver | Unit | Uncommon | 4 | 3/3 | Swift | *Loves a vault.* |
| 115 | Duelist of the Third Gate | Unit | Rare | 4 | 4/2 | Swift. Role: Damage. +2 Attack while you control a Tank and a Healer. | *Hits hardest, falls first.* |
| 116 | Priest of the Third Gate | Unit | Rare | 4 | 2/3 | Role: Healer. At the end of your turn, Mend 2 each friendly unit. | *Heals through anything.* |
| 117 | Tank of the Third Gate | Unit | Rare | 4 | 3/4 | Guard. Role: Tank. Your Healer and Damage units gain +1 Health. | *Takes the hit.* |
| 118 | Raiding Party | Unit | Common | 5 | 5/4 | Rally: deal 2 damage to the enemy Champion. | *They ask nicely twice.* |
| 119 | Stone Golem | Unit | Common | 5 | 5/6 |  | *Not for sale.* |
| 120 | Bandit Captain | Unit | Uncommon | 5 | 5/4 | Rally: summon a 2/1 Bandit with Swift. | *Bring a friend.* |
| 121 | The Tavern Keeper | Unit | Legendary | 5 | 3/5 | Rally: both players Mend 8 their Champions. | *Sit. Eat. Don't break anything.* |
| 122 | Mountain Giant | Unit | Uncommon | 6 | 7/7 |  | *Rarely visited, never forgotten.* |
| 123 | Hero of the Hollow | Unit | Legendary | 6 | 6/8 | Shield. Rally: draw a card. | *Legend before lunchtime.* |
| 124 | Wyrm of the Ashen Peak | Unit | Rare | 7 | 7/7 | Rally: deal 4 damage to the enemy Champion. | *It remembers the village.* |
| 125 | Wandering Dragon | Unit | Epic | 8 | 8/10 | Swift | *Drops by.* |

#### Neutral spells

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 126 | Gambit | Spell | Common | 1 | - | Discard a card, draw 2 cards. | *Toss away the stale.* |
| 127 | Waylay | Spell | Common | 2 | - | Deal 2 damage to a unit and draw a card. | *Never fair.* |
| 128 | Fireside Rest | Spell | Uncommon | 3 | - | Mend 6 your Champion. | *Rest, in a hurry.* |
| 129 | Grave Robbery | Spell | Uncommon | 4 | - | Return the last friendly unit that died to your hand. | *Dig again.* |
| 130 | Whirling Blades | Spell | Epic | 5 | - | Deal 3 damage to each unit. | *Everyone, everywhere.* |

#### Neutral gear

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 131 | Battered Shield | Gear | Common | 2 | +0/+3 | Equipped unit has Guard. | *Dented, not dead.* |
| 132 | Dragonscale Mail | Gear | Epic | 4 | +0/+5 | Equipped unit has Shield and Guard. | *A dragon's regrets.* |

#### Neutral zones

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 133 | Emberdeep Chasm | Zone | Common | 2 | - | Burning: at the start of each turn, deal 1 damage to the unit with the lowest Health. | *Warm, in the worst way.* |
| 134 | The Sunken Mine | Zone | Common | 2 | - | Narrow: each side can control at most 4 units. | *Single file, please.* |
| 135 | Briar Hollow | Zone | Uncommon | 3 | - | Overgrown: at the end of your turn, Mend 1 each friendly unit. | *Gentle as thorns.* |
| 136 | Wailing Warrens | Zone | Uncommon | 3 | - | Echoes: Rally effects trigger twice. | *Say it again.* |
| 137 | Ashfall Plain | Zone | Rare | 4 | - | Smoke: Shadow units have +1 Attack; Rally damage dealt to Champions is reduced by 1. | *Cough, cough.* |
| 138 | Cairn of Kings | Zone | Rare | 4 | - | Ancient Ward: units entering play gain Shield until the end of the next turn. | *They are watching.* |

#### Neutral Guild Standards

| # | Name | Type | Rarity | Cost | Stats | Keywords and text | Flavour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 139 | Banner of the Duel | Standard (PvP) | Rare | 2 | - | Your Champion's class power costs 1 less. | *Honour, then steel.* |
| 140 | Flag of the Guild Hall | Standard (Social) | Rare | 2 | - | At the start of your turn, Mend 1 your Champion. | *Home is where the banners are.* |
| 141 | Sigil of the Forge | Standard (Craft) | Rare | 2 | - | Your Gear costs 1 less. | *Hammer and patience.* |
| 142 | Standard of the First Delve | Standard (Dungeon) | Rare | 2 | - | Your units that survive a turn gain +1 Health (max once each). | *First clears are earned, not given.* |
| 143 | Banner of the Battleground | Standard (PvP) | Epic | 2 | - | When you destroy an enemy unit, your Champion gains 1 Armor. | *Hold the line.* |
| 144 | Flag of the Chronicle | Standard (Social) | Epic | 2 | - | Your first card each turn costs 1 less if you control a Zone. | *Written in the wall.* |
| 145 | Sigil of the Master Artisan | Standard (Craft) | Epic | 2 | - | When a unit with Gear dies, return its Gear to your hand. | *Mend and reuse.* |
| 146 | Standard of the Deep Run | Standard (Dungeon) | Epic | 2 | - | At the start of your turn, if you control 3+ units, draw a card. | *Deeper every time.* |
| 147 | Banner of the Warlord's Ladder | Standard (PvP) | Legendary | 2 | - | Your units have +1 Attack on your turn. | *Rank is a weapon.* |
| 148 | Flag of the Hall of Fame | Standard (Social) | Legendary | 2 | - | When your Champion is below 10 health, draw 1 extra card at your turn start. | *Remember me.* |
| 149 | Sigil of the Raid | Standard (Raid) | Legendary | 2 | - | Role: at the start of your turn, if you control a Tank, Healer and Damage unit, deal 2 damage to the enemy Champion. | *Full party, full power.* |
| 150 | Standard of the Perfect Run | Standard (Dungeon) | Legendary | 2 | - | The first unit that would die each turn is returned to your hand instead. | *Not a scratch.* |

### 8.2 Set statistics

| Rarity | Count | Per-class (class cards) |
| --- | --- | --- |
| Common | 60 | 4 to 5 |
| Uncommon | 32 | 2 to 3 |
| Rare | 27 | 1 to 2 |
| Epic | 16 | 1 |
| Legendary | 15 | 1 |

Mana curve (units, spells, gear, zones): cost 1: 14, 2: 22, 3: 31, 4: 27, 5: 15, 6: 13, 7: 10, 8: 6; average cost 3.8, which with a mana cap of 8 and 24 cards gives a game that peaks around round 6.

## 9. Architecture and build plan

### 9.1 Where things go

| Area | Files |
| --- | --- |
| Engine and rules | `src/services/tcg-engine.ts` (pure), `tcg-effects.ts` (data-driven card effects), `tcg-cards-set1.ts` (the 150 cards as data), `tcg-ai.ts` (opponent and simulator) |
| Match and ladder | `src/services/tcg-match.ts` (store and projections), `tcg-matchmaking.ts`, `tcg-rating.ts` (Glicko-2 and stars), `tcg-season.ts` |
| Collection side | existing `tcg.ts`, `tcg-store.ts`, `tcg-catalogue.ts` (playset rule, craft Epic/Legendary, bound counts), `tcg-deck.ts`, `tcg-quests.ts`, `tcg-trade.ts` |
| Persistence | `prisma/schema.prisma` plus hand-written migrations: `TcgDeck`, `TcgMatch` (seed, decks, actions JSON, result), `TcgRating`, `TcgSeason`, `TcgChallenge`, `TcgTrade`, `TcgQuest`; `TcgCard.boundCount` |
| API | `src/companion-api.ts` routes under `/api/v1/companion/clash/*`; `worker/index.mjs` `apiMethods` |
| Discord | a small result/leaderboard post and challenge button via the existing card renderer (`score-card.ts`); `/officer stats cards` style switches (matches, trading) |
| Phone | `mobile/src/tcg/*` (battle screen, deck builder, challenge list, trade screen, rank screen), after the `mobile/` restructure |
| Docs | this file, a rules page on the site, French copy |

### 9.2 Stages

| Stage | Content | Needs |
| --- | --- | --- |
| **0** | Land #626; apply the economy changes in section 5 (playset, Epic/Legendary crafting, bound counts) | Owner approves this design |
| **1** | **Engine + set 1 data + replay tests + AI** as a headless library and CLI simulator; the balance matrix runs in CI. No UI. | Stage 0 not required |
| **2** | Decks, starter decks, practice vs AI and the PvE gauntlet; a minimal battle screen in the app | Painted art not required (placeholders) |
| **3** | Friendly and guild challenges, async turns, replays, quests, Discord result card | Notifications (on-device) |
| **4** | Casual and ranked: live queue, rating, seasons, reconnect, cross-server ladder, fair-play flags | Enough testers |
| **5** | Trading (guild-only) with the limits in section 6 | Eligibility data |
| **6** | Guild-vs-guild events; set 2 for the 9 December raids; French rules and card text | Art for set 2 |

Each stage ships behind the officer and member off switches (ROADMAP rule 5) and does not bump the version by itself.

### 9.3 Test strategy

- **Deterministic engine:** the same `seed + actions` always give the same state hash; tests assert it across 1,000 recorded games (golden replays committed as fixtures).
- **Property tests:** random legal play for 100,000 games per class pair checks invariants (health never above the maximum, board never above 5, hand never above 8, every game terminates, no hidden-information leak in projections).
- **Card tests:** every card has a table-driven test generated from the data (cost, stats, text keywords, effect result on a prepared board); the budget check of section 7 and a forbidden-names check are tests too.
- **Economy tests** reuse #626's injected-RNG style: odds, pity, playset, crafting costs, trade value rules, trade concurrency (double confirm) and bound cards.
- **Engine vs store:** integration tests with the in-memory database used by `tests/tcg-store.test.ts`.
- **Real-client checks** (owed for any phone UI) remain manual, as for the rest of the app.

## 10. What the owner must decide

1. **Approve the core rules** (24-card decks, mana 1 to 8, 20 Health, 5-slot boards, Zones, Standards), or ask for another shape (bigger decks, lanes like Snap).
2. **Working title.** "Guilded Clash"? The game cannot carry "Warcraft", "Azeroth" or "Forever" in its name.
3. **Faction names** (Sunward League and Ashen Host are placeholders).
4. **Class thickness.** Move 3 to 4 neutral cards per class into the class column now (recommended) or ship thin and add in set 2.
5. **Economy changes to #626:** allow Epic and Legendary crafting (recommended), playset duplicate rule, bound achievement cards.
6. **Population plan:** build AI opponents and the PvE gauntlet before ranked (recommended), and decide whether the global ladder spans every hosted server.
7. **Trading scope for v1:** guild-only swaps with the limits in section 6 (recommended), or delay trading until after ranked.
8. **Trade limits** (5 per day, 1 Legendary per week, 24 h lock, value window 25%): accept or adjust.
9. **Guild Standards:** accept that they are playable but bound and tied to achievements.
10. **Async turn length** (24 h) and whether ranked is live-only.
11. **Ranked season length** (monthly, matching the dungeon seasons) and the rank names.
12. **Legal check:** who checks the name list and the art prompts before the first store release, and is the Apple/Google wording check part of Android launch?
13. **Set 2 scope for 9 December** (about 60 cards, three raid mini-sets), or push to January.
14. **Art:** the painted illustrations need the same card structure (name, art window, type line, text box); confirm that the 150 cards, not only classes, are being illustrated, and whether a Zone gets a wide art crop.
15. **Money:** the plan stays purchase-free. Any future purchase needs its own approval and a legal review first.

## Sources

- Hearthstone: [Deck](https://hearthstone.wiki.gg/wiki/Deck), [Fatigue](https://hearthstone.wiki.gg/wiki/Fatigue), [Reconnection feature](https://hearthstone.wiki.gg/wiki/Reconnection_feature), [Concede](https://hearthstone.wiki.gg/wiki/Concede), [Pity timer](https://hearthstone.wiki.gg/wiki/Pity_Timer)
- MTG Arena: [opening-hand smoothing](https://mtgazone.com/mtg-arenas-opening-hand-algorithm-and-smoothing/), [Draftsim Bo1 smoothing](https://draftsim.com/mtg-arena-bo1-hand-smoothing/), [beginner's guide](https://sites.google.com/view/asap-bg-to-mtga/inner-workings)
- Marvel Snap: [Shacknews](https://shacknews.com/article/132689/how-to-play-marvel-snap), [Marvel.com](https://marvel.com/articles/games/a-starter-guide-on-how-to-play-marvel-snap), [Collector's Tokens](https://marvelsnapzone.com/collector-tokens/)
- Legends of Runeterra: [Inven](https://invenglobal.com/articles/9832/guide-how-do-you-build-a-deck-in-legends-of-runeterra), [Mobalytics](https://mobalytics.gg/blog/legends-of-runeterra-guide/)
- Pokémon TCG Pocket: [Serebii battles](https://serebii.net/tcgpocket/battles.shtml), [Pokémon.com deck building](https://www.pokemon.com/uk/strategy/learn-how-to-build-a-deck-in-pokemon-tcg-pocket), [trade tokens to shinedust](https://esports.gg/news/pokemon-tcg-pocket/pokemon-tcg-pocket-to-remove-trade-tokens-and-require-shinedust-for-trades), [Pocket Tactics](https://www.pockettactics.com/pokemon-tcg-pocket/trade-tokens)
- Shadowverse Evolve: [Comprehensive Rules 1.31](https://en.shadowverse-evolve.com/wordpress/wp-content/uploads/2023/07/14102706/SVEE-Comprehensive-Rules-1.31-July-11-2023.pdf)
- Artifact and RMT: [mein-mmo](https://mein-mmo.de/en/steam-flop-artifact-aims-to-do-everything-better-with-2-0-removes-card-trading), [PCGamesN](https://www.pcgamesn.com/artifact/beta), [Lost Ark RMT](https://piunikaweb.com/blog/lost-ark-rmt-breaking-game-economy-players-are-frustrated)
- Law: [Belgium (Inquirer)](https://technology.inquirer.net/75306/loot-boxes-in-video-games-considered-criminal-offense-in-belgium), [Kotaku](https://kotaku.com/belgium-says-loot-boxes-in-games-like-overwatch-are-ill-1825533879), [Osborne Clarke](https://www.osborneclarke.com/insights/loot-box-update), [Quebec class action](https://slatervecchio.com/wp-content/uploads/2024/10/loot-boxes-re-amended-application-for-authorization.pdf), [BC Supreme Court](https://www.newswire.ca/news-releases/bc-supreme-court-says-loot-box-claim-may-proceed-803161241.html), [Apple odds rule](https://www.pcgamer.com/apple-now-requires-app-store-games-to-disclose-loot-box-odds/), [Google Play](https://www.fenwick.com/insights/publications/google-play-now-requires-disclosure-of-loot-box-odds)
- Pack odds and economy in this repo: PR #626 `src/services/tcg.ts`; [APP_TCG.md](APP_TCG.md); [APP_TCG_ART.md](APP_TCG_ART.md)
