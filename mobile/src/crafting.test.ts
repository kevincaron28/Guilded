import { describe, expect, it } from "vitest";
import { parseCrafting, professionLabel, sampleCrafting } from "./crafting";

describe("crafting answers", () => {
  it("keeps good items and open or claimed requests only", () => {
    const parsed = parseCrafting({
      items: [{ itemKey: 1, itemName: "Bandage", profession: "First Aid", crafters: ["Mira", 3] }, { itemKey: "x", itemName: "Bad" }],
      requests: [{ id: "a", item: "Bag", quantity: 2, status: "OPEN", mine: true }, { id: "b", item: "Old", status: "DONE" }]
    });
    expect(parsed.items).toEqual([{ itemKey: 1, itemName: "Bandage", profession: "First Aid", crafters: ["Mira"] }]);
    expect(parsed.requests.map((r) => r.id)).toEqual(["a"]);
    expect(parseCrafting(null)).toEqual({ items: [], requests: [] });
  });
  it("names professions in French and searches the sample guild locally", () => {
    expect(professionLabel("First Aid", "fr")).toBe("Premiers soins");
    expect(professionLabel("Tailoring", "en")).toBe("Tailoring");
    expect(sampleCrafting("potion").items.map((i) => i.itemName)).toEqual(["Major Healing Potion"]);
    expect(sampleCrafting("p").items).toEqual([]);
  });
});
