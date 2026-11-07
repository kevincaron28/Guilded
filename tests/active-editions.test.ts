import { describe, expect, it } from "vitest";
import { ACTIVE_EDITIONS, activeEditions, editionList, heldEditions } from "../companion/active-editions.mjs";
import { GAME_EDITIONS } from "../companion/game-edition.mjs";

const ALL = [...GAME_EDITIONS];
const OTHERS = ALL.filter(edition => edition !== "forever");

// The Forever-first switch: ACTIVE_EDITIONS (companion/active-editions.mjs) is the only list that
// decides what members are offered. Hidden is not deleted, and flipping the list brings it back.
describe("Forever-first switch", () => {
  it("ships with WoW Forever only, and every id is a real edition", () => {
    expect([...ACTIVE_EDITIONS]).toEqual(["forever"]);
    for (const edition of ACTIVE_EDITIONS) expect(ALL).toContain(edition);
    expect(heldEditions()).toEqual(OTHERS);
  });

  it("can be flipped back: the helpers follow whatever list they are given", () => {
    expect(activeEditions(ALL)).toEqual(ALL);
    expect(heldEditions(ALL)).toEqual([]);
    expect(editionList(0)).toBe("WoW Forever");
    expect(editionList(0, ["forever", "retail"])).toBe("WoW Forever or Retail");
  });
});


