import { describe, expect, it } from "vitest";
import { CARDS_SET1, starterDeck } from "../src/services/tcg-cards-set1.js";
import { CLASS_KEYS, type Action, type ClassKey, type MatchState } from "../src/services/tcg-engine-types.js";
import { apply, applyMut, attackTargets, costOf, createMatch, legalActions, powerCost, replay, spawn, stateHash, atkOf, hpOf } from "../src/services/tcg-engine.js";

const deck = (cls: ClassKey) => ({ cls, cards: starterDeck(cls) });

/** A match where player 0 (the first player) is on turn 1 with an empty board and plenty of mana. */
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
const act = (s: MatchState, a: Action): MatchState => apply(s, a).state;
const hand = (s: MatchState, p: 0 | 1, ...ids: string[]) => { s.players[p].hand = ids; };
const play = (s: MatchState, index: number, extra: Partial<Extract<Action, { t: "play" }>> = {}): MatchState => act(s, { t: "play", hand: index, ...extra });
const canDo = (s: MatchState, a: Action) => legalActions(s).some(l => JSON.stringify(l) === JSON.stringify(a));
const endTurns = (s: MatchState, n: number): MatchState => { let cur = s; for (let i = 0; i < n; i++) cur = act(cur, { t: "end" }); return cur; };

describe("setup and turn flow", () => {
  it("is deterministic for a seed and differs between seeds", () => {
    expect(stateHash(createMatch(5, deck("warrior"), deck("mage")))).toBe(stateHash(createMatch(5, deck("warrior"), deck("mage"))));
    expect(stateHash(createMatch(5, deck("warrior"), deck("mage")))).not.toBe(stateHash(createMatch(6, deck("warrior"), deck("mage"))));
  });
  it("deals 3 cards to the first player and 4 plus the Loot Bag to the second, each with a card costing 2 or less", () => {
    for (let seed = 1; seed < 80; seed++) {
      const s = createMatch(seed, deck("rogue"), deck("paladin"));
      const second = s.first === 0 ? 1 : 0;
      expect(s.players[s.first].hand).toHaveLength(3);
      expect(s.players[second].hand).toHaveLength(5);
      expect(s.players[second].hand).toContain("loot-bag");
      for (const p of [0, 1] as const) expect(s.players[p].hand.some(id => id !== "loot-bag" && costOf(s, p, id) <= 2)).toBe(true);
    }
  });
  it("lets each player mulligan once, first player first, then starts turn 1 without a draw", () => {
    const s = createMatch(3, deck("warrior"), deck("mage"));
    expect(legalActions(s).every(a => a.t === "mulligan")).toBe(true);
    const a = act(s, { t: "mulligan", replace: [0] });
    expect(a.phase).toBe("mulligan");
    const b = act(a, { t: "mulligan", replace: [] });
    expect(b.phase).toBe("main");
    expect(b.active).toBe(b.first);
    expect(b.turn).toBe(1);
    expect(b.players[b.first].mana).toBe(1);
    expect(b.players[b.first].hand).toHaveLength(3);
  });
  it("never lets the Loot Bag be mulliganed away", () => {
    const s = createMatch(3, deck("warrior"), deck("mage"));
    const a = act(s, { t: "mulligan", replace: [] });
    for (const m of legalActions(a)) if (m.t === "mulligan") for (const i of m.replace) expect(a.players[a.first === 0 ? 1 : 0].hand[i]).not.toBe("loot-bag");
  });
  it("gives min(turn number, 8) mana and refreshes it each turn", () => {
    let s = game();
    s.players[0].mana = 1;
    for (let turn = 1; turn <= 10; turn++) {
      expect(s.players[0].mana).toBe(Math.min(turn, 8));
      s = endTurns(s, 2);
    }
  });
  it("draws one card a turn except for the first player's first turn", () => {
    let s = game();
    expect(s.players[0].deck).toHaveLength(21);
    s = act(s, { t: "end" });
    expect(s.players[1].deck).toHaveLength(19);
    s = act(s, { t: "end" });
    expect(s.players[0].deck).toHaveLength(20);
  });
  it("lets the second player spend the Loot Bag for 1 temporary mana", () => {
    let s = game();
    hand(s, 1);
    s.players[1].hand = ["loot-bag"];
    s = act(s, { t: "end" });
    const before = s.players[1].mana;
    const idx = s.players[1].hand.indexOf("loot-bag");
    s = play(s, idx);
    expect(s.players[1].mana).toBe(before + 1);
  });
});

