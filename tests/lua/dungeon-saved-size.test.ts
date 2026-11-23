import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.5.3: the saved file held 1.5 MB of runs. A count cap drops the oldest confirmed copies first and our own unconfirmed runs last;
// death-map points of a confirmed run older than a week are dropped.
const CLOCK = 1800000000;
let s: LuaSession;
afterEach(() => s?.close());

function start() {
  s = newLuaSession();
  s.run(`NS = {}; GuildedDB = nil; CLOCK = ${CLOCK}; CHAT_LOG = {}
    TIMERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end, NewTicker = function() return {} end }`);
  s.load("Core.lua"); s.load("Locale.lua"); s.load("DungeonRoutes.lua"); s.load("Compat.lua"); s.load("Modules/Dungeon.lua"); s.load("Modules/RunResults.lua");
  s.run(`fire_event("PLAYER_LOGIN")
    NS.compat.serverTime = function() return CLOCK end
    NS.playerName = function() return "Hulke Hogan" end`);
}
const seed = (id: string, ago: number, extra: string) => s.run(`
  NS.dungeon.savedRuns()[${JSON.stringify(id)}] = { id = ${JSON.stringify(id)}, state = "COMPLETED", instanceId = 33, name = "Gnomeregan",
    startedAt = CLOCK - ${ago} - 900, endedAt = CLOCK - ${ago}, recorder = "Hulke Hogan",
    players = { ["Hulke Hogan"] = { presentSec = 900 } }, encounters = {} ${extra} }`);

describe("saved dungeon runs stay bounded", () => {
  it("drops the oldest confirmed copies past the cap and keeps our own unconfirmed runs", () => {
    start();
    for (let i = 0; i < 310; i++) seed(`c${i}`, 3600 + i, ", synced = true");
    for (let i = 0; i < 5; i++) seed(`own${i}`, 86400 * 20 + i, "");
    s.run("GuildedDungeonAccepted = {}; NS.dungeon.markSynced()");
    expect(s.run("local n = 0 for _ in pairs(NS.dungeon.savedRuns()) do n = n + 1 end return n")).toBe("300");
    expect(s.run("return tostring(NS.dungeon.savedRuns().own0 ~= nil) .. tostring(NS.dungeon.savedRuns().c0 ~= nil) .. tostring(NS.dungeon.savedRuns().c309 ~= nil)")).toBe("truetruefalse");
  });
  it("drops the death points of every saved run (9.5.3: no longer kept)", () => {
    start();
    seed("old", 86400 * 10, ", synced = true, deathPoints = { { name = 'A', x = 0.1, y = 0.2, map = 1 } }");
    seed("new", 3600, ", synced = true, deathPoints = { { name = 'A', x = 0.1, y = 0.2, map = 1 } }");
    seed("mine", 86400 * 10, ", deathPoints = { { name = 'A', x = 0.1, y = 0.2, map = 1 } }");
    s.run("GuildedDungeonAccepted = {}; NS.dungeon.markSynced()");
    expect(s.run("local r = NS.dungeon.savedRuns(); return tostring(r.old.deathPoints) .. tostring(r.new.deathPoints ~= nil) .. tostring(r.mine.deathPoints ~= nil)")).toBe("nilfalsefalse");
  });
});
