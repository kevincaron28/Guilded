# Guilded Clash: the rules engine (stage A, built)

The headless rules engine of [APP_TCG_GAME.md](APP_TCG_GAME.md) section 2, with set 1 as data. No network, no database, no UI.

| File | What it holds |
| --- | --- |
| `src/services/tcg-engine-types.ts` | Card, effect, action and match-state types. The state is plain JSON. |
| `src/services/tcg-cards-set1.ts` | The 150 cards of "Dawn of Forever", tokens, the Loot Bag, deck rules (`deckProblem`), `starterDeck`, the forbidden-names list and the cost-curve helpers (`pointsOf`, `budgetOf`). |
| `src/services/tcg-engine.ts` | `createMatch(seed, deckA, deckB)`, `legalActions(state)`, `apply(state, action)` (validates, returns a new state and events), `applyMut` (in place, for the simulator), `replay(seed, deckA, deckB, actions)`, `stateHash`. |

## Rules in the code

- Deterministic: one seeded generator (mulberry32) lives in the state; nothing reads a clock or `Math.random`. A match is `{ seed, decks, actions }`; replaying the actions gives the same `stateHash`.
- Intents: `mulligan`, `play` (hand index, optional target and mode), `attack`, `power`, `choose` (a Loot), `end`, `concede`. `apply` rejects anything not in `legalActions`.
- All sixteen keywords and effects, the nine class powers, Zones, Standards, Full Party, Second Wind, Exhaustion, the round-20 draw, hand limit 8, board limit 5 (4 in the Sunken Mine), the opening-hand smoothing and the second player's Loot Bag.
- Loot pauses the match in `state.pending` until the player sends `choose`; the three options were taken out of the deck and the other two are shuffled back.
- Auras (Duelist, Tank of the Third Gate, cost reducers) are computed when read, so they end the moment the source leaves play.
- Cards that care about "attacked this turn" (Snare Trap) read a unit's attack count, which resets at the start of its controller's turn, so on your turn it matches enemy units that attacked last turn.

## Owner decisions applied (8 November)

- 27 neutral cards moved into the class columns, three per class (14 cards per class, 24 neutral left: the Third Gate trio, 2 neutral Legendary/Epic units, 6 Zones and the 12 Standards plus the Epic Dragon). The move list is `MOVED` in the card file.
- Art refs are not in the data (art is separate; the owner approves final painted art).

## Checks that guard the data

`tests/tcg-cards-set1.test.ts`: counts (60/32/27/16/15), the forbidden-names list, token references, roles, legal starter decks and the cost-curve check. `tests/tcg-engine.test.ts`: rules, a table-driven test that plays every card in every legal way, random games for all class pairings with invariants, and replay equality.

Next: stage B (AI opponent, self-play harness, PvE gauntlet data), then the server match service and API (stage C), then trading (stage D).

## Stage B: AI opponent, self-play and the PvE gauntlet (built)

| File | What it holds |
| --- | --- |
| `src/services/tcg-ai.ts` | `chooseAction(state, level)`: a greedy one-ply search (easy adds noise and sometimes stops early, normal is plain, hard also fears the opponent's next attack). A pure function of the state; it reseeds the copy's random numbers so it cannot peek at shuffles. |
| `src/services/tcg-sim.ts` | `playGame`, `buildDeck` (tuned decks), `runMatrix` (class pairs, rotating starter and three tuned decks), `missedTargets` (the section 7.5 targets). |
| `src/services/tcg-pve.ts` | The five-boss gauntlet as data (Zone already in play, extra Health, frozen decks, rewards), `createGauntletMatch`, `runReward`, `featuredRun`. |
| `scripts/clash-selfplay.ts` | `npm run clash:selfplay -- --games 20000 --level normal` prints the balance report. `--games` is per ordered class pair (72 pairs); it runs about 30 games a second. |

The engine gained `MatchSetup` (`zone`, `hp`) for bosses and a per-player `maxHp`.

First report (`--games 40`, 2,880 games, normal AI): see the stage B pull request. The matrix is a balance tool, not a verdict: the AI undervalues support effects, so low rates for Priest and Mage may be the AI rather than the cards.

First report (`--games 40`, 2,880 games, normal AI vs normal AI, about 75 s): first player wins 59.7%, median 8 rounds, Exhaustion 1.0%, no stuck games. Class win rates: Paladin 74.5, Warrior 71.3, Hunter 65.5, Druid 62.5, Rogue 43.0, Warlock 40.3, Shaman 40.0, Priest 28.9, Mage 24.1. Cards with the highest win rate when played are the big Guard and Shield bodies (011, 032, 010, 020, 009); the lowest are healing and spell cards (077, 048, 069, 128). This misses most targets of section 7.5; fixing it needs the harness to run with a smarter AI first (support and spell values) and then data patches.

## Balance pass 1 (8 November 2026)

Data-only changes to set 1 plus the second-player compensation, measured with `npm run clash:selfplay` (normal AI against normal AI). The per-card target is now measured **when drawn** (the card was in the player's opening hand or drawn), not when played, because expensive cards are mostly played by the player who is already ahead.

| | Before (2,880 games) | After (4,320 games, seed 101) | Target |
|---|---|---|---|
| First player wins | 59.7% | 49.4% | 48 to 52 |
| Warrior / Paladin / Hunter | 71.3 / 74.5 / 65.5 | 46.9 / 48.5 / 45.2 | 45 to 55 |
| Rogue / Priest / Shaman | 43.0 / 28.9 / 40.0 | 49.3 / 53.3 / 52.3 | 45 to 55 |
| Mage / Warlock / Druid | 24.1 / 40.3 / 62.5 | 50.5 / 50.2 / 53.8 | 45 to 55 |
| Median rounds | 8 | 8 | 6 to 9 |
| Exhaustion | 1.0% | 1.3% | under 2% |
| Best card when drawn | 93.1% (played) | 58.6% (098) | at most 60 |

What changed:

- **Loot Bag now gives 2 temporary mana** (was 1); the second player still draws 4. Tested alternatives on 1,440 games: draw 4 + 1 mana 58.6% first-player wins, draw 4 + 2 mana 50.6%, draw 5 + 1 mana 55.4%, draw 5 + 2 mana 48.1%. Second Wind was left alone.
- Stat and armor trims on the Guard/Shield bodies of Warrior, Paladin, Hunter and Druid (for example Warlord of the Pass 7/7 with 6 Armor became 6/6 with 3 Armor; Last Shield of the Vale 6/8 became 5/7 with 3 Armor Last Stand; King of the Marches now deals 2 to each enemy unit).
- Stat bumps and small cost cuts for Priest, Mage, Rogue, Shaman and Warlock support cards (for example Radiant Lash 1 mana, Fireside Rest 2, Circle of Mending 2 and Mend 4, Rime Lance 2,).
- Results swing a lot from one card (an early Shaman change moved the class by 20 points), so run at least `--games 60` with two or three seeds before trusting a number. Seed 101 above is the last of seven confirmation runs; the last four runs on different seeds each had every class between 45 and 55 except one outlier of 55.6 (Druid) that the final nudges removed.
