import { describe, expect, it } from "vitest";
import { findProfessionHolders, professionCoverage } from "../src/services/profession-search.js";

const row = (character: string, member: string, isMain: boolean, profession: string, skillLevel: number) => ({
  profession, skillLevel, character: { name: character, isMain, member: { displayName: member } }
});

const database = {
  professionSkill: {
    findMany: async () => [
      row("Kev", "Kevin", true, "Alchemy", 250),
      row("Bob", "Robert", true, "alchemy", 300),
      row("Kevalt", "Kevin", false, "Mining", 150),
      row("Amy", "Amy", true, "Mining", 290)
    ]
  }
};

describe("profession search", () => {
  it("finds partial, case-insensitive matches, highest skill first", async () => {
    const holders = await findProfessionHolders(database as never, "g1", "alch");
    expect(holders.map((holder) => [holder.character, holder.skillLevel])).toEqual([["Bob", 300], ["Kev", 250]]);
  });

  it("returns nothing for a blank query", async () => {
    expect(await findProfessionHolders(database as never, "g1", "  ")).toEqual([]);
  });

  it("merges spelling variants in coverage and names the top character", async () => {
    expect(await professionCoverage(database as never, "g1")).toEqual([
      { profession: "Alchemy", characters: 2, topSkill: 300, topCharacter: "Bob" },
      { profession: "Mining", characters: 2, topSkill: 290, topCharacter: "Amy" }
    ]);
  });
});
