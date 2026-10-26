import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Loads the real Modules/Consumables.lua against a mocked game.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function withModule(): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    NS = {
      isSecret = function() return false end,
      now = function() return "2026-10-01T20:00:00Z" end,
      playerName = function() return "Kev" end,
      isOfficer = function() return true end,
      getActiveRaid = function() return nil end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      commandHandlers = {}, commandHelp = {},
      getDb = function() return DB end
    }
    DB = {}
  `);
  session.load("Modules/Consumables.lua");
  return session;
}

describe("Consumables.lua (real file, mocked game)", () => {
  it("classifies buff names by category", () => {
    const s = withModule();
    expect(s.run(`return NS.consumables.classify("Flask of the Titans")`)).toBe("flask");
    expect(s.run(`return NS.consumables.classify("Elixir of the Mongoose")`)).toBe("elixir");
    expect(s.run(`return NS.consumables.classify("Well Fed")`)).toBe("food");
    expect(s.run(`return tostring(NS.consumables.classify("Blessing of Kings"))`)).toBe("nil");
  });

  it("reads your own active consumables", () => {
    const s = withModule();
    s.run(`MOCK_UNITS = { player = { name = "Kev", buffs = { "Flask of Supreme Power", "Well Fed", "Blessing of Kings" } } }`);
    expect(s.run(`local r = NS.consumables.scanUnit("player"); return tostring(r.flask) .. "|" .. tostring(r.food) .. "|" .. tostring(r.readable)`))
      .toBe("Flask of Supreme Power|Well Fed|true");
  });

  it("/guilded consumes lists who lacks a flask or food in the group", () => {
    const s = withModule();
    s.run(`
      MOCK_RAID = false
      MOCK_UNITS = {
        player = { name = "Kev", buffs = { "Flask of Supreme Power", "Well Fed" } },
        party1 = { name = "Amy", buffs = { "Elixir of the Mongoose" } },
        party2 = { name = "Bob", buffs = { "Well Fed" } },
        party3 = { name = "Cy", buffs = { "Blessing of Kings" } }
      }
      NS.commandHandlers["consumes"]({})
    `);
    const chat = s.chat().join("\n");
    expect(chat).toContain("4 player(s) checked");
    expect(chat).toContain("No flask or elixir: Bob, Cy");
    expect(chat).toContain("No food buff: Amy, Cy");
    // The scan is saved for the export.
    expect(s.run(`return tostring(#DB.consumeScan.players)`)).toBe("4");
  });

  it("only officers can scan the group", () => {
    const s = withModule();
    s.run(`NS.isOfficer = function() return false end; MOCK_UNITS = { player = { name = "Kev", buffs = {} } }; NS.commandHandlers["consumes"]({})`);
    expect(s.chat().join("\n")).toContain("Only officers can scan the group");
  });

  it("builds snapshot rows for your own buffs", () => {
    const s = withModule();
    s.run(`MOCK_UNITS = { player = { name = "Kev", buffs = { "Flask of the Titans", "Well Fed" } } }`);
    expect(s.run(`local rows = NS.consumables.ownRows(); return #rows .. ":" .. rows[1].category .. ":" .. rows[2].category`)).toBe("2:FLASK:FOOD");
  });
});

