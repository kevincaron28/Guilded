import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { novemberCatalogEmbeds, novemberCatalogMarkdown, novemberDungeonCatalog } from "../src/services/dungeon-november-catalog.js";
import { betaSeasonRules, bestEightBetaRules, BETA_DUNGEONS } from "../src/services/dungeon-beta-preset.js";
import { hasDungeonRating } from "../src/services/dungeon-rating.js";

describe("November catalog is separate from active scoring", () => {
  it("includes every beta route, all nine announcements and shared-instance wings", () => {
    const plan = novemberDungeonCatalog();
    expect(plan.routes).toHaveLength(35);
    expect(new Set(plan.routes.map(r => r.id)).size).toBe(35);
    expect(new Set(plan.routes.map(r => r.family)).size).toBe(28);
    expect(plan.routes.filter(r => r.sources.includes("announcement"))).toHaveLength(9);
    expect(plan.routes.flatMap(r => r.betaScoringKey ? [r.betaScoringKey] : []).sort()).toEqual(BETA_DUNGEONS.map(r => r.key).sort());
    for (const [family, count] of [["scarlet-monastery", 4], ["dire-maul", 3], ["stratholme", 2], ["blackrock-spire", 2]] as const) {
      expect(plan.routes.filter(r => r.family === family)).toHaveLength(count);
    }
  });
  it("cannot be interpreted as rating rules or invent launch eligibility", () => {
    const plan = novemberDungeonCatalog();
    expect(hasDungeonRating(plan)).toBe(false);
    expect(plan.ratedRoutes).toEqual([]);
    expect(plan.startsAt).toBeNull();
    expect(plan.routes.filter(r => r.rating === "candidate-pending-verification")).toHaveLength(10);
    for (const route of plan.routes) {
      expect(route.participation).toBe("planned-pending-verification");
      expect(route.launchVerified).toBe(false);
      expect([route.allowedLevels, route.difficultyId, route.targetSec]).toEqual([null, null, null]);
    }
  });
  it("isolates returned drafts and leaves historical and active beta rules intact", () => {
    const before = JSON.stringify([betaSeasonRules(), bestEightBetaRules()]);
    const plan = novemberDungeonCatalog();
    plan.routes.splice(0, 10);
    plan.ratedRoutes.push("hall-of-thanes");
    plan.routes[0]!.name = "changed";
    expect(novemberDungeonCatalog().routes).toHaveLength(35);
    expect(novemberDungeonCatalog().ratedRoutes).toEqual([]);
    expect(novemberDungeonCatalog().routes.some(r => r.name === "changed")).toBe(false);
    expect(JSON.stringify([betaSeasonRules(), bestEightBetaRules()])).toBe(before);
  });
  it("keeps the saved JSON synchronized with the planning catalog", () => {
    expect(JSON.parse(readFileSync("docs/data/november-dungeon-catalog.json", "utf8"))).toEqual(novemberDungeonCatalog());
  });
  for (const lang of ["en", "fr"] as const) {
    it(`shows participation separately and fits Discord limits (${lang})`, () => {
      const embeds = novemberCatalogEmbeds(lang);
      expect(embeds.reduce((n, e) => n + e.length, 0)).toBeLessThanOrEqual(6000);
      const fields = embeds.flatMap(e => e.toJSON().fields ?? []);
      for (const field of fields) expect(field.value.length).toBeLessThanOrEqual(1024);
      expect(fields[0]?.value).toContain("The Hall of Thanes");
      expect(fields[0]?.value).toContain("Upper Blackrock Spire");
      expect(fields[1]?.value).toContain("Shaper's Terrace");
      expect(fields[1]?.value).not.toContain("The Hall of Thanes");
      const path = lang === "fr" ? "docs/NOVEMBER_DUNGEON_CATALOG_FR.md" : "docs/NOVEMBER_DUNGEON_CATALOG.md";
      expect(readFileSync(path, "utf8").replaceAll("\r\n", "\n")).toBe(novemberCatalogMarkdown(lang));
    });
  }
});
