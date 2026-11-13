import { afterEach, describe, expect, it } from "vitest";
import { addonSource, newLuaSession, type LuaSession } from "./harness.js";

// The dungeon result card and the duel card: remembered position, never on top of each other (and never anchored to each
// other), one reset command in both addons.
let s: LuaSession | undefined;
afterEach(() => s?.close());

const FAKE = `
  SETTINGS = {}; MSGS = {}
  UIParent.GetWidth = function() return 1920 end; UIParent.GetHeight = function() return 1080 end
  NS = { getSettings = function() return SETTINGS end, getDb = function() return { settings = SETTINGS } end, util = {}, commandHandlers = {}, commandHelp = {},
    message = function(text) MSGS[#MSGS + 1] = text end }
  -- A frame with real anchor rules: a point name must be valid, and a card anchored to a frame that is anchored to it is an error.
  VALID = { TOP = 1, BOTTOM = 1, LEFT = 1, RIGHT = 1, CENTER = 1, TOPLEFT = 1, TOPRIGHT = 1, BOTTOMLEFT = 1, BOTTOMRIGHT = 1 }
  function fake(l, b, w, h, shown, laidOut)
    local f = { l = l, b = b, w = w, h = h, shown = shown, pts = {}, laidOut = laidOut ~= false }
    local function dependsOn(a, target, depth)
      if depth > 5 then return true end
      for _, p in ipairs(a.pts) do
        local rel = p[2]
        if rel == target or (type(rel) == "table" and rel.pts and dependsOn(rel, target, depth + 1)) then return true end
      end
      return false
    end
    function f:IsShown() return self.shown end
    function f:GetLeft() return self.laidOut and self.l or nil end
    function f:GetRight() return self.laidOut and self.l + self.w or nil end
    function f:GetBottom() return self.laidOut and self.b or nil end
    function f:GetTop() return self.laidOut and self.b + self.h or nil end
    function f:GetWidth() return self.w end
    function f:GetHeight() return self.h end
    function f:ClearAllPoints() self.pts = {} end
    function f:GetPoint(i) local p = self.pts[i or 1]; if p then return p[1], p[2], p[3], p[4], p[5] end end
    function f:SetPoint(point, rel, relPoint, x, y)
      if not VALID[point] then error("Unknown anchor point: " .. tostring(point)) end
      if type(rel) == "table" and rel ~= UIParent and dependsOn(rel, self, 0) then error("Cannot anchor to a region dependent on it") end
      self.pts[#self.pts + 1] = { point, rel, relPoint, x, y }
      -- Where it ends up, so later stacking can read a rectangle.
      if rel == UIParent then
        local fx = point:find("LEFT") and 0 or point:find("RIGHT") and 1 or 0.5
        local fy = point:find("BOTTOM") and 0 or point:find("TOP") and 1 or 0.5
        local px = relPoint:find("LEFT") and 0 or relPoint:find("RIGHT") and 1 or 0.5
        local py = relPoint:find("BOTTOM") and 0 or relPoint:find("TOP") and 1 or 0.5
        self.l = px * 1920 + (x or 0) - fx * self.w; self.b = py * 1080 + (y or 0) - fy * self.h
      end
    end
    return f
  end`;

function setup() {
  s = newLuaSession();
  s.run(FAKE);
  s.load("Util.lua");
  s.load("Modules/RunResults.lua");
  return s;
}

// The two cards as the addon places them when each is shown: the saved or default place, then keepApart against the other.
const SHOW_RUN = `local f = RUN; NS.runResults.restorePosition(f); NS.util.keepApart(f, DUEL); f.shown = true`;
const SHOW_DUEL = `local f = DUEL; f:ClearAllPoints(); f:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -24, 330); NS.util.keepApart(f, RUN); f.shown = true`;

