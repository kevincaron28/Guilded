import { describe, expect, it } from "vitest";
import { roleBadges } from "../src/services/dungeon-rating.js";

describe("role badges on the Discord rating board", () => {
  const detail = (points: number) => ({ points }) as never;
  it("names the main role like the website: most scored routes first, then score, and only roles that scored", () => {
    // damage has the higher score but the tank has more routes: tank is the main role, as on the character page
    expect(roleBadges({ roles: [{ role: "TANK", points: 300, details: [detail(150), detail(150)] }, { role: "HEALER", points: 0, details: [] }, { role: "DAMAGER", points: 800, details: [detail(800)] }] })).toBe("🛡️ 300 · ⚔️ 800");
    // equal routes: the higher score leads
    expect(roleBadges({ roles: [{ role: "TANK", points: 300, details: [detail(300)] }, { role: "DAMAGER", points: 800, details: [detail(800)] }] })).toBe("⚔️ 800 · 🛡️ 300");
    expect(roleBadges({ roles: [{ role: "TANK", points: 0, details: [] }] })).toBe("");
    expect(roleBadges({})).toBe("");
  });
});
