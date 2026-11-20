import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 20 Nov 2026: officer windows (main window, Roster admin, Ready to promote) never cover each other.
let s: LuaSession | undefined;
afterEach(() => s?.close());

const FAKE = `
  UIParent.GetWidth = function() return 1920 end; UIParent.GetHeight = function() return 1080 end
  NS = { util = {}, commandHandlers = {}, commandHelp = {} }
  function fake(l, b, w, h, shown)
    local f = { l = l, b = b, w = w, h = h, shown = shown, pts = {} }
    function f:IsShown() return self.shown end
    function f:GetLeft() return self.l end
    function f:GetRight() return self.l + self.w end
    function f:GetBottom() return self.b end
    function f:GetTop() return self.b + self.h end
    function f:GetWidth() return self.w end
    function f:GetHeight() return self.h end
    function f:ClearAllPoints() self.pts = {} end
    function f:SetPoint(point, rel, relPoint, x, y)
      assert(point == "TOPLEFT" and relPoint == "BOTTOMLEFT" and rel == UIParent)
      self.l = x; self.b = y - self.h
    end
    return f
  end
  function overlaps(a, b) return a.l < b.l + b.w and a.l + a.w > b.l and a.b < b.b + b.h and a.b + a.h > b.b end`;

function setup() {
  s = newLuaSession();
  s.run(FAKE);
  s.load("Util.lua");
  return s;
}

describe("util.placeBeside", () => {
  it("puts Roster admin beside the main window and Ready to promote beside both, with no overlap", () => {
    setup();
    s!.run(`GuildedPanel = fake(560, 200, 600, 600, true); GuildedRosterAdmin = fake(300, 100, 720, 580, false); GuildedPromotionPanel = fake(0, 0, 480, 500, false)`);
    s!.run(`NS.util.placeBeside(GuildedRosterAdmin); GuildedRosterAdmin.shown = true`);
    expect(s!.run(`return tostring(overlaps(GuildedRosterAdmin, GuildedPanel))`)).toBe("false");
    expect(s!.run(`return tostring(GuildedRosterAdmin.l >= 0 and GuildedRosterAdmin.l + GuildedRosterAdmin.w <= 1920)`)).toBe("true");
    s!.run(`NS.util.placeBeside(GuildedPromotionPanel); GuildedPromotionPanel.shown = true`);
    expect(s!.run(`return tostring(overlaps(GuildedPromotionPanel, GuildedPanel) or overlaps(GuildedPromotionPanel, GuildedRosterAdmin))`)).toBe("false");
    expect(s!.run(`return tostring(GuildedPromotionPanel.l >= 0 and GuildedPromotionPanel.l + GuildedPromotionPanel.w <= 1920)`)).toBe("true");
  });

  it("uses the left side when the right has no room", () => {
    setup();
    s!.run(`GuildedPanel = fake(1000, 200, 800, 600, true); GuildedRosterAdmin = fake(0, 0, 500, 400, false)`);
    s!.run(`NS.util.placeBeside(GuildedRosterAdmin)`);
    expect(s!.run(`return tostring(overlaps(GuildedRosterAdmin, GuildedPanel))`)).toBe("false");
    expect(s!.run(`return tostring(GuildedRosterAdmin.l + GuildedRosterAdmin.w <= GuildedPanel.l)`)).toBe("true");
  });

  it("with no room anywhere sits fully over the biggest window, not half on it", () => {
    setup();
    s!.run(`GuildedPanel = fake(100, 100, 1700, 800, true); GuildedRosterAdmin = fake(0, 0, 500, 400, false)`);
    s!.run(`NS.util.placeBeside(GuildedRosterAdmin)`);
    expect(s!.run(`local a, b = GuildedRosterAdmin, GuildedPanel; return tostring(a.l >= b.l and a.l + a.w <= b.l + b.w and a.b >= b.b and a.b + a.h <= b.b + b.h)`)).toBe("true");
  });

  it("with the main window and Roster admin filling the width, covers Roster admin squarely and is raised (seen in game 20 Nov)", () => {
    setup();
    s!.run(`GuildedPanel = fake(60, 300, 590, 600, true); GuildedRosterAdmin = fake(660, 400, 520, 430, true); GuildedPromotionPanel = fake(0, 0, 480, 400, false)
      UIParent.GetWidth = function() return 1200 end; raised = false; function GuildedPromotionPanel:Raise() raised = true end`);
    s!.run(`NS.util.placeBeside(GuildedPromotionPanel)`);
    expect(s!.run(`return tostring(overlaps(GuildedPromotionPanel, GuildedPanel))`)).toBe("false");
    expect(s!.run(`local a, b = GuildedPromotionPanel, GuildedRosterAdmin; return tostring(a.l == b.l and a.b + a.h == b.b + b.h)`)).toBe("true");
    expect(s!.run(`return tostring(raised)`)).toBe("true");
  });

  it("does nothing when no other Guilded window is shown", () => {
    setup();
    s!.run(`GuildedRosterAdmin = fake(300, 100, 720, 580, false); GuildedPanel = fake(0, 0, 10, 10, false)`);
    expect(s!.run(`return tostring(NS.util.placeBeside(GuildedRosterAdmin))`)).toBe("false");
  });
});
