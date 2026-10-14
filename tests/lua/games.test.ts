import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let s: LuaSession;
afterEach(() => s?.close());
function setup() {
  s = newLuaSession();
  s.run(`NS = {}; GuildedDB = nil; function IsInGroup() return true end`);
  s.load("Core.lua"); s.load("Modules/LootRoll.lua"); s.run(`fire_event("PLAYER_LOGIN")`);
}
describe("Guilded loot rolls without party games", () => {
  it("keeps SR bonuses, rejects duplicate/wrong rolls, and restricts ties", () => {
    setup();
    s.run(`NS.lootRoll.start({"Amy", "Bob", "Cy"}, {Amy=10})
      NS.lootRoll.receive("Amy", 40, 1, 100)
      NS.lootRoll.receive("Amy", 100, 1, 100)
      NS.lootRoll.receive("Bob", 50, 1, 50)
      NS.lootRoll.receive("Bob", 50, 1, 100)
      NS.lootRoll.receive("Cy", 10, 1, 100)`);
    expect(s.chat().join("\n")).toContain("Tie at 50: Amy, Bob");
    s.run(`NS.lootRoll.receive("Cy",100,1,100); NS.lootRoll.receive("Amy",10,1,100); NS.lootRoll.receive("Bob",30,1,100)`);
    expect(s.chat().join("\n")).toContain("Roll winner: Bob (30 including SR+)");
    expect(s.run(`return tostring(NS.lootRoll.session)`)).toBe("nil");
    expect(s.run(`return tostring(next(GuildedDB.epgp))`)).toBe("nil");
  });
  it("does not require the old games module and refuses non-officers", () => {
    setup(); s.run(`GuildedDB.settings.modules = { games = false }`);
    expect(s.run(`return tostring(NS.lootRoll.start({"Amy","Bob"},{}))`)).toBe("true");
    s.run(`NS.commandHandlers.lootroll({"cancel"}); NS.isOfficer = function() return false end`);
    expect(s.run(`return tostring(NS.lootRoll.start({"Amy","Bob"},{}))`)).toBe("false");
  });
});
