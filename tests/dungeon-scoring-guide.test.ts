import { describe, expect, it } from "vitest";
import { dungeonScoringGuide } from "../src/services/dungeon-scoring-guide.js";
import { dungeonConfig } from "../src/services/dungeon-rules.js";
import { readFileSync } from "node:fs";
import { Routes } from "discord.js";

describe("dungeon scoring explanation", () => {
  it("uses available Discord REST route helpers in the publication script", () => {
    // Maintenance scripts are outside tsconfig's source tree. Check their actual
    // installed REST helpers without executing any publication or database access.
    const source = readFileSync(new URL("../scripts/publish-dungeon-scoring.ts", import.meta.url), "utf8");
    const helpers = [...source.matchAll(/Routes\.(\w+)\(/g)].map(match => match[1]);
    expect(helpers.length).toBeGreaterThan(0);
    for (const helper of helpers) expect(typeof Routes[helper as keyof typeof Routes], helper).toBe("function");
  });
  for (const lang of ["en", "fr"] as const) {
    it(`uses configured awards and fits Discord embeds (${lang})`, () => {
      const config = dungeonConfig({ completion: 73, weeklyRepeat: [1, 0.25, 0] });
      const embed = dungeonScoringGuide(config, lang);
      const data = embed.toJSON();
      expect(embed.length).toBeLessThanOrEqual(6000);
      for (const field of data.fields ?? []) expect(field.value.length).toBeLessThanOrEqual(1024);
      expect(data.fields?.[2]?.value).toContain("73");
      expect(data.fields?.[3]?.value).toContain("100% → 25% → 0%");
    });
  }
});
