import { describe, expect, it } from "vitest";
import { gettingStartedPost } from "../src/services/bot-messages.js";

// The guide is meant to be read in under a minute: three steps and a short command list.
describe("getting started guide", () => {
  for (const lang of ["en", "fr"] as const) {
    it(`stays short and lists the essential commands (${lang})`, () => {
      const text = gettingStartedPost(lang).data.description!;
      expect(text.length).toBeLessThan(1500);
      for (const command of ["/help", "/character pair", "/dungeon leaderboard", "/bg duels", "/craft request", "/report bug", "/guilded verify", "/guilded companion", "/guilded sync", "/gdg", "/gsos", "/guilded diag"]) expect(text).toContain(command);
      // retired features must not come back
      expect(text).not.toMatch(/\/poll|\/wow use|Classic|raid tools/i);
    });
  }
});
