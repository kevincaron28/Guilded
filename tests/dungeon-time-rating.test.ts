import { describe, expect, it } from "vitest";
import { calculateDungeonRating, createDungeonRatingRules, frozenRating, timeRating, type RatingRun } from "../src/services/dungeon-rating.js";

const rules = createDungeonRatingRules({ "36": 1800 }, 3, { "36": { min: 15, max: 25, difficultyId: 1 } });
function run(seconds = 1500, level: number | null = 20): RatingRun {
  return { instanceId: 36, difficultyId: 1, dungeonName: "Test dungeon", runRef: "test", durationSec: seconds,
    startedAt: new Date(1000000), endedAt: new Date((1000 + seconds) * 1000),
    players: [{ character: "Member", memberId: "m", member: { displayName: "Member" }, presentSec: seconds },
      { character: "Guest", memberId: null, member: null, presentSec: seconds }],
    competitionData: { players: [{ name: "Member", level: 20, minLevel: 20 }, { name: "Guest", level, minLevel: level }],
      encounters: [{ id: 1, name: "Boss", success: true, startedAt: 1100, at: 1190 }] } };
}
describe("dungeon-time competition", () => {
  it.each([[2400, 150], [1800, 200], [1500, 240], [1200, 300], [900, 400], [600, 400], [14400, 50]])("rates %i seconds as %i", (seconds, points) => {
    expect(timeRating(seconds, 1800)).toBe(points);
    expect(calculateDungeonRating([run(seconds)], rules)[0]?.points).toBe(points);
  });
  it("checks outside-guild carriers and unknown levels without deleting their runs", () => {
    for (const [level, reason] of [[60, "Overlevel carry"], [null, "Party levels unknown"], [10, "Below level range"]] as const) {
      const rows = calculateDungeonRating([run(600, level)], rules);
      expect(rows[0]).toMatchObject({ points: 0, details: [expect.objectContaining({ unrankedReason: reason, bosses: [] })] });
      expect(frozenRating(rows)).toEqual(rows);
    }
    const incomplete = run(); incomplete.competitionData = { players: [{ name: "Member", level: 20, minLevel: 20 }] };
    expect(calculateDungeonRating([incomplete], rules)[0]?.points).toBe(0);
  });
  it("keeps fastest eligible boss records independently of best full-run score", () => {
    const slower = run(1800); slower.runRef = "slower";
    (slower.competitionData as { encounters: { at: number }[] }).encounters[0]!.at = 1160;
    const rows = calculateDungeonRating([run(), slower, run(600, 60)], rules);
    expect(rows[0]).toMatchObject({ points: 240, dungeons: 1, details: [expect.objectContaining({
      durationSec: 1500, bosses: [{ id: 1, name: "Boss", durationSec: 60, runRef: "slower" }]
    })] });
    expect(frozenRating(rows)).toEqual(rows);
  });
  it("does not invent a target, level band, or boss start timestamp", () => {
    expect(calculateDungeonRating([run()], createDungeonRatingRules())[0]?.points).toBe(0);
    const missing = run(); missing.competitionData = { players: [{ name: "Member", level: 20, minLevel: 20 }, { name: "Guest", level: 20, minLevel: 20 }],
      encounters: [{ id: 1, success: true, at: 1190 }] };
    expect(calculateDungeonRating([missing], rules)[0]?.details?.[0]?.bosses).toEqual([]);
    expect(calculateDungeonRating([{ ...run(), difficultyId: 2 }], rules)[0]?.points).toBe(0);
  });
});
