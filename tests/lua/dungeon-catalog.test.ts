import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let s: LuaSession;
afterEach(() => s?.close());

describe("source-reviewed endpoint detection", () => {
  it.each([120105,16001])("never registers the Classic combat log on restricted interface %i", api => {
    s=newLuaSession();s.run(`NS={}; GetBuildInfo=function() return "version","123","date",${api} end`);
    s.load("Core.lua");s.load("DungeonRoutes.lua");s.load("Compat.lua");
    s.run(`BLOCKED=0;local original=CreateFrame;CreateFrame=function(...)
      local frame=original(...);local register=frame.RegisterEvent
      frame.RegisterEvent=function(self,event)
        if event=="COMBAT_LOG_EVENT_UNFILTERED" then BLOCKED=BLOCKED+1;error("restricted") end
        return register(self,event)
      end;return frame end`);
    s.load("Modules/Dungeon.lua");
    expect(s.run('return BLOCKED')).toBe("0");
  });
  it("captures Classic NPC deaths, preserves their namespace through peers and ignores wrong instances", () => {
    s = newLuaSession();
    s.run('NS={}; GetBuildInfo=function() return "1.15.8","123","date",11508 end');
    s.load("Core.lua"); s.load("DungeonRoutes.lua"); s.load("Compat.lua");
    s.run(`STAMP=1800000000; NS.compat.serverTime=function() return STAMP end
      INSTANCE={id=33,type="party",name="Shadowfang Keep",difficultyId=1}; NS.compat.instance=function() return INSTANCE end
      CombatLogGetCurrentEventInfo=function() return STAMP,"UNIT_DIED",false,nil,nil,nil,nil,GUID,"Nom localisé" end`);
    s.load("Modules/Dungeon.lua");
    s.run(`fire_event("PLAYER_LOGIN");fire_event("PLAYER_ENTERING_WORLD");fire_event("PLAYER_REGEN_DISABLED")
      RUN_ID=GuildedDB.dungeon.current.id;STAMP=STAMP+600
      GUID="Creature-0-1-33-1-4275-00001";INSTANCE.id=34;fire_event("COMBAT_LOG_EVENT_UNFILTERED")`);
    expect(s.run('return GuildedDB.dungeon.current.state')).toBe("ACTIVE");
    s.run(`INSTANCE.id=33;fire_event("COMBAT_LOG_EVENT_UNFILTERED")
      SAVED=GuildedDB.dungeon.runs[RUN_ID];PEER=NS.dungeon.deserialize(RUN_ID,NS.dungeon.serialize(SAVED))`);
    expect(s.run('return SAVED.completedBy')).toBe("final boss");
    expect(s.run('return PEER.encounters[1].kind..":"..PEER.encounters[1].id')).toBe("npc:4275");
  });
  it("keeps source endpoints edition and difficulty specific", () => {
    s = newLuaSession(); s.run('NS={}; GetBuildInfo=function() return "2.5.6","123","date",20506 end');
    s.load("Core.lua"); s.load("DungeonRoutes.lua"); s.load("Compat.lua");
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(554,1931,"",2))')).toBe("true");
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(554,1931,"",8))')).toBe("false");
    s.run('GetBuildInfo=function() return "1.60.1","123","date",16001 end');
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(554,1931,"",2))')).toBe("false");
  });
  it("recognizes dual NPC/encounter notifications as one boss", () => {
    s = newLuaSession(); s.run('NS={}; GetBuildInfo=function() return "1.15.8","123","date",11508 end');
    s.load("Core.lua"); s.load("DungeonRoutes.lua");
    expect(s.run('return tostring(NS.dungeonRoutes.sameBoss(43,1,{id=3654,kind="npc"},592,nil))')).toBe("true");
    expect(s.run('return tostring(NS.dungeonRoutes.sameBoss(43,1,{id=592,kind="npc"},592,nil))')).toBe("false");
  });
});
