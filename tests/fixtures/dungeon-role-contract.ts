import { readFileSync } from "node:fs";
import { newLuaSession } from "../lua/harness.js";
import { tocFiles } from "../../scripts/build-dungeons-addon.mjs";
import { personalPayloadFrom } from "../../companion/personal-runs-content.mjs";
import { dungeonRunSchema } from "../../src/services/dungeon-rules.js";

// Real shipped Lua under a mocked game API, then the real SavedVariables reader.
// Synthetic evidence only: this is not real-client acceptance.
export function dungeonRoleFixture(standalone = false, nativeRole = "DAMAGER") {
  const lua = newLuaSession();
  try {
    lua.run(`NS={}; GuildedDB=nil; GuildedDungeonsDB=nil
      MOCK_UNITS={player={name="Tester"}}; function UnitLevel() return 16 end
      function UnitGroupRolesAssigned() return ${JSON.stringify(nativeRole)} end
      C_AddOns={IsAddOnLoaded=function() return false end}
      C_Timer.NewTicker=function(_,fn) DUNGEON_TICK=fn end`);
    if (standalone) for (const file of tocFiles()) {
      const source = readFileSync(new URL(`../../addon/GuildedDungeons/${file}`, import.meta.url), "utf8");
      lua.run(`loadaddon("GuildedDungeons", [=====[${source}]=====], NS)`);
    } else for (const file of ["Core.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua"]) lua.load(file);
    lua.run(`fire_event("PLAYER_LOGIN"); STAMP=1800000000
      NS.compat.serverTime=function() return STAMP end
      NS.compat.instance=function() return {id=389,type="party",name="Ragefire Chasm",difficultyId=0} end
      NS.compat.isDungeonFinalBoss=function(_,id) return id==9000 end
      fire_event("PLAYER_ENTERING_WORLD"); fire_event("PLAYER_REGEN_DISABLED")
      for i=1,40 do STAMP=STAMP+30; DUNGEON_TICK() end
      fire_event("ENCOUNTER_END",9000,"Bazzalan",0,1,1)
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
