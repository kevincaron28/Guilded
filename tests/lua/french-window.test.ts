import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// The tools window on a French game client, found on the in-game check of 16 October 2026: a
// button label cut off, English section headings and a stale result line under every page.
// Frames here measure text (6 pixels a byte) and remember their width, so a label that does
// not fit its button fails the test instead of only looking wrong in game.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const toc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "addon", "Guilded", "Guilded.toc"), "utf8");
const FILES = toc.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.endsWith(".lua")).map((line) => line.replace(/\\/g, "/"));

const MEASURING_FRAMES = String.raw`
  local numbers = { GetHeight = 100, GetEffectiveScale = 1, GetLeft = 0, GetTop = 0, GetRight = 100, GetBottom = 0 }
  function CreateFrame(kind, frameName, parent, template)
    local f = { scripts = {}, shown = false, text = "", children = {}, points = {}, kind = kind, template = template, width = 100 }
    if parent and type(parent.children) == "table" then table.insert(parent.children, f) end
    if frameName then _G[frameName] = f end
    setmetatable(f, { __index = function(_, k)
      if numbers[k] then return function() return numbers[k] end end
      if k == "GetText" then return function(self) return self.text end end
      if k == "SetText" then return function(self, v) self.text = v or "" end end
      if k == "GetStringWidth" then return function(self) return #self.text * 6 end end
      if k == "GetFontString" then return function(self) return self end end
      if k == "SetWidth" then return function(self, w) self.width = w end end
      if k == "GetWidth" then return function(self) return self.width end end
      if k == "Show" then return function(self) self.shown = true; if self.scripts.OnShow then self.scripts.OnShow(self) end end end
      if k == "Hide" then return function(self) self.shown = false end end
      if k == "IsShown" then return function(self) return self.shown end end
      if k == "HasFocus" or k == "GetChecked" or k == "IsVisible" then return function() return false end end
      if k == "GetCenter" then return function() return 0, 0 end end
      if k == "CreateFontString" or k == "CreateTexture" then return function() return CreateFrame("FontString") end end
      return function(self) return self end
    end })
    f.SetScript = function(self, name, fn) self.scripts[name] = fn end
    f.GetScript = function(self, name) return self.scripts[name] end
    f.HookScript = function(self, name, fn)
      local before = self.scripts[name]
      self.scripts[name] = before and function(...) before(...); fn(...) end or fn
    end
    f.GetChildren = function(self) return unpack(self.children) end
    f.SetFrameLevel = function(self, level) self.level = level end
    f.GetFrameLevel = function(self) return rawget(self, "level") or 1 end
    f.SetScrollChild = function(self, child) self.scrollChild = child end
    f.SetScale = function(self, scale) self.scale = scale end
    f.ClearAllPoints = function(self) self.points = {} end
    f.SetPoint = function(self, ...) table.insert(self.points, {...}) end
    f.SetSize = function(self, width, height) self.width = width; self.height = height end
    f.SetVerticalScroll = function(self, value) self.verticalScroll = value end
    f.GetVerticalScroll = function(self) return rawget(self, "verticalScroll") or 0 end
    f.ScrollBar = { Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end }
    FRAMES[#FRAMES + 1] = f
    return f
  end
  Minimap = CreateFrame()
  UIParent = CreateFrame()
  GameTooltip = CreateFrame()
  UISpecialFrames = {}
  function UnitIsPlayer() return true end
`;

function frenchWindow(): LuaSession {
  session = newLuaSession();
  session.run(MEASURING_FRAMES);
  session.run(String.raw`
    GuildedDB = nil; NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    function GetLocale() return "frFR" end
    function GetGuildInfo() return "Alpha", "Rank", 1 end
    function GetInventoryItemLink() return nil end
    function GetInventoryItemDurability() return nil end
  `);
  for (const file of FILES) session.load(file);
  session.run(`fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD"); NS.getSettings().setupMode = "local"; NS.commandHandlers["menu"]()`);
  return session;
}

describe("the tools window in French", () => {
  it("fits every button label, including the long ledger sharing button", () => {
    const s = frenchWindow();
    s.run(`NS.openGuildPanel(nil, "guild", "Standings")`);
    const tooNarrow = s.run(`
      local out = {}
      for _, f in ipairs(FRAMES) do
        if f.template == "UIPanelButtonTemplate" and f.text ~= "" and f.width < #f.text * 6 + 20 then out[#out + 1] = f.text .. "=" .. f.width end
      end
      return table.concat(out, " | ")`);
    expect(tooNarrow).toBe("");
    expect(s.run(`for _, f in ipairs(FRAMES) do if f.text == "Partager mon registre comme classement" then return tostring(f.width) end end; return "missing"`))
      .toBe(String(("Partager mon registre comme classement".length) * 6 + 20));
  });

  it("titles the sidebar sections in French, with accented capitals", () => {
    const s = frenchWindow();
    const headings = s.run(`local t = {}; for _, label in pairs(NS.windowState().groupLabels) do t[#t + 1] = label.text end; table.sort(t); return table.concat(t, "|")`);
    expect(headings).toContain("VUE D'ENSEMBLE");
    expect(headings).toContain("SOIR DE RAID");
    expect(headings).toContain("SYSTÈME");
    expect(headings).not.toMatch(/OVERVIEW|RAID NIGHT|SYSTEM\b/);
    expect(s.run(`return NS.bidding.statusText()`)).toBe("Aucune enchère en cours.");
    expect(s.run(`return NS.L("Backup")`)).toBe("Sauvegarde");
  });

  it("clears the result line when another page opens or the window reopens", () => {
    const s = frenchWindow();
    s.run(`NS.message("2026-10-13 [LUA_ERROR] (other addon) old problem")`);
    const status = () => s.run(`return NS.windowState().status.text`);
    expect(status()).toContain("old problem");
    s.run(`NS.windowState().selectTabByName(NS.windowState().tabs[NS.windowState().currentTab].name)`);
    expect(status()).toContain("old problem");
    s.run(`local ui = NS.windowState(); for i, tab in ipairs(ui.tabs) do if i ~= ui.currentTab and tab.visible then ui.selectTabByName(tab.name); break end end`);
    expect(status()).toBe("");
    s.run(`NS.message("Saved."); GuildedPanel:Hide(); GuildedPanel:Show()`);
    expect(status()).toBe("");
  });
});
