import { describe, expect, it } from "vitest";
import { foreverNameMatches, foreverSameName, idKey, sameCharacter } from "../companion/character-identity.mjs";

// The addon sends ids as hex ("6a7bd5"), the bot stores wowId as a bigint (6978517n), the Armory gives a number: one character.
// Values from the in-game check of 20 Nov 2026 (Lebowski Holyroller: GUID Player-6800-006A7BD5, Armory id 6978517).
describe("character ids in every format", () => {
  it("reads hex, bigint and number as the same id", () => {
    expect(idKey("6a7bd5")).toBe("6978517");
    expect(idKey("006A7BD5")).toBe("6978517");
    expect(idKey(6978517n)).toBe("6978517");
    expect(idKey(6978517)).toBe("6978517");
    expect(idKey("not an id")).toBeNull();
    expect(idKey(null)).toBeNull();
  });
  it("matches across formats and keeps different ids apart", () => {
    expect(foreverSameName("Lebowski Holyroller", "Lebowski Holy", "6a7bd5", 6978517n)).toBe(true);
    expect(foreverSameName("Lebowski Holyroller", "Lebowski Haze", "6a7bd5", 6978518n)).toBe(false);
    expect(sameCharacter("Lebowski Holyroller", "Lebowski", "6a7bd5", null)).toBe(true);
  });
  it("finds the row holding the reported id among several Lebowskis", () => {
    const rows = [{ name: "Lebowski Holyroller", wowId: 6978517n }, { name: "Lebowski Haze", wowId: 123n }, { name: "Lebowski Banker", wowId: null }];
    expect(foreverNameMatches(rows, "Lebowski", undefined, "6a7bd5").map((r: { name: string }) => r.name)).toEqual(["Lebowski Holyroller"]);
    expect(foreverNameMatches(rows, "Lebowski").map((r: { name: string }) => r.name)).toEqual(["Lebowski Banker"]);
  });
});