describe("combat", () => {
  it("makes new units wait a turn unless they have Swift", () => {
    let s = game();
    hand(s, 0, "001", "024");
    s = play(s, 0);
    expect(legalActions(s).some(a => a.t === "attack")).toBe(false);
    s = play(s, 0);
    expect(legalActions(s).filter(a => a.t === "attack")).toHaveLength(1);
  });
  it("forces attackers onto Guard units and hides Shadow units", () => {
    const s = game();
    const me = spawn(s, 0, "001");
    const guard = spawn(s, 1, "003");
    const plain = spawn(s, 1, "034");
    expect(attackTargets(s, 0)).toEqual([{ unit: guard.uid }]);
    s.players[1].board = [plain, spawn(s, 1, "036")];
    const targets = attackTargets(s, 0);
    expect(targets).toContainEqual({ unit: plain.uid });
    expect(targets).toContainEqual({ champ: 1 });
    expect(targets).toHaveLength(2);
    expect(me.uid).toBeGreaterThan(0);
  });
  it("lets a Shadow unit lose its Shadow by attacking", () => {
    let s = game();
    const shade = spawn(s, 0, "036");
    s = act(s, { t: "attack", unit: shade.uid, target: { champ: 1 } });
    expect(s.players[0].board[0]!.kw).not.toContain("shadow");
    expect(s.players[1].hp).toBe(18);
  });
  it("deals combat damage both ways at once and kills what reaches 0", () => {
    let s = game();
    const a = spawn(s, 0, "004");
    const d = spawn(s, 1, "102");
    s = act(s, { t: "attack", unit: a.uid, target: { unit: d.uid } });
    expect(s.players[1].board).toHaveLength(0);
    expect(hpOf(s, 0, s.players[0].board[0]!)).toBe(1);
  });
  it("gives no retaliation against a Champion and lets Armor absorb first", () => {
    let s = game();
    const a = spawn(s, 0, "111");
    s.players[1].armor = 2;
    s = act(s, { t: "attack", unit: a.uid, target: { champ: 1 } });
    expect(s.players[1].hp).toBe(17);
    expect(s.players[1].armor).toBe(0);
    expect(s.players[0].board[0]!.dmg).toBe(0);
  });
  it("destroys what Venom damages, even a giant", () => {
    let s = game();
    const v = spawn(s, 0, "039");
    const giant = spawn(s, 1, "122");
    s = act(s, { t: "attack", unit: v.uid, target: { unit: giant.uid } });
    expect(s.players[1].board).toHaveLength(0);
  });
  it("spends a Shield instead of taking damage, once", () => {
    let s = game();
    const a = spawn(s, 0, "111");
    const squire = spawn(s, 1, "014");
    s = act(s, { t: "attack", unit: a.uid, target: { unit: squire.uid } });
    const survivor = s.players[1].board[0]!;
    expect(survivor.dmg).toBe(0);
    expect(survivor.kw).not.toContain("shield");
  });
  it("lets Drain mend the owner's Champion by the damage dealt", () => {
    let s = game();
    s.players[0].hp = 15;
    const siphon = spawn(s, 0, "084");
    s = act(s, { t: "attack", unit: siphon.uid, target: { champ: 1 } });
    expect(s.players[0].hp).toBe(18);
  });
  it("lets Twin Strike attack twice and no more", () => {
    let s = game();
    const rider = spawn(s, 0, "059");
    s = act(s, { t: "attack", unit: rider.uid, target: { champ: 1 } });
    s = act(s, { t: "attack", unit: rider.uid, target: { champ: 1 } });
    expect(s.players[1].hp).toBe(14);
    expect(legalActions(s).some(a => a.t === "attack")).toBe(false);
  });
  it("ends the match when a Champion reaches 0 and declares a draw when both do", () => {
    let s = game();
    s.players[1].hp = 3;
    const a = spawn(s, 0, "111");
    s = act(s, { t: "attack", unit: a.uid, target: { champ: 1 } });
    expect(s.phase).toBe("over");
    expect(s.winner).toBe(0);
    let t = game();
    t.players[0].hp = 1;
    t.players[1].hp = 1;
    hand(t, 0, "087");
    t.players[0].mana = 8;
    t = play(t, 0);
    expect(t.winner).toBe(1);
  });
});

