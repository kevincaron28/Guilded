import { describe, expect, it } from "vitest";
import { roleBadges } from "../src/services/dungeon-rating.js";

describe("role badges on the Discord rating board", () => {
  it("lists the main role first, only scored roles, and nothing without role scores", () => {
    const d = [] as never[];
    expect(roleBadges({ roles: [{ role: "TANK", points: 300, details: d }, { role: "HEALER", points: 0, details: d }, { role: "DAMAGER", points: 800, details: d }] })).toBe("⚔️ 800 · 🛡️ 300");
    expect(roleBadges({ roles: [{ role: "TANK", points: 0, details: d }] })).toBe("");
    expect(roleBadges({})).toBe("");
  });
});
