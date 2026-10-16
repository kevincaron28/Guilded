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
  it.each(["ENCOUNTER_END", "BOSS_KILL"])("supports future verified wing endpoints on %s without shipping guessed mappings", event => {
    const s = activeRun();
    expect(s.run("return #NS.dungeonRoutes.verified")).toBe("0");
    s.run(`INSTANCE.id=90001; GuildedDB.dungeon.current.instanceId=90001
      NS.dungeonRoutes.verified={{instanceId=90001, participationBand={difficultyId=1},
        verification={build="SYNTHETIC",runRef="FIXTURE"}, completion={ids={9000},names={"Fictive endpoint","Boss final fictif"}}}}
      fire_event("ENCOUNTER_END",9000,"Fictive endpoint",1,5,0)`);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(90001,9000,"Fictive endpoint",2))')).toBe("false");
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(90002,9000,"Fictive endpoint",1))')).toBe("false");
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(90001,9999,"Boss final fictif",1))')).toBe("true");
    s.run(`fire_event("${event}",9000,"Localized endpoint",1,5,1)`);
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].completedBy")).toBe("final boss");
  });
  it("refuses conflicting wing endpoints and unverified configuration", () => {
    const s = activeRun();
    s.run(`local route={instanceId=90001,participationBand={difficultyId=1},completion={ids={9000},names={}}}
      NS.dungeonRoutes.verified={route}
      UNVERIFIED=NS.compat.isDungeonFinalBoss(90001,9000,"",1)
      route.verification={build="SYNTHETIC",runRef="FIXTURE"}
      NS.dungeonRoutes.verified={route,route}`);
    expect(s.run("return tostring(UNVERIFIED)")).toBe("false");
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(90001,9000,"",1))')).toBe("false");
  });
  it.each(["ENCOUNTER_END", "BOSS_KILL"])("finishes Deadmines on %s before the group disbands", (event) => {
    const s = activeRun();
    s.run(`INSTANCE.id=36; GuildedDB.dungeon.current.instanceId=36
      fire_event("ENCOUNTER_END", 2747, "Edwin VanCleef", 1, 5, 0)
      fire_event("BOSS_KILL", 2746, "Cookie")`);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
    // The owner observed encounter 2747 in map 36. Completion must also work
    // with a localized name, duplicate kill events, and the subsequent disband.
    s.run(`fire_event("${event}", 2747, "Localized final boss", 1, 5, 1)
      fire_event("BOSS_KILL", 2747, "Localized final boss")
      INSTANCE = nil
      fire_event("ZONE_CHANGED_NEW_AREA")
      NS.compat.inGroup = function() return false end
      fire_event("GROUP_ROSTER_UPDATE")`);
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].completedBy")).toBe("final boss");
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].durationSec")).toBe("600");
    expect(s.run("return #GuildedDB.dungeon.runs[RUN_ID].encounters")).toBe("3");
    expect(s.run("return tostring(GuildedDB.dungeon.current)")).toBe("nil");
  });

  it.each(["Bloodmage Thalnos", "Arcanist Doan", "Mage de sang Thalnos", "Arcaniste Doan"])("completes the Scarlet wing on %s without guessing encounter IDs", (boss) => {
    const s = activeRun();
    s.run(`INSTANCE.id=189; GuildedDB.dungeon.current.instanceId=189
      fire_event("BOSS_KILL",987,${JSON.stringify(boss)})`);
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].encounters[1].name")).toBe(boss);
  });
  it("times wipes and kills, deduplicates both kill events, and survives module reload", () => {
    const s = activeRun();
    s.run('fire_event("ENCOUNTER_START", 3493, "First boss"); STAMP = STAMP + 30; fire_event("ENCOUNTER_END", 3493, "First boss", 1, 5, 0)');
    s.run('STAMP = STAMP + 15; fire_event("ENCOUNTER_START", 3493, "First boss"); STAMP = STAMP + 45');
    // WoW restores current and activeEncounter from SavedVariables across /reload.
    s.run('FRAMES = {}'); s.load("Modules/Dungeon.lua");
    s.run('fire_event("BOSS_KILL", 3493, "First boss"); fire_event("ENCOUNTER_END", 3493, "First boss", 1, 5, 1)');
    expect(s.run('return #GuildedDB.dungeon.current.encounters')).toBe("2");
    expect(s.run('local e=GuildedDB.dungeon.current.encounters; return (e[1].at-e[1].startedAt)..","..(e[2].at-e[2].startedAt)')).toBe("30,45");
    s.run('STAMP=STAMP+20; fire_event("BOSS_KILL",3496,"Durgen Dirgehammer")');
    expect(s.run('return tostring(GuildedDB.dungeon.runs[RUN_ID].encounters[3].startedAt)')).toBe("nil");
    s.run('local r=GuildedDB.dungeon.runs[RUN_ID]; r.players.Tester={class="PRIEST",role="HEALER",spec="Discipline",minLevel=19,level=20}; ROUNDTRIP=NS.dungeon.deserialize(RUN_ID,NS.dungeon.serialize(r))');
    expect(s.run('return ROUNDTRIP.encounters[2].at-ROUNDTRIP.encounters[2].startedAt')).toBe("45");
    expect(s.run('return ROUNDTRIP.players.Tester.spec')).toBe("Discipline");
    expect(s.run('return ROUNDTRIP.players.Tester.minLevel..","..ROUNDTRIP.players.Tester.level')).toBe("19,20");
  });

  it("bounds peer summaries while keeping full saved encounters and accepts legacy summaries", () => {
    const s = activeRun();
    s.run(`local r=GuildedDB.dungeon.current
      for i=1,100 do r.encounters[i]={id=i,name=string.rep("x",100),success=true,at=STAMP+i} end
      SERIALIZED=NS.dungeon.serialize(r)
      LEGACY=NS.dungeon.deserialize("old","v=1;st=COMPLETED;i=3065;s=1800000000;e=1800001000;enc=3496;p=Tester:PRIEST:HEALER:0:1000:1")`);
    expect(Number(s.run('return #SERIALIZED'))).toBeLessThanOrEqual(4000);
    expect(s.run('return #GuildedDB.dungeon.current.encounters')).toBe("100");
    expect(s.run('return LEGACY.encounters[1].id')).toBe("3496");
  });
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
