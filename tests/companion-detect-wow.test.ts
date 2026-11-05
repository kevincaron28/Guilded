import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { rankSavedVariables, pickSavedVariables } = createRequire(import.meta.url)("../companion-app/detect-wow.cjs");

// After WoW Forever launched, a PC can hold a stale beta file, an Era or Retail file and the live
// Forever file. The companion must offer, and when it can pick by itself, choose the Forever one.
const entry = (game: string, modifiedMs: number, exists = true) => ({ path: `C:\\WoW\\${game}\\WTF\\Guilded.lua`, exists, game, modifiedMs });

describe("saved-file ranking", () => {
  it("puts Forever first, other games next and the beta client last", () => {
    const ranked = rankSavedVariables([entry("_classic_beta_", 900), entry("_retail_", 800), entry("_forever_", 100), entry("_classic_era_", 700)]);
    expect(ranked.map((item: { game: string }) => item.game)).toEqual(["_forever_", "_retail_", "_classic_era_", "_classic_beta_"]);
  });

  it("lists files that exist before folders still waiting for their first save", () => {
    const ranked = rankSavedVariables([entry("_forever_", 0, false), entry("_retail_", 800)]);
    expect(ranked[0].game).toBe("_retail_");
  });
});

describe("automatic pick", () => {
  it("takes the only file, or the only Forever file among several", () => {
    expect(pickSavedVariables([entry("_retail_", 1)]).game).toBe("_retail_");
    expect(pickSavedVariables([entry("_retail_", 9), entry("_forever_", 1)]).game).toBe("_forever_");
  });

  it("does not guess between files it cannot tell apart", () => {
    expect(pickSavedVariables([entry("_retail_", 1), entry("_classic_era_", 2)])).toBeNull();
    expect(pickSavedVariables([entry("_forever_", 1), entry("_forever_", 2)])).toBeNull();
    expect(pickSavedVariables([])).toBeNull();
  });
});

describe("account folder waiting for its first save", () => {
  it("picks the one live Forever account folder before Guilded.lua exists, never a stale beta folder", () => {
    const live = entry("_forever_", 0, false), beta = entry("_classic_beta_", 0, false);
    expect(pickSavedVariables([live, beta].filter((item) => !/beta/i.test(item.game))).game).toBe("_forever_");
    expect(pickSavedVariables([entry("_forever_", 0, false), entry("_forever_", 0, false)])).toBeNull();
  });
});
