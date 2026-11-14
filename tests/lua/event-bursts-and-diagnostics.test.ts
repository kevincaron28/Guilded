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

describe("score relearning on roster updates", () => {
  it("relearns at most once a minute and runs once more at the end of the minute", () => {
    const s = loggedIn(`CLOCK = 100; function GetTime() return CLOCK end`);
    s.load("Modules/Scores.lua");
    s.run(`GuildedDB.dungeon = { runs = { r1 = { state = "COMPLETED" } } }; LEARNED = 0; NS.scores.learn = function() LEARNED = LEARNED + 1 end; TIMERS = {}`);
    s.run(`fire_event("GUILD_ROSTER_UPDATE")`);
    expect(s.run("return LEARNED")).toBe("1");
    s.run(`CLOCK = 110; for i = 1, 20 do fire_event("GUILD_ROSTER_UPDATE") end`);
    expect(s.run("return LEARNED")).toBe("1"); // folded
    s.run(`CLOCK = 165; run_timers()`);
    expect(s.run("return LEARNED")).toBe("2"); // the trailing run
  });
});

describe("blocked calls and diagnostics", () => {
  it("says what was running when the game refused a call, but only switches reads off when the game names them", () => {
    const s = loggedIn(`
      function GetGuildRosterMOTD() fire_event("ADDON_ACTION_BLOCKED", "Guilded", "UNKNOWN", "extra") return "hi" end
      function GetGuildInfoText() return "info" end
      GetBuildInfo = function() return "1.0", "55555" end
    `);
    s.load("Modules/GuildSnapshot.lua");
    s.run(`NS.guildSnapshot.read(true)`);
    const detail = s.run("local d = GuildedDB.diagnostics; return d[#d].detail");
    expect(detail).toContain("raised while calling GetGuildRosterMOTD");
    expect(detail).toContain("extra"); // the event's own arguments are kept
    // A guess is not proof: the read is still made next time.
    s.run(`MOTD_CALLS = 0; function GetGuildRosterMOTD() MOTD_CALLS = MOTD_CALLS + 1 return "hi" end; NS.guildSnapshot.read(true)`);
    expect(s.run("return MOTD_CALLS")).toBe("1");
    // After the call returned, the marker is gone: a later refusal is not blamed on the read.
    expect(s.run("return tostring(NS.guardedCall)")).toBe("nil");
    // When the game itself names the function, the reads stop for this client build.
    s.run(`fire_event("ADDON_ACTION_BLOCKED", "Guilded", "GetGuildRosterMOTD()"); MOTD_CALLS = 0; NS.guildSnapshot.read(true)`);
    expect(s.run("return MOTD_CALLS")).toBe("0");
  });

  // 9.3.1: "UNKNOWN()" names no function, so the record says what else was going on.
  it("records combat, the open window page and the last event beside an unnamed blocked call", () => {
    const s = loggedIn(`CLOCK = 100; function GetTime() return CLOCK end`);
    s.run(`INCOMBAT = true; fire_event("GUILD_ROSTER_UPDATE"); CLOCK = 102.5; fire_event("ADDON_ACTION_BLOCKED", "Guilded", "UNKNOWN()")`);
    const detail = s.run("local d = GuildedDB.diagnostics; return d[#d].detail");
    expect(detail).toContain("tried to call UNKNOWN()");
    expect(detail).toContain("(after GUILD_ROSTER_UPDATE)");
    expect(detail).toContain("in combat");
    expect(detail).toContain("last event <5 s ago");
    // Out of combat with no window open, nothing is claimed.
    s.run(`INCOMBAT = false; fire_event("ADDON_ACTION_BLOCKED", "Guilded", "UNKNOWN()")`);
    expect(s.run("local d = GuildedDB.diagnostics; return d[#d].detail")).not.toContain("in combat");
  });

  it("does not list name-migration debug lines for ordinary members in /guilded diag", () => {
    const s = loggedIn(`GetGuildInfo = function() return "Test Guild", "Member", 5 end`);
    s.run(`GuildedDB.nameMigration = { flagged = { a = { table = "roster", key = "El", candidates = { "El Chacal", "El Daron" }, reason = "shared first name" } } }`);
    s.run(`CHAT_LOG = {}; SlashCmdList.GUILDED("diag")`);
    expect(s.chat().join("\n")).not.toContain("shared first name");
    s.run(`CHAT_LOG = {}; SlashCmdList.GUILDED("diag names")`);
    expect(s.chat().join("\n")).toContain("shared first name");
  });

  it("gives an officer one count line, not one line per name, unless /guilded diag names is used (9.2.1)", () => {
    const s = loggedIn(`GetGuildInfo = function() return "Test Guild", "Guild Master", 0 end`);
    s.run(`GuildedDB.nameMigration = { flagged = {
      a = { table = "roster", key = "El", candidates = { "El Chacal", "El Daron" }, reason = "shared first name" },
      b = { table = "roster", key = "Pally", candidates = { "Pally One", "Pally Two" }, reason = "shared first name" } } }`);
    s.run(`CHAT_LOG = {}; SlashCmdList.GUILDED("diag")`);
    const text = s.chat().join("\n");
    expect(text).toContain("2 saved entries still use a first name only");
    expect(text).not.toContain("El Chacal");
    expect(text).not.toContain("Pally One");
    s.run(`CHAT_LOG = {}; SlashCmdList.GUILDED("diag names")`);
    expect(s.chat().join("\n")).toContain("El Chacal");
  });

  it("names the kind of addon message in a SLOW entry (9.2.1)", () => {
    const s = loggedIn();
    s.run(`local t = 0; debugprofilestop = function() t = t + 80; return t end
      fire_event("CHAT_MSG_ADDON", "Guilded", "LEDGER|abc|1", "GUILD", "Amy-Realm")`);
    expect(s.run(`local d = GuildedDB.diagnostics; return d[#d].detail`)).toContain("CHAT_MSG_ADDON LEDGER took");
  });
});

