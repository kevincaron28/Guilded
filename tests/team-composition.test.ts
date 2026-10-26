import { describe, expect, it } from "vitest";
import { teamComposition, teamClassLabel } from "../src/services/team-composition.js";
import type { TeamMember, TeamView } from "../src/services/guild-tools-store.js";
const member = (id: string, className: string, overrides: Partial<TeamMember> = {}): TeamMember => ({ characterId: id, name: id, realm: "Realm", className, assigned: true, role: "DPS", bench: false, trial: false, main: id, backups: [], ...overrides });
const team = (members: TeamMember[], truncated = false): TeamView => ({ id: "t", name: "Team", schedule: null, timezone: null, tankLimit: null, healerLimit: null, dpsLimit: null, members, truncated });
describe("team composition planning", () => {
  it("uses alternative Mists providers and keeps Forever provisional", () => {
    const result = teamComposition(team([member("A", "Monk"), member("B", "Druid"), member("C", "Death Knight")]), "classic-mists");
    expect(result.buffs?.find(buff => buff.en === "Primary stats")?.providers).toEqual(["B", "A"]);
    expect(result.buffs?.find(buff => buff.en === "Attack power")?.providers).toEqual(["C"]);
    expect(teamComposition(team([]), "forever").provisional).toBe(true);
    expect(teamComposition(team([]), "classic-era").provisional).toBe(false);
  });
  it("recognizes existing French class values and uses localized display labels", () => {
    expect(teamComposition(team([member("A", "Guerrier")]), "retail").classes).toEqual([["WARRIOR", ["A"]]]);
    expect(teamClassLabel("WARRIOR", "fr")).toBe("Guerrier");
  });
  it("counts assigned trials but excludes bench and unassigned linked mains", () => {
    const result = teamComposition(team([member("A", "Warrior", { trial: true }), member("B", "Priest", { bench: true }), member("C", "Mage", { assigned: false })]), "retail");
    expect(result.classes).toEqual([["WARRIOR", ["A"]]]);
    expect(result.unknown).toBe(1);
    expect(result.buffs?.find(buff => buff.className === "WARRIOR")?.status).toBe("potential");
    expect(result.buffs?.find(buff => buff.className === "MAGE")?.status).toBe("unknown");
  });
  it("does not claim missing providers from partial rosters or duplicate assignments", () => {
    expect(teamComposition(team([member("A", "Mage")], true), "retail").buffs?.find(buff => buff.className === "PRIEST")?.status).toBe("unknown");
    const result = teamComposition(team([member("A", "Mage"), member("A", "Mage")]), "retail");
    expect(result.classes).toEqual([["MAGE", ["A"]]]); expect(result.duplicates).toBe(1);
    expect(teamComposition(team([member("A", "Mage")]), "retail").buffs?.find(buff => buff.className === "PRIEST")?.status).toBe("absent");
  });
  it("gates class and buff assumptions by edition", () => {
    for (const edition of ["forever", "classic-era", "classic-tbc"]) {
      const result = teamComposition(team([member("A", "Death Knight"), member("B", "Monk")]), edition);
      expect(result.unknown).toBe(2); expect(result.buffs).toHaveLength(8);
    }
    expect(teamComposition(team([member("A", "Death Knight"), member("B", "Monk")]), "classic-mists").classes).toHaveLength(2);
    expect(teamComposition(team([member("A", "Demon Hunter"), member("B", "Evoker")]), "retail").classes).toHaveLength(2);
  });
});
