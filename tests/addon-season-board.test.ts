import { describe, expect, it, vi } from "vitest";
import { addonDungeonBoard } from "../src/services/dungeon-stats.js";
import { standingsToLua } from "../companion/standings.mjs";
describe("official season feed", () => {
  it("aggregates current and archived seasons once, preserves reversals and uses main characters", async () => {
    const database = {
      dungeonSeason: { findFirst: async () => ({ id: "now", name: "Season 2", status: "ACTIVE" }), findMany: async () => [{ id: "old", name: "Season 1", status: "ENDED" }] },
      dungeonPointTransaction: { groupBy: vi.fn(async () => [
        { seasonId: "now", memberId: "a", _sum: { amount: 20 } },
        { seasonId: "now", memberId: "b", _sum: { amount: 0 } },
        { seasonId: "old", memberId: "a", _sum: { amount: 80 } }
      ]) }, member: { findMany: async () => [{ id: "a", displayName: "Discord name" }] },
      character: { findMany: async () => [{ memberId: "a", name: "Main" }, { memberId: "a", name: "Alt" }] }
    };
    const board = await addonDungeonBoard(database as never, "guild");
    expect(database.dungeonPointTransaction.groupBy).toHaveBeenCalledOnce();
    expect(database.dungeonPointTransaction.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "guild", seasonId: { in: ["now", "old"] } } }));
    expect(board).toMatchObject({ season: "Season 2", rows: [{ name: "Main", points: 20 }], history: [{ season: "Season 1", rows: [{ name: "Main", points: 80 }] }] });
    const lua = standingsToLua({ standings: [], updatedAt: "2026-09-30", dungeonBoard: board });
    expect(lua).toContain('season = "Season 1", status = "ENDED"');
    expect(lua).toContain('name = "Main", points = 80');
  });
});
