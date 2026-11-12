import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.1.7: bursts of GUILD_ROSTER_UPDATE / UNIT_INVENTORY_CHANGED run their heavy work once, a blocked
// protected call is named instead of UNKNOWN, /guilded diag keeps debug lines from ordinary members,
// and an unfinished dungeon whose final boss is known is not reported as a problem.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function loggedIn(extra = ""): LuaSession {
  const s = newLuaSession();
  session = s;
  s.run(String.raw`
    GuildedDB = nil; NS = {}; SENT = {}; TIMERS = {}; INCOMBAT = false; SCANS = 0; INSPECTS = 0
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    function InCombatLockdown() return INCOMBAT end
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end }
    function run_timers() local list = TIMERS; TIMERS = {}; for _, fn in ipairs(list) do fn() end end
    function GetNumGuildMembers() return 3 end
    function GetGuildRosterInfo(i) SCANS = SCANS + 1; return "Member" .. i .. "-Realm", "Member", 3, 60, "Warrior", "Zone", "", "", true, 0, "WARRIOR" end
    C_ChatInfo = { RegisterAddonMessagePrefix = function() return true end, SendAddonMessage = function() return 0 end, SendChatMessage = function() end }
    ${extra}
  `);
  s.load("Core.lua");
  s.load("Compat.lua");
  s.run(`fire_event("PLAYER_LOGIN"); run_timers(); SCANS = 0`);
  return s;
}

describe("event bursts", () => {
  it("scans the roster at once for the first update and folds the rest of a burst into one more pass", () => {
    const s = loggedIn();
    s.run(`for i = 1, 25 do fire_event("GUILD_ROSTER_UPDATE") end`);
    expect(s.run("return SCANS")).toBe("3"); // the first update: one pass over three members
    s.run("run_timers()");
    expect(s.run("return SCANS")).toBe("6"); // 24 more updates became a single pass
    s.run("run_timers()");
    expect(s.run("return SCANS")).toBe("6");
  });

  it("waits out combat before scanning", () => {
    const s = loggedIn();
    s.run(`INCOMBAT = true; fire_event("GUILD_ROSTER_UPDATE"); run_timers()`);
    expect(s.run("return SCANS")).toBe("0");
    s.run(`INCOMBAT = false; run_timers()`);
    expect(s.run("return SCANS")).toBe("3");
  });

  it("folds a burst of UNIT_INVENTORY_CHANGED into one deferred sync and ignores other units", () => {
    const s = loggedIn();
    s.run(`COUNT = 0; NS.deferWork("inventory-probe", 3, function() COUNT = COUNT + 1 end); NS.deferWork("inventory-probe", 3, function() COUNT = COUNT + 1 end)`);
    s.run("run_timers()");
    expect(s.run("return COUNT")).toBe("1");
    s.run(`for i = 1, 10 do fire_event("UNIT_INVENTORY_CHANGED", "party1") end`);
    expect(s.run("return #TIMERS")).toBe("0");
    s.run(`for i = 1, 10 do fire_event("UNIT_INVENTORY_CHANGED", "player") end`);
    expect(s.run("return #TIMERS")).toBe("1");
  });
});

describe("blocked calls and diagnostics", () => {
  it("names the guild text read that the game refused instead of UNKNOWN", () => {
    const s = loggedIn(`
      function GetGuildRosterMOTD() fire_event("ADDON_ACTION_BLOCKED", "Guilded", "UNKNOWN") return "hi" end
      function GetGuildInfoText() return "info" end
      GetBuildInfo = function() return "1.0", "55555" end
    `);
    s.load("Modules/GuildSnapshot.lua");
    s.run(`NS.guildSnapshot.read(true)`);
    expect(s.run("local d = GuildedDB.diagnostics; return d[#d].detail")).toContain("while calling GetGuildRosterMOTD");
    // Remembered for this client build: the next read does not call it again.
    s.run(`MOTD_CALLS = 0; function GetGuildRosterMOTD() MOTD_CALLS = MOTD_CALLS + 1 return "hi" end; NS.guildSnapshot.read(true)`);
    expect(s.run("return MOTD_CALLS")).toBe("0");
  });

  it("does not list name-migration debug lines for ordinary members in /guilded diag", () => {
    const s = loggedIn(`GetGuildInfo = function() return "Test Guild", "Member", 5 end`);
    s.run(`GuildedDB.nameMigration = { flagged = { a = { table = "roster", key = "El", candidates = { "El Chacal", "El Daron" }, reason = "shared first name" } } }`);
    s.run(`CHAT_LOG = {}; SlashCmdList.GUILDED("diag")`);
    expect(s.chat().join("\n")).not.toContain("shared first name");
    s.run(`CHAT_LOG = {}; SlashCmdList.GUILDED("diag names")`);
    expect(s.chat().join("\n")).toContain("shared first name");
  });
});

describe("unfinished dungeons", () => {
  it("knows Wailing Caverns ends with Mutanus, so stopping after Verdan is not a problem", () => {
    const s = loggedIn();
    expect(s.run("return tostring(NS.compat.dungeonFinalKnown(43))")).toBe("true");
    expect(s.run("return tostring(NS.compat.dungeonFinalKnown(999999))")).toBe("false");
  });
});
