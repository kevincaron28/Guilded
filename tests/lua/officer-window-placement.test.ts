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
    function f:Hide() self.shown = false end
    function f:SetDontSavePosition(v) self.noSave = v end
    function f:SetUserPlaced(v) self.userPlaced = v end
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

  it("with the main window and Roster admin filling the width, closes Roster admin and goes beside the main window (seen in game 20 Nov)", () => {
    setup();
    s!.run(`GuildedPanel = fake(60, 300, 590, 600, true); GuildedRosterAdmin = fake(660, 400, 520, 430, true); GuildedPromotionPanel = fake(0, 0, 480, 400, false)
      UIParent.GetWidth = function() return 1200 end; raised = false; function GuildedPromotionPanel:Raise() raised = true end
      function GuildedPromotionPanel:SetFrameStrata(s) self.strata = s end`);
    s!.run(`NS.util.placeBeside(GuildedPromotionPanel); GuildedPromotionPanel.shown = true`);
    expect(s!.run(`return tostring(GuildedRosterAdmin.shown) .. " " .. tostring(GuildedPanel.shown)`)).toBe("false true");
    expect(s!.run(`return tostring(overlaps(GuildedPromotionPanel, GuildedPanel))`)).toBe("false");
    expect(s!.run(`return tostring(GuildedPromotionPanel.l + GuildedPromotionPanel.w <= 1200)`)).toBe("true");
    expect(s!.run(`return tostring(raised) .. " " .. tostring(GuildedPromotionPanel.strata)`)).toBe("true DIALOG");
  });

  it("covers one window squarely, one strata up, only when the screen is narrower than it and the main window", () => {
    setup();
    s!.run(`GuildedPanel = fake(60, 300, 590, 600, true); GuildedPromotionPanel = fake(0, 0, 480, 400, false)
      UIParent.GetWidth = function() return 900 end; function GuildedPromotionPanel:SetFrameStrata(s) self.strata = s end`);
    s!.run(`NS.util.placeBeside(GuildedPromotionPanel)`);
    expect(s!.run(`local a, b = GuildedPromotionPanel, GuildedPanel; return tostring(a.l == b.l and a.b + a.h == b.b + b.h)`)).toBe("true");
    expect(s!.run(`return tostring(GuildedPromotionPanel.strata)`)).toBe("FULLSCREEN");
  });

  it("never lets WoW save a dragged window's spot, and places again one frame later (a restored spot is undone)", () => {
    setup();
    s!.run(`TIMERS = {}; C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end }
      GuildedPanel = fake(560, 200, 600, 600, true); GuildedRosterAdmin = fake(300, 100, 720, 580, false)`);
    s!.run(`NS.util.placeBeside(GuildedRosterAdmin); GuildedRosterAdmin.shown = true`);
    expect(s!.run(`return tostring(GuildedRosterAdmin.noSave) .. " " .. tostring(GuildedRosterAdmin.userPlaced)`)).toBe("true false");
    s!.run(`GuildedRosterAdmin.l = 600; GuildedRosterAdmin.b = 250`); // WoW puts the window back where it was once dragged
    expect(s!.run(`return tostring(overlaps(GuildedRosterAdmin, GuildedPanel))`)).toBe("true");
    s!.run(`for _, fn in ipairs(TIMERS) do fn() end`);
    expect(s!.run(`return tostring(overlaps(GuildedRosterAdmin, GuildedPanel))`)).toBe("false");
  });

  it("is raised above the other shown officer windows", () => {
    setup();
    s!.run(`GuildedPanel = fake(560, 200, 600, 600, true); GuildedPanel.level = 40; function GuildedPanel:GetFrameLevel() return self.level end
      GuildedRosterAdmin = fake(300, 100, 720, 580, false); GuildedRosterAdmin.level = 1
      function GuildedRosterAdmin:GetFrameLevel() return self.level end; function GuildedRosterAdmin:SetFrameLevel(v) self.level = v end`);
    s!.run(`NS.util.placeBeside(GuildedRosterAdmin)`);
    expect(s!.run(`return tostring(GuildedRosterAdmin.level > 40)`)).toBe("true");
  });

  it("does nothing when no other Guilded window is shown", () => {
    setup();
    s!.run(`GuildedRosterAdmin = fake(300, 100, 720, 580, false); GuildedPanel = fake(0, 0, 10, 10, false)`);
    expect(s!.run(`return tostring(NS.util.placeBeside(GuildedRosterAdmin))`)).toBe("false");
  });
});
