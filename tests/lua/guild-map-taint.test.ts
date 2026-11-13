import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9 November 2026: "Guilded tried to call Button:SetPassThroughButtons()" in bursts after duels. The
// world map's own pins call it, and the game refuses it in combat once the map runs tainted. Guilded
// must never open, hook or call into the world map, nor parent its dots to the map canvas.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function withWorldMap(): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    MAP_CALLS = {}
    local make = CreateFrame
    function CreateFrame(kind, name, parent)
      local f = make(kind, name, parent)
      f.parent = parent
      f.Show = function(self) self.shown = true end
      f.Hide = function(self) self.shown = false end
      f.SetPoint = function(self, point, relative, relPoint, x, y) self.anchor, self.px, self.py = relative, x, y end
      f.GetEffectiveScale = function() return 0.5 end
      return f
    end
    function ToggleWorldMap() MAP_CALLS[#MAP_CALLS + 1] = "ToggleWorldMap" end
    function GetBindingKey(action) if action == "TOGGLEWORLDMAP" then return "M" end end
    function hooksecurefunc(target) MAP_CALLS[#MAP_CALLS + 1] = "hooksecurefunc:" .. tostring(target == WorldMapFrame) end
    MAP_ID, MAP_SHOWN, CANVAS_SCALE = 1429, false, 1
    CANVAS = { GetWidth = function() return 1000 end, GetHeight = function() return 500 end,
      GetEffectiveScale = function() return CANVAS_SCALE end, GetFrameLevel = function() return 10 end }
    CONTAINER = { Child = CANVAS }
    WorldMapFrame = {
      ScrollContainer = CONTAINER,
      IsShown = function() return MAP_SHOWN end,
      GetMapID = function() return MAP_ID end,
      GetFrameStrata = function() return "HIGH" end,
      GetFrameLevel = function() return 3 end,
      HookScript = function() MAP_CALLS[#MAP_CALLS + 1] = "HookScript" end,
      OnMapChanged = function() end
    }
    Minimap = { GetWidth = function() return 100 end, GetHeight = function() return 100 end, GetZoom = function() return 0 end }
    SETTINGS = {}
    NS = { getSettings = function() return SETTINGS end, commandHandlers = {}, commandHelp = {},
           comm = { register = function() end, send = function() return true end }, displayName = function(n) return n end,
           normalizeName = function(n) return n end, playerName = function() return "Me" end,
           message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end }
  `);
  session.load("Modules/GuildMap.lua");
  session.run(`fire_event("PLAYER_LOGIN")`);
  return session;
}

describe("guild map and the world map's taint", () => {
  it("fills no tooltip from a dot while in combat", () => {
    const s = withWorldMap();
    s.run(`TIPS = 0; GameTooltip = { SetOwner = function() TIPS = TIPS + 1 end, AddLine = function() end, Show = function() end, Hide = function() end }
      MAP_SHOWN = true; NS.guildMap.receive("P|1429|4100|6000|MAGE|60", "Ann"); NS.guildMap.refreshWorldMap()
      PIN = NS.guildMap.worldPins[1]
      NS.compat = { inCombat = function() return COMBAT == true end }
      COMBAT = true; PIN.scripts.OnEnter(PIN)`);
    expect(s.run(`return TIPS`)).toBe("0");
    s.run(`COMBAT = false; PIN.scripts.OnEnter(PIN)`);
    expect(s.run(`return TIPS`)).toBe("1");
  });
  it("never hooks WorldMapFrame at login", () => {
    const s = withWorldMap();
    expect(s.run(`return table.concat(MAP_CALLS, ",")`)).toBe("");
  });

  it("/guilded map open is retired: it never opens the map and prints no key hint, the dots switch stays", () => {
    const s = withWorldMap();
    s.run(`NS.commandHandlers.map({ "open" })`);
    expect(s.run(`return table.concat(MAP_CALLS, ",")`)).toBe("");
    expect(s.chat().join("\n")).not.toContain("Open your world map");
    s.run(`NS.commandHandlers.map({ "show", "off" })`);
    expect(s.chat().join("\n")).toContain("Guildmates are hidden from your maps.");
  });

  it("draws dots on its own overlay (not the map canvas), anchored to the canvas and scaled to it", () => {
    const s = withWorldMap();
    s.run(`MAP_SHOWN = true; NS.guildMap.receive("P|1429|4100|6000|MAGE|60", "Ann"); NS.guildMap.refreshWorldMap()`);
    expect(s.run(`local p = NS.guildMap.worldPins[1]
      return tostring(p.parent == NS.guildMap.worldOverlay) .. ":" .. tostring(p.parent == CANVAS) .. ":" .. tostring(p.anchor == CANVAS)
        .. ":" .. tostring(NS.guildMap.worldOverlay.parent == UIParent) .. ":" .. string.format("%.0f,%.0f", p.px, p.py)`))
      .toBe("true:false:true:true:820,-600");
    expect(s.run(`return tostring(NS.guildMap.worldOverlay.shown)`)).toBe("true");
  });

  // 10 November 2026: dots showed on the minimap but not on the world map. The map's own pins and
  // explored-area art use frame levels in the thousands, so the overlay must sit above all of them.
  it("keeps the overlay above the map's own layers (at least HIGH, top frame level)", () => {
    const s = withWorldMap();
    s.run(`
      local make = CreateFrame
      function CreateFrame(kind, name, parent)
        local f = make(kind, name, parent)
        f.SetFrameStrata = function(self, value) self.strata = value end
        f.SetFrameLevel = function(self, value) self.level = value end
        return f
      end
      MAP_STRATA = "MEDIUM"
      WorldMapFrame.GetFrameStrata = function() return MAP_STRATA end
      MAP_SHOWN = true; NS.guildMap.receive("P|1429|4100|6000|MAGE|60", "Ann"); NS.guildMap.refreshWorldMap()`);
    expect(s.run(`return NS.guildMap.worldOverlay.strata .. ":" .. NS.guildMap.worldOverlay.level`)).toBe("HIGH:9000");
    s.run(`MAP_STRATA = "FULLSCREEN"; NS.guildMap.refreshWorldMap()`);
    expect(s.run(`return NS.guildMap.worldOverlay.strata .. ":" .. NS.guildMap.worldOverlay.level`)).toBe("FULLSCREEN:9000");
  });

  it("notices the map opening, changing and zooming by reading it, and hides the overlay when it closes", () => {
    const s = withWorldMap();
    s.run(`NS.guildMap.receive("P|1429|4100|6000|MAGE|60", "Ann")`);
    expect(s.run(`return tostring(NS.guildMap.worldMapChanged())`)).toBe("true"); // first look
    expect(s.run(`return tostring(NS.guildMap.worldMapChanged())`)).toBe("false");
    s.run(`MAP_SHOWN = true`);
    expect(s.run(`return tostring(NS.guildMap.worldMapChanged())`)).toBe("true");
    s.run(`CANVAS_SCALE = 2`);
    expect(s.run(`return tostring(NS.guildMap.worldMapChanged())`)).toBe("true");
    s.run(`MAP_ID = 1415`);
    expect(s.run(`return tostring(NS.guildMap.worldMapChanged())`)).toBe("true");
    // The OnUpdate between ticks redraws on a change.
    s.run(`MAP_ID = 1429; for _, f in ipairs(FRAMES) do if f.scripts.OnUpdate then f.scripts.OnUpdate(f, 0.01) end end`);
    expect(s.run(`return tostring(NS.guildMap.worldPins[1] and NS.guildMap.worldPins[1].shown)`)).toBe("true");
    s.run(`MAP_SHOWN = false; NS.guildMap.refreshWorldMap()`);
    expect(s.run(`return tostring(NS.guildMap.worldOverlay.shown) .. ":" .. tostring(NS.guildMap.worldPins[1].shown)`)).toBe("false:false");
  });
});
