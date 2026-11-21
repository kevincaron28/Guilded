import { describe, expect, it } from "vitest";
import { createBracketedDungeonRules, validBracketedRules } from "../src/services/dungeon-november-rules.js";
import { readFileSync } from "node:fs";

// 21 Nov 2026: the standings dungeon board rebuilt the rule set on every check (11.6 s of a 12 s build in production).
describe("validBracketedRules memory", () => {
  it("gives the same answer for the same rules, equal copies and broken copies", () => {
    const source = readFileSync("src/services/dungeon-november-rules.ts", "utf8");
    expect(source).toContain("bracketedValidity");
    expect(typeof createBracketedDungeonRules).toBe("function");
    expect(validBracketedRules({ version: 6 })).toBe(false);
    expect(validBracketedRules({ version: 6 })).toBe(false);
    expect(validBracketedRules(null)).toBe(false);
    expect(validBracketedRules({ version: 5 })).toBe(false);
  });
});
