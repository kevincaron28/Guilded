import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession;
afterEach(() => session?.close());

// The same active-run setup as death-positions.test.ts, inside a 5-player instance.
function activeRun() {
  session = newLuaSession();
  session.run("NS = {}; GuildedDB = nil");
  session.load("Core.lua");
  session.load("Util.lua");
  session.load("DungeonRoutes.lua");
  session.load("Compat.lua");
  session.load("Modules/Dungeon.lua");
  session.run(`fire_event("PLAYER_LOGIN")
    GetBuildInfo = function() return "1.60.1", "12345", "date", 16001 end
    STAMP = 1800000000
    NS.compat.serverTime = function() return STAMP end
    INSTANCE = {id=3065, type="party", name="Hall of Thanes", difficultyId=1}
    NS.compat.instance = function() return INSTANCE end
    IsInInstance = function() return true, "party" end
    fire_event("PLAYER_ENTERING_WORLD")
    fire_event("PLAYER_REGEN_DISABLED")
    POS = {0.1, 0.5}
    MAP = 1234
    C_Map = { GetBestMapForUnit = function() return MAP end,
      GetPlayerMapPosition = function() return { GetXY = function() return POS[1], POS[2] end } end }`);
  return session;
}
const cells = (map = 1234) => session.run(`for _, e in ipairs(GuildedDB.dungeon.current.trace or {}) do if e.map == ${map} then return e.cells end end; return ""`);
const count = () => Number(session.run(`local n = 0; for _, e in ipairs(GuildedDB.dungeon.current.trace or {}) do for _ in string.gmatch(e.cells, "%d+") do n = n + 1 end end; return n`));

describe("traced dungeon maps", () => {
  it("records the snapped grid cell per floor, once, with no time", () => {
    const s = activeRun();
    s.run("NS.dungeonTrace.sample(); NS.dungeonTrace.sample()");
    // x 0.1 -> column 20, y 0.5 -> row 100: key 20 * 200 + 100.
    expect(cells()).toBe(String(20 * 200 + 100));
    expect(s.run("local e = GuildedDB.dungeon.current.trace[1]; local n = 0; for k in pairs(e) do n = n + 1 end; return n")).toBe("2"); // map + cells only
  });
  it("fills short steps in a straight line, but not long jumps or a floor change", () => {
    const s = activeRun();
    s.run("NS.dungeonTrace.sample(); POS = {0.125, 0.5}; NS.dungeonTrace.sample()"); // 5 columns to the right: 5 more cells
    expect(cells().split(",").map(Number).map(key => Math.floor(key / 200))).toEqual([20, 21, 22, 23, 24, 25]);
    s.run("POS = {0.9, 0.9}; NS.dungeonTrace.sample()"); // a long jump (teleport): only the landing cell
    expect(count()).toBe(7);
    s.run("MAP = 1235; POS = {0.905, 0.9}; NS.dungeonTrace.sample()"); // another floor: its own entry
    expect(cells(1235)).toBe(String(181 * 200 + 180));
  });
  it("records nothing outside an instance, with tracing off, or when the position is unknown", () => {
    const s = activeRun();
    s.run(`IsInInstance = function() return false, "none" end; NS.dungeonTrace.sample()`);
    s.run(`IsInInstance = function() return true, "party" end; NS.getSettings().dungeonTrace = false; NS.dungeonTrace.sample()`);
    s.run(`NS.getSettings().dungeonTrace = nil; POS = {0, 0}; NS.dungeonTrace.sample()`);
    s.run(`C_Map = nil; NS.dungeonTrace.sample()`);
    expect(count()).toBe(0);
  });
  it("caps the cells per run", () => {
    const s = activeRun();
    s.run("for i = 0, 199 do for j = 0, 3 do POS = {i / 200 + 0.001, j / 10 + 0.05}; NS.dungeonTrace.sample() end end");
    expect(count()).toBe(600);
  });
  it("has a member off switch: /guilded maptrace off | on", () => {
    const s = activeRun();
    s.run(`NS.commandHandlers.maptrace({ "off" })`);
    expect(s.run("return tostring(NS.getSettings().dungeonTrace)")).toBe("false");
    s.run("NS.dungeonTrace.sample()");
    expect(count()).toBe(0);
    s.run(`NS.commandHandlers.maptrace({ "on" }); NS.dungeonTrace.sample()`);
    expect(count()).toBe(1);
  });
});