describe("spells and Rally", () => {
  it("casts damage spells at units and Champions", () => {
    let s = game("mage", "warrior");
    hand(s, 0, "068");
    s = play(s, 0, { target: { champ: 1 } });
    expect(s.players[1].hp).toBe(17);
  });
  it("makes Cleaving Strike hurt you only if the target survives", () => {
    let s = game();
    const big = spawn(s, 1, "119");
    hand(s, 0, "002", "002");
    s = play(s, 0, { target: { unit: big.uid } });
    expect(s.players[0].hp).toBe(18);
    const small = spawn(s, 1, "001");
    s = play(s, 0, { target: { unit: small.uid } });
    expect(s.players[0].hp).toBe(18);
  });
  it("only lets Reckoning target units with 5 or more Attack", () => {
    const s = game("paladin", "warrior");
    hand(s, 0, "017");
    spawn(s, 1, "001");
    expect(legalActions(s).some(a => a.t === "play")).toBe(false);
    const big = spawn(s, 1, "111");
    expect(legalActions(s).filter(a => a.t === "play")).toEqual([{ t: "play", hand: 0, target: { unit: big.uid } }]);
    const after = play(s, 0, { target: { unit: big.uid } });
    expect(after.players[1].board.map(u => u.card)).toEqual(["001"]);
  });
  it("resolves Rally healing, and fizzles a Rally with no target", () => {
    let s = game("paladin", "warrior");
    s.players[0].hp = 10;
    hand(s, 0, "016");
    s = play(s, 0, { target: { champ: 0 } });
    expect(s.players[0].hp).toBe(14);
    let t = game("hunter", "warrior");
    hand(t, 0, "026");
    t = play(t, 0);
    expect(t.players[0].board).toHaveLength(1);
  });
  it("triggers Rally twice under the Echoes Zone but not spells", () => {
    let s = game("hunter", "warrior");
    s.zone = { card: "136", owner: 0 };
    hand(s, 0, "028");
    s = play(s, 0);
    expect(s.players[1].hp).toBe(16);
  });
  it("Chills a unit for its controller's next turn only", () => {
    let s = game("mage", "warrior");
    const target = spawn(s, 1, "111");
    hand(s, 0, "069");
    s = play(s, 0, { target: { unit: target.uid } });
    s = act(s, { t: "end" });
    expect(legalActions(s).some(a => a.t === "attack")).toBe(false);
    s = endTurns(s, 2);
    expect(legalActions(s).some(a => a.t === "attack" && a.unit === target.uid)).toBe(true);
  });
  it("deals area damage with Meteor Fall and Whirling Blades", () => {
    let s = game("mage", "warrior");
    spawn(s, 1, "119");
    spawn(s, 1, "001");
    const mine = spawn(s, 0, "001");
    hand(s, 0, "130", "076");
    s.players[0].mana = 10;
    s = play(s, 0);
    expect(s.players[0].board).toHaveLength(0);
    expect(mine.uid).toBeGreaterThan(0);
    expect(s.players[1].board).toHaveLength(1);
    s.players[0].mana = 10;
    s = play(s, 0);
    expect(s.players[1].board).toHaveLength(0);
  });
});

