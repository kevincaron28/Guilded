import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseItemValues } from "../src/services/item-values.js";

const template = readFileSync(new URL("../docs/raid-loot/forever-onyxias-lair-prices.txt", import.meta.url), "utf8");

describe("Forever raid price template", () => {
  it("imports nothing until officers fill in prices, without complaints", () => {
    expect(parseItemValues(template)).toEqual({ values: [], problems: [] });
  });

  it("reads every listed item once a price is filled in", () => {
    const filled = parseItemValues(template.replace(/= \?/g, "= 100"));
    expect(filled.problems).toEqual([]);
    expect(filled.values).toHaveLength(17);
    expect(filled.values).toContainEqual({ name: "Vis'kag the Bloodletter", id: null, gp: 100 });
  });
});