describe("result and duel cards", () => {
  it("places the card being shown above the one already on screen, from UIParent, when they overlap", () => {
    setup();
    expect(s!.run(`local a, b = fake(100, 100, 300, 200, false), fake(150, 150, 300, 200, true)
      local moved = NS.util.keepApart(a, b); local p = a.pts[1]
      return tostring(moved) .. ":" .. p[1] .. ":" .. tostring(p[2] == UIParent) .. ":" .. p[4] .. ":" .. p[5]`)).toBe("true:BOTTOMLEFT:true:150:358");
  });

  it("leaves them alone when they do not overlap, or the other is hidden", () => {
    setup();
    expect(s!.run(`return tostring(NS.util.keepApart(fake(0, 0, 100, 100, false), fake(500, 500, 100, 100, true)))`)).toBe("false");
    expect(s!.run(`return tostring(NS.util.keepApart(fake(0, 0, 100, 100, false), fake(10, 10, 100, 100, false)))`)).toBe("false");
    expect(s!.run(`return tostring(NS.util.keepApart(fake(0, 0, 100, 100, false), nil))`)).toBe("false");
  });

  it("measures a card that was just positioned and has no rectangle yet from its anchor and size", () => {
    setup();
    // The new card (bottom right, 354 x 276) is not laid out; the other card is on screen at the same place.
    expect(s!.run(`local a = fake(0, 0, 354, 276, false, false); a:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -24, 150)
      local b = fake(1920 - 24 - 340, 150, 340, 200, true)
      return tostring(NS.util.keepApart(a, b))`)).toBe("true");
    expect(s!.run(`local a = fake(0, 0, 100, 100, false, false); a:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", 0, 0)
      return tostring(NS.util.keepApart(a, fake(500, 500, 100, 100, true)))`)).toBe("false");
  });

  for (const order of [["RUN", "DUEL"], ["DUEL", "RUN"]]) {
    it(`re-showing either card while both are up never anchors one to the other (${order.join(" then ")} first)`, () => {
      setup();
      s!.run(`RUN = fake(0, 0, 354, 276, false, false); DUEL = fake(0, 0, 340, 200, false, false)`);
      const show = (name: string) => s!.run(name === "RUN" ? SHOW_RUN : SHOW_DUEL);
      show(order[0]!); show(order[1]!);
      // The taller details state, a new run and a new duel: each card is shown again while the other is still up.
      for (let i = 0; i < 3; i++) { show("RUN"); show("DUEL"); show("DUEL"); show("RUN"); }
      expect(s!.run(`local bad = 0; for _, c in ipairs({ RUN, DUEL }) do for _, p in ipairs(c.pts) do if p[2] ~= UIParent then bad = bad + 1 end end end; return bad`)).toBe("0");
      // And they do not overlap.
      expect(s!.run(`local a, b = RUN, DUEL
        return tostring(a.l + a.w <= b.l or b.l + b.w <= a.l or a.b >= b.b + b.h or b.b >= a.b + a.h)`)).toBe("true");
    });
  }

  it("remembers where the result card was dragged and restores it", () => {
    setup();
    s!.run(`local f = fake(0, 0, 354, 276, true); f:SetPoint("TOP", UIParent, "TOP", 12, -34); NS.runResults.savePosition(f)`);
    expect(s!.run(`return SETTINGS.runCardPos.point .. ":" .. SETTINGS.runCardPos.x .. ":" .. SETTINGS.runCardPos.y`)).toBe("TOP:12:-34");
    expect(s!.run(`local f = fake(0, 0, 354, 276, true); NS.runResults.restorePosition(f); local p = f.pts[1]; return p[1] .. ":" .. tostring(p[2] == UIParent) .. ":" .. p[4] .. ":" .. p[5]`)).toBe("TOP:true:12:-34");
  });

  it("never saves a place measured from the other card", () => {
    setup();
    s!.run(`local other = fake(0, 0, 340, 200, true); local f = fake(0, 0, 354, 276, true); f:SetPoint("BOTTOMLEFT", other, "TOPLEFT", 0, 8); NS.runResults.savePosition(f)`);
    expect(s!.run(`return tostring(SETTINGS.runCardPos)`)).toBe("nil");
  });

  it("starts bottom right without a saved position, and falls back from a malformed or hand-edited one", () => {
    setup();
    const start = `local f = fake(0, 0, 354, 276, true); NS.runResults.restorePosition(f); local p = f.pts[1]; return p[1] .. ":" .. p[4] .. ":" .. p[5]`;
    expect(s!.run(start)).toBe("BOTTOMRIGHT:-24:150");
    s!.run(`SETTINGS.runCardPos = { point = 5, x = "a" }`);
    expect(s!.run(start)).toBe("BOTTOMRIGHT:-24:150");
    s!.run(`SETTINGS.runCardPos = { point = "SIDEWAYS", relPoint = "MIDDLE", x = 1, y = 2 }`);
    expect(s!.run(start)).toBe("BOTTOMRIGHT:-24:150"); // the invalid point name did not throw
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

  it("is reachable from the Guilded Dungeons slash command (/gdg cards reset)", () => {
    setup();
    s!.run(`SETTINGS.runCardPos = { point = "TOP", x = 1, y = 2 }; SETTINGS.duelCardPos = { point = "TOP", x = 3, y = 4 }
      NS.guildedPresent = function() return false end; NS.L = function(t) return t end; NS.standalone = true`);
    s!.run(`loadaddon("GuildedDungeons", [====[${addonSource("../GuildedDungeons/Main.lua")}]====], NS)`);
    s!.run(`SlashCmdList["GUILDEDDUNGEONS"]("cards reset")`);
    expect(s!.run(`return tostring(SETTINGS.runCardPos) .. ":" .. tostring(SETTINGS.duelCardPos)`)).toBe("nil:nil");
  });
});
