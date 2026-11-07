import { describe, expect, it } from "vitest";
import { dungeonRunCard, partyRoles } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";

const detail = (character: string, cls: string, role: string | undefined) =>
  ({ character, class: cls, ...(role ? { role } : {}), deaths: 0, presentSec: 1100, points: 0 });
const run = (playerDetails: NonNullable<DungeonImportResult["playerDetails"]>): DungeonImportResult => ({
  runRef: "QG-1", dungeonName: "Wailing Caverns", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1105, points: 0,
  guildRecord: false, previousGuildBest: null, personalRecords: [], players: playerDetails.map((d) => d.character), deaths: 0, unlinked: [],
  inGuildPlayers: playerDetails.map((d) => d.character), achievements: [], endedAt: 1794000000, playerDetails
});
const rolesOf = (d: NonNullable<DungeonImportResult["playerDetails"]>) => dungeonRunCard(run(d), "en").dungeon!.party.map((m) => m.role);

describe("the dungeon card shows each member's real role", () => {
  it("keeps a clean party as recorded (DAMAGER is DPS)", () => {
    expect(rolesOf([detail("A", "WARRIOR", "TANK"), detail("B", "PRIEST", "HEALER"), detail("C", "MAGE", "DAMAGER"), detail("D", "ROGUE", "DPS"), detail("E", "PALADIN", "DPS")]))
      .toEqual(["TANK", "HEALER", "DPS", "DPS", "DPS"]);
  });
  it("shows no second healer: two members tagged healer lose the icon, the rest keep theirs", () => {
    expect(rolesOf([detail("A", "WARRIOR", "TANK"), detail("B", "PRIEST", "HEALER"), detail("C", "DRUID", "HEALER"), detail("D", "MAGE", "DPS"), detail("E", "ROGUE", "DPS")]))
      .toEqual(["TANK", undefined, undefined, "DPS", "DPS"]);
  });
  it("shows no second tank, and never guesses a role from the class", () => {
    expect(rolesOf([detail("A", "WARRIOR", "TANK"), detail("B", "PALADIN", "TANK"), detail("C", "PRIEST", "HEALER"), detail("D", "DRUID", undefined), detail("E", "SHAMAN", undefined)]))
      .toEqual([undefined, undefined, "HEALER", undefined, undefined]);
  });
  it("drops a role the class cannot fill, so a lone real healer keeps the mark", () => {
    expect(partyRoles([{ class: "WARRIOR", role: "HEALER" }, { class: "PRIEST", role: "HEALER" }, { class: "MAGE", role: "TANK" }, { class: "PALADIN", role: "TANK" }]))
      .toEqual([undefined, "HEALER", undefined, "TANK"]);
  });
  it("leaves large groups alone", () => {
    const raid = Array.from({ length: 8 }, () => ({ class: "PRIEST", role: "HEALER" }));
    expect(partyRoles(raid).every((r) => r === "HEALER")).toBe(true);
  });
});
