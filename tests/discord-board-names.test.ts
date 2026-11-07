import { describe, expect, it } from "vitest";
import { mergeSameNameRows, withFullNames, UNLINKED_RATING_PREFIX, type RatingRow } from "../src/services/dungeon-rating.js";
import { displayCharacterName, loadFullNameBook } from "../src/services/character-display.js";
import { dungeonSeasonCard } from "../src/services/dungeon-leaderboard.js";

const detail = (dungeonKey: string, points: number, runRef: string) =>
  ({ ratingVersion: 6 as const, dungeonKey, instanceId: Number(dungeonKey), name: `Dungeon ${dungeonKey}`, points, speedBonus: 0, durationSec: 1500, targetSec: 1500, runRef, bosses: [] });
const row = (memberId: string, name: string, details: ReturnType<typeof detail>[], bracket = "15-29"): RatingRow =>
  ({ memberId, character: name, name, points: details.reduce((s, d) => s + d.points, 0), dungeons: details.length, details, bracket, bestCount: 8 });

describe("the Discord dungeon board names one player once", () => {
  it("joins the two El Pirata rows (148 and 147) into one with the best result per dungeon", () => {
    const linked = row("member-1", "El Pirata", [detail("389", 100, "a"), detail("36", 48, "b")]);
    const unlinked = row(`${UNLINKED_RATING_PREFIX}el pirata`, "El Pirata", [detail("389", 99, "c"), detail("33", 47, "d")]);
    const merged = mergeSameNameRows([linked, unlinked]);
    expect(merged.map((r) => r.name)).toEqual(["El Pirata"]);
    expect(merged[0]!.memberId).toBe("member-1");
    expect(merged[0]!.dungeons).toBe(3);
    expect(merged[0]!.points).toBe(195);
    const card = dungeonSeasonCard(merged.map((r) => ({ name: r.name, points: r.points, dungeons: r.dungeons })), "Season 1", "fr", true);
    expect(card.ladder!.boards[0]!.rows.map((r) => r.name)).toEqual(["El Pirata"]);
  });
  it("keeps different players and different brackets apart, and two members sharing a bare first name apart", () => {
    const rows = [row("m1", "El Pirata", [detail("389", 100, "a")]), row("m2", "El Veneking", [detail("389", 90, "b")]),
      row("m1", "El Pirata", [detail("389", 80, "c")], "30-44"), row("m3", "Hulke", [detail("389", 70, "d")]), row("m4", "Hulke", [detail("389", 60, "e")])];
    expect(mergeSameNameRows(rows)).toHaveLength(5);
  });
  it("shows Crashing Pally, Shawir and Xaldin by the name standard, from the public runs when the guild tables lack the full name", async () => {
    const characters = [{ name: "Crashing", displayName: null }, { name: "Shawir", displayName: "Shawir Forever" }, { name: "Xaldin", displayName: "Xaldin Xaldin" }];
    const db = {
      character: { findMany: async () => characters },
      publicRunPlayer: { findMany: async (args: { where: { character: { in: string[] } } }) =>
        [{ character: "Crashing", displayName: "Crashing Pally" }].filter((p) => args.where.character.in.includes(p.character)) }
    };
    const book = await loadFullNameBook(db, "guild");
    expect(displayCharacterName("Crashing", book)).toBe("Crashing Pally");
    expect(displayCharacterName("Shawir", book)).toBe("Shawir");
    expect(displayCharacterName("Xaldin", book)).toBe("Xaldin");
    const named = await withFullNames(db as never, "guild", [{ name: "Crashing" }, { name: "Shawir" }, { name: "Xaldin" }]);
    expect(named.map((r) => r.name)).toEqual(["Crashing Pally", "Shawir", "Xaldin"]);
  });
  it("lets the guild's own tables win over the public runs", async () => {
    const db = {
      character: { findMany: async () => [{ name: "El", displayName: "El Pirata" }] },
      publicRunPlayer: { findMany: async () => [{ character: "El", displayName: "El Veneking" }] }
    };
    expect(displayCharacterName("El", await loadFullNameBook(db, "guild"))).toBe("El Pirata");
  });
});

describe("the run card keeps a real doubled last name", () => {
  it("shows Xaldin Xaldin when the guild's own tables hold it, Xaldin otherwise", async () => {
    const { runFullName } = await import("../src/services/dungeon-import.js");
    expect(runFullName("Xaldin", [{ name: "Xaldin", displayName: "Xaldin Xaldin" }])).toBe("Xaldin Xaldin");
    expect(runFullName("Xaldin", [{ name: "Xaldin" }])).toBe("Xaldin");
    expect(runFullName("Crashing", [{ name: "Crashing", displayName: "Crashing Pally" }])).toBe("Crashing Pally");
    expect(runFullName("Shawir", [{ name: "Shawir", displayName: "Shawir Forever" }])).toBe("Shawir");
  });
});
