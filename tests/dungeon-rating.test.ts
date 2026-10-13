import { describe, expect, it, vi } from "vitest";
import { calculateDungeonRating, dungeonRating, DUNGEON_RATING_RULES, frozenRating, ratingEmbed, type RatingRun } from "../src/services/dungeon-rating.js";

const player = (memberId = "m", presentSec = 800) => ({ memberId, presentSec, member: { displayName: memberId } });
const run = (instanceId: number, players: RatingRun["players"] = [player()]): RatingRun => ({ instanceId, durationSec: 1000, players });
const season = { id: "s", status: "ACTIVE", startsAt: new Date("2026-10-13T17:00:00Z"), ratingRules: DUNGEON_RATING_RULES };

describe("distinct dungeon rating", () => {
  it("makes 100 repeats worth one slot, across characters and difficulties", () => {
    expect(calculateDungeonRating([...Array.from({ length: 100 }, () => run(3065)), run(36)]))
      .toEqual([{ memberId: "m", name: "m", points: 200, dungeons: 2 }]);
    expect(calculateDungeonRating([run(3065, [player(), player()])])[0]?.points).toBe(100);
  });
  it("requires a linked member and at least 80% presence, without rewarding invalid durations", () => {
    expect(calculateDungeonRating([run(36, [player("late", 799), player("eligible", 800),
      { memberId: null, presentSec: 1000, member: null }, player("broken", NaN)]), { ...run(42), durationSec: 0 }]))
      .toEqual([{ memberId: "eligible", name: "eligible", points: 100, dungeons: 1 }]);
  });
  it("queries only eligible season runs and this guild's linked members", async () => {
    const findMany = vi.fn().mockResolvedValue([run(36)]);
    await dungeonRating({ dungeonRun: { findMany } } as never, "g", season, 36);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      guildId: "g", seasonId: "s", valid: true, state: "COMPLETED", completedBy: "final boss",
      durationSec: { gt: 0 }, NOT: { runRef: { startsWith: "SIM-" } }, startedAt: { gte: season.startsAt }, instanceId: 36
    }, select: expect.objectContaining({ players: { where: { member: { guildId: "g" } }, select: expect.any(Object) } }) }));
  });
  it("never recomputes archived results, even after later corrections or renames", async () => {
    const finalRating = [{ memberId: "m", name: "Old name", points: 200, dungeons: 2 }];
    const archived = { ...season, status: "ENDED", finalRating };
    expect(await dungeonRating({} as never, "g", archived)).toEqual(finalRating);
    await expect(dungeonRating({} as never, "g", archived, 36)).rejects.toThrow(/Archived/);
    expect(await dungeonRating({} as never, "g", { ...archived, finalRating: null })).toEqual([]);
    expect(await dungeonRating({} as never, "g", { ...season, ratingRules: null })).toEqual([]);
    expect(frozenRating([{ ...finalRating[0], points: 201 }])).toBeNull();
  });
  it("gives tied ratings equal rank without speed or participation tie breakers", () => {
    const rows = calculateDungeonRating([run(36, [player("B"), player("A")]), run(42, [player("C")])]);
    const embed = ratingEmbed(rows, "Season", "en").toJSON();
    expect(embed.description?.match(/🏅/g)).toHaveLength(3);
    expect(embed.description).toContain("no speed bonus");
    expect(ratingEmbed(rows, "Season", "fr").toJSON().footer?.text).toContain("80 %");
  });
});
