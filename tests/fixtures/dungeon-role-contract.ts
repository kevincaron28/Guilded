import { readFileSync } from "node:fs";
import { newLuaSession } from "../lua/harness.js";
import { tocFiles } from "../../scripts/build-dungeons-addon.mjs";
import { personalPayloadFrom } from "../../companion/personal-runs-content.mjs";
import { dungeonRunSchema } from "../../src/services/dungeon-rules.js";

// Real shipped Lua under a mocked game API, then the real SavedVariables reader.
// Synthetic evidence only: this is not real-client acceptance.
export function dungeonRoleFixture(standalone = false, nativeRole = "DAMAGER", capture: { nativeApi?: boolean; reloadGap?: number; peerEarlier?: number; wipe?: boolean; peerRoundTrip?: boolean; peerEndFirst?: boolean } = {}) {
  const lua = newLuaSession();
  try {
    lua.run(`NS={}; GuildedDB=nil; GuildedDungeonsDB=nil
      MOCK_UNITS={player={name="Tester"}}; function UnitLevel() return ${capture.nativeApi ? 17 : 16} end
      ${capture.peerEarlier !== undefined ? 'MOCK_UNITS.party1={name="Peer"}' : ''}
      function UnitGroupRolesAssigned() return ${JSON.stringify(nativeRole)} end
      C_AddOns={IsAddOnLoaded=function() return false end}
      C_Timer.NewTicker=function(_,fn) DUNGEON_TICK=fn end`);
    if (standalone) for (const file of tocFiles()) {
      const source = readFileSync(new URL(`../../addon/GuildedDungeons/${file}`, import.meta.url), "utf8");
      lua.run(`loadaddon("GuildedDungeons", [=====[${source}]=====], NS)`);
    } else for (const file of ["Core.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua"]) lua.load(file);
    lua.run(`fire_event("PLAYER_LOGIN"); STAMP=1800000000
      function GetServerTime() return STAMP end
      ${capture.nativeApi ? 'function GetInstanceInfo() return "Deadmines", "party", 0, "Normal", 5, false, false, 36 end'
        : 'NS.compat.instance=function() return {id=389,type="party",name="Ragefire Chasm",difficultyId=0} end; NS.compat.isDungeonFinalBoss=function(_,id) return id==9000 end'}
      fire_event("PLAYER_ENTERING_WORLD"); fire_event("PLAYER_REGEN_DISABLED")
      if ${capture.peerEarlier ?? 0}>0 then
        local run=NS.getDb().dungeon.current
        fire_event("CHAT_MSG_ADDON","GuildedDgn","ACTIVE|"..run.id.."|"..(STAMP-${capture.peerEarlier ?? 0}),"PARTY","Peer")
      end
      for i=1,40 do
        if i==21 and ${capture.reloadGap ?? 0}>0 then STAMP=STAMP+${capture.reloadGap ?? 0}; fire_event("PLAYER_LOGIN") end
        STAMP=STAMP+30; DUNGEON_TICK()
        if i==10 and ${capture.wipe ? "true" : "false"} then fire_event("ENCOUNTER_START",2747,"Edwin VanCleef",0,1); fire_event("ENCOUNTER_END",2747,"Edwin VanCleef",0,1,0) end
      end
      if ${capture.peerEndFirst ? "true" : "false"} then
        function UnitIsGroupLeader(unit) return unit=="party1" end
        local run=NS.getDb().dungeon.current
        fire_event("CHAT_MSG_ADDON","GuildedDgn","END|"..run.id.."|COMPLETED|"..STAMP.."|final boss","PARTY","Peer")
      end
      fire_event("ENCOUNTER_END",${capture.nativeApi ? '2747,"Edwin VanCleef",1,1,1' : '9000,"Bazzalan",0,1,1'})
      if ${capture.peerRoundTrip ? "true" : "false"} then
        for id,run in pairs(NS.getDb().dungeon.runs) do NS.getDb().dungeon.runs[id]=NS.dungeon.deserialize(id,NS.dungeon.serialize(run)) end
      end
      function SERIALIZE(v)
        if type(v)=="table" then local t={}; for k,x in pairs(v) do t[#t+1]="["..SERIALIZE(k).."]="..SERIALIZE(x) end; return "{"..table.concat(t,",").."}" end
        if type(v)=="string" then return string.format("%q",v) end
        return tostring(v)
      end`);
    const database = standalone ? "GuildedDungeonsDB" : "GuildedDB";
    const saved = lua.run(`return "${database} = "..SERIALIZE(${database})`);
    const payload = personalPayloadFrom([saved]);
    const run = dungeonRunSchema.parse(payload.runs[0]);
    return { saved, payload, run };
  } finally { lua.close(); }
}
