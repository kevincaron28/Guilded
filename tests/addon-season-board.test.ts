import { describe, expect, it, vi } from "vitest";
import { addonDungeonBoard } from "../src/services/dungeon-stats.js";
import { standingsToLua } from "../companion/standings.mjs";
import { DUNGEON_RATING_RULES } from "../src/services/dungeon-rating.js";
describe("official season feed", () => {
  it("exports two separate character profiles for one owner without rewriting either as the main", async () => {
    const database = {
      dungeonSeason: { findFirst: async () => ({ id: "current", name: "Current", status: "ACTIVE", startsAt: new Date(0), ratingRules: DUNGEON_RATING_RULES }), findMany: async () => [] },
      dungeonRun: { findMany: async () => [
        { instanceId: 36, durationSec: 1000, players: [{ character: "Main", memberId: "a", presentSec: 1000, member: { displayName: "Discord" } }] },
        { instanceId: 33, durationSec: 1000, players: [{ character: "Alt", memberId: "a", presentSec: 1000, member: { displayName: "Discord" } }] }
      ] },
      dungeonPointTransaction: { groupBy: async () => [] }, member: { findMany: async () => [{ id: "a", displayName: "Discord" }] },
      character: { findMany: async () => [{ memberId: "a", name: "Main" }, { memberId: "a", name: "Alt" }] }
    };
    const board = await addonDungeonBoard(database as never, "guild");
    expect(board?.rows).toEqual([{ name: "Alt", points: 100 }, { name: "Main", points: 100 }]);
    expect(board?.profiles).toEqual([
      expect.objectContaining({ name: "Alt", points: 100, characters: [], details: [expect.objectContaining({ instanceId: 33 })] }),
      expect.objectContaining({ name: "Main", points: 100, characters: [], details: [expect.objectContaining({ instanceId: 36 })] })
    ]);
  });
  it("uses frozen exploration rating for new seasons rather than participation points", async () => {
    const database = {
      dungeonSeason: { findFirst: async () => null, findMany: async () => [{ id: "rated", name: "Exploration", status: "ENDED",
        ratingRules: DUNGEON_RATING_RULES, finalRating: [{ memberId: "a", name: "Ann", points: 200, dungeons: 2 }],
        finalStandings: [{ memberId: "a", name: "Ann", points: 9999 }] }] },
      dungeonPointTransaction: { groupBy: async () => [] }, member: { findMany: async () => [] }, character: { findMany: async () => [] }
    };
    expect((await addonDungeonBoard(database as never, "guild"))?.rows).toEqual([{ name: "Ann", points: 200 }]);
  });
  it("aggregates current and archived seasons once, preserves reversals and uses main characters", async () => {
    const database = {
      dungeonSeason: { findFirst: async () => ({ id: "now", name: "Season 2", status: "ACTIVE" }), findMany: async () => [{ id: "old", name: "Season 1", status: "ENDED",
        startsAt: new Date("2026-09-01T00:00:00Z"), endsAt: new Date("2026-10-01T00:00:00Z") }] },
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
    expect(board?.history[0]).toMatchObject({ startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-10-01T00:00:00.000Z" });
    expect(board).toMatchObject({ startsAt: null, endsAt: null });
    expect(lua).toContain('status = "ENDED", startsAt = "2026-09-01T00:00:00.000Z", endsAt = "2026-10-01T00:00:00.000Z"');
    expect(lua).toContain('startsAt = nil, endsAt = nil');
  });
  it("publishes the same archived points as Discord after later ledger corrections", async () => {
    const database = {
      dungeonSeason: { findFirst: async () => null, findMany: async () => [{ id: "old", name: "Season 1", status: "ENDED", finalStandings: [{ memberId: "a", name: "Ann", points: 100 }] }] },
      dungeonPointTransaction: { groupBy: async () => [{ seasonId: "old", memberId: "a", _sum: { amount: 80 } }] },
      member: { findMany: async () => [{ id: "a", displayName: "Ann" }] }, character: { findMany: async () => [] }
    };
    expect((await addonDungeonBoard(database as never, "guild"))?.rows).toEqual([{ name: "Ann", points: 100 }]);
  });
});
