import { describe, expect, it } from "vitest";
import { ratingDungeonKey } from "../src/services/dungeon-rating.js";
import { publicRouteKey } from "../src/services/public-score.js";
import { withoutDeparted } from "../src/services/roster-presence.js";

const key = (instanceId: number, encounters: unknown) => ratingDungeonKey({ instanceId, competitionData: { encounters } } as never);

describe("endgame wing routes: edge cases (16 Nov 2026 sweep)", () => {
  it("a run with no boss killed on a shared map has no wing (route unknown), never a guessed one", () => {
    for (const map of [229, 429, 329]) {
      expect(key(map, [])).toBe(String(map));
      expect(key(map, [{ name: "Balnazzar", success: false }])).toBe(String(map));
      expect(key(map, undefined)).toBe(String(map));
      expect(key(map, "not a list")).toBe(String(map));
      expect(publicRouteKey(map, [])).toBeNull();
      expect(publicRouteKey(map, [{ name: "Balnazzar", success: false }])).toBeNull();
    }
    expect(ratingDungeonKey({ instanceId: 429, competitionData: null } as never)).toBe("429");
  });
  it("bosses of two wings in one run stay ambiguous", () => {
    expect(key(429, [{ name: "King Gordok", success: true }, { name: "Alzzin the Wildshaper", success: true }])).toBe("429");
  });
  it("an English boss name on a French client and a French one on an English client both resolve", () => {
    expect(key(329, [{ name: "Baron Rivendare", success: true }])).toBe("329:service");
    expect(key(229, [{ name: "General Drakkisath", success: true }])).toBe("229:upper");
    expect(key(229, [{ name: "Seigneur Wyrmthalak", success: true }])).toBe("229:lower");
  });
  it("an accent typed in decomposed form (NFD) or with stray spaces still matches", () => {
    const nfd = "Général Drakkisath".normalize("NFD");
    expect(nfd).not.toBe("Général Drakkisath");
    expect(key(229, [{ name: nfd, success: true }])).toBe("229:upper");
    expect(key(229, [{ name: "  GÉNÉRAL DRAKKISATH ", success: true }])).toBe("229:upper");
    expect(publicRouteKey(229, [{ name: nfd, success: true }])).toBe("229:upper");
  });
});

describe("race to 60 roster edge cases", () => {
  const chars = [{ key: "ann lee", name: "Ann Lee" }, { key: "bob", name: "Bob" }];
  const row = (nameKey: string, inGuild: boolean) => ({ name: nameKey, nameKey, inGuild, observedAt: new Date("2026-11-16T00:00:00Z") });
  it("a transient roster with zero rows removes nobody", () => {
    expect(withoutDeparted(chars, [])).toHaveLength(2);
  });
  it("a roster that lists everyone as present removes nobody, and one departed first name does not take a full-name namesake with it", () => {
    expect(withoutDeparted(chars, [row("ann lee", true), row("bob", true)])).toHaveLength(2);
    // "bob" left but "Bob Stone" is in the guild: the bare first-name character is the one the roster still sees
    expect(withoutDeparted([{ key: "bob stone", name: "Bob Stone" }], [row("bob", false), row("bob stone", true)])).toHaveLength(1);
  });
  it("a member renamed to a new full name is kept under the new name and dropped under the old one", () => {
    const roster = [row("ann lee", false), row("ann moss", true)];
    expect(withoutDeparted([{ key: "ann lee", name: "Ann Lee" }, { key: "ann moss", name: "Ann Moss" }], roster).map((c) => c.name)).toEqual(["Ann Moss"]);
  });
});
