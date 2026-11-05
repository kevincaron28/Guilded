import { describe, expect, it } from "vitest";
import { summarizeCoverage, type CoverageMember } from "../src/services/link-coverage.js";

const member = (id: string, extra: Partial<CoverageMember> = {}): CoverageMember => ({
  memberId: id, discordUserId: `d${id}`, displayName: `Name ${id}`, characters: [], companionDevices: 0, provisionalKeys: [], ...extra
});
const ray = { name: "Ray", realm: "Doomhowl", nameKey: "ray" };

describe("summarizeCoverage", () => {
  it("counts linked, provisional, unlinked and companion members", () => {
    const { summary, rows } = summarizeCoverage([
      member("1", { characters: [ray], companionDevices: 1 }),
      member("2", { characters: [ray], provisionalKeys: ["ray"] }),
      member("3"),
      member("4", { companionDevices: 2 })
    ], [{ name: "Stray", realm: "Doomhowl" }]);
    expect(summary).toMatchObject({
      members: 4, linked: 2, fullyVerified: 1, hasProvisional: 1, unlinked: 2, withCompanion: 2,
      linkedWithoutCompanion: 1, companionWithoutLink: 1, characters: 2, provisionalCharacters: 1, unclaimedCharacters: 1
    });
    expect(rows.map((r) => r.state)).toEqual(["unlinked", "unlinked", "provisional", "verified"]);
    expect(rows.find((r) => r.state === "provisional")?.characters).toEqual(["Ray-Doomhowl (provisional)"]);
  });

  it("handles an empty guild", () => {
    expect(summarizeCoverage([], []).summary).toMatchObject({ members: 0, linked: 0, unlinked: 0 });
  });
});
