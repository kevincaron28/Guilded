import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Util.lua's showWindow/hideWindow: game windows opened by Guilded must close with Escape.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function withUtil(): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    NS = {}
    CALLS = {}
    function window(name)
      return { name = name, shown = false,
        GetName = function(self) return self.name end,
        Show = function(self) self.shown = true; CALLS[#CALLS + 1] = "Show " .. self.name end,
        Hide = function(self) self.shown = false; CALLS[#CALLS + 1] = "Hide " .. self.name end }
    end
    UIPanelWindows = { LFGParentFrame = { area = "left" } }
    UISpecialFrames = { "GameMenuFrame" }
    function ShowUIPanel(f) f.shown = true; CALLS[#CALLS + 1] = "ShowUIPanel " .. f.name end
    function HideUIPanel(f) f.shown = false; CALLS[#CALLS + 1] = "HideUIPanel " .. f.name end
  `);
  session.load("Util.lua");
  return session;
}

describe("Util.lua showWindow / hideWindow", () => {
  it("opens and closes a managed game window through the game's window manager", () => {
    const s = withUtil();
    s.run(`F = window("LFGParentFrame"); NS.util.showWindow(F); NS.util.hideWindow(F)`);
    expect(s.run(`return table.concat(CALLS, ",")`)).toBe("ShowUIPanel LFGParentFrame,HideUIPanel LFGParentFrame");
  });

  it("registers any other named window for Escape, once", () => {
    const s = withUtil();
    s.run(`F = window("CalendarFrame"); NS.util.showWindow(F); NS.util.showWindow(F)`);
    expect(s.run(`return tostring(F.shown)`)).toBe("true");
    expect(s.run(`local n = 0; for _, v in ipairs(UISpecialFrames) do if v == "CalendarFrame" then n = n + 1 end end; return n`)).toBe("1");
  });

  it("does nothing for a missing window", () => {
    const s = withUtil();
    s.run(`NS.util.showWindow(nil); NS.util.hideWindow(nil)`);
    expect(s.run(`return #CALLS`)).toBe("0");
  });
});
