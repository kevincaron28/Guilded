import { afterEach, describe, expect, it } from "vitest";
import { standingsToLua } from "../../companion/standings-format.mjs";
import { provisionalSeasonRules } from "../../src/services/dungeon-bracket-season.js";
import { createBracketedDungeonRules } from "../../src/services/dungeon-november-rules.js";
import { calculateDungeonRating, seasonDungeonCatalog, type RatingRun } from "../../src/services/dungeon-rating.js";
import { newLuaSession, type LuaSession } from "./harness.js";
const sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions.length = 0; });

const { rules } = provisionalSeasonRules();
const deadmines: RatingRun = { instanceId: 36, difficultyId: 0, durationSec: 2400, completedBy: "final boss", runRef: "dm",
  startedAt: new Date(1000000), endedAt: new Date(3400000),
  competitionData: { players: [{ name: "Tester", level: 20, minLevel: 20 }], encounters: [] },
  players: [{ character: "Tester", memberId: "m", presentSec: 2400, member: { displayName: "Tester" } }] };
function board(r: typeof rules) {
  const rows = calculateDungeonRating([deadmines], r);
  return { id: "all", season: "All levels", status: "ACTIVE", ratingVersion: 6, detailsAvailable: true,
    provisionalTargets: r.provisionalTargets, brackets: r.brackets, catalog: seasonDungeonCatalog(r, rows),
    rows: rows.map(x => ({ name: x.name, points: x.points, bracket: x.bracket })),
    profiles: rows.map(x => ({ name: x.name, points: x.points, details: x.details, bracket: x.bracket, characters: [] })) };
}
function panel(r: typeof rules) {
  const s = newLuaSession(); sessions.push(s);
  s.run("NS={}; GuildedDB=nil; CLOCK=100; function GetTime() return CLOCK end; function UnitLevel() return 20 end");
  for (const file of ["Core.lua", "Modules/Scores.lua", "Modules/SeasonDetails.lua", "Modules/DungeonScorePanel.lua"]) s.load(file);
  s.run(`fire_event("PLAYER_LOGIN"); DB=NS.getDb(); DB.roster.Tester={inGuild=true}
    NS.isOfficer=function() return false end; NS.isOfficerName=function() return false end
    NS.playerName=function() return "Tester" end`);
  s.run(standingsToLua({ updatedAt: "stamp", standings: [], dungeonBoard: board(r) }));
  s.run(`DB.dungeonBoard=GuildedDungeonBoard
    local oldCreate = CreateFrame
    function CreateFrame(...)
      local f = oldCreate(...)
      f.CreateFontString = function() return CreateFrame() end
      f.CreateTexture = function() return CreateFrame() end
      f.SetText = function(self, text) self.text = text end
      f.GetFrameLevel = function() return 1 end
      return f
    end
    P = NS.dungeonScorePanel.build(UIParent); P.mode = "season"; P:Refresh()
    function CARD(name) for _, c in ipairs(P.cards) do if c.row and c.row.name == name then return c.value.text end end end`);
  return s;
}

describe("provisional all-level season in the addon", () => {
  it("says the targets are provisional and marks each provisional target", () => {
    const s = panel(rules);
    expect(s.run("return P.note.text")).toBe("Levels 15-29: best 5 distinct routes. * = provisional target; shared and locked for the season.");
    expect(s.run('return CARD("The Deadmines")')).toContain("40:00*");
    expect(s.run('return CARD("Ragefire Chasm")')).toContain("20:00*");
  });
  it("drops the mark once a route is recalibrated, and the note once every route is", () => {
    const one = createBracketedDungeonRules({ routes: rules.routes, brackets: rules.brackets, provisional: rules.provisional,
      recalibrations: [{ dungeonKey: "36", targetSec: 1680, from: "2026-10-22T00:00:00.000Z", runs: 3 }] });
    const s = panel(one);
    expect(s.run('return CARD("The Deadmines")')).toMatch(/28:00$/);
    expect(s.run('return CARD("Ragefire Chasm")')).toContain("20:00*");
    const all = createBracketedDungeonRules({ routes: rules.routes, brackets: rules.brackets, provisional: rules.provisional,
      recalibrations: rules.catalog.map(d => ({ dungeonKey: d.dungeonKey, targetSec: 1800, from: "2026-10-22T00:00:00.000Z", runs: 3 })) });
    expect(panel(all).run("return P.note.text")).toBe("Levels 15-29: best 5 distinct routes. Verified route evidence required.");
  });
  it("ends Scarlet Armory and Cathedral runs on their last boss, in English and French", () => {
    const s = newLuaSession(); sessions.push(s);
    s.run("NS = {}; GuildedDB = nil");
    for (const file of ["Core.lua", "DungeonRoutes.lua", "Compat.lua"]) s.load(file);
    for (const name of ["Herod", "H\\195\\169rode", "High Inquisitor Whitemane", "Grande Inquisitrice Blanchet\\195\\170te", "Arcanist Doan"]) {
      expect(s.run(`return tostring(NS.compat.isDungeonFinalBoss(189, 1, "${name}", 0))`)).toBe("true");
    }
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(189, 1, "Houndmaster Loksey", 0))')).toBe("false");
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(36, 1, "Herod", 0))')).toBe("false");
  });
});
