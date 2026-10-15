import { describe, expect, it } from "vitest";
import { dungeonScoringGuide } from "../src/services/dungeon-scoring-guide.js";
import { dungeonConfig } from "../src/services/dungeon-rules.js";

describe("dungeon scoring explanation", () => {
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
