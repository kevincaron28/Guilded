import { describe, expect, it } from "vitest";
import { evaluateAchievements, emptyFacts, guildFirsts } from "../src/services/achievements.js";

const at = (day: number) => new Date(Date.UTC(2026, 10, day));
const earned = (facts: ReturnType<typeof emptyFacts>) => evaluateAchievements(facts, at(30)).filter(row => row.earned).map(row => row.def.id);

describe("profession achievements", () => {
  it("earns every skill step up to the highest skill", () => {
    const facts = emptyFacts();
    facts.editions["forever"] = { highestLevel: 60, atCap: 1, profession: 225, mastered: 0 };
    const ids = earned(facts);
    expect(ids).toEqual(expect.arrayContaining(["wow-forever-profession-75", "wow-forever-profession-150", "wow-forever-profession-225"]));
    expect(ids).not.toContain("wow-forever-profession-300");
  });
  it("counts mastered professions, rare recipes and crafts for guildmates", () => {
    const facts = emptyFacts();
    facts.editions["forever"] = { highestLevel: 60, atCap: 0, profession: 300, mastered: 2 };
    facts.rareRecipes = 5;
    facts.craftsDone = [at(1), at(2), at(3), at(4), at(5)];
    const ids = earned(facts);
    expect(ids).toEqual(expect.arrayContaining(["wow-forever-masters-2", "wow-forever-rare-recipes-1", "wow-forever-rare-recipes-5", "crafts-done-1", "crafts-done-5"]));
    expect(ids).not.toContain("wow-forever-masters-4");
    expect(ids).not.toContain("crafts-done-10");
  });
  it("gives the guild first only to the earliest live reach of 300", () => {
    const rows = [
      { memberId: "a", ref: "profnew:alchemy", reachedAt: at(3) },
      { memberId: "b", ref: "profnew:alchemy", reachedAt: at(5) },
      { memberId: "b", ref: "prof:mining-300", reachedAt: at(1) },
      { memberId: "a", ref: "profnew:mining", reachedAt: at(4) },
      { memberId: "a", ref: "prof:tailoring-300", reachedAt: at(2) }
    ];
    expect(guildFirsts(rows, "a")).toBe(1); // alchemy yes, mining no (b was there earlier), tailoring was a baseline, not live
    expect(guildFirsts(rows, "b")).toBe(0);
  });
});
