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
