import { afterEach, describe, expect, it } from "vitest";
import { parseSelfExport } from "../../src/services/self-export.js";
import { newLuaSession, type LuaSession } from "./harness.js";

// The code is produced by the real Lua and read by the real TypeScript.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

describe("/guilded share -> /character import", () => {
  it("round-trips character, gear check, consumables and attunements", () => {
    session = newLuaSession();
    session.run(`
      GuildedDB = nil
      NS = {}
      MOCK_RAID = true
      MOCK_UNITS = { player = { name = "Kev", buffs = { "Flask of the Titans" } } }
      LINKS = { [1] = "|cff|Hitem:100:0:0|h[Helm]|h|r", [3] = "|cff|Hitem:101:5:0|h[Spaulders]|h|r", [5] = "|cff|Hitem:102:0:0|h[Chest]|h|r",
        [6] = "|cff|Hitem:103:0:0|h[Belt]|h|r", [7] = "|cff|Hitem:104:0:0|h[Legs]|h|r", [8] = "|cff|Hitem:105:0:0|h[Boots]|h|r",
        [9] = "|cff|Hitem:106:0:0|h[Bracers]|h|r", [10] = "|cff|Hitem:107:0:0|h[Gloves]|h|r", [16] = "|cff|Hitem:108:0:0|h[Sword]|h|r" }
      GetInventoryItemLink = function(_, slot) return LINKS[slot] end
      GetInventoryItemID = function(_, slot) return LINKS[slot] and tonumber(string.match(LINKS[slot], "item:(%d+)")) end
    `);
    session.load("Core.lua");
    session.load("Compat.lua");
    session.load("Modules/Consumables.lua");
    session.run(`
      fire_event("PLAYER_LOGIN")
      GuildedDB.attunements = { Kev = { ["Onyxia Key"] = { completed = true } } }
      SlashCmdList["GUILDED"]("share")
    `);
    const code = session.run("return NS.lastShareCode");
    expect(code.startsWith("QGEXP1:")).toBe(true);

    const data = parseSelfExport(code);
    expect(data.character).toMatchObject({ name: "Kev", realm: "TestRealm", className: "Warrior", race: "Night Elf", level: 60 });
    expect(data.status).toBe("PARTIAL");
    expect(data.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(["MISSING_ENCHANTS", "NO_FOOD"]));
    expect(data.consumables).toEqual([{ category: "FLASK", name: "Flask of the Titans" }]);
    expect(data.attunements).toEqual([{ name: "Onyxia Key", completed: true }]);
  });

  it("rejects damaged or foreign codes with a clear message", () => {
    expect(() => parseSelfExport("hello")).toThrow(/share code/);
    expect(() => parseSelfExport("QGEXP1:@@@@@@@@")).toThrow(/damaged/);
    expect(() => parseSelfExport(`QGEXP1:${Buffer.from("not a character line").toString("base64")}`)).toThrow(/Guilded character line/);
  });

  it("points a /guilded character line (pasted into the wrong command) at /character import instead", () => {
    expect(() => parseSelfExport("QG2;Ray;Classic Beta PvP;PRIEST;Scourge;11;;Skinning:15,First Aid:54,Cooking:20"))
      .toThrow(/character import/);
    expect(() => parseSelfExport("QG1|Ray|Classic Beta PvP|PRIEST|Scourge|11||Skinning:15")).toThrow(/character import/);
  });
});
