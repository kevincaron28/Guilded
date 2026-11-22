import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.4.9: Modules/GuildEvents.lua turns the difference between two guild roster snapshots into join, leave and rank-change
// lines and a short list. It reads only what GuildSnapshot already saved: no extra game call.
let s: LuaSession | undefined;
afterEach(() => { s?.close(); s = undefined; });

function setup() {
  s = newLuaSession();
  s.run(`CLOCK = 1800000000; SHOW_OFFLINE = true; ACTIVE = true; SAID = {}
    function GetServerTime() return CLOCK end
    local function member(name, rank, rankName) return { name, rankName, rank, 20, "Warrior", "", "", "", false, 0, "WARRIOR" } end
    function MEMBER(name, rank, rankName) return member(name, rank, rankName) end
    ROSTER = { member("Ann Able", 0, "Leader"), member("Bob Baker", 3, "Member"), member("Cy Cole", 3, "Member"), member("Di Dunn", 3, "Member"), member("Ed East", 3, "Member") }
    function GetNumGuildMembers() return #ROSTER, 1, 1 end
    function GetGuildRosterInfo(i) return unpack(ROSTER[i]) end
    function GetGuildRosterShowOffline() return SHOW_OFFLINE end
    function UnitName() return "Me Myself" end
    DB = {}
    NS = { getDb = function() return DB end, isSecret = function() return false end,
      normalizeName = function(n) if type(n) ~= "string" or n:find("|", 1, true) then return nil end return n end,
      message = function(text) SAID[#SAID + 1] = text end,
      moduleActive = function() return ACTIVE end, commandHandlers = {} }`);
  s.load("Modules/GuildSnapshot.lua");
  s.load("Modules/GuildEvents.lua");
  s.run(`NS.guildSnapshot.read(true)`);
  return s;
}
const next = (lua: LuaSession, hours = 1) => lua.run(`CLOCK = CLOCK + ${hours * 3600}; NS.guildSnapshot.read(true)`);
const said = (lua: LuaSession) => lua.run(`return table.concat(SAID, " | ")`);
const kinds = (lua: LuaSession) => lua.run(`local t = {} for _, e in ipairs(DB.guildEvents and DB.guildEvents.list or {}) do t[#t + 1] = e.kind .. ":" .. e.name end return table.concat(t, ",")`);

describe("guild events feed", () => {
  it("treats the first roster as a baseline: nothing to say", () => {
    const lua = setup();
    expect(kinds(lua)).toBe("");
    expect(said(lua)).toBe("");
  });

  it("reports a join, a leave, a promotion and a demotion, and keeps them", () => {
    const lua = setup();
    lua.run(`ROSTER = { MEMBER("Ann Able", 0, "Leader"), MEMBER("Bob Baker", 2, "Officer"), MEMBER("Cy Cole", 4, "Initiate"), MEMBER("Di Dunn", 3, "Member"), MEMBER("Fay Frost", 3, "Member") }`);
    next(lua);
    expect(kinds(lua)).toBe("join:Fay Frost,leave:Ed East,promote:Bob Baker,demote:Cy Cole");
    const text = said(lua);
    expect(text).toContain("Fay Frost joined the guild.");
    expect(text).toContain("Ed East left the guild.");
    expect(text).toContain("Bob Baker was promoted to Officer.");
    expect(text).toContain("More guild changes (1)");
    expect(lua.run(`return NS.guildEvents.text()`)).toContain("Cy Cole was moved to Initiate.");
    expect(lua.run(`return NS.guildEvents.text()`)).toContain("Fay Frost joined the guild.");
  });

  it("never announces the player's own arrival, and says 'and N more' after three lines", () => {
    const lua = setup();
    lua.run(`ROSTER = { MEMBER("Ann Able", 0, "Leader"), MEMBER("Me Myself", 3, "Member"), MEMBER("G One", 3, "Member"), MEMBER("H Two", 3, "Member"), MEMBER("I Three", 3, "Member") }`);
    next(lua);
    // Bob, Cy, Di, Ed left (4) and 4 joined: 8 changes against 5 members is a bad read and is skipped.
    expect(kinds(lua)).toBe("");
    lua.close();
    const big = setup();
    big.run(`ROSTER = {}; for i = 1, 20 do ROSTER[i] = MEMBER("Member " .. string.char(64 + i), 3, "Member") end; NS.guildSnapshot.read(true)`);
    big.run(`SAID = {}; ROSTER[21] = MEMBER("Me Myself", 3, "Member"); for i = 22, 26 do ROSTER[i] = MEMBER("New " .. i, 3, "Member") end`);
    next(big);
    expect(big.run(`return #SAID`)).toBe("4");
    expect(said(big)).toContain("More guild changes (2)");
    expect(said(big)).not.toContain("Me Myself joined");
    expect(kinds(big)).toContain("join:Me Myself");
  });

  it("ignores a partial roster, a stale baseline and a switched-off module", () => {
    const lua = setup();
    lua.run(`SHOW_OFFLINE = false; table.remove(ROSTER, 5)`);
    next(lua);
    expect(kinds(lua)).toBe("");
    lua.run(`SHOW_OFFLINE = true; NS.guildSnapshot.read(true)`);
    next(lua, 24 * 4);
    expect(kinds(lua)).toBe("");
    lua.run(`ACTIVE = false; table.remove(ROSTER, 1)`);
    next(lua);
    expect(kinds(lua)).toBe("");
    expect(said(lua)).toBe("");
  });

  it("keeps at most 200 events and forgets those older than 60 days", () => {
    const lua = setup();
    lua.run(`DB.guildEvents = { list = {} }; for i = 1, 210 do DB.guildEvents.list[i] = { at = CLOCK - 3600, kind = "join", name = "Old " .. i } end
      DB.guildEvents.list[1].at = CLOCK - 61 * 86400
      ROSTER[6] = MEMBER("Zed Zane", 3, "Member")`);
    next(lua);
    expect(lua.run(`return #DB.guildEvents.list`)).toBe("200");
    expect(lua.run(`return DB.guildEvents.list[#DB.guildEvents.list].name`)).toBe("Zed Zane");
  });
});
