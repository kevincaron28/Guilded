import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession;
afterEach(() => session?.close());

function activeRun() {
  session = newLuaSession();
  session.run("NS = {}; GuildedDB = nil");
  session.load("Core.lua");
  session.load("Compat.lua");
  session.run(`BLOCKED_REGISTRATIONS = 0
    local originalCreateFrame = CreateFrame
    CreateFrame = function(...)
      local frame = originalCreateFrame(...)
      frame.RegisterEvent = function(_, event)
        if event == "COMBAT_LOG_EVENT_UNFILTERED" or event == "COMBAT_LOG_EVENT" then
          -- Blizzard emits a forbidden action even if pcall catches an error.
          BLOCKED_REGISTRATIONS = BLOCKED_REGISTRATIONS + 1
          error("restricted combat-log event")
        end
      end
      return frame
    end`);
  session.load("Modules/Dungeon.lua");
  session.run(`fire_event("PLAYER_LOGIN")
    STAMP = 1800000000
    NS.compat.serverTime = function() return STAMP end
    INSTANCE = {id=3065, type="party", name="Hall of Thanes", difficultyId=1}
    NS.compat.instance = function() return INSTANCE end
    fire_event("PLAYER_ENTERING_WORLD")
    fire_event("PLAYER_REGEN_DISABLED")
    RUN_ID = GuildedDB.dungeon.current.id
    STAMP = STAMP + 600`);
  return session;
}

describe("dungeon final-boss completion without the Encounter Journal", () => {
  it.each(["ENCOUNTER_END", "BOSS_KILL"])("finishes Hall of Thanes on %s", (event) => {
    const s = activeRun();
    s.run(`fire_event("${event}", 3496, "Durgen Dirgehammer", 1, 5, 1)`);
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].durationSec")).toBe("600");
    expect(s.run("return tostring(GuildedDB.dungeon.current)")).toBe("nil");
  });

  it("loads without probing restricted events and finishes a localized encounter only once", () => {
    const s = activeRun();
    expect(s.run("return BLOCKED_REGISTRATIONS")).toBe("0");
    s.run(`fire_event("ENCOUNTER_END", 3496, "Localized boss", 1, 5, 1)
      fire_event("BOSS_KILL", 3496, "Localized boss")`);
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
    expect(s.run("return #GuildedDB.dungeon.runs[RUN_ID].encounters")).toBe("1");
    expect(s.run("return NS.dungeon.serialize(GuildedDB.dungeon.runs[RUN_ID])")).not.toContain("enc=nil");
  });

  it("ignores wipes, other bosses, and kills outside the tracked instance", () => {
    const s = activeRun();
    s.run(`fire_event("ENCOUNTER_END", 3496, "Durgen Dirgehammer", 1, 5, 0)
      fire_event("BOSS_KILL", 3493, "Faldrim Anvilmar")
      INSTANCE = {id=33, type="party"}
      fire_event("BOSS_KILL", 3496, "Durgen Dirgehammer")
      fire_event("ENCOUNTER_END", 3496, "Durgen Dirgehammer", 1, 5, 1)`);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
  });

  it("keeps journal-based completion for other dungeons", () => {
    const s = activeRun();
    s.run(`INSTANCE.id = 33
      GuildedDB.dungeon.current.instanceId = 33
      GuildedDB.dungeon.current.finalEncounterId = 99
      fire_event("ENCOUNTER_END", 98, "Earlier boss", 1, 5, 1)`);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
    s.run('fire_event("ENCOUNTER_END", 99, "Last boss", 1, 5, 1)');
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
  });

  it("does not start another run in the cleared dungeon, but tracks a return after leaving", () => {
    const s = activeRun();
    s.run(`fire_event("BOSS_KILL", 3496, "Durgen Dirgehammer")
      fire_event("ZONE_CHANGED_NEW_AREA")
      fire_event("PLAYER_ENTERING_WORLD")`);
    expect(s.run("return tostring(GuildedDB.dungeon.current)")).toBe("nil");
    s.run(`INSTANCE = nil
      fire_event("ZONE_CHANGED_NEW_AREA")
      INSTANCE = {id=3065, type="party", name="Hall of Thanes", difficultyId=1}
      fire_event("ZONE_CHANGED_NEW_AREA")`);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("STARTING");
  });
});
