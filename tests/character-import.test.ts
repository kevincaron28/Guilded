import { describe, expect, it } from "vitest";
import { normalizeClassName, normalizeRaceName, parseCharacterString } from "../src/services/character-import.js";

describe("character import line", () => {
  it("parses the line the addon produces", () => {
    const parsed = parseCharacterString("QG1|Bob|WoW-Forever|DEATHKNIGHT|NightElf|60|Frost|Mining:300,Blacksmithing:275");
    expect(parsed).toEqual({
      name: "Bob", realm: "WoW-Forever", className: "Death Knight", race: "Night Elf", level: 60, spec: "Frost",
      professions: [{ name: "Mining", skillLevel: 300 }, { name: "Blacksmithing", skillLevel: 275 }]
    });
  });

  it("copes with empty optional fields and stray whitespace", () => {
    const parsed = parseCharacterString("  QG1|Amy|Realm|MAGE|Scourge|0||  \n");
    expect(parsed).toEqual({ name: "Amy", realm: "Realm", className: "Mage", race: "Undead", professions: [] });
  });

  it("rejects text that is not a character line", () => {
    expect(() => parseCharacterString("hello")).toThrow(/Guilded character line/);
    expect(() => parseCharacterString("QG1|Bob||WARRIOR|Human|60||")).toThrow(/missing/);
  });

  it("normalizes class and race spellings", () => {
    expect(normalizeClassName("DEMONHUNTER")).toBe("Demon Hunter");
    expect(normalizeClassName("Guerrier")).toBe("Guerrier");
    expect(normalizeRaceName("BloodElf")).toBe("Blood Elf");
    expect(normalizeRaceName("Dwarf")).toBe("Dwarf");
  });

  it("reads the semicolon line (QG2) and explains a garbled pipe line", () => {
    expect(parseCharacterString("QG2;Ray;Classic Beta PvP;PRIEST;Scourge;6;;Skinning:3,Cooking:1")).toEqual({
      name: "Ray", realm: "Classic Beta PvP", className: "Priest", race: "Undead", level: 6,
      professions: [{ name: "Skinning", skillLevel: 3 }, { name: "Cooking", skillLevel: 1 }]
    });
    // What WoW's chat did to "QG1|Ray|...": "|R" was eaten.
    expect(() => parseCharacterString("QG1ay|Classic Beta PvP|PRIEST|Scourge|6|Skinning:3,Cooking:1")).toThrow(/garbled/);
  });
});
