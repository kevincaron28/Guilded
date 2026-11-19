import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { readFileSync } from "node:fs";
import { tocFiles } from "../../scripts/build-dungeons-addon.mjs";

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

describe.each(["guilded", "standalone"] as const)("#4 peer copy merge (%s)", (kind) => {
  const CLOCK = 1_800_000_000;
  function client(name: string): LuaSession {
    const s = newLuaSession(); sessions.push(s);
    s.run(`NS = {}; GuildedDB = nil; GuildedDungeonsDB = nil; CLOCK = ${CLOCK}; GT = 0
      C_AddOns = { IsAddOnLoaded = function() return false end }
      function GetServerTime() return CLOCK end
      function GetTime() GT = GT + 1; return GT end
      function InCombatLockdown() return false end
      TIMERS = {}
      C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end, NewTicker = function() return {} end }
      function run_timers() for _ = 1, 20 do local list = TIMERS; TIMERS = {}; if #list == 0 then return end; for _, fn in ipairs(list) do fn() end end end
      UnitName = function() return "${name}" end`);
    if (kind === "guilded") for (const f of ["Core.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua"]) s.load(f);
    else for (const f of tocFiles()) s.run(`loadaddon("GuildedDungeons", [=====[${readFileSync(new URL(`../../addon/GuildedDungeons/${f}`, import.meta.url), "utf8")}]=====], NS)`);
    s.run(`fire_event("PLAYER_LOGIN"); NS.compat.serverTime = function() return CLOCK end; NS.playerName = function() return "${name}" end
      NS.isGuildMember = function() return true end; NS.isOfficerName = function() return false end
      fire_event("PLAYER_ENTERING_WORLD"); run_timers(); SENT = {}`);
    return s;
  }
  const run = (players: string) => `NS.getDb().dungeon.runs["r1"] = { id = "r1", state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 1,
    startedAt = CLOCK - 2000, endedAt = CLOCK - 1100, completedBy = "final boss", recorder = "Walter", encounters = {}, reporters = { Walter = true }, players = { ${players} } }`;
  it("fills missing fields from a second copy, keeps known values, takes the larger presentSec", () => {
    const walter = client("Walter"), leb = client("Lebowski");
    walter.run(run(`Walter = { class = "WARRIOR", role = "TANK", level = 20, deaths = 0, presentSec = 900, inGuild = true, guild = "Bowlers", faction = "ALLIANCE" },
      Donny = { class = "MAGE", role = "DAMAGER", level = 20, deaths = 0, presentSec = 900, inGuild = true, guild = "Bowlers", faction = "ALLIANCE" }`));
    leb.run(run(`Walter = { level = 20, deaths = 0, presentSec = 500 }, Donny = { level = 20, deaths = 0, presentSec = 1200, guild = "Old", faction = "HORDE" }`));
    walter.run("NS.dungeon.offerRuns(true); run_timers(); SENT = {}");
    walter.run(`fire_event("CHAT_MSG_ADDON", "GuildedDgn", "WNT|r1", "GUILD", "Lebowski-Realm")`);
    walter.run("run_timers()");
    const sent = walter.run(`local o = {}; for _, m in ipairs(SENT) do o[#o + 1] = m.prefix .. ">" .. m.text end; return table.concat(o, "~")`).split("~").filter((l) => l.startsWith("GuildedDgn>SUM"));
    expect(sent.length).toBeGreaterThan(0);
    for (const l of sent) leb.run(`fire_event("CHAT_MSG_ADDON", "GuildedDgn", ${JSON.stringify(l.slice("GuildedDgn>".length))}, "GUILD", "Walter-Realm")`);
    const f = (n: string, k: string) => leb.run(`return tostring(NS.getDb().dungeon.runs["r1"].players.${n}.${k})`);
    expect([f("Walter", "guild"), f("Walter", "faction"), f("Walter", "class"), f("Walter", "role"), f("Walter", "inGuild")]).toEqual(["Bowlers", "ALLIANCE", "WARRIOR", "TANK", "true"]);
    expect(f("Walter", "presentSec")).toBe("900");
    expect([f("Donny", "guild"), f("Donny", "faction")]).toEqual(["Old", "HORDE"]);
    expect(f("Donny", "presentSec")).toBe("1200");
  });
});
