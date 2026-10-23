import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { clean, itemInsights, MAX_ITEMS, WISHERS_SHOWN } from "../src/services/item-insights.js";

const now = Date.now();
function fakeDb(wishes: { itemKey: string; priority: number; name: string }[], awards: { itemName: string; amount: number }[]) {
  return {
    wishlistEntry: { findMany: async () => wishes.map((w) => ({ itemKey: w.itemKey, priority: w.priority, createdAt: new Date(now), character: { name: w.name } })) },
    lootAward: { findMany: async () => awards }
  } as unknown as PrismaClient;
}

describe("item insights for tooltips", () => {
  it("counts wishers (a few named, most urgent first) and averages recent GP", async () => {
    const wishes = ["Amy", "Bob", "Cy", "Dee", "Eve", "Fay"].map((name, i) => ({ itemKey: "thunderfury, blessed blade", priority: i < 2 ? 1 : 2, name }));
    const rows = await itemInsights(fakeDb(wishes, [{ itemName: "Thunderfury,  Blessed Blade", amount: 100 }, { itemName: "thunderfury, blessed blade", amount: 141 }]), "g1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "thunderfury blessed blade", wishTotal: 6, gp: 121, awards: 2 });
    expect(rows[0]?.wish).toHaveLength(WISHERS_SHOWN);
    expect(rows[0]?.wish[0]).toEqual({ name: "Amy", priority: 1 });
  });

  it("keeps unwanted items only when they were awarded more than once", async () => {
    const rows = await itemInsights(fakeDb([], [{ itemName: "Plain Sword", amount: 10 }, { itemName: "Twice Ring", amount: 30 }, { itemName: "Twice Ring", amount: 50 }]), "g1");
    expect(rows.map((r) => [r.key, r.gp, r.awards])).toEqual([["twice ring", 40, 2]]);
  });

  it("puts the most wanted items first and caps the list", async () => {
    const wishes = Array.from({ length: MAX_ITEMS + 20 }, (_, i) => ({ itemKey: `item ${String(i).padStart(3, "0")}`, priority: 2, name: "Amy" }));
    wishes.push({ itemKey: "popular", priority: 1, name: "Bob" }, { itemKey: "popular", priority: 1, name: "Cy" });
    const rows = await itemInsights(fakeDb(wishes, []), "g1");
    expect(rows).toHaveLength(MAX_ITEMS);
    expect(rows[0]?.key).toBe("popular");
  });

  it("keeps the addon's separators out of names and keys", () => {
    expect(clean("A|B;C~D:E,F\nG")).toBe("A B C D E F G");
  });
});
