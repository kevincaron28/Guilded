import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { readFileSync } from "node:fs";

// Data-loss audit (19 Nov 2026), addon side: #1 milestone log, #4 peer-copy merge, #11 recipe relay limit, #12 READINESS digest.
let sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions = []; });
const source = (file: string) => readFileSync(new URL(`../../addon/Guilded/${file}`, import.meta.url), "utf8");

describe("#1 achievements never evict real milestones", () => {
  it("keeps level milestones next to 700 achievements, and caps each group on its own", () => {
    const s = newLuaSession(); sessions.push(s);
    s.run(`DB = { roster = {} }; CLOCK = 1800000000
      function GetServerTime() return CLOCK end
      function GetLocale() return "enUS" end
      function UnitName() return "Kev" end; function GetRealmName() return "Realm" end
      function UnitLevel() return 5 end; function InCombatLockdown() return false end
      function GetMaxPlayerLevel() return 60 end; function IsInGuild() return true end
      NS = { getDb = function() return DB end, util = {}, commandHandlers = {}, commandHelp = {}, message = function() end,
        isSecret = function() return false end, isGuildMember = function() return true end, isOfficerName = function() return false end, isOfficer = function() return false end }`);
    s.load("Locale.lua"); s.load("Modules/Milestones.lua");
    s.run(`NS.util.gameEdition = function() return "forever" end; NS.milestones.baseline()`);
    s.run(`for i = 1, 5 do NS.milestones.reach("level:" .. i, "level:" .. i, { kind = "level", value = i }, true) end
      for i = 1, 700 do NS.milestones.reach("ach:" .. i, "ach:" .. i, { kind = "ach", value = 1, label = "A" .. i, at = CLOCK }, true) end`);
    expect(s.run(`local n, a = 0, 0; for _, r in ipairs(NS.milestones.state().log) do if r.kind == "ach" then a = a + 1 else n = n + 1 end end; return n .. "," .. a`)).toBe("5,700");
    s.run(`for i = 6, 600 do NS.milestones.reach("level:" .. i, "level:" .. i, { kind = "level", value = i }, true) end`);
    expect(s.run(`local n, a = 0, 0; for _, r in ipairs(NS.milestones.state().log) do if r.kind == "ach" then a = a + 1 else n = n + 1 end end; return n .. "," .. a`)).toBe("500,700");
  });
});

describe("#4/#12/#11 source guards", () => {
  it("storePeerRun fills guild, faction, class, role, inGuild and presentSec of an existing player", () => {
    const text = source("Modules/Dungeon.lua");
    expect(text).toMatch(/for _, field in ipairs\(\{ "guild", "faction", "class", "role", "inGuild" \}\)/);
    expect(text).toMatch(/player\.presentSec > mine\.presentSec/);
  });
  it("catch-up relays recipe lists up to 800", () => {
    expect(source("Modules/CatchUp.lua")).toMatch(/MAX_RECIPE_KEYS, MAX_RECIPE_PARTS = 800, \d+/);
  });
});

describe("#12 READINESS peers", () => {
  function core(): LuaSession {
    const s = newLuaSession(); sessions.push(s);
    s.run(`GuildedDB = nil; NS = {}; MOCK_UNITS = { player = { name = "Kev" } }`);
    s.load("Core.lua"); s.load("Compat.lua");
    s.run(`fire_event("PLAYER_LOGIN"); NS.isGuildMember = function() return true end`);
    return s;
  }
  it("a later digest without I: or V: keeps the stored identity and verify code", () => {
    const s = core();
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Amy|READY|0|100|I:MAGE,Human,60,Fire|Alchemy:300", "GUILD", "Amy-Realm")`);
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Amy|READY|0|100|Alchemy:300", "GUILD", "Amy-Realm")`);
    expect(s.run(`local p = GuildedDB.peerRoster["Amy"] or GuildedDB.peerRoster["Amy-Realm"]; return tostring(p and p.identity and p.identity.class)`)).toBe("MAGE");
  });
});
