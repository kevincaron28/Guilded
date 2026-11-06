import { describe, expect, it } from "vitest";
import { bestEightBetaRules } from "../src/services/dungeon-beta-preset.js";
import { calculateDungeonRating, isUnlinkedRating, type RatingRun } from "../src/services/dungeon-rating.js";

const rules = bestEightBetaRules();
const key = rules.catalog[0]!.dungeonKey;
const names = ["Crashin Holyroller", "Xaldin Smith", "El Pirata", "Third Guy", "Fourth Guy"];

// One addon user (linked) plus four guildmates with no addon and no link, all flagged as guild members.
function party(links: Record<string, string> = { "Crashin Holyroller": "m-crash" }, strangers: string[] = []): RatingRun {
  const durationSec = 200 * rules.targets[key]! / 200;
  const all = [...names, ...strangers];
  return { instanceId: Number(key.split(":")[0]), difficultyId: 0, runRef: "R1", durationSec,
    startedAt: new Date(1000000), endedAt: new Date((1000 + durationSec) * 1000),
    players: all.map((character) => ({ character, memberId: links[character] ?? null,
      member: links[character] ? { displayName: character } : null, presentSec: durationSec, inGuild: !strangers.includes(character) })),
    competitionData: { players: all.map((name) => ({ name, level: 30, minLevel: 30 })),
      encounters: [{ id: 1, success: true, name: "Boss", startedAt: 1001, at: 1031 }] } };
}

describe("rating guildmates without the addon or a link", () => {
  it("credits every party member by character, using the full Forever name", () => {
    const rows = calculateDungeonRating([party()], rules);
    expect(rows.map((row) => row.name).sort()).toEqual([...names].sort());
    expect(rows.every((row) => row.points === rows[0]!.points && row.points > 0)).toBe(true);
    expect(rows.find((row) => row.name === "El Pirata")!.memberId).toBe("char:el pirata");
    expect(isUnlinkedRating(rows.find((row) => row.name === "Xaldin Smith")!.memberId)).toBe(true);
    expect(rows.find((row) => row.name === "Crashin Holyroller")!.memberId).toBe("m-crash");
  });

  it("moves the credit to the member once a character is linked, without counting it twice", () => {
    const rows = calculateDungeonRating([party({ "Crashin Holyroller": "m-crash", "El Pirata": "m-pirata" })], rules);
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.name === "El Pirata")).toEqual([expect.objectContaining({ memberId: "m-pirata" })]);
    expect(rows.filter((row) => isUnlinkedRating(row.memberId))).toHaveLength(3);
  });

  it("never rates players the addon did not flag as guildmates", () => {
    const rows = calculateDungeonRating([party({ "Crashin Holyroller": "m-crash" }, ["Stranger Danger"])], rules);
    expect(rows.map((row) => row.name)).not.toContain("Stranger Danger");
  });

  it("keeps the run's gates: a player present under 80% of the run is not rated", () => {
    const run = party();
    run.players[2]!.presentSec = 10;
    expect(calculateDungeonRating([run], rules).map((row) => row.name)).not.toContain("El Pirata");
  });
});
