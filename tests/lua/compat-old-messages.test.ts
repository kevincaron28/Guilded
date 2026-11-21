import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Compatibility replay (docs/COMPAT_POLICY.md): addon messages an older release put on the wire are fed to the
// current handlers. None may raise an error; each is either understood or ignored.
const sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions.length = 0; });

function sync(): LuaSession {
  const s = newLuaSession(); sessions.push(s);
  s.run(`
    GetAddOnMetadata = function() return "9.3.5" end
    DB = {}
    NS = {
      isSecret = function() return false end,
      normalizeName = function(n) return (string.gsub(string.match(n, "^([^%-]+)") or n, "^%l", string.upper)) end,
      playerName = function() return "Kev" end,
      isOfficer = function() return false end, isOfficerName = function() return false end,
      getDb = function() return DB end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      commandHandlers = {}, commandHelp = {}
    }
  `);
  s.load("Modules/Sync.lua");
  return s;
}

function catchUp(): LuaSession {
  const s = newLuaSession(); sessions.push(s);
  s.run(`NS = {}; GuildedDB = nil; CLOCK = 1800000000; GT = 0
    function GetServerTime() return CLOCK end
    function GetTime() GT = GT + 1; return GT end
    function IsInInstance() return false, "none" end
    TIMERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end }
    function run_timers() for _ = 1, 20 do local list = TIMERS; TIMERS = {}; if #list == 0 then return end; for _, fn in ipairs(list) do fn() end end end`);
  for (const file of ["Core.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua", "Modules/GuildRelay.lua", "Modules/CatchUp.lua", "Modules/SyncNow.lua"]) s.load(file);
  s.run(`fire_event("PLAYER_LOGIN")
    NS.compat.serverTime = function() return CLOCK end
    NS.playerName = function() return "Walter" end
    NS.isGuildMember = function() return true end
    NS.isOfficerName = function() return false end
    NS.currentGuildKey = function() return "Achievers-Realm" end
    NS.getDb().standings = { updatedAt = "2026-12-20T10:00:00Z" }
    NS.getDb().peerRoster = {}
    fire_event("PLAYER_ENTERING_WORLD")
    run_timers(); SENT = {}`);
  return s;
}

describe("older addon messages reach the current handlers", () => {
  it("VERSION from several older releases is recorded, never an error", () => {
    const s = sync();
    s.run(`fire_event("PLAYER_ENTERING_WORLD")
      for i, version in ipairs({ "9.1.0", "9.1.3", "9.2.0", "9.3.0" }) do
        fire_event("CHAT_MSG_ADDON", "GuildedSync", "VERSION|" .. version, "GUILD", "Peer" .. i .. "-Realm")
      end
      fire_event("CHAT_MSG_ADDON", "GuildedSync", "VERSION|", "GUILD", "Empty-Realm")
      NS.commandHandlers["peers"]({})`);
    const text = s.chat().join("\n");
    expect(text).toContain("4 addon user(s) seen");
    expect(text).toContain("Peer1 9.1.0 (older)");
  });

  it("STANDREQ with or without a stamp, and kinds this release never heard of, are handled quietly", () => {
    const s = sync();
    s.run(`fire_event("PLAYER_ENTERING_WORLD")
      fire_event("CHAT_MSG_ADDON", "GuildedSync", "STANDREQ|0", "GUILD", "Old-Realm")
      fire_event("CHAT_MSG_ADDON", "GuildedSync", "STANDREQ|2026-01-01T00:00:00Z", "GUILD", "Old2-Realm")
      fire_event("CHAT_MSG_ADDON", "GuildedSync", "RETIREDKIND|a|b|c", "GUILD", "Old3-Realm")
      fire_event("CHAT_MSG_ADDON", "GuildedSync", "garbage without a kind", "GUILD", "Old4-Realm")`);
    expect(s.chat().join("\n")).not.toMatch(/error|attempt to/i);
  });

  it("a DIG without the C and A fields (before 9.0) is answered about runs and never about recipes", () => {
    const s = catchUp();
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedCatch", "DIG|1|1|R:0:0|P:0:0", "GUILD", "Old-Realm"); run_timers()`);
    const lines = s.run(`local out = {}; for _, m in ipairs(SENT or {}) do out[#out + 1] = m.prefix .. ">" .. m.text end; return table.concat(out, "\\n")`);
    expect(lines).not.toMatch(/HAVE\|[CA]\|/);
  });

  it("a DIG from a newer protocol and unknown catch-up kinds are ignored", () => {
    const s = catchUp();
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedCatch", "DIG|9|0|R:1:5|P:0:0|C:0:0|A:0:0|X:7", "GUILD", "New-Realm")
      fire_event("CHAT_MSG_ADDON", "GuildedCatch", "NEWKIND|1|2", "GUILD", "New-Realm"); run_timers()`);
  });
});

describe("season details", () => {
  it("still parses a version 5 payload and refuses a version it cannot read", () => {
    const s = newLuaSession(); sessions.push(s);
    s.run(`NS={}; GuildedDB=nil; CLOCK=100; function GetTime() return CLOCK end`);
    for (const file of ["Core.lua", "Modules/Scores.lua", "Modules/SeasonDetails.lua"]) s.load(file);
    s.run(`fire_event("PLAYER_LOGIN")`);
    const payload = "S;test;5;200;1\nC;90001;East;1800;90001:east;60;60\nR;90001;East;200;0;1800;1800;r;;90001:east";
    expect(s.run(`return tostring(NS.seasonDetails.parse(${JSON.stringify(payload)})~=nil)`)).toBe("true");
    expect(s.run(`return tostring(NS.seasonDetails.parse(${JSON.stringify(payload.replace(";5;", ";4;"))})==nil)`)).toBe("true");
  });
});
