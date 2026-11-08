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
