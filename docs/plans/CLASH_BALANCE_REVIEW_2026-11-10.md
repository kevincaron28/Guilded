# Guilded Clash balance review (10 November 2026)

Owner request (10 November 2026): review the base game, the cards and how they interact, and make the balance and core
mechanics keep **every match between 2 and 5 minutes, never more**. This lands before the Google Play closed-testing build.

All numbers below come from `scripts/clash-sim.ts` (`npm run clash:sim -- --games 40 --pve 6 --hard 4`). It plays the real
engine (`src/services/tcg-engine.ts`) with the real AI (`src/services/tcg-ai.ts`) on both seats, across all 72 ordered class
pairs. Each class rotates through its starter deck and three tuned decks, and the run also plays the five PvE bosses and a
hard-vs-hard sample.

## 1. Summary

| | Before (live today) | After (this PR) |
| --- | --- | --- |
| Rounds: median / p95 / max | 8 / 11 / 15 | 7 / 9 / **9 (hard cap)** |
| **You vs the AI** (Practice, gauntlet): median / p95 / max | 3:02 / 4:38 / 7:28 | **2:32 / 3:29 / 4:28** |
| You vs the AI, share over 5 min | 2.7% | **0.0%** |
| Hard AI vs hard AI, vs-AI time p95 | 5:58 | 3:58 |
| Gauntlet boss runs, worst p95 (boss 1) | 6:14, 22% over 5 min | 3:46, 0% over 5 min |
| **Two people live** (friendly duel): median / p95 / max | 5:08 / 7:45 / 12:00 | 4:19 / 5:45 / 7:26 |
| Two people live, share over 5 min | 54.8% | 20.4% |
| First player win rate | 48.8% | 50.6% |
| Class win rates (field) | 46.6 to 55.5% | 44.8 to 58.9% (see 6.3) |
| Draws | 0% | 0% (0.9% end on the round cap, decided on Health) |

In short:
- **Matches against the AI** (Practice, the gauntlet) now fit 2 to 5 minutes in every simulated game.
- **Two people playing live** get a median of 4:19, but 1 match in 5 still runs past 5 minutes. They both read and think, so
  a round takes about twice as long. A turn-count rule cannot guarantee "never more than 5 minutes" for two people: only a
  clock can. That is decision Q1 in section 8.
- **Ranked duels** are asynchronous today (24 hours a turn), so a ranked match lasts days, not minutes (Q2).

## 2. The rules as built (before this PR)

