import { describe, expect, it, vi } from "vitest";
import { adjustPoints, describeConfig, setWeeklyRepeat, startSeason } from "../src/services/dungeon-admin.js";
import { dungeonConfig } from "../src/services/dungeon-rules.js";
import { DUNGEON_RATING_RULES } from "../src/services/dungeon-rating.js";

const noDb = {} as Parameters<typeof adjustPoints>[0];

describe("dungeon admin", () => {
  it("crowns exploration leaders rather than participation grinders and freezes both results", async () => {
    const season = { id: "rated", name: "Exploration", status: "ACTIVE", startsAt: new Date(0), ratingRules: DUNGEON_RATING_RULES };
    const tx = {
      $executeRaw: vi.fn(),
      dungeonSeason: { findFirst: async () => season, findMany: async () => [season], update: vi.fn(), updateMany: vi.fn(), create: vi.fn(async () => ({ id: "next" })) },
      dungeonRun: { findMany: async () => [36, 33].map(instanceId => ({ instanceId, durationSec: 1000,
        players: [{ memberId: "explorer", member: { displayName: "Explorer" }, presentSec: 1000 }] })) },
      dungeonPointTransaction: { groupBy: async () => [{ memberId: "grinder", _sum: { amount: 9999 } }] },
      member: { count: async () => 2, findMany: async () => [{ id: "grinder", displayName: "Grinder" }] },
      guildSettings: { findUnique: async () => null }, dungeonAchievement: { upsert: vi.fn() }
    };
    const db = { ...tx, $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx) };
    const result = await startSeason(db as never, "g", "Next", "rated");
    expect(result.champions).toEqual(["Explorer"]);
    expect(tx.dungeonSeason.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      finalRating: [expect.objectContaining({ memberId: "explorer", name: "Explorer", points: 200, dungeons: 2,
        details: [expect.objectContaining({ instanceId: 33, points: 100 }), expect.objectContaining({ instanceId: 36, points: 100 })] })],
      finalStandings: [{ memberId: "grinder", name: "Grinder", points: 9999 }]
    }) }));
    await expect(startSeason(db as never, "g", "Retry", "wrong")).rejects.toThrow(/changed/);
    expect(tx.dungeonSeason.create).toHaveBeenCalledOnce();
  });
  it("refuses zero or huge manual awards before touching the database", async () => {
    await expect(adjustPoints(noDb, "g", "m", 0, "x", "o")).rejects.toThrow(/not 0/);
    await expect(adjustPoints(noDb, "g", "m", 20_000, "x", "o")).rejects.toThrow();
    await expect(adjustPoints(noDb, "g", "m", 1.5, "x", "o")).rejects.toThrow();
  });

  it("rejects weekly shares outside 0-100%", async () => {
    await expect(setWeeklyRepeat(noDb, "g", "100,150")).rejects.toThrow(/percents/);
    await expect(setWeeklyRepeat(noDb, "g", "abc")).rejects.toThrow(/percents/);
  });

  it("shows changed rules with their default and named target times", () => {
    const text = describeConfig(dungeonConfig({ completion: 60, targets: { "36": 1500 }, weeklyRepeat: [1, 0.75] }), new Map([[36, "Deadmines"]]));
    expect(text).toContain("`completion` 60 (default 50)");
    expect(text).toContain("`noDeaths` 25 ·");
    expect(text).toContain("100% → 75%");
    expect(text).toContain("Deadmines 25:00");
  });
});

describe("achievement rules", () => {
  it("qualify from the run's facts and the dungeon count", async () => {
    const { qualifiedAchievements, achievementName } = await import("../src/services/dungeon-achievements.js");
    expect(qualifiedAchievements({ guildRecord: false, fullGuildGroup: false, underTarget: false, deathless: false }, 1, 10)).toEqual(["firstBlood"]);
    expect(qualifiedAchievements({ guildRecord: true, fullGuildGroup: true, underTarget: true, deathless: true }, 10, 10))
      .toEqual(["firstBlood", "noOneDies", "speedDemon", "recordBreaker", "guildSquad", "dungeonMaster"]);
    expect(achievementName("seasonChampion:abc", "fr", "Saison 1")).toBe("👑 Champion de saison (Saison 1)");
    expect(achievementName("unknownThing", "en")).toBe("unknownThing");
  });
});

 it("archives a season without deleting history and remembers every tied champion, including ties beyond five players", async () => {
  const past = { id: "past", name: "Season 1", status: "ACTIVE" };
  const people = Array.from({ length: 6 }, (_, i) => ({ id: "m" + i, displayName: "Player " + i }));
  const tx = {
    $executeRaw: vi.fn(),
    dungeonSeason: { findFirst: async () => past, findMany: async () => [past], update: vi.fn(), updateMany: vi.fn(), create: vi.fn(async () => ({ id: "new", name: "Season 2" })) },
    guildSettings: { findUnique: async () => null },
    dungeonPointTransaction: { groupBy: async () => people.map((person) => ({ memberId: person.id, _sum: { amount: 100 } })), deleteMany: vi.fn() },
    dungeonRun: { deleteMany: vi.fn() }, dungeonAchievement: { upsert: vi.fn() },
    member: { count: async () => 6, findMany: async () => people }
  };
  const db = { ...tx, $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) };
  const result = await startSeason(db as never, "g", "Season 2");
  expect(result.ended).toEqual(["Season 1"]);
  expect(result.champions).toHaveLength(6);
  expect(tx.dungeonAchievement.upsert).toHaveBeenCalledTimes(6);
  expect(tx.dungeonSeason.update).toHaveBeenCalledWith({ where: { id: "past" }, data: { finalStandings: expect.arrayContaining(people.map(person => ({ memberId: person.id, name: person.displayName, points: 100 }))), rulesSnapshot: expect.any(Object) } });
  expect(tx.dungeonSeason.updateMany).toHaveBeenCalledWith({ where: { guildId: "g", status: "ACTIVE" }, data: { status: "ENDED", endsAt: expect.any(Date) } });
  expect(tx.dungeonPointTransaction.deleteMany).not.toHaveBeenCalled();
  expect(tx.dungeonRun.deleteMany).not.toHaveBeenCalled();
});