describe("Consumables.lua: reading buffs by id, and never blaming a hidden buff", () => {
  // Loads the data file too; auras carry ids and icons the way the modern client gives them.
  function withData(): LuaSession {
    const s = withModule();
    s.load("Modules/ConsumableData.lua");
    s.run(String.raw`
      NS.util.gameEdition = function() return "retail" end
      AURAS = {}
      MOCK_UNITS = { player = { name = "Kev" } }
      GetTime = function() return 1000 end
      C_UnitAuras = { GetAuraDataByIndex = function(unit, index) return AURAS[unit] and AURAS[unit][index] end }
    `);
    return s;
  }
  const scan = (s: LuaSession, unit = "player") => s.run(String.raw`
    local r = NS.consumables.scanUnit("${unit}")
    return table.concat({ tostring(r.flask), tostring(r.food), tostring(r.augment), tostring(r.vantus), tostring(r.readable), tostring(r.complete), tostring(r.flaskLeft) }, "|")`);

  it("knows a flask, food, augment and vantus rune whatever language the buff is named in", () => {
    const s = withData();
    s.run(String.raw`AURAS.player = {
      { name = "Flacon des Chevaliers de sang", spellId = 1235110, expirationTime = 1300 },
      { name = "Bien nourri", icon = 136000, spellId = 1 },
      { name = "Rune d'augmentation", spellId = 1264426 },
      { name = "Rune de Vantus", spellId = 1276687 }
    }`);
    expect(scan(s)).toBe("Flacon des Chevaliers de sang|Bien nourri|true|true|true|true|300");
  });

  it("counts eating as food and reads the raid buffs a player has", () => {
    const s = withData();
    s.run(String.raw`AURAS.player = { { name = "Manger", icon = 133950 }, { name = "Mot de pouvoir : Robustesse", spellId = 21562 }, { name = "Cri de guerre", spellId = 6673 } }`);
    expect(s.run(String.raw`local f = NS.consumables.factsFromScan(NS.consumables.scanUnit("player")); local keys = {}; for k in pairs(f.buffs) do keys[#keys + 1] = k end; table.sort(keys); return tostring(f.food) .. "|" .. table.concat(keys, ",")`)).toBe("true|ap,sta");
  });

  it("falls back to the name only when a buff has no id or icon", () => {
    const s = withData();
    s.run(String.raw`AURAS.player = { { name = "Flask of Something New" } }`);
    expect(s.run(String.raw`return tostring(NS.consumables.scanUnit("player").flask)`)).toBe("Flask of Something New");
  });

  it("a buff list that is partly hidden proves what is there, never what is missing", () => {
    const s = withData();
    // The second buff cannot be read at all (no id, no name).
    s.run(String.raw`AURAS.player = { { name = "Flask of the Titans" }, {} }`);
    expect(s.run(String.raw`local f = NS.consumables.factsFromScan(NS.consumables.scanUnit("player")); return tostring(f.flask) .. "|" .. tostring(f.food) .. "|" .. tostring(f.buffs)`)).toBe("true|nil|nil");
  });

  it("a whole list the game hides, an offline, far away or phased player is unknown, not empty", () => {
    const s = withData();
    s.run(String.raw`MOCK_UNITS.party1 = { name = "Amy" }; AURAS.party1 = { { name = "Well Fed" } }`);
    expect(s.run(`return tostring(NS.consumables.scanUnit("party1").readable)`)).toBe("true");
    s.run(`C_Secrets = { ShouldAurasBeSecret = function() return true end }`);
    expect(s.run(`return tostring(NS.consumables.scanUnit("party1").readable)`)).toBe("false");
    // Your own buffs are still yours to read.
    s.run(String.raw`AURAS.player = { { name = "Well Fed" } }`);
    expect(s.run(`return tostring(NS.consumables.scanUnit("player").readable)`)).toBe("true");
    s.run(`C_Secrets = nil; UnitIsVisible = function() return false end`);
    expect(s.run(`return tostring(NS.consumables.scanUnit("party1").readable)`)).toBe("false");
    s.run(`UnitIsVisible = nil; UnitPhaseReason = function() return 2 end`);
    expect(s.run(`return tostring(NS.consumables.scanUnit("party1").readable)`)).toBe("false");
  });

  it("the group scan does not accuse someone whose buffs it could not fully read", () => {
    const s = withData();
    s.run(String.raw`
      MOCK_RAID = false
      MOCK_UNITS.party1 = { name = "Amy" }; MOCK_UNITS.party2 = { name = "Bob" }
      AURAS.player = { { name = "Flask of Power" }, { name = "Well Fed" } }
      AURAS.party1 = { { name = "Well Fed" }, {} }
      AURAS.party2 = { { name = "Well Fed" } }
      NS.commandHandlers["consumes"]({})`);
    const chat = s.chat().join("\n");
    expect(chat).toContain("No flask or elixir: Bob");
    expect(chat).not.toContain("No flask or elixir: Amy");
  });

  it("writes a report and reads it back, keeping what is unknown unknown", () => {
    const s = withData();
    const text = s.run(String.raw`return NS.consumables.encode("Kev", { flask = true, flaskLeft = 1500, food = false, weapon = true, augment = false, buffs = { sta = true, ap = true }, durability = 88 })`);
    expect(text).toBe("CONSUME|Kev|F=1500|D=0|W=99999|R=0|B=ap,sta|U=88");
    expect(s.run(String.raw`local f = NS.consumables.decode("${text}"); return table.concat({ tostring(f.name), tostring(f.flask), tostring(f.flaskLeft), tostring(f.food), tostring(f.weapon), tostring(f.weaponLeft), tostring(f.augment), tostring(f.vantus), tostring(f.buffs.ap), tostring(f.durability) }, "|")`))
      .toBe("Kev|true|1500|false|true|nil|false|nil|true|88");
    expect(s.run(`return tostring(NS.consumables.decode("READINESS|Kev"))`)).toBe("nil");
  });

  it("reads your weapon enchant and lowest durability for the report", () => {
    const s = withData();
    s.run(String.raw`
      AURAS.player = { { name = "Flask of Power" } }
      GetInventoryItemID = function() return 1234 end
      GetWeaponEnchantInfo = function() return true, 1200000 end
      GetInventoryItemDurability = function(slot) if slot == 5 then return 30, 100 end if slot == 6 then return 90, 100 end end`);
    expect(s.run(String.raw`local f = NS.consumables.ownFacts(); return tostring(f.weapon) .. "|" .. tostring(f.weaponLeft) .. "|" .. tostring(f.durability)`)).toBe("true|1200|30");
    s.run(`GetWeaponEnchantInfo = function() return false end`);
    expect(s.run(String.raw`return tostring((NS.consumables.ownFacts()).weapon)`)).toBe("false");
  });
});
