import { describe, expect, it } from "vitest";
import { worldPvpCard } from "../src/services/world-pvp.js";

// 20 Nov 2026 polish round: the banner layout draws a card's subtitle in 620 px, so the world PvP board's subtitle names the
// week only (it used to list every column and was cut with an ellipsis); the columns are named by the table heads.
describe("world PvP card subtitle", () => {
  for (const lang of ["en", "fr"] as const) {
    it(`is short enough to be drawn whole (${lang})`, () => {
      const card = worldPvpCard({ weekKey: 1, standings: [] }, lang);
      expect(card.subtitle!.length).toBeLessThanOrEqual(34);
      expect(card.subtitle).not.toMatch(/undefined|null/);
    });
  }
});
