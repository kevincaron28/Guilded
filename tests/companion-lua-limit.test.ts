import { describe, expect, it } from "vitest";
import { MAX_LUA_NODES, readDatabase } from "../companion/lua-export-content.mjs";

// 21 Nov 2026: an officer's 4.1 MB SavedVariables (parked copies of the guild after the Forever 1.60.1 realm hotfix) went over
// the old 500,000-value limit and every upload and standings update stopped.
describe("SavedVariables value limit", () => {
  it("reads a file with well over 500,000 Lua values", () => {
    const rows = Array.from({ length: 120_000 }, (_, i) => `{ ["at"] = ${i}, ["n"] = "r${i}" },`).join("\n");
    const lua = `GuildedDB = {\n["guildKey"] = "Q-",\n["runs"] = {\n${rows}\n},\n}\n`;
    const db = readDatabase(lua) as { guildKey: string; runs: unknown[] };
    expect(db.guildKey).toBe("Q-");
    expect(db.runs).toHaveLength(120_000);
  });

  it("still refuses an absurd number of values", () => {
    expect(MAX_LUA_NODES).toBeGreaterThanOrEqual(2_000_000);
    expect(MAX_LUA_NODES).toBeLessThanOrEqual(8_000_000);
  });
});
