import { describe, expect, it } from "vitest";
import { starterDeck } from "../src/services/tcg-cards-set1.js";
import { chooseAction, evaluate } from "../src/services/tcg-ai.js";
import { buildDeck, matrixDecks, missedTargets, playGame, runMatrix, type MatrixReport } from "../src/services/tcg-sim.js";
import { CLASS_KEYS, type ClassKey, type MatchState } from "../src/services/tcg-engine-types.js";
import { apply, applyMut, createMatch, legalActions, spawn, stateHash } from "../src/services/tcg-engine.js";

const deck = (cls: ClassKey) => ({ cls, cards: starterDeck(cls) });
function game(a: ClassKey = "warrior", b: ClassKey = "mage"): MatchState {
  let seed = 1;
  let s = createMatch(seed, deck(a), deck(b));
  while (s.first !== 0) s = createMatch(++seed, deck(a), deck(b));
  applyMut(s, { t: "mulligan", replace: [] });
  applyMut(s, { t: "mulligan", replace: [] });
  s.players[0].mana = 10;
  s.players[0].hand = [];
  s.players[1].hand = [];
  return s;
}

describe("AI choices", () => {
  it("is a pure function of the state and always legal", () => {
    const s = game();
    s.players[0].hand = ["001", "003", "068"];
    const before = stateHash(s);
    for (const level of ["easy", "normal", "hard"] as const) {
      const a = chooseAction(s, level);
      expect(chooseAction(s, level)).toEqual(a);
      expect(() => apply(s, a)).not.toThrow();
    }
    expect(stateHash(s)).toBe(before);
  });
  it("takes lethal when it has it", () => {
    const s = game();
    s.players[1].hp = 4;
    const u = spawn(s, 0, "111");
    expect(chooseAction(s, "normal")).toEqual({ t: "attack", unit: u.uid, target: { champ: 1 } });
  });
  it("plays the Loot Bag first and spends its mana", () => {
    const s = game();
    s.players[0].hand = ["002", "loot-bag"];
    expect(chooseAction(s, "normal")).toEqual({ t: "play", hand: 1 });
  });
  it("ends the turn when nothing helps", () => {
    const s = game();
    s.players[0].mana = 0;
    expect(chooseAction(s, "normal")).toEqual({ t: "end" });
  });
  it("mulligans legally and picks the dearest Loot option", () => {
    const s = createMatch(3, deck("warrior"), deck("mage"));
    expect(chooseAction(s, "normal").t).toBe("mulligan");
    expect(() => apply(s, chooseAction(s, "normal"))).not.toThrow();
    const t = game("rogue", "warrior");
    t.pending.push({ kind: "loot", p: 0, options: ["001", "009", "003"] });
    expect(chooseAction(t, "normal")).toEqual({ t: "choose", index: 1 });
    expect(legalActions(t)).toHaveLength(3);
  });
  it("scores wins and losses at the extremes", () => {
    const s = game();
    s.phase = "over";
    s.winner = 0;
    expect(evaluate(s, 0)).toBeGreaterThan(1000);
    expect(evaluate(s, 1)).toBeLessThan(-1000);
  });
});

describe("self-play", () => {
  it("finishes games at every level and gives the same game for the same seed", () => {
    for (const level of ["easy", "normal", "hard"] as const) {
      const a = playGame(11, deck("hunter"), deck("priest"), [level, level]);
      const b = playGame(11, deck("hunter"), deck("priest"), [level, level]);
      expect(a.stuck).toBe(false);
      expect(a).toEqual(b);
      expect(a.rounds).toBeLessThanOrEqual(20);
    }
  });
  it("lets the hard AI beat the easy one most of the time", () => {
    let hardWins = 0;
    const games = 24;
    for (let i = 0; i < games; i++) {
      const cls = CLASS_KEYS[i % 9]!;
      const r = playGame(500 + i, buildDeck(cls, 0), buildDeck(cls, 0), i % 2 ? ["easy", "hard"] : ["hard", "easy"]);
      if (r.winner === (i % 2 ? 1 : 0)) hardWins++;
    }
    expect(hardWins / games).toBeGreaterThan(0.6);
  }, 120_000);
  it("builds legal tuned decks for every class and variant", () => {
    for (const cls of CLASS_KEYS) {
      expect(matrixDecks(cls)).toHaveLength(4);
      for (let v = 0; v < 6; v++) expect(buildDeck(cls, v).cards).toHaveLength(24);
    }
  });
  it("runs a CI-sized matrix with no stuck games and a sane report", () => {
    const report = runMatrix({ gamesPerPair: 4, classes: ["warrior", "mage", "priest"], seed: 9 });
    expect(report.games).toBe(24);
    expect(report.stuck).toBe(0);
    expect(report.medianRounds).toBeGreaterThan(3);
    expect(Object.keys(report.byClass)).toEqual(["warrior", "mage", "priest"]);
    expect(report.pairs).toHaveLength(6);
    const classWins = Object.values(report.byClass).reduce((sum, r) => sum + r.wins, 0);
    expect(classWins).toBe(report.games - report.draws);
  }, 120_000);
  it("reports the design targets it misses", () => {
    const fine: MatrixReport = { games: 100, draws: 0, stuck: 0, firstPlayerWins: 50, medianRounds: 7, exhaustionShare: 0.01, byClass: { warrior: { games: 100, wins: 50, rate: 0.5 } }, pairs: [], cards: { "001": { played: 500, wins: 250, rate: 0.5 } } };
    expect(missedTargets(fine)).toEqual([]);
    const bad: MatrixReport = { ...fine, firstPlayerWins: 70, medianRounds: 12, exhaustionShare: 0.05, byClass: { warrior: { games: 100, wins: 70, rate: 0.7 } }, cards: { "001": { played: 500, wins: 350, rate: 0.7 } } };
    expect(missedTargets(bad)).toHaveLength(5);
  });
});