describe("Last Stand, Frenzy and Loot", () => {
  it("summons from Last Stand, and the Saint comes back with Shield", () => {
    let s = game("mage", "hunter");
    spawn(s, 1, "033");
    hand(s, 0, "081", "081");
    const stag = s.players[1].board[0]!;
    stag.dmg = 2;
    s = play(s, 0, { target: { unit: stag.uid } });
    expect(s.players[1].board.map(u => u.card)).toEqual(["tk-beast-swift", "tk-beast-swift"]);
    const saint = spawn(s, 1, "054");
    saint.kw = [];
    s = play(s, 0, { target: { unit: saint.uid } });
    const copy = s.players[1].board.find(u => u.card === "054")!;
    expect(copy.kw).toContain("shield");
    expect(copy.uid).not.toBe(saint.uid);
  });
  it("returns Soul Binder to its owner's hand", () => {
    let s = game("mage", "priest");
    const binder = spawn(s, 1, "052");
    hand(s, 0, "081");
    s = play(s, 0, { target: { unit: binder.uid } });
    expect(s.players[1].hand).toContain("052");
  });
  it("triggers Frenzy once on the first survived damage", () => {
    let s = game("mage", "warrior");
    const vet = spawn(s, 1, "004");
    hand(s, 0, "127", "127");
    s = play(s, 0, { target: { unit: vet.uid } });
    expect(atkOf(s, 1, s.players[1].board[0]!)).toBe(5);
    s = play(s, 0, { target: { unit: vet.uid } });
    expect(s.players[1].board).toHaveLength(0);
  });
  it("pauses on Loot until the player chooses one of three, then restores the rest to the deck", () => {
    let s = game("rogue", "warrior");
    hand(s, 0, "038");
    const deckBefore = s.players[0].deck.length;
    s = play(s, 0);
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0]!.options).toHaveLength(3);
    expect(legalActions(s).every(a => a.t === "choose")).toBe(true);
    const picked = s.pending[0]!.options[1]!;
    s = act(s, { t: "choose", index: 1 });
    expect(s.pending).toHaveLength(0);
    expect(s.players[0].hand).toEqual([picked]);
    expect(s.players[0].deck).toHaveLength(deckBefore - 1);
  });
});

