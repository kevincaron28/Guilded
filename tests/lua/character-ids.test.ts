import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Character ids, stage B (docs/plans/CHARACTER_ID_MATCHING_2026-11-20.md): the addon stamps the low part of the GUID
// wherever it can. Ids are optional extra fields: nothing hashed, no protocol change.
let s: LuaSession | undefined;
afterEach(() => { s?.close(); s = undefined; });

function client() {
  s = newLuaSession();
  s.run(`NS = {}; GuildedDB = {}
    GetBuildInfo = function() return "test", "1", "date", 16001 end
    UnitName = function() return "Dude", "Lebowski" end
    GetUnitName = function() return "Dude Lebowski" end
    GetServerTime = function() return 1800000000 end`);
  s.load("Core.lua");
  s.run('fire_event("PLAYER_LOGIN")');
  return s;
}

describe("character ids in the addon", () => {
  it("turns a player GUID into the lowercase hex low part, and nothing else", () => {
    const lua = client();
    expect(lua.run('return tostring(NS.util.charId("Player-4395-01A2B3C4"))')).toBe("1a2b3c4");
    expect(lua.run('return tostring(NS.util.charId("Player-4395-0000000000FF"))')).toBe("ff");
    expect(lua.run('return tostring(NS.util.charId("Creature-0-4395-1-1-1234-00001"))')).toBe("nil");
    expect(lua.run('return tostring(NS.util.charId("Player-1-00000000"))')).toBe("nil");
    expect(lua.run('return tostring(NS.util.charId(42))')).toBe("nil");
    expect(lua.run('return tostring(NS.util.validId("01A2B3C4"))')).toBe("1a2b3c4");
    expect(lua.run('return tostring(NS.util.validId("not hex"))')).toBe("nil");
    expect(lua.run('return tostring(NS.util.validId(string.rep("a", 17)))')).toBe("nil");
  });

  it("reads the id of a unit and survives a missing or secret GUID", () => {
    const lua = client();
    lua.run('UnitGUID = function(unit) if unit == "player" then return "Player-1-00ABCDEF" end end');
    expect(lua.run('return tostring(NS.util.unitId("player"))')).toBe("abcdef");
    expect(lua.run('return tostring(NS.util.unitId("target"))')).toBe("nil");
    lua.run('issecretvalue = function(value) return value == "Player-1-00ABCDEF" end');
    expect(lua.run('return tostring(NS.util.unitId("player"))')).toBe("nil");
  });

  it("sameCharacter: equal ids are the same, different ids are different, a missing id falls back to the name rule", () => {
    const lua = client();
    const same = (args: string) => lua.run(`return tostring(NS.util.sameCharacter(${args}))`);
    expect(same('"Dude Lebowski", "Dude Lebowski", "1a", "2b"')).toBe("false");   // the same name, two characters
    expect(same('"Dude", "Walter Sobchak", "1a", "01A"')).toBe("true");           // whatever the names say
    expect(same('"Dude Lebowski", "Dude Lebowski", "1a", nil')).toBe("true");
    expect(same('"Dude Lebowski", "Dude Holyroller", "1a", nil')).toBe("false");
    expect(same('"Dude", "Dude Lebowski"')).toBe("true");                          // old name rule untouched
    expect(same('"Dude Lebowski", "Walter Sobchak"')).toBe("false");
  });

  it("findCharacterKey uses the roster's name for an id before any name scan", () => {
    const lua = client();
    lua.run(`NS.idToKey = { ["1a"] = "Dude Lebowski" }
      MAP = { ["Dude Lebowski"] = 1, ["Dude Holyroller"] = 2 }`);
    expect(lua.run('return tostring(NS.util.findCharacterKey(MAP, "Dude", "1a"))')).toBe("Dude Lebowski");
    expect(lua.run('return tostring(NS.util.findCharacterKey(MAP, "Dude"))')).toBe("nil");   // shared first name: no guess
  });

  it("the character capture carries the own id", () => {
    const lua = client();
    lua.run('UnitGUID = function(unit) if unit == "player" then return "Player-1-00ABCDEF" end end');
    lua.run('fire_event("PLAYER_ENTERING_WORLD")');
    lua.run("GuildedDB.character = nil");
    lua.run('SLASH = SlashCmdList["GUILDED"]; SLASH("character")');
    expect(lua.run("return GuildedDB.character.id")).toBe("abcdef");
  });
});

