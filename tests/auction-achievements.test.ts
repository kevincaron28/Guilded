import { describe, expect, it } from "vitest";
import { exportMilestones } from "../companion/lua-export-content.mjs";
import { ACHIEVEMENTS, AUCTION_PROFIT_GOLD, AUCTION_SOLD_COUNT } from "../src/services/achievements-catalogue.js";
import { emptyFacts, evaluateAchievements } from "../src/services/achievements.js";
import { badgeFamily } from "../src/services/badge-art.js";
import { importMilestones, milestoneSchema } from "../src/services/duels.js";

// Auction house achievements (owner decision 16 Nov 2026): sales and profit, no Flipper. Only the TIER (1-3) is ever uploaded or stored.
const now = new Date("2026-11-16T12:00:00Z");
const earned = (facts: Partial<ReturnType<typeof emptyFacts>>, metric: string) => evaluateAchievements({ ...emptyFacts(), ...facts }, now).filter(row => row.earned && row.def.metric === metric).map(row => row.def.id);
const sold = { character: "Kev", realm: "R", kind: "auction", ref: "auction:sold-2", value: 2, at: 1800000000 };
const profit = { character: "Kev", realm: "R", kind: "auction", ref: "auction:profit-3", value: 3, at: 1800000000 };

describe("auction achievements", () => {
  it("has the sold and profit ladders with names in both languages", () => {
    const soldRows = ACHIEVEMENTS.filter(def => def.metric === "auctionSoldTier");
    expect(soldRows.map(def => [def.id, def.tier, def.threshold, def.en.name, def.fr.name])).toEqual([
      ["auction-sold-1", "bronze", 1, "First Sale", "Première vente"],
      ["auction-sold-2", "silver", 2, "Market Regular", "Habitué du marché"],
      ["auction-sold-3", "epic", 3, "Auction Baron", "Baron des enchères"]
    ]);
    const profitRows = ACHIEVEMENTS.filter(def => def.metric === "auctionProfitTier");
    expect(profitRows.map(def => def.en.name)).toEqual(["Profit Margin I", "Profit Margin II", "Profit Margin III"]);
    expect(profitRows.map(def => def.fr.name)).toEqual(["Marge bénéficiaire I", "Marge bénéficiaire II", "Marge bénéficiaire III"]);
    expect(AUCTION_SOLD_COUNT).toEqual([1, 100, 1000]);
    expect(AUCTION_PROFIT_GOLD).toEqual([100, 1000, 10000]);
    expect(profitRows[2]!.en.description).toBe("Earn 10,000 gold from the auction house.");
    expect(soldRows[2]!.fr.description).toContain(String.fromCharCode(49, 160, 48, 48, 48));
    expect(soldRows[0]!.en.description).toBe("Sell 1 item at the auction house.");
    for (const def of [...soldRows, ...profitRows]) expect(badgeFamily(def)).toBe("guild");
  });

  it("earns the tiers up to the reported one, from the tier number alone", () => {
    expect(earned({}, "auctionSoldTier")).toEqual([]);
    expect(earned({ auctionSoldTier: 2 }, "auctionSoldTier")).toEqual(["auction-sold-1", "auction-sold-2"]);
    expect(earned({ auctionProfitTier: 3 }, "auctionProfitTier")).toHaveLength(3);
    expect(earned({ auctionProfitTier: 3 }, "auctionSoldTier")).toEqual([]);
  });

  it("is accepted by the milestone schema and the companion export, tier only", () => {
    expect(milestoneSchema.safeParse(sold).success).toBe(true);
    const log = [{ kind: "auction", ref: "auction:sold-2", value: 2, at: 1800000000, count: 137, gold: 123456 }];
    expect(exportMilestones({ milestones: { chars: { "Kev-R": { name: "Kev", realm: "R", log } } } })).toEqual([sold]);
  });

  it("stores only a tier: a count, an amount or a mismatched ref is rejected", async () => {
    const milestones: Record<string, unknown>[] = [];
    const tx = { memberMilestone: { createMany: async ({ data }: { data: Record<string, unknown>[] }) => { milestones.push(...data); return { count: data.length }; } } };
    const rows = [sold, profit, { ...sold, ref: "auction:sold-137", value: 137 }, { ...sold, ref: "auction:profit-2", value: 3 }, { ...sold, ref: "auction:flip-2", value: 2 }, { ...sold, ref: "auction:sold-0", value: 0 }, { ...sold, ref: "auction:profit-50000", value: 50000 }];
    const result = await importMilestones(tx as never, "g", "forever", "m1", [{ name: "Kev" }], rows, new Date("2028-01-01T00:00:00Z"));
    expect(result).toEqual({ recorded: 2, rejected: 5 });
    expect(milestones.map(row => [row["kind"], row["ref"], row["value"]])).toEqual([["auction", "auction:sold-2", 2], ["auction", "auction:profit-3", 3]]);
  });

  it("the companion export drops auction rows that are not a tier 1-3 with a matching ref", () => {
    const at = 1800000000;
    const log = [
      { kind: "auction", ref: "auction:profit-3", value: 3, at }, { kind: "auction", ref: "auction:sold-1000", value: 1000, at }, { kind: "auction", ref: "auction:sold-1", value: 2, at },
      { kind: "auction", ref: "auction:sold-4", value: 4, at }, { kind: "auction", ref: "auction:buy-1", value: 1, at }
    ];
    expect(exportMilestones({ milestones: { chars: { "Kev-R": { name: "Kev", realm: "R", log } } } })).toHaveLength(1);
  });

  it("exposes no count or amount on any evaluated row", () => {
    const rows = evaluateAchievements({ ...emptyFacts(), auctionSoldTier: 3, auctionProfitTier: 3 }, now).filter(result => result.def.metric.startsWith("auction"));
    expect(JSON.stringify(rows)).not.toMatch(/copper|amount|"count"/i);
    expect(emptyFacts().auctionSoldTier).toBe(0);
    expect(emptyFacts().auctionProfitTier).toBe(0);
  });
});
