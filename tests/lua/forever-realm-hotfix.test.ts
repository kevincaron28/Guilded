import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// WoW Forever 1.60.1 hotfix (20 Nov 2026): realm names and ids are hidden ("" or 0) and the realm in creature GUIDs is
// obfuscated. Nothing may switch, park or reset because only the realm part disappeared (docs/FOREVER_REALM_HOTFIX_2026-11.md).
let s: LuaSession | undefined;
afterEach(() => { s?.close(); s = undefined; });

const HOME = "CAMWOWUS2Realm2PvP";

function start(saved: string, guild = "Alpha") {
  s = newLuaSession();
  s.run(`GuildedDB = ${saved}; NS = {}; MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    NOW = 1800000000; GetServerTime = function() return NOW end; GUILDED_TEST_HOME_WAIT = 20
    CLOCK_TICKS = 0; function GetTime() CLOCK_TICKS = CLOCK_TICKS + 10; return CLOCK_TICKS end
    function GetBuildInfo() return "1.60.1", "70790", "Nov 1 2026", 16001 end
    function GetRealmName() return "" end
    function GetNormalizedRealmName() return "" end
    function GetGuildInfo() return ${JSON.stringify(guild)}, "Officer", 1, "" end`);
  s.load("Core.lua"); s.load("Compat.lua");
  s.run(`fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD"); fire_event("GUILD_ROSTER_UPDATE")`);
  return s;
}

describe("Forever 1.60.1: guild key without a realm", () => {
  it("keeps the stored key and data when the realm goes blank", () => {
    const lua = start(`{ version = 4, guildKey = "Alpha-${HOME}", guildEdition = "forever", roster = { Bob = {} }, epgp = { Bob = { ep = 9, gp = 0, ledger = {} } }, settings = { officers = {} } }`);
    expect(lua.run("return GuildedDB.guildKey")).toBe("Alpha-" + HOME);
    expect(lua.run("return tostring(GuildedDB.roster.Bob ~= nil)")).toBe("true");
    expect(lua.run("return GuildedDB.epgp.Bob.ep")).toBe("9");
    expect(lua.run("return tostring(next(GuildedDB.otherGuilds or {}))")).toBe("nil");
    expect(lua.run("return NS.currentGuildKey()")).toBe("Alpha-" + HOME);
    lua.run(`fire_event("GUILD_ROSTER_UPDATE")`);
    expect(lua.run("return GuildedDB.guildKey")).toBe("Alpha-" + HOME);
  });

  it("also keeps it when the realm functions return 0 or nil", () => {
    const lua = start(`{ version = 4, guildKey = "Alpha-${HOME}", guildEdition = "forever", roster = { Bob = {} }, settings = { officers = {} } }`);
    lua.run(`GetRealmName = function() return nil end; GetNormalizedRealmName = function() return 0 end; GetGuildInfo = function() return "Alpha", "Officer", 1, nil end`);
    lua.run(`fire_event("GUILD_ROSTER_UPDATE")`);
    expect(lua.run("return GuildedDB.guildKey")).toBe("Alpha-" + HOME);
    expect(lua.run("return tostring(next(GuildedDB.otherGuilds or {}))")).toBe("nil");
  });

  it("uses a stable 'Guild-' key on a first install and keeps it", () => {
    const lua = start("nil");
    expect(lua.run("return GuildedDB.guildKey")).toBe("Alpha-");
    lua.run(`NOW = NOW + 30; fire_event("GUILD_ROSTER_UPDATE")`);
    expect(lua.run("return GuildedDB.guildKey")).toBe("Alpha-");
  });

  it("still switches to another guild, and restores a parked key of the same guild name", () => {
    const lua = start(`{ version = 4, guildKey = "Beta-${HOME}", guildEdition = "forever", roster = { Cy = {} }, settings = { officers = {} },
      otherGuilds = { ["Alpha-${HOME}"] = { roster = { Bob = {} }, settings = { officers = {} } } } }`);
    // Alpha's data was parked under its old key: the same guild again, the realm part is only missing.
    expect(lua.run("return GuildedDB.guildKey")).toBe("Alpha-" + HOME);
    expect(lua.run("return tostring(GuildedDB.roster.Bob ~= nil)")).toBe("true");
    expect(lua.run(`return tostring(GuildedDB.otherGuilds["Beta-${HOME}"].roster.Cy ~= nil)`)).toBe("true");
  });

  it("switches to a brand-new guild with a stable key and parks the old one", () => {
    const lua = start(`{ version = 4, guildKey = "Beta-${HOME}", guildEdition = "forever", roster = { Cy = {} }, settings = { officers = {} } }`);
    expect(lua.run("return GuildedDB.guildKey")).toBe("Alpha-");
    expect(lua.run(`return tostring(GuildedDB.otherGuilds["Beta-${HOME}"].roster.Cy ~= nil)`)).toBe("true");
  });

  it("an alt that only ever saw a no-realm key keeps it", () => {
    const lua = start(`{ version = 4, guildKey = "Alpha-", guildEdition = "forever", roster = { Bob = {} }, settings = { officers = {} } }`);
    expect(lua.run("return GuildedDB.guildKey")).toBe("Alpha-");
    expect(lua.run("return tostring(next(GuildedDB.otherGuilds or {}))")).toBe("nil");
  });
});

