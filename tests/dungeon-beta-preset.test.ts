import { describe, expect, it } from "vitest";
import { betaSeasonRules, BETA_DUNGEONS, BETA_SEASON_END } from "../src/services/dungeon-beta-preset.js";
import { calculateDungeonRating, dungeonRating, frozenRating, hasDungeonRating, seasonDungeonCatalog, type RatingRun } from "../src/services/dungeon-rating.js";

function wing(boss: string, seconds: number): RatingRun {
  return { instanceId: 189, difficultyId: 0, dungeonName: "Scarlet Monastery", durationSec: seconds, runRef: boss,
    startedAt: new Date(1000000), endedAt: new Date((1000 + seconds) * 1000),
    players: [{ character: "Main", memberId: "m", member: { displayName: "Main" }, presentSec: seconds }],
    competitionData: { players: [{ name: "Main", level: 30, minLevel: 30 }],
      encounters: [{ id: 1, name: boss, success: true, startedAt: 1100, at: 1160 }] } };
}
describe("short beta season preset", () => {
  it("freezes 16 provisional targets, beta level bands and the observed normal difficulty", () => {
    const rules = betaSeasonRules();
    expect(hasDungeonRating(rules)).toBe(true);
    expect(rules.provisionalTargets).toBe(true);
    expect(BETA_DUNGEONS).toHaveLength(16);
    expect(new Set(BETA_DUNGEONS.map(d => d.key)).size).toBe(16);
    expect("levelBands" in rules && Object.values(rules.levelBands).every(b => b.max <= 30 && b.min <= b.max && b.difficultyId === 0)).toBe(true);
    rules.targets["389"] = 1;
    expect(betaSeasonRules().targets["389"]).toBe(1200);
    expect(BETA_SEASON_END).toBe("2026-10-23T04:00:00.000Z");
    expect(seasonDungeonCatalog(betaSeasonRules(), [])).toHaveLength(16);
  });
  it("keeps two wings and their boss records separate through archive filtering", async () => {
    const rows = calculateDungeonRating([wing("Bloodmage Thalnos", 900), wing("Arcanist Doan", 1500)], betaSeasonRules());
    expect(rows[0]).toMatchObject({ points: 400, dungeons: 2 });
    expect(rows[0]!.details!.map(d => d.dungeonKey)).toEqual(["189:graveyard", "189:library"]);
    expect(rows[0]!.details!.map(d => d.bosses![0]!.runRef)).toEqual(["Bloodmage Thalnos", "Arcanist Doan"]);
    expect(frozenRating(rows)).toEqual(rows);
    expect(seasonDungeonCatalog(betaSeasonRules(), rows)).toHaveLength(16);
    expect(await dungeonRating({} as never, "g", { id: "s", startsAt: new Date(0), status: "ENDED", ratingRules: betaSeasonRules(), finalRating: rows }, 189)).toEqual(rows);
  });
  it("refuses unknown or mixed wings and carries even with a convincing dungeon label", () => {
    const unknown = wing("Other boss", 900); unknown.dungeonName = "Scarlet Monastery: Graveyard";
    expect(calculateDungeonRating([unknown], betaSeasonRules())[0]!.details![0]!.unrankedReason).toBe("Dungeon route unknown");
    const mixed = wing("Arcanist Doan", 900);
    (mixed.competitionData as { encounters: unknown[] }).encounters.push({ name: "Bloodmage Thalnos", success: true });
    expect(calculateDungeonRating([mixed], betaSeasonRules())[0]!.points).toBe(0);
    const carry = wing("Arcanist Doan", 600);
    (carry.competitionData as { players: { level: number }[] }).players[0]!.level = 31;
    expect(calculateDungeonRating([carry], betaSeasonRules())[0]!.details![0]!.unrankedReason).toBe("Overlevel carry");
    expect(calculateDungeonRating([wing("Arcaniste Doan", 1500)], betaSeasonRules())[0]!.points).toBe(200);
  });
});
