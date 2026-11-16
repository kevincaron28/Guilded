import { describe, expect, it } from "vitest";
import { factionOfRace, majorityFaction } from "../companion/race-faction.mjs";

describe("race to faction", () => {
  it("maps the classic races, tokens and names alike", () => {
    for (const race of ["Human", "Dwarf", "NightElf", "Night Elf", "Gnome", "Draenei"]) expect(factionOfRace(race)).toBe("ALLIANCE");
    for (const race of ["Orc", "Scourge", "Undead", "Tauren", "Troll", "BloodElf", "Blood Elf"]) expect(factionOfRace(race)).toBe("HORDE");
    for (const race of ["Pandaren", "", null, undefined, "Murloc"]) expect(factionOfRace(race)).toBeNull();
  });
  it("takes a guild's faction only from a clear majority of known players", () => {
    expect(majorityFaction(["ALLIANCE", "ALLIANCE", "ALLIANCE", null])).toBe("ALLIANCE");
    expect(majorityFaction(["HORDE", "HORDE", "HORDE", "ALLIANCE"])).toBe("HORDE"); // 75%
    expect(majorityFaction(["HORDE", "ALLIANCE"])).toBeNull(); // split
    expect(majorityFaction(["HORDE"])).toBeNull(); // one known player is not enough
    expect(majorityFaction([null, null])).toBeNull();
    expect(majorityFaction(["HORDE", "HORDE", "ALLIANCE", "ALLIANCE", "ALLIANCE"])).toBeNull(); // 60%
  });
});
