import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Levelling partners (Modules/LevelPartners.lua): online guildmates within 3 levels, Whisper and Invite.
let s: LuaSession | undefined;
afterEach(() => s?.close());

function setup(level = 30) {
  s = newLuaSession();
  s.run(`LEVEL = ${level}; ZONE = "Duskwood"; MSGS = {}; INVITES = {}; TELLS = {}
    function UnitName(u) return "Kev" end
    function UnitLevel() return LEVEL end
    function GetMaxPlayerLevel() return 60 end
    function GetRealZoneText() return ZONE end
    function IsInGuild() return true end
    function InviteUnit(name) INVITES[#INVITES + 1] = name end
    function ChatFrame_SendTell(name) TELLS[#TELLS + 1] = name end
    ROSTER = {
      { "Kev", 30, "ROGUE", "Duskwood", true }, { "Ann-Realm", 31, "MAGE", "Redridge Mountains", true },
      { "Bo-Realm", 30, "WARRIOR", "Duskwood", true }, { "Cy-Realm", 33, "PRIEST", "Duskwood", true },
      { "Dee-Realm", 34, "HUNTER", "Duskwood", true }, { "Eve-Realm", 29, "ROGUE", "Elwynn Forest", true },
      { "Fay-Realm", 30, "DRUID", "Duskwood", false }, { "Gus-Realm", 28, "MAGE", "Duskwood", true },
      { "Hal-Realm", 28, "MAGE", "Redridge Mountains", true } }
    function GetNumGuildMembers() return #ROSTER end
    function GetGuildRosterInfo(i) local r = ROSTER[i]; return r[1], "Member", 3, r[2], r[3], r[4], "", "", r[5], 0, r[3] end
    NS = { util = {}, commandHandlers = {}, commandHelp = {},
      message = function(text) MSGS[#MSGS + 1] = text end,
      isSecret = function() return false end,
      playerName = function() return "Kev" end,
      normalizeName = function(n) return n and (n:match("^[^-]+")) end }`);
  s.load("Locale.lua");
  s.load("Modules/LevelPartners.lua");
  return s;
}
const names = () => s!.run(`local t = {} for _, p in ipairs(NS.levelPartners.partners()) do t[#t + 1] = p.name end return table.concat(t, ",")`);
const msgs = () => s!.run(`return table.concat(MSGS, " | ")`);

describe("levelling partners", () => {
  it("lists online guildmates within 3 levels, closest level first then same zone, never me or offline", () => {
    setup();
    // diff 0: Bo (Duskwood); diff 1: Eve (Elwynn) and Ann (Redridge), Eve before Ann by name; diff 2: Gus (Duskwood) before Hal;
    // diff 3: Cy. Dee is 4 away and Fay is offline.
    expect(names()).toBe("Bo-Realm,Ann-Realm,Eve-Realm,Gus-Realm,Hal-Realm,Cy-Realm");
  });

  it("puts a guildmate in my zone before one of the same level elsewhere", () => {
    setup();
    s!.run(`ROSTER[2][2] = 30; ROSTER[2][4] = "Elwynn Forest"; ROSTER[3][4] = "Elwynn Forest"; ROSTER[6][2] = 30; ROSTER[6][4] = "Duskwood"`);
    expect(names().split(",").slice(0, 3)).toEqual(["Eve-Realm", "Ann-Realm", "Bo-Realm"]);
  });

  it("caps the list at eight", () => {
    setup();
    s!.run(`for i = 1, 10 do ROSTER[#ROSTER + 1] = { "Extra" .. i .. "-Realm", 30, "MAGE", "Duskwood", true } end`);
    expect(s!.run(`return tostring(#NS.levelPartners.partners())`)).toBe("8");
  });

  it("is hidden at the top level", () => {
    setup(60);
    expect(s!.run(`return tostring(NS.levelPartners.available())`)).toBe("false");
    expect(names()).toBe("");
    expect(s!.run(`return tostring(NS.levelPartners.open())`)).toBe("false");
    expect(msgs()).toContain("top level");
  });

  it("opens the window while levelling and fills a row per partner", () => {
    setup();
    expect(s!.run(`return tostring(NS.levelPartners.open())`)).toBe("true");
    expect(s!.run(`return tostring(NS.levelPartners.refresh())`)).toBe("6");
  });

  it("whispers and invites only on a click", () => {
    setup();
    expect(msgs()).toBe("");
    expect(s!.run(`return tostring(NS.levelPartners.whisper("Bo-Realm"))`)).toBe("true");
    expect(s!.run(`return table.concat(TELLS, ",")`)).toBe("Bo-Realm");
    expect(s!.run(`return tostring(NS.levelPartners.invite("Bo-Realm"))`)).toBe("true");
    expect(s!.run(`return table.concat(INVITES, ",")`)).toBe("Bo-Realm");
    s!.run(`InviteUnit = nil`);
    expect(s!.run(`return tostring(NS.levelPartners.invite("Ann-Realm"))`)).toBe("false");
  });

  it("registers /guilded partners and translates", () => {
    const lua = setup();
    expect(lua.run(`return type(NS.commandHandlers.partners)`)).toBe("function");
    expect(lua.run(`return NS.L("Levelling partners")`)).toBe("Levelling partners");
  });
});