describe("unfinished dungeons", () => {
  function abandoned(instance: string, kills: Array<[number, string]>) {
    const s = newLuaSession();
    session = s;
    s.run("NS = {}; GuildedDB = nil");
    s.load("Core.lua");
    s.load("DungeonRoutes.lua");
    s.load("Compat.lua");
    s.load("Modules/Dungeon.lua");
    s.run(`fire_event("PLAYER_LOGIN")
      GetBuildInfo = function() return "1.60.1", "70790", "date", 16001 end
      STAMP = 1800000000
      NS.compat.serverTime = function() return STAMP end
      INSTANCE = ${instance}
      NS.compat.instance = function() return INSTANCE end
      fire_event("PLAYER_ENTERING_WORLD")
      fire_event("PLAYER_REGEN_DISABLED")
      STAMP = STAMP + 600`);
    for (const [id, name] of kills) s.run(`STAMP=STAMP+300; fire_event("ENCOUNTER_END",${id},"${name}",0,5,1)`);
    s.run(`NS.commandHandlers["dungeon"]({ "abandon" })`);
    return s;
  }
  const problems = (s: LuaSession) => s.run(`local n = 0; for _, e in ipairs(GuildedDB.diagnostics or {}) do if e.kind == "DUNGEON_FINAL_UNMATCHED" then n = n + 1 end end return n`);

  it("knows Wailing Caverns ends with Mutanus", () => {
    const s = loggedIn();
    expect(s.run("return tostring(NS.compat.dungeonFinalKnown(43))")).toBe("true");
    expect(s.run("return tostring(NS.compat.dungeonFinalKnown(999999))")).toBe("false");
  });

  it("an abandoned run whose last kill was Verdan lists no problem; an unrecognised last kill still does", () => {
    const wc = '{id=43, type="party", name="Wailing Caverns", difficultyId=0}';
    const s = abandoned(wc, [[1001, "Verdan the Everliving"]]);
    expect(s.run("return GuildedDB.dungeon.runs[next(GuildedDB.dungeon.runs)].state")).toBe("ABANDONED");
    expect(problems(s)).toBe("0");
    session?.close();
    // A dungeon the addon has no final boss for: the trace is what lets it be added.
    const t = abandoned('{id=999999, type="party", name="Unknown Hold", difficultyId=0}', [[1002, "Some Boss"]]);
    expect(t.run("return GuildedDB.dungeon.runs[next(GuildedDB.dungeon.runs)].state")).toBe("ABANDONED");
    expect(problems(t)).toBe("1");
  });
});
