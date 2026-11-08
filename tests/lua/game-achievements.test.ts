import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Modules/GameAchievements.lua on a mocked Forever client: the first scan is silent, a later one announces the newest,
// ACHIEVEMENT_EARNED records at once, category 15425 is skipped, and a client without the API records nothing.
let s: LuaSession | undefined;
afterEach(() => s?.close());

const API = `
  CATS = { 15425, 15577, 15587 }
  NAMES = { [15425] = "Do Not Display", [15577] = "Druid", [15587] = "Alchemy" }
  -- id, name, points, completed, month, day, year, description
  ACH = {
    [15425] = { { 9001, "Hidden", 5, true, 1, 2, 26, "never shown" } },
    [15577] = { { 101, "Moonkin Form", 10, true, 11, 2, 26, "Learn it." }, { 102, "Cat Form", 5, false, 0, 0, 0, "Not yet." } },
    [15587] = { { 201, "Apprentice  Alchemist\\n", 5, true, 11, 5, 26, "Reach 75." } }
  }
  function GetCategoryList() return CATS end
  function GetCategoryInfo(id) return NAMES[id], -1, 0 end
  function GetCategoryNumAchievements(id)
    local done = 0
    for _, a in ipairs(ACH[id]) do if a[4] then done = done + 1 end end
    return #ACH[id], done, #ACH[id] - done
  end
  function GetAchievementInfo(a, b)
    if b then local r = ACH[a][b]; return r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8] end
    for cat, list in pairs(ACH) do for _, r in ipairs(list) do if r[1] == a then return r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8] end end end
  end
  function GetAchievementCategory(id) for cat, list in pairs(ACH) do for _, r in ipairs(list) do if r[1] == id then return cat end end end end
`;

function setup(api = API) {
  s = newLuaSession();
  s.run(`DB = { roster = {} }; CLOCK = 1800000000; CHAT_OUT = {}
    function GetServerTime() return CLOCK end
    function GetLocale() return "enUS" end
    function UnitName() return "Kev" end; function GetRealmName() return "Realm" end
    function UnitLevel() return 5 end
    function InCombatLockdown() return false end
    function GetMaxPlayerLevel() return 60 end
    function IsInGuild() return true end
    function SendChatMessage(text, channel) CHAT_OUT[#CHAT_OUT + 1] = channel .. ":" .. text end
    NS = { getDb = function() return DB end, util = {}, commandHandlers = {}, commandHelp = {}, message = function() end,
      isSecret = function(v) return v == "SECRET" end, isGuildMember = function() return true end, isOfficerName = function() return false end, isOfficer = function() return false end }`);
  s.run(api);
  s.load("Locale.lua");
  s.load("Modules/Milestones.lua");
  s.load("Modules/GameAchievements.lua");
  s.run(`NS.util.gameEdition = function() return "forever" end`);
  s.run(`NS.milestones.baseline()`);
  return s;
}
const out = () => s!.run(`return table.concat(CHAT_OUT, "\\n")`);
const log = () => s!.run(`local t = {}; for _, r in ipairs(DB.milestones.chars["Kev-Realm"].log) do if r.kind == "ach" then t[#t + 1] = r.ref .. "|" .. r.label .. "|" .. tostring(r.category) .. "|" .. tostring(r.points) .. "|" .. tostring(r.desc) end end; return table.concat(t, ";")`);

describe("Forever achievements as milestones", () => {
  it("records earned ones silently at the first scan, skips category 15425 and unearned ones, cleans names", () => {
    setup();
    expect(s!.run(`return tostring(NS.gameAchievements.scan())`)).toBe("2");
    expect(log()).toBe("ach:101|Moonkin Form|Druid|10|Learn it.;ach:201|Apprentice Alchemist|Alchemy|5|Reach 75.");
    expect(out()).toBe(""); // nothing announced
    expect(s!.run(`return tostring(DB.milestones.chars["Kev-Realm"].achBaselined)`)).toBe("true");
    // The date is the game's own (2026-11-02 12:00 local), not "now".
    expect(Number(s!.run(`return DB.milestones.chars["Kev-Realm"].done["ach:101"]`))).toBeLessThan(1800000000);
    // Scanning again finds nothing new.
    expect(s!.run(`return tostring(NS.gameAchievements.scan())`)).toBe("0");
  });

  it("announces only the newest new achievement of a later scan, in guild chat, once", () => {
    setup();
    s!.run(`NS.gameAchievements.scan()`);
    s!.run(`ACH[15577][2] = { 102, "Cat Form", 5, true, 11, 7, 26, "Now earned." }; ACH[15587][2] = { 202, "Journeyman Alchemist", 5, true, 11, 8, 26, "Reach 150." }`);
    expect(s!.run(`return tostring(NS.gameAchievements.scan())`)).toBe("2");
    expect(out()).toBe("GUILD:Kev earned the achievement Journeyman Alchemist!");
    expect(s!.run(`return tostring(DB.milestones.chars["Kev-Realm"].done["ach:102"] ~= nil)`)).toBe("true");
  });

  it("records ACHIEVEMENT_EARNED at once and announces it, but not a repeat or a hidden category", () => {
    setup();
    s!.run(`NS.gameAchievements.scan()`);
    s!.run(`ACH[15577][2] = { 102, "Cat Form", 5, true, 11, 9, 26, "Now earned." }; fire_event("ACHIEVEMENT_EARNED", 102, false)`);
    expect(out()).toBe("GUILD:Kev earned the achievement Cat Form!");
    s!.run(`fire_event("ACHIEVEMENT_EARNED", 102, false)`);
    expect(out().split("\n")).toHaveLength(1);
    s!.run(`fire_event("ACHIEVEMENT_EARNED", 9001, false)`);
    expect(s!.run(`return tostring(DB.milestones.chars["Kev-Realm"].done["ach:9001"])`)).toBe("nil");
  });

  it("respects the switches: per-kind off records but never says anything, and the officer switch wins", () => {
    setup();
    s!.run(`NS.gameAchievements.scan(); NS.commandHandlers.announce({ "ach", "off" })`);
    s!.run(`ACH[15577][2] = { 102, "Cat Form", 5, true, 11, 9, 26, "Now earned." }; fire_event("ACHIEVEMENT_EARNED", 102, false)`);
    expect(out()).toBe("");
    expect(log()).toContain("ach:102");
    setup();
    s!.run(`NS.gameAchievements.scan(); DB.milestones.guild = { off = true, at = 1 }`);
    s!.run(`ACH[15577][2] = { 102, "Cat Form", 5, true, 11, 9, 26, "Now earned." }; fire_event("ACHIEVEMENT_EARNED", 102, false)`);
    expect(out()).toBe("");
  });

  it("ignores hidden values and a client without the achievement API", () => {
    setup();
    s!.run(`ACH[15587][1][2] = "SECRET"`);
    expect(s!.run(`return tostring(NS.gameAchievements.scan())`)).toBe("1"); // only Moonkin Form
    setup();
    s!.run(`GetCategoryList = nil; GetAchievementInfo = nil`);
    expect(s!.run(`return tostring(NS.gameAchievements.scan())`)).toBe("0");
    expect(s!.run(`return tostring(DB.milestones.chars["Kev-Realm"].achBaselined)`)).toBe("nil"); // tried again next login
    s!.run(`function GetCategoryList() error("protected") end`);
    expect(s!.run(`return tostring(NS.gameAchievements.scan())`)).toBe("0");
  });
});
