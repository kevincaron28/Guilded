import { describe, expect, it } from "vitest";
import { CARD_BY_KEY, CARDS, cardsOfRarity } from "../src/services/tcg-catalogue.js";
import { ACCRUAL_MS, CRAFT_COST, DUPLICATE_DUST, EPIC_PITY, LEGENDARY_PITY, MAX_BANKED, PACK_SIZE, SLOT_WEIGHTS, accrue, craftCheck, nextPackAt, oddsTable, pityRemaining, rollPack, seededRng, type Rng } from "../src/services/tcg.js";

const fixed = (...values: number[]): Rng => { let i = 0; return { int: max => Math.min(values[i++ % values.length]!, max - 1) }; };

describe("catalogue", () => {
  it("has unique keys, 27 class cards and a badge card per visible achievement", () => {
    expect(new Set(CARDS.map(c => c.key)).size).toBe(CARDS.length);
    expect(CARDS.filter(c => c.family === "class")).toHaveLength(27);
    expect(CARDS.filter(c => c.family === "badge").length).toBeGreaterThan(0);
    for (const rarity of ["common", "rare", "epic"] as const) expect(cardsOfRarity(rarity).length).toBeGreaterThan(0);
  });
});

describe("odds", () => {
  it("slot weights sum to 100 percent", () => {
    const odds = oddsTable();
    expect(Object.values(odds.ordinarySlots).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
    expect(Object.values(odds.rarePlusSlot).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
    expect(odds.packSize).toBe(5);
    expect(SLOT_WEIGHTS.rarePlus.legendary).toBeLessThan(SLOT_WEIGHTS.rarePlus.epic);
  });
  it("rolled frequencies follow the weights", () => {
    const rng = seededRng(7);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) for (const card of rollPack({ owned: new Set(), pityEpic: 0, pityLegendary: 0, rng }).cards.slice(0, 4)) counts[card.rarity] = (counts[card.rarity] ?? 0) + 1;
    const total = 16000;
    expect(counts['common']! / total).toBeGreaterThan(0.64);
    expect(counts['common']! / total).toBeLessThan(0.80);
    expect(counts['uncommon']! / total).toBeGreaterThan(0.20);
    expect(counts['uncommon']! / total).toBeLessThan(0.36);
  });
});

describe("rollPack", () => {
  it("returns 5 distinct cards, the last being Rare or better", () => {
    for (let seed = 1; seed < 50; seed++) {
      const roll = rollPack({ owned: new Set(), pityEpic: 0, pityLegendary: 0, rng: seededRng(seed) });
      expect(roll.cards).toHaveLength(PACK_SIZE);
      expect(new Set(roll.cards.map(c => c.key)).size).toBe(PACK_SIZE);
      expect(["rare", "epic", "legendary"]).toContain(roll.cards[4]!.rarity);
      expect(roll.cards.every(c => c.isNew)).toBe(true);
      expect(roll.dust).toBe(0);
    }
  });
  it("is deterministic for the same seed", () => {
    const a = rollPack({ owned: new Set(), pityEpic: 3, pityLegendary: 3, rng: seededRng(42) });
    const b = rollPack({ owned: new Set(), pityEpic: 3, pityLegendary: 3, rng: seededRng(42) });
    expect(a).toEqual(b);
  });
  it("turns duplicates into dust", () => {
    const owned = new Set(CARDS.map(c => c.key));
    const roll = rollPack({ owned, pityEpic: 0, pityLegendary: 0, rng: seededRng(3) });
    expect(roll.cards.every(c => !c.isNew)).toBe(true);
    expect(roll.dust).toBe(roll.cards.reduce((sum, c) => sum + DUPLICATE_DUST[c.rarity], 0));
    expect(roll.dust).toBeGreaterThan(0);
  });
  it("guarantees an Epic or better by the 10th pack without one", () => {
    // weight pick 0 would be a Rare in the top slot; pity must lift it
    const roll = rollPack({ owned: new Set(), pityEpic: EPIC_PITY - 1, pityLegendary: 0, rng: fixed(0) });
    expect(["epic", "legendary"]).toContain(roll.cards[4]!.rarity);
    expect(roll.pityEpic).toBe(0);
  });
  it("never goes more than 10 packs without an Epic over a long simulation", () => {
    const rng = seededRng(99);
    let pityEpic = 0, pityLegendary = 0, gap = 0, worst = 0;
    for (let i = 0; i < 3000; i++) {
      const roll = rollPack({ owned: new Set(), pityEpic, pityLegendary, rng });
      pityEpic = roll.pityEpic; pityLegendary = roll.pityLegendary;
      const hit = roll.cards.some(c => c.rarity === "epic" || c.rarity === "legendary");
      gap = hit ? 0 : gap + 1; worst = Math.max(worst, gap);
    }
    expect(worst).toBeLessThan(EPIC_PITY);
  });
  it("counts pity up when the top card is only Rare", () => {
    const roll = rollPack({ owned: new Set(), pityEpic: 2, pityLegendary: 5, rng: fixed(0) });
    expect(roll.cards[4]!.rarity).toBe("rare");
    expect(roll.pityEpic).toBe(3);
    expect(roll.pityLegendary).toBe(6);
  });
  it("legendary pity only applies when a legendary card exists", () => {
    const roll = rollPack({ owned: new Set(), pityEpic: 0, pityLegendary: LEGENDARY_PITY - 1, rng: fixed(0) });
    if (cardsOfRarity("legendary").length) expect(roll.cards[4]!.rarity).toBe("legendary");
    else expect(roll.cards[4]!.rarity).not.toBe("legendary");
  });
  it("prefers cards the member does not have yet", () => {
    const rares = cardsOfRarity("rare");
    const owned = new Set(rares.slice(1).map(c => c.key));
    const roll = rollPack({ owned, pityEpic: 0, pityLegendary: 0, rng: fixed(0) });
    if (roll.cards[4]!.rarity === "rare") expect(roll.cards[4]!.key).toBe(rares[0]!.key);
  });
  it("reports pity remaining", () => {
    expect(pityRemaining(0, 0)).toEqual({ epicIn: EPIC_PITY, legendaryIn: LEGENDARY_PITY });
    expect(pityRemaining(9, 39)).toEqual({ epicIn: 1, legendaryIn: 1 });
  });
});

describe("daily pack", () => {
  const t0 = new Date("2026-11-08T12:00:00Z");
  const after = (ms: number) => new Date(t0.getTime() + ms);
  it("accrues one pack per 20 hours", () => {
    expect(accrue({ banked: 0, accruedAt: t0 }, after(ACCRUAL_MS - 1)).banked).toBe(0);
    expect(accrue({ banked: 0, accruedAt: t0 }, after(ACCRUAL_MS)).banked).toBe(1);
    expect(accrue({ banked: 0, accruedAt: t0 }, after(2.5 * ACCRUAL_MS)).banked).toBe(2);
  });
  it("keeps the remainder of the clock when packs accrue", () => {
    const clock = accrue({ banked: 0, accruedAt: t0 }, after(1.5 * ACCRUAL_MS));
    expect(clock.accruedAt.getTime()).toBe(t0.getTime() + ACCRUAL_MS);
    expect(nextPackAt(clock)!.getTime()).toBe(t0.getTime() + 2 * ACCRUAL_MS);
  });
  it("caps at 3 and restarts the timer from the moment a pack is opened", () => {
    const capped = accrue({ banked: 0, accruedAt: t0 }, after(10 * ACCRUAL_MS));
    expect(capped.banked).toBe(MAX_BANKED);
    expect(nextPackAt(capped)).toBeNull();
    expect(accrue({ banked: MAX_BANKED, accruedAt: t0 }, after(50 * ACCRUAL_MS)).accruedAt.getTime()).toBe(after(50 * ACCRUAL_MS).getTime());
  });
});

describe("crafting", () => {
  const common = CARDS.find(c => c.rarity === "common")!.key;
  const rare = CARDS.find(c => c.rarity === "rare")!.key;
  const epic = CARDS.find(c => c.rarity === "epic")!.key;
  it("costs dust by rarity", () => {
    expect(craftCheck(common, new Set(), 1000)).toEqual({ cost: CRAFT_COST.common });
    expect(craftCheck(rare, new Set(), 1000)).toEqual({ cost: CRAFT_COST.rare });
  });
  it("refuses unknown, owned, uncraftable and unaffordable cards", () => {
    expect(craftCheck("nope", new Set(), 999)).toEqual({ error: "unknown" });
    expect(craftCheck(common, new Set([common]), 999)).toEqual({ error: "owned" });
    expect(craftCheck(epic, new Set(), 99999)).toEqual({ error: "not-craftable" });
    expect(craftCheck(rare, new Set(), CRAFT_COST.rare! - 1)).toEqual({ error: "dust" });
    expect(CARD_BY_KEY.has(common)).toBe(true);
  });
});
