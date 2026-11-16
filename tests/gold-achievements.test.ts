import { describe, expect, it } from "vitest";
import { exportMilestones } from "../companion/lua-export-content.mjs";
import { ACHIEVEMENTS, GOLD_TIER_GOLD, achievementById } from "../src/services/achievements-catalogue.js";
import { emptyFacts, evaluateAchievements } from "../src/services/achievements.js";
import { badgeFamily } from "../src/services/badge-art.js";
import { importMilestones, milestoneSchema } from "../src/services/duels.js";

// Gold held (owner decision 16 Nov 2026): four tiers per character; only the TIER (1-4) is ever uploaded or stored, never the amount.
const now = new Date("2026-11-16T12:00:00Z");
const earned = (goldTier: number) => evaluateAchievements({ ...emptyFacts(), goldTier }, now).filter(row => row.earned && row.def.metric === "goldTier").map(row => row.def.id);
const row = { character: "Kev", realm: "R", kind: "gold", ref: "gold:2", value: 2, at: 1800000000 };

describe("gold achievements", () => {
  it("has four rows with the owner's names, tiers and thresholds, in both languages", () => {
    const rows = ACHIEVEMENTS.filter(def => def.metric === "goldTier");
    expect(rows.map(def => [def.id, def.tier, def.threshold, def.en.name, def.fr.name])).toEqual([
      ["gold-held-1", "bronze", 1, "Pocket Change", "Menue monnaie"],
      ["gold-held-2", "silver", 2, "Coin Collector", "Collectionneur de pièces"],
      ["gold-held-3", "gold", 3, "Thousandaire", "Millénaire"],
      ["gold-held-4", "epic", 4, "Gold Goblin", "Gobelin de l'or"]
    ]);
    expect(GOLD_TIER_GOLD).toEqual([100, 500, 1000, 5000]);
    expect(rows[3]!.en.description).toBe("Hold 5,000 gold on one character.");
    expect(achievementById("gold-held-3")?.fr.description).toContain("1 000");
  });

  it("earns the tiers up to the reported one, from the tier number alone", () => {
    expect(earned(0)).toEqual([]);
    expect(earned(1)).toEqual(["gold-held-1"]);
    expect(earned(3)).toEqual(["gold-held-1", "gold-held-2", "gold-held-3"]);
    expect(earned(4)).toHaveLength(4);
    expect(badgeFamily(ACHIEVEMENTS.find(def => def.id === "gold-held-1")!)).toBe("guild");
  });

  it("is accepted by the milestone schema and the companion export, tier only", () => {
    expect(milestoneSchema.safeParse(row).success).toBe(true);
    const database = { milestones: { chars: { "Kev-R": { name: "Kev", realm: "R", log: [{ id: "gold:2", kind: "gold", ref: "gold:2", value: 2, at: 1800000000, amount: 123456789 }] } } } };
    expect(exportMilestones(database)).toEqual([row]);
  });

  it("stores only a tier: a raw amount or a mismatched ref is rejected", async () => {
    const milestones: Record<string, unknown>[] = [];
    const tx = { memberMilestone: { createMany: async ({ data }: { data: Record<string, unknown>[] }) => { milestones.push(...data); return { count: data.length }; } } };
    const own = [{ name: "Kev" }];
    const result = await importMilestones(tx as never, "g", "forever", "m1", own, [row, { ...row, ref: "gold:5", value: 5 }, { ...row, ref: "gold:50000", value: 500000 }, { ...row, ref: "gold:3", value: 2 }], new Date("2028-01-01T00:00:00Z"));
    expect(result).toEqual({ recorded: 1, rejected: 3 });
    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({ kind: "gold", ref: "gold:2", value: 2 });
  });

  it("shows no amount of the member's own on any evaluated row", () => {
    const text = JSON.stringify(evaluateAchievements({ ...emptyFacts(), goldTier: 4 }, now).filter(result => result.def.metric === "goldTier"));
    expect(text).not.toMatch(/copper|amount/i);
    expect(emptyFacts().goldTier).toBe(0);
  });
});
