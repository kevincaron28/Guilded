import { describe, expect, it } from "vitest";
import { teamComposition, teamClassLabel } from "../src/services/team-composition.js";
import type { TeamMember, TeamView } from "../src/services/guild-tools-store.js";
const member = (id: string, className: string, overrides: Partial<TeamMember> = {}): TeamMember => ({ characterId: id, name: id, realm: "Realm", className, assigned: true, role: "DPS", bench: false, trial: false, main: id, backups: [], ...overrides });
const team = (members: TeamMember[], truncated = false): TeamView => ({ id: "t", name: "Team", schedule: null, timezone: null, tankLimit: null, healerLimit: null, dpsLimit: null, members, truncated });
describe("team composition planning", () => {
  it("keeps world effects external and optional effects separate from core coverage", () => {
    const result = teamComposition(team([member("A", "Shaman")]), "forever");
    expect(result.buffs?.find(buff => buff.en === "Strength of Earth Totem")).toMatchObject({ optional: true, scope: "party", status: "potential", providers: ["A"] });
    expect(result.buffs?.find(buff => buff.en === "Spirit of Zandalar")).toMatchObject({ optional: true, scope: "world", status: "world", providers: [] });
  });
  it("keeps the WoW Forever catalog provisional and has none for other editions", () => {
    expect(teamComposition(team([]), "forever").provisional).toBe(true);
    expect(teamComposition(team([]), "classic-mists").buffs).toBeNull();
  });
  it("recognizes existing French class values and uses localized display labels", () => {
    expect(teamComposition(team([member("A", "Guerrier")]), "forever").classes).toEqual([["WARRIOR", ["A"]]]);
    expect(teamClassLabel("WARRIOR", "fr")).toBe("Guerrier");
  });
  it("counts assigned trials but excludes bench and unassigned linked mains", () => {
    const result = teamComposition(team([member("A", "Warrior", { trial: true }), member("B", "Priest", { bench: true }), member("C", "Mage", { assigned: false })]), "forever");
    expect(result.classes).toEqual([["WARRIOR", ["A"]]]);
    expect(result.unknown).toBe(1);
    expect(result.buffs?.find(buff => buff.className === "WARRIOR")?.status).toBe("potential");
    expect(result.buffs?.find(buff => buff.className === "MAGE")?.status).toBe("unknown");
  });
  it("does not claim missing providers from partial rosters or duplicate assignments", () => {
    expect(teamComposition(team([member("A", "Mage")], true), "forever").buffs?.find(buff => buff.className === "PRIEST")?.status).toBe("unknown");
    const result = teamComposition(team([member("A", "Mage"), member("A", "Mage")]), "forever");
    expect(result.classes).toEqual([["MAGE", ["A"]]]); expect(result.duplicates).toBe(1);
    expect(teamComposition(team([member("A", "Mage")]), "forever").buffs?.find(buff => buff.className === "PRIEST")?.status).toBe("absent");
  });
  it("knows only WoW Forever's classes", () => {
    const result = teamComposition(team([member("A", "Death Knight"), member("B", "Monk")]), "forever");
    expect(result.unknown).toBe(2); expect(result.buffs?.filter(buff => !buff.optional)).toHaveLength(8);
    expect(teamComposition(team([member("A", "Demon Hunter"), member("B", "Evoker")]), "forever").classes).toHaveLength(0);
  });
});
