import { describe, expect, it, vi } from "vitest";
import { calculateDungeonRating, createDungeonRatingRules, dungeonRating, frozenRating, hasDungeonRating, ratingEmbed } from "../src/services/dungeon-rating.js";
import { startSeason } from "../src/services/dungeon-admin.js";
const rules = createDungeonRatingRules({ "36": 1200 }, 2);
const run = (seconds: number, ref = String(seconds), instanceId = 36) => ({
  instanceId, dungeonName: "Deadmines", runRef: ref, durationSec: seconds,
  players: [{ memberId: "m", character: "Member", member: { displayName: "Member" }, presentSec: seconds }]
});
describe("seasonal completion plus speed", () => {
  it.each([[1500, 100], [1200, 100], [1020, 110], [840, 120], [600, 120]])("scores %i seconds as %i", (seconds, points) => {
    const rows = calculateDungeonRating([run(seconds)], rules);
    expect(rows[0]?.points).toBe(points);
    expect(rows[0]?.details?.[0]).toMatchObject({ points, targetSec: 1200, durationSec: seconds, runRef: String(seconds) });
  });
  it("uses one character's highest result once and cannot lose score on a slower run", () => {
    const rows = calculateDungeonRating([run(1020), run(1500), run(840), run(2000), run(1000, "other", 33)], rules);
    expect(rows[0]).toMatchObject({ points: 220, dungeons: 2 });
    expect(rows[0]?.details?.find(d => d.instanceId === 36)).toMatchObject({ runRef: "840", points: 120 });
    expect(calculateDungeonRating([run(840), run(840)], rules)[0]?.points).toBe(120);
  });
  it("uses no target rather than inventing one and rejects malformed rule snapshots", () => {
    expect(calculateDungeonRating([run(600)], createDungeonRatingRules({}, 2))[0]?.points).toBe(100);
    expect(hasDungeonRating({ ...rules, targets: { "36": Infinity } })).toBe(false);
    expect(hasDungeonRating({ ...rules, targets: { "36": -1 } })).toBe(false);
    expect(calculateDungeonRating([run(600)], { ...rules, speedBonus: 200 })).toEqual([]);
    const targets = { "36": 1200 };
    const frozen = createDungeonRatingRules(targets);
    targets["36"] = 600;
    expect(frozen.targets["36"]).toBe(1200);
  });
  it("freezes detailed results and never queries mutable runs for an archive", async () => {
    const finalRating = calculateDungeonRating([run(1020), run(1000, "other", 33)], rules);
    const findMany = vi.fn();
    const season = { id: "s", startsAt: new Date(0), status: "ENDED", ratingRules: rules, finalRating };
    expect(await dungeonRating({ dungeonRun: { findMany } } as never, "g", season)).toEqual(finalRating);
    expect((await dungeonRating({ dungeonRun: { findMany } } as never, "g", season, 36))[0]).toMatchObject({ points: 110, dungeons: 1 });
    expect(findMany).not.toHaveBeenCalled();
    expect(frozenRating(finalRating)).toEqual(finalRating);
    const corrupt = structuredClone(finalRating);
    corrupt[0]!.details![0]!.speedBonus = 19;
    expect(frozenRating(corrupt)).toBeNull();
  });
  it("advertises the active season rules and preserves old-season wording", () => {
    expect(ratingEmbed([], "New", "en", rules).toJSON().description).toContain("0–20 speed");
    expect(ratingEmbed([], "Old", "en").toJSON().description).toContain("no speed bonus");
  });
  it("copies configured targets at season creation without rewriting old rules", async () => {
    const create = vi.fn(async ({ data }) => data);
    const tx = { $executeRaw: vi.fn(), dungeonSeason: { findFirst: async () => null, findMany: async () => [],
      updateMany: vi.fn(), create }, guildSettings: { findUnique: async () => ({ dungeonConfig: { targets: { "36": 1200 } } }) } };
    const db = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
    await startSeason(db as never, "g", "Fresh");
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ ratingRules: createDungeonRatingRules({ "36": 1200 }) }) });
  });
});
