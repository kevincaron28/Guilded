import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let s: LuaSession;
afterEach(() => s?.close());

// The real Core.lua (roll parsing, names) with the soft-reserve roll-off, in a party.
function setup() {
  s = newLuaSession();
  s.run(`NS={}; GuildedDB=nil; MOCK_UNITS={player={name="Host"}}`);
  for (const f of ["Core.lua", "Compat.lua", "Modules/LootRoll.lua"]) s.load(f);
  s.run(`fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD")
    NS.isOfficer = function() return true end
    function IsInGroup() return true end
    function IsInRaid() return false end`);
}
const roll = (name: string, value: number) => s.run(`fire_event("CHAT_MSG_SYSTEM", "${name} rolls ${value} (1-100)")`);
const said = (from: number) => s.chat().slice(from).join("\n");

describe("soft-reserve roll-off (G9)", () => {
  it("re-rolls only the tied players, adds SR+, and reads WoW Forever full names", () => {
    setup();
    expect(s.run(`return tostring(NS.lootRoll.start({ "Highpriest", "Naomine", "Halidor" }, { Naomine = 1 }))`)).toBe("true");
    let mark = s.chat().length;
    // Forever characters roll under their first and last name.
    roll("Highpriest Cheech", 50);
    roll("Naomine Merriweather", 49); // 49 + SR+1 = 50: a tie with Highpriest
    roll("Halidor Galemorne", 12);
    expect(said(mark)).toContain("Tie at 50: Highpriest, Naomine. Only these players /roll 100 again.");
    mark = s.chat().length;
    // Halidor is out of the re-roll; a roll from him is ignored.
    roll("Halidor Galemorne", 100);
    roll("Highpriest Cheech", 30);
    roll("Highpriest Cheech", 99); // a second roll from the same player does not count
    roll("Naomine Merriweather", 40);
    expect(said(mark)).toContain("Roll winner: Naomine (41 including SR+). Award the item separately.");
    expect(said(mark)).not.toContain("Halidor");
    expect(s.run(`return tostring(NS.lootRoll.session)`)).toBe("nil");
  });

  it("ignores rolls that are not 1-100", () => {
    setup();
    s.run(`NS.lootRoll.start({ "Highpriest", "Naomine" }, {})`);
    const mark = s.chat().length;
    s.run(`fire_event("CHAT_MSG_SYSTEM", "Highpriest Cheech rolls 5 (1-10)")`);
    roll("Naomine Merriweather", 70);
    expect(said(mark)).not.toContain("Roll winner");
    roll("Highpriest Cheech", 20);
    expect(said(mark)).toContain("Roll winner: Naomine (70). Award the item separately.");
  });
});