describe("Gear, Zones and Standards", () => {
  it("equips Gear to a unit without Gear, once", () => {
    let s = game("druid", "warrior");
    const u = spawn(s, 0, "089");
    hand(s, 0, "131", "090");
    s = play(s, 0, { target: { unit: u.uid } });
    expect(s.players[0].board[0]!.kw).toContain("guard");
    expect(s.players[0].board[0]!.hp).toBe(5);
    expect(legalActions(s).some(a => a.t === "play")).toBe(false);
  });
  it("makes Thornbark hit attackers", () => {
    let s = game("warrior", "druid");
    const attacker = spawn(s, 0, "122");
    const vest = spawn(s, 1, "119");
    vest.gear = "090";
    vest.gearOn = true;
    s = act(s, { t: "attack", unit: attacker.uid, target: { unit: vest.uid } });
    expect(s.players[0].board[0]!.dmg).toBe(6);
  });
  it("burns the weakest unit in Emberdeep Chasm at the start of each turn", () => {
    let s = game();
    s.zone = { card: "133", owner: 0 };
    spawn(s, 1, "001");
    spawn(s, 1, "119");
    s = act(s, { t: "end" });
    expect(s.players[1].board.map(u => u.card)).toEqual(["119"]);
  });
  it("limits boards to 4 in the Sunken Mine and 5 otherwise", () => {
    const s = game();
    for (let i = 0; i < 5; i++) spawn(s, 0, "089");
    hand(s, 0, "001");
    expect(legalActions(s).some(a => a.t === "play")).toBe(false);
    const t = game();
    t.zone = { card: "134", owner: 0 };
    for (let i = 0; i < 4; i++) spawn(t, 0, "089");
    hand(t, 0, "001");
    expect(legalActions(t).some(a => a.t === "play")).toBe(false);
  });
  it("gives entering units a temporary Shield in the Cairn of Kings", () => {
    let s = game();
    s.zone = { card: "138", owner: 0 };
    hand(s, 0, "001");
    s = play(s, 0);
    expect(s.players[0].board[0]!.kw).toContain("shield");
    s = endTurns(s, 2);
    expect(s.players[0].board[0]!.kw).not.toContain("shield");
  });
  it("reduces Rally damage to Champions in Ashfall Plain", () => {
    let s = game("hunter", "warrior");
    s.zone = { card: "137", owner: 0 };
    hand(s, 0, "028");
    s = play(s, 0);
    expect(s.players[1].hp).toBe(19);
  });
  it("lets a Standard fill the slot once and powers cost less with the Duelist banner", () => {
    let s = game();
    hand(s, 0, "139", "142");
    s = play(s, 0);
    expect(s.players[0].standard).toBe("139");
    expect(powerCost(s, 0)).toBe(1);
    expect(legalActions(s).some(a => a.t === "play")).toBe(false);
  });
  it("returns the first unit that would die each turn to hand with the Perfect Run Standard", () => {
    let s = game("mage", "warrior");
    s.players[1].standard = "150";
    spawn(s, 1, "001");
    spawn(s, 1, "003");
    hand(s, 0, "068", "068");
    s = play(s, 0, { target: { unit: s.players[1].board[0]!.uid } });
    expect(s.players[1].hand).toContain("001");
    s = play(s, 0, { target: { unit: s.players[1].board[0]!.uid } });
    expect(s.players[1].board).toHaveLength(0);
  });
});

describe("Full Party, powers, stalls and limits", () => {
  it("makes the first card cheaper with a Tank, Healer and Damage unit at turn start", () => {
    let s = game("priest", "warrior");
    spawn(s, 0, "058");
    spawn(s, 0, "046");
    spawn(s, 0, "045");
    s = endTurns(s, 2);
    expect(s.players[0].partyDiscount).toBe(true);
    expect(costOf(s, 0, "016")).toBe(3);
    s.players[0].played = 1;
    expect(costOf(s, 0, "016")).toBe(4);
  });
  it("runs a class power once a turn", () => {
    let s = game("warrior", "mage");
    s = act(s, { t: "power" });
    expect(s.players[0].armor).toBe(2);
    expect(canDo(s, { t: "power" })).toBe(false);
    let h = game("hunter", "mage");
    h = act(h, { t: "power" });
    expect(h.players[0].board.map(u => u.card)).toEqual(["tk-beast-companion"]);
    const p = game("paladin", "mage");
    expect(powerCost(p, 0)).toBe(3);
  });
  it("applies Exhaustion from an empty deck, growing each time", () => {
    let s = game();
    s.players[1].deck = [];
    s = act(s, { t: "end" });
    expect(s.players[1].hp).toBe(19);
    s = endTurns(s, 2);
    expect(s.players[1].hp).toBe(17);
  });
  it("gives Second Wind once at 8 Health or less", () => {
    let s = game();
    s.players[1].hp = 8;
    const deckBefore = s.players[1].deck.length;
    s = act(s, { t: "end" });
    expect(s.players[1].armor).toBe(2);
    expect(s.players[1].deck.length).toBe(deckBefore - 2);
    s = endTurns(s, 2);
    expect(s.players[1].armor).toBe(2);
  });
  it("ends in a draw at the round cap", () => {
    let s = game();
    s.turn = 39;
    s.players[0].deck.length = 5;
    s.players[1].deck.length = 5;
    s = endTurns(s, 2);
    expect(s.phase === "over" && s.winner === "draw").toBe(true);
  });
  it("burns cards drawn into a full hand and lets players concede", () => {
    let s = game();
    s.players[1].hand = ["001", "001", "001", "001", "001", "001", "001", "001"];
    s = act(s, { t: "end" });
    expect(s.players[1].hand).toHaveLength(8);
    s = act(s, { t: "concede", p: 1 });
    expect(s.winner).toBe(0);
    expect(() => apply(s, { t: "end" })).toThrow();
  });
  it("rejects illegal actions", () => {
    const s = game();
    hand(s, 0, "011");
    s.players[0].mana = 2;
    expect(() => apply(s, { t: "play", hand: 0 })).toThrow();
    expect(() => apply(s, { t: "attack", unit: 999, target: { champ: 1 } })).toThrow();
  });
});

