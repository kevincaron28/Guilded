import { describe, expect, it } from "vitest";
import { CARDS_SET1, CARD_BY_ID, FORBIDDEN_TERMS, TOKENS, budgetOf, cardOf, deckProblem, pointsOf, roleOfCard, starterDeck } from "../src/services/tcg-cards-set1.js";
import { CLASS_KEYS } from "../src/services/tcg-engine-types.js";

describe("set 1 data", () => {
  it("has the 150 cards of the design with unique ids", () => {
    expect(CARDS_SET1).toHaveLength(150);
    expect(new Set(CARDS_SET1.map(c => c.id)).size).toBe(150);
  });
  it("matches the rarity table of the design", () => {
    const count = (r: string) => CARDS_SET1.filter(c => c.rarity === r).length;
    expect([count("common"), count("uncommon"), count("rare"), count("epic"), count("legendary")]).toEqual([60, 32, 27, 16, 15]);
  });
  it("has 12 Standards, 6 Zones and 14 cards per class after the class-column move", () => {
    expect(CARDS_SET1.filter(c => c.type === "standard")).toHaveLength(12);
    expect(CARDS_SET1.filter(c => c.type === "zone")).toHaveLength(6);
    for (const cls of CLASS_KEYS) expect(CARDS_SET1.filter(c => c.cls === cls)).toHaveLength(14);
    expect(CARDS_SET1.filter(c => c.cls === "neutral")).toHaveLength(24);
  });
  it("only references tokens and cards that exist", () => {
    for (const card of [...CARDS_SET1, ...TOKENS]) {
      const effects = [...(card.onPlay ?? []).flatMap(a => a.effects), ...(card.lastStand ?? []), ...(card.frenzy ?? []), ...(card.startTurn ?? []), ...(card.endTurn ?? [])];
      for (const e of effects) if (e.k === "summon") expect(CARD_BY_ID.get(e.token)?.token, `${card.name} summons ${e.token}`).toBe(true);
    }
  });
  it("uses no protected names (forbidden-terms list)", () => {
    for (const card of [...CARDS_SET1, ...TOKENS]) {
      const text = `${card.name} ${card.text}`.toLowerCase();
      for (const term of FORBIDDEN_TERMS) expect(text.includes(term), `${card.name} contains "${term}"`).toBe(false);
    }
  });
  it("gives units stats and every non-unit none", () => {
    for (const card of CARDS_SET1) {
      if (card.type === "unit") { expect(card.atk).toBeGreaterThanOrEqual(0); expect(card.hp).toBeGreaterThan(0); }
      else expect(card.atk).toBeUndefined();
      expect(card.cost).toBeGreaterThanOrEqual(0);
      expect(card.cost).toBeLessThanOrEqual(8);
    }
  });
  it("derives roles for the Full Party rule", () => {
    expect(roleOfCard(cardOf("003"))).toBe("tank");
    expect(roleOfCard(cardOf("016"))).toBe("healer");
    expect(roleOfCard(cardOf("001"))).toBe("damage");
    expect(roleOfCard(cardOf("115"))).toBe("damage");
    expect(roleOfCard(cardOf("116"))).toBe("healer");
    expect(roleOfCard(cardOf("117"))).toBe("tank");
  });
});

describe("cost curve (section 7 of the design)", () => {
  // The rate card is the design's; effects it does not price (summons, armor, Loot, steal) use the estimates in effectPoints.
  // Tolerances are the design's plus 0.5 for those estimates. Units flagged here are balance work for the self-play
  // harness (stage B), not data errors.
  const TOLERANCE = { common: 1.5, uncommon: 2, rare: 3 } as const;
  // Soul Siphoner (084) was listed here until the 10 November balance review gave it the +1 Health the harness asked for.
  const KNOWN_LOW: Record<string, string> = {};
  const units = CARDS_SET1.filter(c => c.type === "unit");
  it("keeps every Common, Uncommon and Rare unit near its budget", () => {
    expect(units.length).toBeGreaterThan(95);
    for (const card of units) {
      if (card.rarity === "epic" || card.rarity === "legendary" || KNOWN_LOW[card.id]) continue;
      const delta = pointsOf(card) - budgetOf(card);
      const limit = TOLERANCE[card.rarity as keyof typeof TOLERANCE];
      expect(Math.abs(delta), `${card.id} ${card.name} is ${delta.toFixed(1)} from its budget`).toBeLessThanOrEqual(limit);
    }
  });
  it("lets Epic and Legendary units spend extra points on text but never fall far below the curve", () => {
    for (const card of units.filter(c => c.rarity === "epic" || c.rarity === "legendary")) {
      const delta = pointsOf(card) - budgetOf(card);
      expect(delta, `${card.id} ${card.name} is ${delta.toFixed(1)} from its budget`).toBeGreaterThanOrEqual(-3.5);
      expect(delta, `${card.id} ${card.name} is ${delta.toFixed(1)} from its budget`).toBeLessThanOrEqual(8.5);
    }
  });
  it("has an average cost near the design's 3.8 and a curve that peaks at 3", () => {
    const playable = CARDS_SET1.filter(c => c.type !== "standard");
    const avg = playable.reduce((s, c) => s + c.cost, 0) / playable.length;
    expect(avg).toBeGreaterThan(3.2);
    expect(avg).toBeLessThan(4.4);
    const byCost = (n: number) => playable.filter(c => c.cost === n).length;
    expect(byCost(3)).toBeGreaterThanOrEqual(byCost(1));
    expect(byCost(3)).toBeGreaterThanOrEqual(byCost(8));
  });
});

describe("decks", () => {
  it("builds a legal free starter deck for every class (no Epic, Legendary or Standard)", () => {
    for (const cls of CLASS_KEYS) {
      const deck = starterDeck(cls);
      expect(deckProblem(cls, deck), cls).toBeNull();
      for (const id of deck) expect(["common", "uncommon", "rare"]).toContain(cardOf(id).rarity);
    }
  });
  it("rejects wrong sizes, other classes, extra copies, too many Legendaries and two Standards", () => {
    const base = starterDeck("warrior");
    expect(deckProblem("warrior", base.slice(1))).toMatch(/exactly 24/);
    expect(deckProblem("mage", base)).toMatch(/another class/);
    expect(deckProblem("warrior", [...base.slice(0, 21), "001", "001", "001"])).toMatch(/Too many copies/);
    const paladin = starterDeck("paladin");
    expect(deckProblem("paladin", [...paladin.slice(0, 21), "022", "121", "123"])).toMatch(/Legendary/);
    expect(deckProblem("warrior", [...base.slice(0, 22), "139", "140"])).toMatch(/Standard/);
    expect(deckProblem("warrior", [...base.slice(0, 22), "011", "011"])).toMatch(/Too many copies/);
  });
});
