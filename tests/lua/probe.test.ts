import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function setup() {
  const s = session = newLuaSession();
  s.run(`DB = {}; LOG = {}
    NS = { getDb = function() return DB end, util = { gameEdition = function() return "forever" end },
      isSecret = function(v) return v == "SECRET" end, message = function(text) LOG[#LOG + 1] = text end, commandHandlers = {}, commandHelp = {} }
  `);
  s.load("Modules/Probe.lua");
  return s;
}
const MODERN = `
  GetBuildInfo = function() return "1.60.1", "12345" end
  GetServerTime = function() return 1800000000 end
  CATS = { 92, 96, 97, 95, 168, 169, 201 }
  NAMES = { [92] = "General", [96] = "Quests", [97] = "Exploration", [95] = "Player vs. Player", [168] = "Dungeons", [169] = "Professions", [201] = "Reputation" }
  GetCategoryList = function() return CATS end
  GetCategoryInfo = function(id) return NAMES[id], -1, 0 end
  GetCategoryNumAchievements = function(id) return 10, 4, 6 end
  GetAchievementInfo = function(cat, index) return 5000 + index, "First step", 10, false end
  GetAchievementCriteriaInfo = function() end
  GetNumCompletedAchievements = function() return 28 end
  GetTotalAchievementPoints = function() return 280 end
  GetStatistic = function() return "0" end
  C_AchievementInfo = { GetRewardItemID = function() end, IsValidAchievement = function() end, Version = 3 }
  FOREVER_LEGACY_DATA = {}; C_LegacyChallenges = {}
  CreateFrame = function()
    return { RegisterEvent = function(_, name) if name == "BOGUS" then error("unknown event") end end, UnregisterEvent = function() end }
  end
`;

describe("achievement probe (read-only)", () => {
  it("reports the APIs, categories, events and a sample, and saves a summary", () => {
    const s = setup();
    s.run(MODERN);
    s.run(`NS.commandHandlers["probe"]({ "achievements" })`);
    const r = (path: string) => s.run(`return tostring(${path})`);
    expect(r("DB.probes.achievements.categories")).toBe("7");
    expect(r("DB.probes.achievements.total")).toBe("70");
    expect(r("DB.probes.achievements.completed")).toBe("28");
    expect(r("#DB.probes.achievements.shown")).toBe("5");
    expect(r("DB.probes.achievements.shown[1].name")).toBe("General");
    expect(r("DB.probes.achievements.sample.id")).toBe("5001");
    expect(r("DB.probes.achievements.apis.GetAchievementInfo")).toBe("true");
    expect(r("DB.probes.achievements.apis.C_AchievementInfo")).toBe("true");
    expect(r("DB.probes.achievements.events.ACHIEVEMENT_EARNED")).toBe("true");
    expect(r("DB.probes.achievements.events.CRITERIA_UPDATE")).toBe("true");
    expect(s.run(`return table.concat(DB.probes.achievements.infoFunctions, ",")`)).toBe("GetRewardItemID,IsValidAchievement");
    expect(s.run(`return table.concat(DB.probes.achievements.legacyNames, ",")`)).toBe("C_LegacyChallenges,FOREVER_LEGACY_DATA");
    const log = s.run(`return table.concat(LOG, "\\n")`);
    expect(log).toContain("client 1.60.1 (12345), edition");
    expect(log).toContain("all of them exist");
    expect(log).toContain("Categories: 7, achievements visible: 70, completed: 28.");
    expect(log).toContain("92 General (10)");
    expect(log).toContain("Nothing was sent.");
  });

  it("copes with a client that has none of it", () => {
    const s = setup();
    s.run(`CreateFrame = nil`);
    s.run(`NS.commandHandlers["probe"]({ "achievements" })`);
    expect(s.run(`return tostring(DB.probes.achievements.categories)`)).toBe("0");
    expect(s.run(`return tostring(DB.probes.achievements.apis.GetCategoryList)`)).toBe("false");
    expect(s.run(`return tostring(DB.probes.achievements.apis.C_AchievementInfo)`)).toBe("false");
    expect(s.run(`return tostring(DB.probes.achievements.events.ACHIEVEMENT_EARNED)`)).toBe("false");
    expect(s.run(`return tostring(DB.probes.achievements.sample)`)).toBe("nil");
    const log = s.run(`return table.concat(LOG, "\\n")`);
    expect(log).toContain("Achievement APIs missing: GetCategoryList, GetCategoryInfo");
    expect(log).toContain("C_AchievementInfo: absent.");
    expect(log).toContain("does not register");
  });

  it("never lets a throwing or hidden-value API break it", () => {
    const s = setup();
    s.run(MODERN);
    s.run(`GetCategoryList = function() error("protected") end`);
    s.run(`NS.commandHandlers["probe"]({ "achievements" })`);
    expect(s.run(`return tostring(DB.probes.achievements.categories)`)).toBe("0");
    s.run(`GetCategoryList = function() return CATS end; GetCategoryNumAchievements = function() return "SECRET" end; GetCategoryInfo = function() return "SECRET" end`);
    s.run(`NS.commandHandlers["probe"]({ "achievements" })`);
    expect(s.run(`return tostring(DB.probes.achievements.total)`)).toBe("0");
    expect(s.run(`return DB.probes.achievements.shown[1].name`)).toBe("?");
    // An event the client refuses to register is reported as not registering, not as an error.
    s.run(`CreateFrame = function() return { RegisterEvent = function() error("unknown event") end } end`);
    s.run(`NS.commandHandlers["probe"]({ "achievements" })`);
    expect(s.run(`return tostring(DB.probes.achievements.events.CRITERIA_UPDATE)`)).toBe("false");
  });

  it("prints its usage for anything else and writes nothing", () => {
    const s = setup();
    s.run(`NS.commandHandlers["probe"]({ "other" })`);
    expect(s.run(`return tostring(DB.probes)`)).toBe("nil");
    expect(s.run(`return LOG[1]`)).toContain("/guilded probe achievements");
  });
});
