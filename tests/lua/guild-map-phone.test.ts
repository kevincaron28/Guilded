import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Track M: the addon saves the player's own last position, a short trail and their own calls for
// help (db.mapSeen, db.mapTrail, db.helpCalls) for their companion to upload to the phone map.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const MAPS = String.raw`
  CLOCK = 100; NOW = 1800000000
  function GetTime() return CLOCK end
  function GetServerTime() return NOW end
  Enum = { UIMapType = { Continent = 2, Zone = 3 } }
  C_Map = {
    GetMapInfo = function(id)
      if id == 1429 then return { name = "Elwynn Forest", mapType = 3, parentMapID = 1415 } end
      if id == 1415 then return { name = "Eastern Kingdoms", mapType = 2, parentMapID = 947 } end
      return nil
    end,
    GetMapRectOnMap = function(from, to) if from == 1429 and to == 1415 then return 0.4, 0.6, 0.6, 0.8 end end
  }
  DB = {}
`;

function withMap(): LuaSession {
  session = newLuaSession();
  session.run(MAPS + String.raw`
    NS = { getSettings = function() return {} end, getDb = function() return DB end, playerName = function() return "Aldric Vane" end,
           commandHandlers = {}, commandHelp = {}, comm = { register = function() end } }
  `);
  session.load("Modules/GuildMap.lua");
  return session;
}

describe("phone map: own position", () => {
  it("saves the last position with its continent point, at most every 30 s", () => {
    const s = withMap();
    s.run(`NS.guildMap.remember(1429, 0.5, 0.25)`);
    expect(s.run(`local r = DB.mapSeen["Aldric Vane"]; return table.concat({ r.m, r.z, r.x, r.y, r.c, r.cn, r.cx, r.cy, r.at }, "|")`))
      .toBe("1429|Elwynn Forest|0.5|0.25|1415|Eastern Kingdoms|0.5|0.65|1800000000");
    s.run(`CLOCK = 110; NOW = NOW + 10; NS.guildMap.remember(1429, 0.9, 0.9)`);
    expect(s.run(`return tostring(DB.mapSeen["Aldric Vane"].x)`)).toBe("0.5");
    s.run(`CLOCK = 140; NOW = NOW + 30; NS.guildMap.remember(1429, 0.9, 0.9)`);
    expect(s.run(`return tostring(DB.mapSeen["Aldric Vane"].x)`)).toBe("0.9");
  });

  it("keeps a trail of one point per 10 minutes, at most 40 and 7 days", () => {
    const s = withMap();
    s.run(`for i = 1, 45 do CLOCK = CLOCK + 600; NOW = NOW + 600; NS.guildMap.remember(1429, 0.5, 0.5) end`);
    expect(s.run(`return tostring(#DB.mapTrail) .. "|" .. DB.mapTrail[1].n`)).toBe("40|Aldric Vane");
    s.run(`CLOCK = CLOCK + 600; NOW = NOW + 8 * 86400; NS.guildMap.remember(1429, 0.5, 0.5)`);
    expect(s.run(`return tostring(#DB.mapTrail)`)).toBe("1");
  });

  it("saves from the tick, so a client without the map APIs saves nothing", () => {
    const s = withMap();
    s.run(`NS.guildMap.myPosition = function() return 1429, 0.5, 0.5 end; IsInGuild = function() return false end; NS.guildMap.tick()`);
    expect(s.run(`return tostring(DB.mapSeen ~= nil)`)).toBe("true");
    session!.close();
    session = newLuaSession();
    session.run(`DB = {}; NS = { getSettings = function() return {} end, getDb = function() return DB end, playerName = function() return "Ann" end, commandHandlers = {}, commandHelp = {}, comm = { register = function() end } }`);
    session.load("Modules/GuildMap.lua");
    session.run(`NS.guildMap.tick()`);
    expect(session.run(`return tostring(DB.mapSeen == nil)`)).toBe("true");
  });
});

describe("phone map: own calls for help", () => {
  it("saves the call with attackers and continent point, and marks all clear", () => {
    session = newLuaSession();
    session.run(MAPS + String.raw`
      INST = false; SENT = 0
      function UnitName(u) return u == "player" and "Aldric Vane" or nil end
      function UnitLevel() return 40 end
      function GetRealZoneText() return "Elwynn Forest" end
      function GetSubZoneText() return "Goldshire" end
      function IsInInstance() return INST end
      function IsInGuild() return true end
      SETTINGS = { helpGuildChat = false }
      NS = { util = {}, commandHandlers = {}, commandHelp = {}, message = function() end, isSecret = function() return false end,
        playerName = function() return "Aldric Vane" end, getSettings = function() return SETTINGS end, getDb = function() return DB end,
        guildMap = { members = {}, myPosition = function() return 1429, 0.5, 0.25 end, refresh = function() end },
        comm = { register = function() end, send = function() SENT = SENT + 1; return true end } }
    `);
    session.load("Locale.lua");
    session.run(`NS.guildMap.continentOf = function() return 1415, "Eastern Kingdoms" end
      NS.guildMap.translate = function(_, x, y) return 0.5, 0.65 end`);
    session.load("Modules/CallForHelp.lua");
    session.run(`NS.callForHelp.open()`);
    expect(session.run(`local r = DB.helpCalls["1800000000"]; return table.concat({ r.id, r.n, r.z, r.sz, r.m, r.c, r.cx, r.cy, tostring(r.clr) }, "|")`))
      .toBe("1800000000|Aldric Vane|Elwynn Forest|Goldshire|1429|1415|0.5|0.65|nil");
    session.run(`NOW = NOW + 60; NS.callForHelp.allClear()`);
    expect(session.run(`return tostring(DB.helpCalls["1800000000"].clr)`)).toBe("1800000060");
  });

  it("keeps at most 10 calls and none older than 2 days", () => {
    session = newLuaSession();
    session.run(MAPS + `NS = { util = {}, commandHandlers = {}, commandHelp = {}, getSettings = function() return {} end, getDb = function() return DB end, playerName = function() return "Ann" end, comm = { register = function() end } }`);
    session.load("Modules/CallForHelp.lua");
    session.run(`for i = 1, 12 do NS.callForHelp.saveCall({ time = NOW + i, zone = "Z", attackers = {} }) end
      NS.callForHelp.saveCall({ time = NOW + 3 * 86400, zone = "Z", attackers = {} })`);
    expect(session.run(`local n = 0; for _ in pairs(DB.helpCalls) do n = n + 1 end; return tostring(n)`)).toBe("1");
    session.run(`DB.helpCalls = {}; for i = 1, 12 do NS.callForHelp.saveCall({ time = NOW + i, zone = "Z", attackers = {} }) end`);
    expect(session.run(`local n = 0; for _ in pairs(DB.helpCalls) do n = n + 1 end; return tostring(n) .. "|" .. tostring(DB.helpCalls[tostring(NOW + 1)] == nil)`)).toBe("10|true");
  });
});