describe("Forever 1.60.1: GUIDs", () => {
  it("reads the creature id from obfuscated creature and vehicle GUIDs", () => {
    s = newLuaSession();
    s.run(`NS = { util = {}, getDb = function() return {} end, commandHandlers = {}, commandHelp = {}, message = function() end, isSecret = function() return false end }`);
    s.load("Locale.lua");
    s.load("Modules/SecretAchievements.lua");
    const id = (guid: string) => s!.run(`return tostring(NS.secretAchievements.npcId(${JSON.stringify(guid)}))`);
    expect(id("Creature-0-3-0-0-2529-0000A1B2C3")).toBe("2529");
    expect(id("Creature-0-x9f2-0b7c-1e44-2529-AB12CD34EF")).toBe("2529");
    expect(id("Vehicle-0-0-0-0-0-2529-0000FFFF")).toBe("2529");
    expect(id("Creature-0-ffff-ffff-ffff-2529-ffffffffff")).toBe("2529");
    expect(id("Creature-0-3-0-0-notanumber-0000A1B2C3")).toBe("nil");
    expect(id("Creature-0-3-0")).toBe("nil");
    expect(id("Player-3676-0A1B2C3D")).toBe("nil");
  });

  it("keeps the character id from Player GUIDs whatever the realm part is", () => {
    start("nil");
    const id = (guid: string) => s!.run(`return tostring(NS.util.charId(${JSON.stringify(guid)}))`);
    expect(id("Player-4395-01A2B3C4")).toBe("1a2b3c4");
    expect(id("Player-0-01A2B3C4")).toBe("1a2b3c4");
    expect(id("Player--01A2B3C4")).toBe("1a2b3c4");
    expect(id("Player-xyz-01A2B3C4")).toBe("1a2b3c4");
    expect(id("Creature-0-4395-1-1-1234-00001")).toBe("nil");
  });
});

describe("Forever 1.60.1: other realm users", () => {
  it("the milestone record keeps its old key when the realm goes blank", () => {
    s = newLuaSession();
    s.run(`DB = { roster = {}, milestones = { chars = { ["Kev-CAMWOW US2 Realm 2 PvP"] = { name = "Kev", realm = "CAMWOW US2 Realm 2 PvP", done = { ["gold:1"] = true }, log = {}, settings = {} } } } }
      CLOCK = 1800000000; CHAT_OUT = {}; MONEY = 0; TIMERS = {}
      function GetServerTime() return CLOCK end; function GetLocale() return "enUS" end
      function UnitName() return "Kev" end; function GetRealmName() return "" end
      function UnitLevel() return 5 end; function GetMoney() return MONEY end
      function InCombatLockdown() return false end; function GetMaxPlayerLevel() return 60 end; function IsInGuild() return true end
      function SendChatMessage() end
      C_Timer = { After = function(delay, fn) TIMERS[#TIMERS + 1] = { delay = delay, fn = fn } end }
      NS = { getDb = function() return DB end, util = {}, commandHandlers = {}, commandHelp = {}, message = function() end,
        isSecret = function() return false end, isGuildMember = function() return true end, isOfficerName = function() return false end, isOfficer = function() return false end }`);
    s.load("Locale.lua");
    s.load("Modules/Milestones.lua");
    s.run(`NS.milestones.enabled("level")`);
    expect(s.run(`local n = 0; for _ in pairs(DB.milestones.chars) do n = n + 1 end; return n`)).toBe("1");
    expect(s.run(`return tostring(DB.milestones.chars["Kev-CAMWOW US2 Realm 2 PvP"].done["gold:1"])`)).toBe("true");
  });
});
