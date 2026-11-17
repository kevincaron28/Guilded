import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.3.8: the SavedVariables file stops growing. The audit log ages out, parked guilds keep a short tail of their logs, and a parked
// guild nobody played in for half a year goes only when it holds no points and no run the bot has not confirmed.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const DAY = 86400;

function login(setup: string): LuaSession {
  session = newLuaSession();
  session.run(`
    NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    function GetServerTime() return 1800000000 end
    ${setup}
  `);
  session.load("Core.lua");
  session.load("Compat.lua");
  session.run(`fire_event("PLAYER_LOGIN")`);
  return session;
}

describe("saved-data size caps (9.3.8)", () => {
  it("ages out the audit log, keeps the newest entries and the loaded guild's data", () => {
    const s = login(`
      local now = time()
      local old = date("!%Y-%m-%dT%H:%M:%SZ", now - 40 * ${DAY})
      local fresh = date("!%Y-%m-%dT%H:%M:%SZ", now - 1 * ${DAY})
      GuildedDB = { version = 4, guildKey = "Alpha-TestRealm", roster = { Bob = {} }, epgp = { Bob = { ep = 5, gp = 0, ledger = {} } }, settings = { officers = {} }, events = {} }
      for i = 1, 50 do GuildedDB.events[#GuildedDB.events + 1] = { at = old, kind = "LOOT" } end
      for i = 1, 20 do GuildedDB.events[#GuildedDB.events + 1] = { at = fresh, kind = "LOOT" } end
    `);
    expect(s.run("return #GuildedDB.events")).toBe("20");
    expect(s.run("return GuildedDB.epgp.Bob.ep .. tostring(GuildedDB.roster.Bob ~= nil)")).toBe("5true");
  });

  it("caps a parked guild's logs and forgets only an idle, empty, fully synced parked guild", () => {
    const s = login(`
      local now = time()
      local function events(n, at) local list = {}; for i = 1, n do list[i] = { at = at, kind = "LOOT" } end; return list end
      GuildedDB = { version = 4, guildKey = "Alpha-TestRealm", roster = {}, settings = { officers = {} }, otherGuilds = {
        ["Busy-TestRealm"] = { parkedAt = now - 10 * ${DAY}, events = events(400, "2026-11-01T00:00:00Z"), guildLog = { events = events(500, now - 1 * ${DAY}) } },
        ["Idle-TestRealm"] = { parkedAt = now - 200 * ${DAY}, roster = {}, dungeon = { runs = { a = { id = "a", synced = true } } } },
        ["IdlePoints-TestRealm"] = { parkedAt = now - 200 * ${DAY}, epgp = { Bob = { ep = 9, gp = 0, ledger = {} } } },
        ["IdleUnsent-TestRealm"] = { parkedAt = now - 200 * ${DAY}, dungeon = { runs = { b = { id = "b" } } } },
        ["Unstamped-TestRealm"] = { roster = {} }
      } }
    `);
    expect(s.run('return #GuildedDB.otherGuilds["Busy-TestRealm"].events')).toBe("100");
    expect(s.run('return #GuildedDB.otherGuilds["Busy-TestRealm"].guildLog.events')).toBe("300");
    expect(s.run('return tostring(GuildedDB.otherGuilds["Idle-TestRealm"])')).toBe("nil");
    expect(s.run('return tostring(GuildedDB.otherGuilds["IdlePoints-TestRealm"] ~= nil)')).toBe("true");
    expect(s.run('return tostring(GuildedDB.otherGuilds["IdleUnsent-TestRealm"] ~= nil)')).toBe("true");
    // Data parked before the stamp existed starts its half year at the first login with this version.
    expect(s.run('return tostring(GuildedDB.otherGuilds["Unstamped-TestRealm"].parkedAt ~= nil)')).toBe("true");
  });

  it("stamps a guild when it is parked and drops the stamp when it comes back", () => {
    const s = login(`
      GuildedDB = { version = 4, guildKey = "Alpha-TestRealm", epgp = { Bob = { ep = 50, gp = 0, ledger = {} } }, roster = { Bob = {} }, settings = { officers = {} } }
      function GetGuildInfo() return "Beta", "Member", 3 end
    `);
    s.run(`fire_event("GUILD_ROSTER_UPDATE")`);
    expect(s.run('return tostring(type(GuildedDB.otherGuilds["Alpha-TestRealm"].parkedAt))')).toBe("number");
    expect(s.run("return tostring(GuildedDB.parkedAt)")).toBe("nil");
    s.run(`function GetGuildInfo() return "Alpha", "Member", 3 end; FRAMES = {}; NS = {}`);
    s.load("Core.lua");
    s.load("Compat.lua");
    s.run(`fire_event("PLAYER_LOGIN"); fire_event("GUILD_ROSTER_UPDATE")`);
    expect(s.run("return GuildedDB.guildKey .. tostring(GuildedDB.parkedAt) .. GuildedDB.epgp.Bob.ep")).toBe("Alpha-TestRealmnil50");
  });

  it("trims the guild event log by count and age", () => {
    session = newLuaSession();
    const s = session;
    s.run(`
      DB = { settings = {}, guildLog = { events = {} } }
      NS = { L = function(t) return t end, getDb = function() return DB end, util = { serverTime = function() return 1800000000 end } }
      function GetNumGuildEvents() return 0 end
      function GetGuildEventInfo() end
      for i = 1, 1100 do DB.guildLog.events[i] = { type = "join", p1 = "P" .. i, at = 1800000000 - i } end
      DB.guildLog.events[1].at = 1800000000 - 200 * ${DAY}
    `.replace("i end\n", "i }\n"));
    s.load("Modules/GuildLog.lua");
    s.run("NS.guildLog.read()");
    // The first (oldest, 200 days) goes by age, then the list is cut to the newest 1000.
    expect(s.run("return #DB.guildLog.events")).toBe("1000");
  });
});
