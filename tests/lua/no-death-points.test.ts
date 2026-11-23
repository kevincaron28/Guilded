import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession;
afterEach(() => session?.close());

// 9.5.3: death positions and traced dungeon maps are no longer recorded, and saved runs lose them.
function activeRun() {
  session = newLuaSession();
  session.run("NS = {}; GuildedDB = nil");
  session.load("Core.lua");
  session.load("DungeonRoutes.lua");
  session.load("Compat.lua");
  session.load("Modules/Dungeon.lua");
  session.run(`fire_event("PLAYER_LOGIN")
    GetBuildInfo = function() return "1.60.1", "12345", "date", 16001 end
    STAMP = 1800000000
    NS.compat.serverTime = function() return STAMP end
    INSTANCE = {id=3065, type="party", name="Hall of Thanes", difficultyId=1}
    NS.compat.instance = function() return INSTANCE end
    fire_event("PLAYER_ENTERING_WORLD")
    fire_event("PLAYER_REGEN_DISABLED")
    STAMP = STAMP + 600
    C_Map = { GetBestMapForUnit = function() return 1234 end,
      GetPlayerMapPosition = function() return { GetXY = function() return 0.25, 0.5 end } end }`);
  return session;
}

describe("no death points", () => {
  it("counts a death without saving its position or sending DPOS", () => {
    const s = activeRun();
    s.run(`SENT = {}; local old = NS.comm.send; NS.comm.send = function(...) for _, a in ipairs({ ... }) do SENT[#SENT + 1] = a end; return old(...) end
      fire_event("PLAYER_DEAD")`);
    expect(s.run("return tostring(GuildedDB.dungeon.current.deathPoints)")).toBe("nil");
    expect(s.run("return GuildedDB.dungeon.current.players[NS.playerName()].deaths")).toBe("1");
    expect(s.run(`for _, t in ipairs(SENT) do if type(t) == "string" and string.find(t, "DPOS|", 1, true) then return "sent" end end return "none"`)).toBe("none");
  });
  it("ignores an older guildmate's DPOS line", () => {
    const s = activeRun();
    s.run(`local run = GuildedDB.dungeon.current
      run.players["Friend"] = { presentSec = 0 }
      fire_event("CHAT_MSG_ADDON", "GuildedDgn", "DPOS|" .. run.id .. "|Friend|250|750|1234", "PARTY", "Friend")`);
    expect(s.run("return tostring(GuildedDB.dungeon.current.deathPoints)")).toBe("nil");
  });
  it("drops death points and traces from saved runs at the sync check", () => {
    const s = activeRun();
    s.run(`GuildedDB.dungeon.runs["OLD"] = { id = "OLD", endedAt = STAMP, players = {}, deathPoints = { { x = 0.1, y = 0.2, map = 1 } }, trace = { { map = 1, cells = "1,2" } }, traceCount = 2 }
      GuildedDB.dungeon.current.trace = { { map = 1, cells = "3" } }
      NS.dungeon.markSynced()`);
    expect(s.run(`local r = GuildedDB.dungeon.runs["OLD"]; return tostring(r.deathPoints) .. tostring(r.trace) .. tostring(r.traceCount)`)).toBe("nilnilnil");
    expect(s.run("return tostring(GuildedDB.dungeon.current.trace)")).toBe("nil");
  });
});
