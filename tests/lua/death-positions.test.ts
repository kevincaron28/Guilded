import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession;
afterEach(() => session?.close());

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
    POS = {0.12345, 0.5}
    MAP = 1234
    C_Map = { GetBestMapForUnit = function() return MAP end,
      GetPlayerMapPosition = function() return { GetXY = function() return POS[1], POS[2] end } end }`);
  return session;
}
const points = "local p = GuildedDB.dungeon.current.deathPoints or {}; return #p";

describe("death positions", () => {
  it("records the player's own death position, rounded to 3 decimals, with the map id", () => {
    const s = activeRun();
    s.run(`fire_event("PLAYER_DEAD")`);
    expect(s.run(points)).toBe("1");
    expect(s.run(`local p = GuildedDB.dungeon.current.deathPoints[1]; return p.x .. ":" .. p.y .. ":" .. p.map .. ":" .. p.name`)).toBe(`0.123:0.5:1234:${s.run("return NS.playerName()")}`);
    expect(s.run("return GuildedDB.dungeon.current.players[NS.playerName()].deaths")).toBe("1");
  });
  it("records nothing, and still counts the death, when the position is unknown or restricted", () => {
    const s = activeRun();
    s.run(`POS = {0, 0}; fire_event("PLAYER_DEAD")`);
    s.run(`POS = {nil, nil}; fire_event("PLAYER_DEAD")`);
    s.run(`POS = {0.4, 0.4}; MAP = nil; fire_event("PLAYER_DEAD")`);
    s.run(`MAP = 7; NS.isSecret = function(v) return v == 0.4 end; fire_event("PLAYER_DEAD")`);
    s.run(`NS.isSecret = function() return false end; C_Map.GetPlayerMapPosition = function() error("blocked") end; fire_event("PLAYER_DEAD")`);
    s.run(`C_Map = nil; fire_event("PLAYER_DEAD")`);
    expect(s.run(points)).toBe("0");
    expect(s.run("return GuildedDB.dungeon.current.players[NS.playerName()].deaths")).toBe("6");
  });
  it("caps the points per run", () => {
    const s = activeRun();
    s.run(`for i = 1, 80 do POS = {i / 100 % 1 + 0.001, 0.2}; fire_event("PLAYER_DEAD") end`);
    expect(s.run(points)).toBe("60");
  });
  it("accepts a groupmate's own DPOS only for a player in the run, with valid ranges", () => {
    const s = activeRun();
    s.run(`NS.util.inMyGroup = function() return true end
      local run = GuildedDB.dungeon.current
      run.players.Friend = { presentSec = 0 }
      fire_event("CHAT_MSG_ADDON", "GuildedDgn", "DPOS|" .. run.id .. "|Friend|250|750|1234", "PARTY", "Friend")
      fire_event("CHAT_MSG_ADDON", "GuildedDgn", "DPOS|" .. run.id .. "|Friend|2500|750|1234", "PARTY", "Friend")
      fire_event("CHAT_MSG_ADDON", "GuildedDgn", "DPOS|" .. run.id .. "|Friend|250|750|0", "PARTY", "Friend")
      fire_event("CHAT_MSG_ADDON", "GuildedDgn", "DPOS|" .. run.id .. "|Friend|250|750|1234", "PARTY", "Stranger")
      fire_event("CHAT_MSG_ADDON", "GuildedDgn", "DPOS|" .. run.id .. "|Latecomer|250|750|1234", "PARTY", "Latecomer")
      fire_event("CHAT_MSG_ADDON", "GuildedDgn", "DPOS|nope|Friend|250|750|1234", "PARTY", "Friend")`);
    expect(s.run(points)).toBe("1");
    expect(s.run(`local p = GuildedDB.dungeon.current.deathPoints[1]; return p.x .. ":" .. p.y .. ":" .. p.map .. ":" .. p.name`)).toBe("0.25:0.75:1234:Friend");
  });
});