describe("guild roster ids", () => {
  it("stores each row's id, builds ns.idToKey / ns.keyToId once per refresh and drops an id seen on two rows", () => {
    s = newLuaSession();
    s.run(`CLOCK = 1800000000
      function GetServerTime() return CLOCK end
      ROSTER = {
        { "Dude Lebowski", "Member", 3, 12, "Warrior", "", "", "", false, 0, "WARRIOR", 0, 0, false, false, 0, "Player-1-00000A01" },
        { "Dude Holyroller", "Member", 3, 30, "Priest", "", "", "", false, 0, "PRIEST", 0, 0, false, false, 0, "Player-1-00000A02" },
        { "Walter Sobchak", "Officer", 1, 40, "Paladin", "", "", "", true, 0, "PALADIN", 0, 0, false, false, 0, "Player-1-00000B01" },
        { "Donny Kerabatsos", "Member", 3, 20, "Mage", "", "", "", false, 0, "MAGE", 0, 0, false, false, 0, "Player-1-00000B01" },
        { "Maude Lebowski", "Member", 3, 20, "Mage", "", "", "", false, 0, "MAGE" }
      }
      function GetNumGuildMembers() return #ROSTER, 1, 1 end
      function GetGuildRosterInfo(i) return unpack(ROSTER[i]) end
      DB = {}
      NS = { getDb = function() return DB end, isSecret = function() return false end,
        normalizeName = function(n) return n end }`);
    s.load("Modules/GuildSnapshot.lua");
    s.run("NS.guildSnapshot.read(true)");
    const value = (expr: string) => s!.run(`return tostring(${expr})`);
    expect(value("DB.guildSnapshot.members['Dude Lebowski'].id")).toBe("a01");
    expect(value("DB.guildSnapshot.members['Maude Lebowski'].id")).toBe("nil");
    expect(value("NS.idToKey['a01']")).toBe("Dude Lebowski");
    expect(value("NS.keyToId['Dude Holyroller']")).toBe("a02");
    expect(value("NS.keyToId['Maude Lebowski']")).toBe("nil");
    // b01 sits on two rows: neither maps to it.
    expect(value("NS.idToKey['b01']")).toBe("nil");
    expect(value("NS.keyToId['Walter Sobchak']")).toBe("nil");
    expect(value("NS.keyToId['Donny Kerabatsos']")).toBe("nil");
  });
});

describe("dungeon summary line", () => {
  function dungeon() {
    s = newLuaSession();
    s.run(`NS = {}; GuildedDB = nil; GetServerTime = function() return 1800000000 end
      GetBuildInfo = function() return "test", "1", "date", 16001 end
      UnitName = function() return "Dude", "Lebowski" end`);
    for (const file of ["Core.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua"]) s.load(file);
    s.run('fire_event("PLAYER_LOGIN")');
    return s;
  }
  const RUN = `{ id = "r1", state = "COMPLETED", instanceId = 389, name = "Ragefire Chasm", difficultyId = 1, addonVersion = "9", startedAt = 1799990000, endedAt = 1799991000,
    completedBy = "final boss", recorder = "Walter Sobchak", encounters = {}, reporters = {},
    players = { ["Walter Sobchak"] = { class = "WARRIOR", role = "TANK", level = 20, deaths = 0, presentSec = 900, inGuild = true, id = "a01" },
      ["Dude Lebowski"] = { class = "MAGE", role = "DAMAGER", level = 20, deaths = 0, presentSec = 900, inGuild = true, id = "a02" },
      ["Dude Holyroller"] = { class = "PRIEST", role = "HEALER", level = 20, deaths = 1, presentSec = 800, inGuild = false } } }`;

  it("adds the ids as one new pi= key, leaves every p= entry unchanged, and round-trips them", () => {
    const lua = dungeon();
    const text = lua.run(`return NS.dungeon.serialize(${RUN})`);
    expect(text).toMatch(/;pi=/);
    const p = text.match(/;p=([^;]*)/)![1]!;
    expect(p.split(",").every((entry) => entry.split(":").length === 6)).toBe(true);   // the exact 6-field shape older addons read
    const back = lua.run(`local r = NS.dungeon.deserialize("r1", NS.dungeon.serialize(${RUN}))
      return r.players["Walter Sobchak"].id .. "|" .. r.players["Dude Lebowski"].id .. "|" .. tostring(r.players["Dude Holyroller"].id)`);
    expect(back).toBe("a01|a02|nil");
  });

  it("an older reader ignores the unknown key: the same summary without pi= parses to the same players", () => {
    const lua = dungeon();
    const text = lua.run(`return NS.dungeon.serialize(${RUN})`);
    const old = text.replace(/;pi=[^;]*/, "");
    lua.run(`OLD = ${JSON.stringify(old)}`);
    expect(lua.run('local r = NS.dungeon.deserialize("r1", OLD); return r.players["Walter Sobchak"].class .. "|" .. tostring(r.players["Walter Sobchak"].id)')).toBe("WARRIOR|nil");
  });

  it("a run without any ids serializes exactly as before (no pi= key)", () => {
    const lua = dungeon();
    const text = lua.run(`local r = ${RUN}; for _, p in pairs(r.players) do p.id = nil end; return NS.dungeon.serialize(r)`);
    expect(text).not.toMatch(/;pi=/);
  });

  it("ignores a malformed id in a received line", () => {
    const lua = dungeon();
    const text = lua.run(`return NS.dungeon.serialize(${RUN})`).replace(/;pi=[^;]*/, ";pi=Walter Sobchak:zz9,Dude Lebowski:" + "f".repeat(20));
    lua.run(`BAD = ${JSON.stringify(text)}`);
    expect(lua.run('local r = NS.dungeon.deserialize("r1", BAD); return tostring(r.players["Walter Sobchak"].id) .. "|" .. tostring(r.players["Dude Lebowski"].id)')).toBe("nil|nil");
  });
});