| Rule | Engine (before) | Notes |
| --- | --- | --- |
| Champion Health | 20, cannot be healed above 20 | PvE bosses 20 / 22 / 24 / 26 / 30 |
| Deck | exactly 24 cards; 2 copies (1 Legendary); max 2 Legendaries; max 1 Guild Standard | |
| Opening hand | first player 3, second player 4 + Loot Bag (0 cost, +2 temporary mana once) | smoothing: at least one card costing 2 or less |
| Mulligan | once each, first player first | the Loot Bag cannot be mulliganed |
| Mana | turn n has min(n, 8); temporary mana up to 10 | Cooldown N takes N off your next turn |
| Turn | start: ready, refresh mana, draw 1 (the first player skips the first draw), Second Wind, Burning Zone, start-of-turn effects; main: play / attack / power in any order; end: end-of-turn effects, temporary effects expire | no stack, everything resolves at once |
| Class power | once a turn, 2 mana (Paladin's Ward 3) | |
| Board / hand | 5 units (4 with The Sunken Mine), 8 cards (extra draws burn) | |
| Combat | simultaneous damage; Guard must be attacked first; Shadow cannot be attacked or targeted until it attacks; no damage back from Champions | |
| Keywords on units | Guard, Swift, Shield, Shadow, Venom, Drain, Twin Strike | |
| Effects | Rally, Last Stand, Frenzy, Loot, Dispel, Cooldown, Chill, Mend, Armor | |
| Card types | Unit, Spell, Gear, Zone (shared, replaces), Standard (yours, permanent) | Full Party (Tank + Healer + Damage at turn start): first card costs 1 less |
| Second Wind | once, at 8 Health or less at your turn start: draw 1, +2 Armor | |
| Exhaustion | from round 13, or with an empty deck: 1, 2, 3... at your turn start | |
| Round cap | round 20 ends the match as a draw | |
| Win | enemy Champion at 0 Health; both at 0 is a draw | |
| Timers | vs AI 24 h a turn; friendly duel live 60 s or async 24 h; **ranked 24 h a turn (async)** | **a missed turn clock forfeits the whole match** |

### Inconsistencies found

1. **Turn timeouts.** The design (`APP_TCG_GAME.md` 2.9) says a live timeout ends your turn, and three in a row forfeit. The
   server (`forfeitIfOverdue` in `tcg-duel.ts` and `tcg-match.ts`) forfeits the whole match on the first missed clock. The
   design's 90 s first turn and 15 s warning are not built either. Not changed here (Q3).
2. **Ranked is asynchronous.** Ranked pairing creates `live: false` duels with 24-hour turns, so the 2 to 5 minute target
   cannot hold for ranked (Q2).
3. **Pact Binder and Pact Overseer** ("sacrifice a friendly unit to draw 2"; "destroy a friendly unit and gain +3/+3") drew 2
   and grew +3/+3 even with nothing to sacrifice. Under the Echoes Zone, the Overseer grew +6/+6 for one sacrifice. **Fixed.**
4. **Resurrected Saint** ("Last Stand: summon a copy of this with Shield") came back forever: the copy had the same Last Stand,
   and Dispel did not remove Last Stand. It was effectively unkillable. **Fixed**: the copy has no Last Stand (text updated).
5. **Dispel** is defined as "remove all keywords", and the design lists Last Stand, Frenzy and Rally among the keywords. The
   engine only removed the unit keywords and Gear effects, so a Dispelled unit kept its Last Stand, Frenzy, turn effects and
   auras. **Fixed**: a Dispelled unit is now `quiet`.
6. **Snare Trap** said "a unit that attacked this turn", but spells are only cast on your own turn, so taken literally it could
   only hit your own units. The engine actually allows a unit that attacked on the opponent's last turn, which is the useful
   reading. **Text fixed** (EN and FR): "a unit that attacked since your last turn".
7. **Emberbrand Adept** (Shaman: "Your Gear costs 1 less; Rally: +1 Attack per Gear") has dead text. Since the 8 November
   class move, Shaman has no Gear at all. Not changed (Q5).
8. The design doc said the first player draws 3 and skips the first draw, and that Ward costs 3. Both changed in this PR, and
   the doc is updated.

## 3. Method and time model

- **Engine:** unchanged code paths. `withRules()` lets the simulator try other match-length numbers; live matches always use
  `DEFAULT_RULES`.
- **Decks:** for each class, the free starter deck and the three tuned decks from `buildDeck` (the same as `clash:selfplay`).
- **PvE:** each class's starter deck and tuned deck against all five bosses (Zone in play, boss Health, the boss's AI level).
- **Time model** (`TIME` in `scripts/clash-sim.ts`): per turn, 4 s to read the board plus 0.4 s per card in hand. Then per move:
  play 3.5 s (5.5 s with a target, +2 s to pick a mode), attack 3.5 s, power 3 s (4.5 s targeted), Loot choice 5 s,
  end turn 1.5 s. Each move adds a 0.7 s server round trip. Mulligan 8 s. A turn is capped at the live turn clock (60 s; the
  design's 90 s on the first turn). Against the AI: the AI's measured compute time plus 1.2 s per AI move to read it (the app
  shows the result, with no animation).
  - This averages about 18 to 20 s per human turn, in line with phone card games. No simulated turn hit the 60 s clock.
  - Treat absolute minutes as ±25%. The before/after comparisons are what matter.

## 4. Measurements before the change (live code, old AI)

`--games 40 --pve 6 --hard 4`: 2,880 matrix games, 288 hard, 540 PvE.

| Set | Rounds med / p95 / max | Live PvP med / p95 / max (>5 min) | vs AI med / p95 (>5 min) | Exhaustion |
| --- | --- | --- | --- | --- |
| Matrix (normal AI) | 8 / 11 / 15 | 5:08 / 7:45 / 12:00 (54.8%) | 3:02 / 4:38 (2.7%) | 1.7% |
| Hard vs hard | 9 / 13 / 18 | 6:11 / 9:43 / 13:12 (78.5%) | 3:44 / 5:58 (14.2%) | 10.1% |
| Boss 1 (easy, Burning) | 10 / 16 / 18 | 6:01 / 9:60 (76.9%) | 3:45 / 6:14 (22.2%) | 20.4% |
| Boss 2 to 5 | 7-8 / 10-12 / 11-13 | 4:49 to 5:36 median | 2:49 to 3:16 / up to 4:51 | 0-2% |

Win rates: first player 48.8%. Warrior 49.5, Paladin 48.9, Hunter 46.6, Rogue 48.8, Priest 55.5, Shaman 49.1, Mage 48.0,
Warlock 51.9, Druid 51.9. Starter decks 41.9% against the tuned decks. No round-cap draws, no stuck games.

**The AI held cards forever.** The old AI never played (0% of games where the card was in the deck): all Gear (Staff of the
Archive, Cursed Grimoire, Thornbark Vest), the Zones (Emberdeep Chasm, The Sunken Mine), Boon of Strength, Relic Hunter, Dread
Pretender, Cave Stalker and Crypt Delver. It played Hunting Wolf and Elder Tree Spirit almost never, and Wandering Dragon in 7%
of games. Its evaluation valued a card in hand (0.6 × (2·cost + 1) + 0.4) above the same card on the board, and its one-move
search could not see a Swift unit's attack. That made bosses weaker, and the card win rates measured the AI rather than the
cards.

## 5. Card and interaction review

| Area | Finding | Action |
| --- | --- | --- |
| Infinite loops | Resurrected Saint (above). No other self-renewing effect: Soul Binder returns to hand (costs 5 each time); the Perfect Run Standard saves one unit a turn. | Fixed |
| Uncounterable | Saint (fixed). Shadow units can still be hit by "any target" spells to the Champion and by area damage, and lose Shadow when they attack. Nightblade Legend (Shadow, Venom, Twin) is strong but answerable by area damage. | none |
| Free value | Pact Binder / Pact Overseer without a sacrifice, and the Overseer twice under Echoes. | Fixed |
| Keyword combos | Echoes × Mirror Illusionist gives 2 copies (intended: "Rally triggers twice"). Echoes × Shadowhymn Confessor double-Dispels and hits twice (fine). Cairn of Kings Shield × Venom: Shield blocks Venom (correct by the rules). Twin Strike × Venom kills 2 a turn (Legendary, fine). | none |
| Stalling | Healing (Priest's 3-a-turn power, Tavern Keeper's Mend 8 for both, Avatar's Mend 8), Warrior's Armor and the Burning Zone made long games. Boss 1 had 20% of games reach Exhaustion. | Sudden Death, round cap, Tavern Keeper 8 → 6 |
| Dead cards | Emberbrand Adept (no Shaman Gear). Gear-cost Standards (Sigil of the Forge, Sigil of the Master Artisan) only matter for the 5 classes that have Gear. With the new AI, Relic Hunter, Grave Robbery, Dread Pretender and the two cheap Zones are still never or rarely played. The AI cannot judge Loot, Zones or returning a dead unit. That is an AI limit, not proof the cards are bad. | Q5 |
| Rules vs text | Snare Trap wording; Dispel (above). French numbers are already checked by `tests/tcg-cards-set1-fr.test.ts`. Every English text was checked against its effect numbers. | Fixed |

Per card, with the final rules and the new AI, at least 144 games each:
- **Highest win rate when played:** Last Shield of the Vale 87%, Sunward Marshal 81%, Wandering Dragon 80%, Unbroken Bulwark
  79%, Warlord of the Pass 76%, Scarred Veteran 75%, Battle Cry 74%.
  - These are mostly expensive or late-game cards: a card played in a game you were already winning scores high. Of the cards
    that are played in many games, the Warrior cards stand out (6.3).
- **Lowest:** Archmage of the Tower 17%, Staff of the Archive 28%, Void Sovereign 31%, The Tavern Keeper 31%, Spring Bloom 32%,
  Boon of Strength 34%, Circle of Mending 35%.
  - Healing and card-draw cards lose value in shorter games. That is expected, and acceptable for the target length.

The full tables are in the simulator's JSON output (`--json`).

## 6. Changes, ranked by impact

Each step adds one change on top of the one before. All rows use the new AI and the card fixes. Numbers are from
`--games 20 --hard 2 --seed 41` (1,440 + 144 games each). The "alone" column is that change by itself on top of row 0.

| # | Change | vs AI med / p95 | Live PvP med / p95 / max | Rounds p95 / max | First player | Alone (vs row 0) |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | New AI and card fixes, old rules | 2:50 / 4:13 | 4:47 / 7:00 / 10:20 | 10 / 14 | 47.4% | |
| 1 | **Health 20 → 16** (Second Wind 8 → 6), PvE bosses 16 / 18 / 20 / 22 / 24 | 2:32 / 3:47 | 4:16 / 6:16 / 9:32 | 9 / 13 | 47.0% | same as this row |
| 2 | **Sudden Death**: Exhaustion from round 8 (was 13), growing by 2 (2, 4, 6...) | 2:31 / 3:28 | 4:16 / 5:44 / 7:27 | 9 / 11 | 44.9% | 2:47 / 3:46; PvP 4:44 / 6:10 / 7:39 |
| 3 | **Round cap 9** (was 20); Health lost (Armor counting) decides it, equal is a draw | 2:31 / 3:28 | 4:16 / 5:43 / 7:11 | 9 / **9** | 44.8% | PvP p95 6:27, 8.3% of games end on the cap |
| 4 | **First player draws on turn 1** | 2:33 / 3:28 | 4:20 / 5:48 / 7:01 | 9 / 9 | 50.7% | first player 54.0% |
| 5 | **Class numbers** (6.2) | 2:31 / 3:27 | 4:18 / 5:46 / 7:03 | 9 / 9 | 50.1% | spread 41-59% → 45-56% |

The final 40-games-per-pair run is in section 1.

1. **Health** moves the median most (about 15% shorter).
2. **Sudden Death** cuts the tail: max 9:32 → 7:27, and vs-AI p95 drops under 3:30.
3. **The round cap** is the hard ceiling: 18 turns. With the turn clock that is a worst case of 18 minutes in theory, 7:26 in
   all simulated games.
4. **First draw** fixes the first-player rate, which drops to about 45% once games get short.
5. **Class numbers** fix the class spread.

### 6.1 Rules (implemented)

- `START_HEALTH` 20 → 16; `SECOND_WIND_HEALTH` 8 → 6; PvE boss Health 20 / 22 / 24 / 26 / 30 → 16 / 18 / 20 / 22 / 24.
- `EXHAUSTION_ROUND` 13 → 8; new `EXHAUSTION_STEP` 2. Empty-deck Exhaustion uses the same step.
- `DRAW_ROUND` 20 → 9. After round 9 the match ends. The Champion who lost less Health wins, counting Armor as Health; this is
  fair against bosses with more Health. Equal losses are a draw (0.9% of games end on the cap; under 0.3% are draws).
- The first player now draws on turn 1. The second player keeps one extra card and the Loot Bag.
- Tried and dropped:
  - Starting with 2 mana: it pushed the first-player rate to 40%.
  - Loot Bag 2 → 1: first player 56 to 59%.
  - Second player's opening hand 4 → 3: first player 53%.
  - Exhaustion ignoring Armor: no measurable difference.
  - Health 15 or 14: about 10 s faster, but Sudden Death then ends 57% of games instead of 30%, which feels like a timer
    rather than a fight.

### 6.2 Card and power numbers (implemented, EN and FR text updated where the text has the number)

| Card | Before | After | Why |
| --- | --- | --- | --- |
| Paladin power Ward | 3 mana | 2 mana | Paladin was 39-44%; the other eight powers cost 2 |
| 012 Chapel Acolyte | 1/2 | 2/2 | Paladin |
| 016 Dawn Healer | 3/3 | 3/4 | Paladin |
| 019 Crusader of the Ember | 4/5 | 5/5 | Paladin |
| 082 Void Shade | 3/3 | 3/4 | Warlock was 29-43% (its self-damage costs more at 16 Health) |
| 084 Soul Siphoner | 4/3 | 4/4 | Warlock; the design had flagged it as low ("the harness will say whether it needs +1 Health") |
| 037 Quick Fingers | 2 mana | 1 mana | Rogue was 37-45% |
| 040 Assassin of the Veil | 3/3 | 4/3 | Rogue |
| 121 The Tavern Keeper | both Mend 8 | both Mend 6 | Stall card in every boss deck; scaled with Health |
| 124 Wyrm of the Ashen Peak | 4 to the enemy Champion | 3 | Mage was 58-62% once Health dropped (direct damage is worth more) |

All stay inside the card-budget tolerances (`tests/tcg-cards-set1.test.ts`).

Measured and dropped:
- A cheaper Soul Pact (take 1 instead of 2) made the AI's Warlock *worse* (35.6% against 40.0%): the AI then spends its turns
  drawing.
- Brace at +1 Armor made the AI's Warrior *stronger* (69% against 62%): same effect.
- Rogue's Jab at 2 damage did not move Rogue.

### 6.3 Class balance after the change

| Class | Final (2,880 games, 640 per class) |
| --- | --- |
| Warrior | 58.9% |
| Paladin | 56.1% |
| Hunter | 54.5% |
| Warlock | 48.4% |
| Mage | 46.7% |
| Druid | 46.9% |
| Shaman | 47.3% |
| Priest | 46.1% |
| Rogue | 44.8% |

- Noise is about ±3 points per class: across seeds, Warrior read 54 to 59 and Rogue 41 to 49.
- **Warrior** is the clearest remaining outlier: its Guard and Armor cards top the win-when-played list. Nerfing Brace backfired
  with this AI (above).
- The design target is 45 to 55% for every class. Warrior and Paladin are slightly over, and Rogue sits at the lower edge.
- Recommended next pass, after real Play-test data: Unbroken Bulwark (6 mana 3/5 Guard Shield) and Battle Cry are the Warrior
  candidates.
- Real players will not play like this AI. The card-level numbers are a guide, not a verdict.

### 6.4 The AI (implemented)

- Hand weight 0.6 → 0.45, plus a value for a Swift unit's attack this turn and for Gear effects.
- The new AI beats the old one 63.4% (normal, 243 games) and 64.2% (hard, 162 games).
- It now plays Gear, cheap Swift units and Boon of Strength.
- It still never plays Relic Hunter (Loot), Grave Robbery, Dread Pretender or the two cheap Zones. A one-move search cannot see
  their value.
- Gauntlet win rates for the player, with each class's starter and tuned decks: boss 1 62%, 2 47%, 3 37%, 4 43%, 5 19%.
  Before: 82 / 41 / 36 / 36 / 22.
  - Boss 1 is no longer a walkover, because the easy AI now plays its cards.
  - Boss 5 is the wall, as designed.

## 7. What this PR changes

- **Engine** (`tcg-engine.ts`):
  - The match-length rules are now named constants, gathered in `DEFAULT_RULES` with a `withRules()` override for the
    simulator.
  - The new numbers from 6.1.
  - The cap decision on Health lost.
  - Sacrifice abilities (`needsTarget`).
  - Dispel and the Saint's copy are `quiet`. `UnitState.quiet` is optional, so matches stored before the deploy still load.
- **Cards** (`tcg-cards-set1.ts`, `tcg-cards-set1-fr.ts`, and the app's generated `mobile/src/clash/set1*.ts`): 6.2, plus the
  Saint and Snare Trap text.
- **AI** (`tcg-ai.ts`): 6.4.
- **PvE** (`tcg-pve.ts`): boss Health, and the player starts at `START_HEALTH`.
- **Simulator** `scripts/clash-sim.ts` (`npm run clash:sim`); tests for each fix and the new rules; `APP_TCG_GAME.md` rule
  lines updated.
- **Not changed:**
  - Timers and the duel service (Q1 to Q3), art, card names, which cards exist.
  - The version number.
  - A replay of a match finished before the deploy will no longer reproduce its stored hash: the rules changed. Only audits
    read replays.
  - Matches in progress at deploy time continue under the new rules from their stored state. An old match already past
    round 9 ends at the next turn change.

## 8. Questions for the owner

**Q1. A hard 5-minute ceiling for two people playing live.** Turn-count rules give a median of 4:19 and a p95 of 5:45. Nothing
short of a clock guarantees "never more than 5 minutes".

- **A. A match clock (recommended).** Each player has 2:30 for the whole match, chess style, and it only runs on your own turn.
  When yours runs out, your turns end as soon as you make one move. At 5:00 total, the match ends with the round-cap rule
  (Health lost decides). Needs a small engine action ("time up") and duel-service work.
- **B. A shorter turn clock only.** Live 60 s → 30 s. Cheap, but it caps only slow turns: typical matches are unchanged (no
  simulated turn hit 60 s) and the worst case stays above 5 minutes.
- **C. Accept the current numbers for live duels.** The 2 to 5 minute goal then applies to matches against the AI only.

**Q2. Ranked duels are asynchronous (24 hours a turn).** A ranked match lasts days.

- **A. Make ranked live (recommended).** Both players are in the waiting room when they are paired. It needs Q3 first, or one
  slow turn loses a ranked match.
- **B. Keep async ranked**, and set the 2 to 5 minute goal for live play only.

**Q3. A missed turn clock forfeits the whole match.** The design says the turn ends and three in a row forfeit.

- **A. Build the design (recommended):** the turn auto-ends (Loot: first option; mulligan: keep), and three in a row forfeit.
  Needed before shorter clocks or live ranked.
- **B. Keep the forfeit** and only lengthen the first turn to 90 s.

**Q4. Warrior at about 59%.**

- **A. Wait for Play-test data** (recommended; this AI over-rates Guard and Armor).
- **B. Nerf now:** Unbroken Bulwark 3/5 → 3/4, Battle Cry 3 → 4 mana. Measured: Warrior about −4 points.

**Q5. Dead or AI-invisible cards.**

- **Emberbrand Adept** has no Shaman Gear to work with. Options:
  - **A.** Move one Gear (for example Battered Shield) into Shaman.
  - **B.** Change its text to "Your spells cost 1 less" (a new effect for Shaman).
  - **C.** Leave it as a 3/4 for 4.
- **The AI** cannot value Loot, Zones or Grave Robbery. Option: a later AI pass with a two-move search.

## 9. Not verified

- The time model is a model. The real numbers will come from the Play closed test: match `createdAt` / `finishedAt` and the
  action logs.
- No phone or real-client play of the new rules: the app reads Health, rounds and text from the server, and its generated card
  file is regenerated. Nothing in the app hard-codes 20 Health (checked).
- Card win rates come from AI-vs-AI play and are about ±3 points at these sample sizes.

## 10. Owner answers and follow-up (10 November 2026, second PR)

Answers: Q1 = A (match clock, 2:30 per player, a 5:00 total decided on Health lost), Q2 = A (ranked live), Q3 = A (missed turn
auto-ends, three in a row forfeit), Q4 = A (no Warrior nerf; wait for Play data), Q5 = give Shaman a Gear (the AI two-move search
is not now).

Built, in this order:

1. **Q3 Missed clocks.** New server-only engine moves: `timeout` plays the safe default for whoever must act (keep the opening
   hand, take the first Loot option, or end the turn); the third in a row (`MAX_TIMEOUTS`) forfeits with reason `timeout`, and
   any real move resets the count (`PlayerState.timeouts`). Duels and matches against the AI settle every overdue clock on the
   next read, each from the deadline of the one before. Before this, one missed clock forfeited the match.
2. **Q1 Match clock.** `TcgDuel.clockA` / `clockB` (migration `20270131000000_tcg_duel_clocks`): 150,000 ms each for live
   duels, charged to the seat that must act. The turn deadline is the sooner of the 60 s turn clock and the clock left; an empty
   clock plays `timeUp`, which ends the match on Health lost (reason `time`). The phone shows both clocks as m:ss on live
   matches (EN + FR).
3. **Q2 Ranked live.** Ranked pairings start live: 60 s turns and both 2:30 clocks.
4. **Q5 Shaman Gear.** Battered Shield (131) moves from Warrior to Shaman and Stone Golem (119) from Shaman to Warrior, so each
   class keeps three moved neutrals and Warrior is not weakened (Q4). Boss 1's deck uses Stone Golem instead. Card text is
   unchanged; no saved decks exist (matches use starter decks).

Simulated, `--games 20 --hard 2 --seed 41` (1,440 + 144 games), live-PvP time model:

| | Before (main after #718) | After (clock on) |
| --- | --- | --- |
| Two people live: median / p95 / max | 4:17 / 5:42 / 7:32 | **4:11 / 4:52 / 5:00** |
| Over 5 minutes | 19.7% | **0%** |
| Hard AI pace: p95 / max | 6:30 / 7:22 | 4:58 / 5:00 |
| Matches ended by the clock | - | 33.5% (65% at the hard AI's pace) |
| First player | 50.2% | 49.6% |

The clock decides about one live match in three at this model's pace: on Health lost, as chosen. If Play data shows real players
are faster than the model (about 18 to 20 s a turn), that share drops; if it stays high, 3:00 per player is the next lever.

Shaman Gear (same seed, before vs after the swap): Emberbrand Adept is played in 31% of the games where it is in the deck (was
17%); Shaman 55.9% → 55.6%, Warrior 54.7% → 53.4% (both inside noise).