// ---- replay and invariants over random play ----
function botRng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function invariants(s: MatchState): void {
  for (const p of [0, 1] as const) {
    const pl = s.players[p];
    expect(pl.hp).toBeLessThanOrEqual(20);
    expect(pl.hand.length).toBeLessThanOrEqual(8);
    expect(pl.board.length).toBeLessThanOrEqual(5);
    expect(pl.mana).toBeLessThanOrEqual(10);
    expect(pl.mana).toBeGreaterThanOrEqual(0);
    for (const u of pl.board) expect(hpOf(s, p, u)).toBeGreaterThan(0);
    expect(new Set(pl.board.map(u => u.uid)).size).toBe(pl.board.length);
  }
}
function playRandom(seed: number, a: ClassKey, b: ClassKey): { actions: Action[]; final: MatchState } {
  const rand = botRng(seed * 7919);
  const s = createMatch(seed, deck(a), deck(b));
  const actions: Action[] = [];
  for (let step = 0; step < 3000 && s.phase !== "over"; step++) {
    const legal = legalActions(s);
    const nonEnd = legal.filter(l => l.t !== "end");
    const pick = nonEnd.length && rand() < 0.9 ? nonEnd[Math.floor(rand() * nonEnd.length)]! : legal[legal.length - 1]!;
    actions.push(pick);
    applyMut(s, pick);
    if (step % 5 === 0) invariants(s);
  }
  return { actions, final: s };
}

describe("replay and random play", () => {
  it("plays every card in every way it can be played without breaking the rules", () => {
    for (const card of CARDS_SET1) {
      const cls = card.cls === "neutral" ? "warrior" : card.cls;
      const base = game(cls, "druid");
      spawn(base, 0, "003");
      spawn(base, 0, "016");
      spawn(base, 1, "058");
      spawn(base, 1, "111").attacks = 1;
      base.players[0].lastDied = "001";
      hand(base, 0, card.id, "001", "002");
      base.players[0].mana = 10;
      if (card.type === "standard") base.players[0].standard = null;
      const options = legalActions(base).filter(a => a.t === "play" && a.hand === 0);
      expect(options.length, `${card.id} ${card.name} has no way to be played`).toBeGreaterThan(0);
      for (const option of options) {
        const result = apply(base, option);
        invariants(result.state);
        expect(result.events.some(e => e.t === "play"), card.id).toBe(true);
      }
    }
  });
  it("finishes random games of every class pairing, keeps its invariants, and replays to the same state hash", () => {
    let n = 0;
    for (let round = 0; round < 3; round++) for (const a of CLASS_KEYS) {
      const b = CLASS_KEYS[(CLASS_KEYS.indexOf(a) + 3 + round) % CLASS_KEYS.length]!;
      const seed = 100 + n++;
      const { actions, final } = playRandom(seed, a, b);
      expect(final.phase, `${a} vs ${b}`).toBe("over");
      invariants(final);
      const again = replay(seed, deck(a), deck(b), actions);
      expect(stateHash(again)).toBe(stateHash(final));
    }
  }, 120_000);
  it("is the same game every time for the same seed and actions", () => {
    const one = playRandom(77, "warrior", "druid");
    const two = playRandom(77, "warrior", "druid");
    expect(stateHash(one.final)).toBe(stateHash(two.final));
    expect(one.actions).toEqual(two.actions);
  });
});
