import { describe, expect, it } from "vitest";
import { buildComposition, buildRetention, formatHealth, guildHealth } from "../src/services/guild-health.js";

const now = new Date("2026-10-01T00:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe("guild health", () => {
  it("counts classes, races and level bands", () => {
    const composition = buildComposition([
      { className: "Priest", race: "Human", level: 60 }, { className: "Priest", race: "Dwarf", level: 25 }, { className: "Mage", race: "Human", level: null }
    ], 1);
    expect(composition.byClass).toEqual([["Priest", 2], ["Mage", 1]]);
    expect(composition.byRace[0]).toEqual(["Human", 2]);
    expect(composition.levels).toEqual([{ label: "1-19", count: 0 }, { label: "20-39", count: 1 }, { label: "40-59", count: 0 }, { label: "60+", count: 1 }]);
    expect(composition.withoutCharacter).toBe(1);
  });

  it("measures retention per cohort and skips cohorts nobody is old enough for", () => {
    const rows = buildRetention([
      { createdAt: ago(120), status: "ACTIVE" }, { createdAt: ago(100), status: "LEFT" }, { createdAt: ago(70), status: "ACTIVE" }, { createdAt: ago(40), status: "ACTIVE" }
    ], now);
    expect(rows).toEqual([{ days: 30, joined: 4, stillHere: 3 }, { days: 60, joined: 3, stillHere: 2 }, { days: 90, joined: 2, stillHere: 1 }]);
    expect(buildRetention([{ createdAt: ago(5), status: "ACTIVE" }], now)).toEqual([]);
  });

  it("flags things that need attention", async () => {
    const members = Array.from({ length: 6 }, (_, i) => ({ createdAt: ago(100), status: i < 2 ? "ACTIVE" : "LEFT", _count: { characters: i === 0 ? 0 : 1 } }));
    const database = {
      member: { findMany: async () => members },
      character: { findMany: async () => Array.from({ length: 10 }, () => ({ className: "Warrior", race: "Human", level: 60 })) },
      application: { count: async () => 2 }
    };
    const health = await guildHealth(database as never, "g", now);
    expect(health.members).toBe(2);
    expect(health.attention.join("\n")).toContain("1 member(s) have no linked character");
    expect(health.attention.join("\n")).toContain("2 open application(s)");
    expect(health.attention.join("\n")).toContain("Only 33% of members who joined 30+ days ago are still here.");
    expect(health.attention.join("\n")).toContain("Few healer-capable classes");
    expect(formatHealth(health)).toContain("**Needs attention**");
  });
});
