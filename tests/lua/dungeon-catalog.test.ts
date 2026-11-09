import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let s: LuaSession;
afterEach(() => s?.close());

describe("source-reviewed endpoint detection", () => {
  it.each([120105,16001])("never registers the combat log on interface %i", api => {
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
  it("ships WoW Forever endpoints only", () => {
    s = newLuaSession(); s.run('NS={}; GetBuildInfo=function() return "1.60.1","123","date",16001 end');
    s.load("Core.lua"); s.load("DungeonRoutes.lua");
    expect(s.run('local other=0; for _,r in ipairs(NS.dungeonRoutes.sourced) do if r.edition~="forever" then other=other+1 end end; return other')).toBe("0");
    // A former Classic endpoint (TBC Mana-Tombs, instance 554) no longer completes a run.
    s.load("Compat.lua");
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(554,1931,"",2))')).toBe("false");
  });
});
