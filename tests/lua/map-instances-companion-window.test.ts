import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Owner requests 1, 2, 18 (7 November 2026): no Battle.net wording, a copyable companion link
// window, and no guildmate pins inside instances.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function withMap(): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    INSTANCE = false
    function IsInInstance() if INSTANCE then return true, "party" end return false, "none" end
    local make = CreateFrame
    function CreateFrame(...)
      local f = make(...)
      f.Show = function(self) self.shown = true end
      f.Hide = function(self) self.shown = false end
      return f
    end
    Minimap = { GetWidth = function() return 100 end, GetHeight = function() return 100 end, GetZoom = function() return 0 end }
    SETTINGS = {}
    NS = { getSettings = function() return SETTINGS end, commandHandlers = {}, commandHelp = {},
           comm = { register = function() end }, displayName = function(n) return n end }
  `);
  session.load("Modules/GuildMap.lua");
  session.run(String.raw`
    NS.guildMap.members = { Ann = { mapId = 1, x = 0.5, y = 0.5, level = 10, at = 0 } }
    NS.guildMap.myPosition = function() return 1, 0.5, 0.5 end
    NS.guildMap.minimapOffset = function() return 0.2, 0.2 end
  `);
  return session;
}

describe("guild map pins inside instances", () => {
  it("shows a minimap pin outside, hides it inside an instance and restores it after", () => {
    const s = withMap();
    s.run(`NS.guildMap.refreshMinimap()`);
    expect(s.run(`return tostring(NS.guildMap.minimapPins[1].shown)`)).toBe("true");
    s.run(`INSTANCE = true; NS.guildMap.refresh()`);
    expect(s.run(`return tostring(NS.guildMap.minimapPins[1].shown)`)).toBe("false");
    expect(s.run(`return tostring(NS.guildMap.inInstance())`)).toBe("true");
    s.run(`INSTANCE = false; NS.guildMap.refresh()`);
    expect(s.run(`return tostring(NS.guildMap.minimapPins[1].shown)`)).toBe("true");
  });

  it("hides world-map pins in an instance too", () => {
    const s = withMap();
    s.run(`
      local canvas = { GetWidth = function() return 100 end, GetHeight = function() return 100 end }
      WorldMapFrame = { ScrollContainer = { Child = canvas, GetCanvasScale = function() return 1 end },
        IsShown = function() return true end, GetMapID = function() return 1 end }
      NS.guildMap.worldPins = { { shown = true, Hide = function(self) self.shown = false end } }
      INSTANCE = true
      NS.guildMap.refreshWorldMap()
    `);
    expect(s.run(`return tostring(NS.guildMap.worldPins[1].shown)`)).toBe("false");
  });
});

describe("companion download window", () => {
  it("opens a box holding the direct installer link", () => {
    session = newLuaSession();
    session.run(String.raw`
      NS = { getSettings = function() return {} end, getDb = function() return {} end, commandHandlers = {}, commandHelp = {},
             message = function() end }
    `);
    session.load("Modules/CompanionLink.lua");
    const text = session.run(String.raw`
      local popup = NS.companionLink.openCopyWindow()
      return tostring(popup ~= nil) .. "|" .. NS.companionLink.DIRECT
    `);
    expect(text).toContain("true|https://guilded.kcaron.top/downloads/Guilded.Companion.Setup.exe");
  });
});

describe("no Battle.net wording in the addon", () => {
  it("never mentions Battle.net in addon source", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(__dirname, "..", "..", "addon");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(lua|xml|toc)$/.test(name) && /battle\.?net|bnet/i.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
