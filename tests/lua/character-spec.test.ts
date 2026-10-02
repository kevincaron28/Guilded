import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });
function character(setup: string) {
  session = newLuaSession();
  session.run(`GuildedDB = nil; NS = {}; ${setup}`);
  session.load("Core.lua");
  session.run('fire_event("PLAYER_LOGIN")');
  return session;
}

describe("character specialization captured from the game", () => {
  const classic = `GetNumTalentTabs = function() return 3 end
    GetTalentTabInfo = function(i) return ({"Discipline", "Sacré", "Ombre"})[i], "icon", POINTS[i] end`;
  it("reads the localized Retail specialization before Classic talent trees", () => {
    const s = character(`POINTS = {10, 0, 0}; ${classic}
      GetSpecialization = function() return 2 end
      GetSpecializationInfo = function() return 257, "Sacré" end`);
    expect(s.run("return GuildedDB.character.spec")).toBe("Sacré");
  });
  it("reads the unique dominant Classic tree for the player and owned-character export", () => {
    const s = character(`POINTS = {0, 5, 0}; ${classic}`);
    expect(s.run("return GuildedDB.character.spec")).toBe("Sacré");
    expect(s.run("return GuildedDB.myCharacters.Tester.spec")).toBe("Sacré");
  });
  it("does not invent a specialization for tied or unspent talent trees", () => {
    const s = character(`POINTS = {0, 0, 0}; ${classic}`);
    expect(s.run("return GuildedDB.character.spec")).toBe("");
    s.run('POINTS = {5, 5, 0}; fire_event("CHARACTER_POINTS_CHANGED")');
    expect(s.run("return GuildedDB.character.spec")).toBe("");
  });
  it("refreshes the current specialization after a respec or active talent group change", () => {
    const s = character(`POINTS = {5, 0, 0}; ${classic}`);
    s.run('POINTS = {0, 0, 12}; fire_event("ACTIVE_TALENT_GROUP_CHANGED")');
    expect(s.run("return GuildedDB.character.spec")).toBe("Ombre");
    expect(s.run("return GuildedDB.myCharacters.Tester.spec")).toBe("Ombre");
  });
  it("survives missing or unsupported talent APIs", () => {
    const s = character('GetNumTalentTabs = function() error("Unavailable") end; GetTalentTabInfo = function() error("Unavailable") end; GetActiveTalentGroup = function() error("Unavailable") end');
    expect(s.run("return GuildedDB.character.spec")).toBe("");
  });
});
