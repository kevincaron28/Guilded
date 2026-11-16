import { describe, expect, it } from "vitest";
import { groupObservedGuilds, MIN_OBSERVED_MEMBERS, slugBase } from "../src/services/guild-public-stats.js";

const row = (guild: string | null, character: string, realm = "Doomhowl") => ({ guild, realm, character });

describe("observed guilds (guilds seen only in public runs)", () => {
  it("groups by folded name and realm, needs two characters and uses the most common spelling", () => {
    const out = groupObservedGuilds([row("Les Élus", "A"), row("les elus", "B"), row("Les Élus", "C"), row("Solo Guild", "D"), row(null, "E")], new Set());
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Les Élus");
    expect(out[0]!.characters.size).toBe(3);
    expect(out[0]!.spellings.sort()).toEqual(["Les Élus", "les elus"]);
    expect(MIN_OBSERVED_MEMBERS).toBe(2);
  });
  it("keeps the same guild name on two realms apart", () => {
    const out = groupObservedGuilds([row("Twins", "A", "One"), row("Twins", "B", "One"), row("Twins", "C", "Two"), row("Twins", "D", "Two")], new Set());
    expect(out.map((g) => g.realm).sort()).toEqual(["One", "Two"]);
  });
  it("leaves out a guild that already has a Guilded page", () => {
    const out = groupObservedGuilds([row("Quebec Gold", "A"), row("Quebec Gold", "B")], new Set([slugBase("⚜Quebec Gold⚜", "x")]));
    expect(out).toEqual([]);
  });
});

import { roleBadges } from "../src/services/dungeon-rating.js";
describe("role badges on the Discord rating board", () => {
  it("lists the main role first, only scored roles, and nothing without role scores", () => {
    const d = [] as never[];
    expect(roleBadges({ roles: [{ role: "TANK", points: 300, details: d }, { role: "HEALER", points: 0, details: d }, { role: "DAMAGER", points: 800, details: d }] })).toBe("⚔️ 800 · 🛡️ 300");
    expect(roleBadges({ roles: [{ role: "TANK", points: 0, details: d }] })).toBe("");
    expect(roleBadges({})).toBe("");
  });
});
