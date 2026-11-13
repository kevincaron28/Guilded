import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// The dungeon result card and the duel card: remembered position, never on top of each other, one reset command.
let s: LuaSession | undefined;
afterEach(() => s?.close());

function setup() {
  s = newLuaSession();
  s.run(`SETTINGS = {}; MSGS = {}
    NS = { getSettings = function() return SETTINGS end, getDb = function() return { settings = SETTINGS } end, util = {}, commandHandlers = {}, commandHelp = {},
      message = function(text) MSGS[#MSGS + 1] = text end }
    function fake(l, b, w, h, shown)
      local f = { l = l, b = b, w = w, h = h, shown = shown, pts = {} }
      function f:IsShown() return self.shown end
      function f:GetLeft() return self.l end
      function f:GetRight() return self.l + self.w end
      function f:GetBottom() return self.b end
      function f:GetTop() return self.b + self.h end
      function f:ClearAllPoints() self.pts = {} end
      function f:SetPoint(...) self.pts[#self.pts + 1] = { ... } end
      return f
    end`);
  s.load("Util.lua");
  s.load("Modules/RunResults.lua");
  return s;
}

describe("result and duel cards", () => {
  it("stacks the card being shown above the one already on screen when they overlap", () => {
    setup();
    expect(s!.run(`local a, b = fake(100, 100, 300, 200, false), fake(150, 150, 300, 200, true)
      local moved = NS.util.keepApart(a, b); local p = a.pts[1]
      return tostring(moved) .. ":" .. p[1] .. ":" .. p[3] .. ":" .. p[5]`)).toBe("true:BOTTOMLEFT:TOPLEFT:8");
  });
  it("leaves them alone when they do not overlap, or the other is hidden", () => {
    setup();
    expect(s!.run(`return tostring(NS.util.keepApart(fake(0, 0, 100, 100, false), fake(500, 500, 100, 100, true)))`)).toBe("false");
    expect(s!.run(`return tostring(NS.util.keepApart(fake(0, 0, 100, 100, false), fake(10, 10, 100, 100, false)))`)).toBe("false");
    expect(s!.run(`return tostring(NS.util.keepApart(fake(0, 0, 100, 100, false), nil))`)).toBe("false");
  });
  it("remembers where the result card was dragged and restores it", () => {
    setup();
    s!.run(`local f = fake(0, 0, 354, 276, true); f.GetPoint = function() return "TOP", UIParent, "TOP", 12, -34 end
      NS.runResults.savePosition(f)`);
    expect(s!.run(`return SETTINGS.runCardPos.point .. ":" .. SETTINGS.runCardPos.x .. ":" .. SETTINGS.runCardPos.y`)).toBe("TOP:12:-34");
    expect(s!.run(`local f = fake(0, 0, 354, 276, true); NS.runResults.restorePosition(f); local p = f.pts[1]; return p[1] .. ":" .. p[4] .. ":" .. p[5]`)).toBe("TOP:12:-34");
  });
  it("starts bottom right without a saved position, and ignores a malformed one", () => {
    setup();
    const start = `local f = fake(0, 0, 354, 276, true); NS.runResults.restorePosition(f); local p = f.pts[1]; return p[1] .. ":" .. p[4] .. ":" .. p[5]`;
    expect(s!.run(start)).toBe("BOTTOMRIGHT:-24:150");
    s!.run(`SETTINGS.runCardPos = { point = 5, x = "a" }`);
    expect(s!.run(start)).toBe("BOTTOMRIGHT:-24:150");
  });
  it("puts both cards back with the cards reset command", () => {
    setup();
    s!.run(`SETTINGS.runCardPos = { point = "TOP", x = 1, y = 2 }; SETTINGS.duelCardPos = { point = "TOP", x = 3, y = 4 }`);
    s!.run(`NS.commandHandlers.cards({ "reset" })`);
    expect(s!.run(`return tostring(SETTINGS.runCardPos) .. ":" .. tostring(SETTINGS.duelCardPos)`)).toBe("nil:nil");
    expect(s!.run(`return MSGS[#MSGS]`)).toContain("back in their usual place");
    s!.run(`NS.commandHandlers.cards({})`);
    expect(s!.run(`return MSGS[#MSGS]`)).toContain("cards reset");
  });
});
