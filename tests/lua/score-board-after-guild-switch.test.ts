import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// In-game findings, 21 Nov 2026: "/guilded score Lebowski Holyroller" read only "Lebowski", and on the login where the guild
// data was repaired the companion's newer board stayed unused until a /reload (no per-dungeon breakdown).
let session: LuaSession | undefined;
afterEach(() => session?.close());

describe("scores and the companion's board after a guild switch", () => {
  it("reads a two-word name as one name", () => {
    session = newLuaSession();
    session.run(`NS = {}; GuildedDB = nil`);
    session.load("Core.lua");
    session.load("Modules/Scores.lua");
    session.load("Modules/SeasonDetails.lua");
    session.run(`fire_event("PLAYER_LOGIN")
      SEEN = nil
      NS.scores.detailText = function(name) SEEN = name; return "ok" end
      NS.message = function() end
      NS.commandHandlers["score"]({ "Lebowski", "Holyroller" })`);
    expect(session.run("return SEEN")).toBe("Lebowski Holyroller");
  });

  it("gives your own score for your current level's bracket", () => {
    session = newLuaSession();
    session.run(`NS = {}; GuildedDB = nil`);
    session.load("Core.lua");
    session.load("Modules/Scores.lua");
    session.load("Modules/SeasonDetails.lua");
    session.run(`fire_event("PLAYER_LOGIN")
      local me = NS.playerName()
      NS.scores.isMember = function() return true end
      NS.getDb().dungeonBoard = { season = "S1", status = "ACTIVE", updatedAt = "x", detailsAvailable = true, ratingVersion = 6,
        brackets = { { key = "15-29", min = 15, max = 29, bestCount = 5 }, { key = "30-44", min = 30, max = 44, bestCount = 5 } },
        profiles = {
          { name = me, points = 734, bracket = "15-29", details = { { dungeonKey = "43", name = "Wailing Caverns", points = 734, speedBonus = 0, durationSec = 60 } } },
          { name = me, points = 372, bracket = "30-44", details = { { dungeonKey = "47", name = "Razorfen Kraul", points = 372, speedBonus = 0, durationSec = 60 } } } } }
      UnitLevel = function() return 35 end
      OUT = {}
      NS.message = function(text) OUT[#OUT + 1] = text end
      NS.commandHandlers["score"]({})`);
    expect(session.run("return OUT[1]")).toContain("372");
    expect(session.run("return OUT[2]")).toContain("Razorfen Kraul");
  });

  it("takes the companion's newer board again when the guild data is switched after login", () => {
    session = newLuaSession();
    session.run(`NS = {}; GuildedDB = nil`);
    session.load("Core.lua");
    session.load("Compat.lua");
    session.load("Modules/SeasonSync.lua");
    session.run(`fire_event("PLAYER_LOGIN")
      NS.getDb().dungeonBoard = { season = "S1", status = "ACTIVE", updatedAt = "2026-11-21T00:53:21Z", rows = {} }
      GuildedDungeonBoard = { season = "S1", status = "ACTIVE", updatedAt = "2026-11-21T11:49:56Z", rows = {}, detailsAvailable = true }
      FILE = GuildedDungeonBoard
      -- What a repair does: the loaded data is replaced by the guild's home data, which carries an older board.
      NS.getDb().dungeonBoard = { season = "S1", status = "ACTIVE", updatedAt = "2026-11-21T00:53:21Z", rows = {} }
      NS.onGuildDataSwitched("repaired")`);
    expect(session.run("return NS.getDb().dungeonBoard.updatedAt")).toBe("2026-11-21T11:49:56Z");
    expect(session.run("return tostring(NS.getDb().dungeonBoard.detailsAvailable)")).toBe("true");
  });
});
