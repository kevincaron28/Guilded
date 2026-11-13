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

function frenchWindow(client = "frFR"): LuaSession {
  session = newLuaSession();
  session.run(MEASURING_FRAMES);
  session.run(String.raw`
    GuildedDB = nil; NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    function GetLocale() return "${client}" end
    function GetGuildInfo() return "Alpha", "Rank", 1 end
    function GetInventoryItemLink() return nil end
    function GetInventoryItemDurability() return nil end
  `);
  for (const file of FILES) session.load(file);
  session.run(`fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD"); NS.getSettings().setupMode = "local"; NS.commandHandlers["menu"]()`);
  return session;
}

describe("the tools window in French", () => {
  it("translates login help with and without a restored active raid", () => {
    const s = frenchWindow();
    expect(s.chat().join("\n")).toContain("Chargé. /guilded help pour les commandes.");
    s.run(`NS.runCommand("start Friday raid"); fire_event("PLAYER_LOGIN")`);
    expect(s.chat().join("\n")).toContain("le raid 'Friday raid' est toujours actif.");
  });

  it("keeps confirmation compact and gives each arm its own ten-second timeout", () => {
    const s = frenchWindow();
    s.run(`TIMERS = {}; C_Timer.After = function(seconds, fn) TIMERS[#TIMERS + 1] = { seconds = seconds, fn = fn } end
      for _, f in ipairs(FRAMES) do if f.text == NS.L("Clear test data") then CLEAR_BUTTON = f; break end end
      CLEAR_BUTTON.scripts.OnClick(CLEAR_BUTTON)`);
    expect(s.run(`return CLEAR_BUTTON.text`)).toBe("Valider ?");
    expect(s.run(`return tostring(CLEAR_BUTTON.width >= #CLEAR_BUTTON.text * 6 + 20)`)).toBe("true");
    expect(s.run(`return tostring(TIMERS[1].seconds)`)).toBe("10");
    s.run(`CLEAR_BUTTON.scripts.OnClick(CLEAR_BUTTON); CLEAR_BUTTON.scripts.OnClick(CLEAR_BUTTON); TIMERS[1].fn()`);
    expect(s.run(`return tostring(CLEAR_BUTTON.armed)`)).toBe("true");
    s.run(`TIMERS[#TIMERS].fn()`);
    expect(s.run(`return tostring(CLEAR_BUTTON.armed)`)).toBe("false");
    expect(s.run(`return CLEAR_BUTTON.text == NS.L("Clear test data") and "restored" or "wrong"`)).toBe("restored");
  });

  it("reserves space below the module list for status messages", () => {
    const s = frenchWindow();
    expect(s.run(`for _, point in ipairs(NS.windowState().moduleScroll.points) do
      if point[1] == "BOTTOMRIGHT" then return tostring(point[5]) end
    end; return "missing"`)).toBe("24");
  });

  it.each(["deDE", "esES"])("fits translated button labels on %s", client => {
    const s = frenchWindow(client);
    s.run(`NS.openToolsPage("Standings")`);
    expect(s.run(`local out = {}; for _, f in ipairs(FRAMES) do
      if f.template == "UIPanelButtonTemplate" and f.text ~= "" and f.width < #f.text * 6 + 20 then out[#out + 1] = f.text end
      end; return table.concat(out, " | ")`)).toBe("");
  });
  it("fits every button label, including the long ledger sharing button", () => {
    const s = frenchWindow();
    s.run(`NS.openToolsPage("Standings")`);
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

  it("keeps the section rows inside the page width in French", () => {
    const s = frenchWindow();
    for (const group of ["Home", "Guild", "Raids", "Officer"]) {
      s.run(`NS.windowState().groupButtons.${group}.scripts.OnClick()`);
      const rows = JSON.parse(s.run(`local t = {}; for _, r in ipairs(NS.windowState().sectionLayout) do
        local b; for _, tab in ipairs(NS.windowState().tabs) do if tab.name == r.name then b = tab.button end end
        t[#t + 1] = string.format('{"x":%d,"line":%d,"width":%d,"real":%d,"text":%q}', r.x, r.line, r.width, b.width, b.text) end
        return "[" .. table.concat(t, ",") .. "]"`)) as { x: number; line: number; width: number; real: number; text: string }[];
      expect(rows.length).toBeGreaterThan(1);
      const pageWidth = Number(s.run("return NS.layoutMath.PAGE_WIDTH"));
      for (const r of rows) {
        expect(r.real).toBe(r.width);
        expect(r.x + r.width).toBeLessThanOrEqual(pageWidth);          // never past the right edge
        expect(r.width).toBeGreaterThanOrEqual(r.text.length * 7 + 20 > 200 ? 200 : r.text.length * 7 + 20); // fits its text
        expect(r.line).toBeLessThanOrEqual(1);                          // the page starts below two lines
        if (r.line === 0) expect(r.x + r.width).toBeLessThanOrEqual(pageWidth - 90); // clear of the - / + / close buttons
      }
    }
  });

  it("names the five member tabs and Settings in French", () => {
    const s = frenchWindow();
    const headings = s.run(`local t = {}; for _, button in pairs(NS.windowState().groupButtons) do t[#t + 1] = button.text end; table.sort(t); return table.concat(t, "|")`);
    for (const name of ["Accueil", "Guilde", "Donjons", "Artisanat", "Raids", "Options"]) expect(headings).toContain(name);
    expect(headings).not.toMatch(/Home|Guild\b|Dungeons|Crafting|Settings/);
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

describe("window geometry that must not move (UI polish)", () => {
  const ys = (s: LuaSession) => JSON.parse(s.run(`local t = {}; for _, g in ipairs({ "Home", "Guild", "Dungeons", "Crafting", "Raids", "Officer", "Settings" }) do
      local b = NS.windowState().groupButtons[g]
      if b and b.shown then t[#t + 1] = string.format('"%s":%d', g, b.points[1][5]) end end
      return "{" .. table.concat(t, ",") .. "}"`)) as Record<string, number>;

  it("keeps the left menu where it is when a section opens", () => {
    const s = frenchWindow();
    const base = ys(s);
    expect(Object.keys(base).length).toBeGreaterThan(3);
    for (const group of Object.keys(base)) {
      s.run(`NS.windowState().groupButtons.${group}.scripts.OnClick()`);
      expect(ys(s)).toEqual(base);
    }
  });

  it("puts the Player field below the section row and the page below the field", () => {
    const s = frenchWindow();
    s.run(`NS.windowState().groupButtons.Guild.scripts.OnClick(); NS.windowState().selectTabByName("Standings")`);
    const g = (code: string) => Number(s.run(code));
    const lines = g(`return NS.windowState().sectionLines`);
    expect(lines).toBeGreaterThan(0);
    const rowBottom = 12 + 22 + 24 * (lines - 1);
    const boxTop = -g(`return NS.windowState().playerBox.points[1][5]`);
    expect(boxTop).toBeGreaterThanOrEqual(rowBottom);                                  // not over the row
    const scrollTop = -g(`for _, p in ipairs(NS.windowState().guildScroll.points) do if p[1] == "TOPLEFT" then return p[5] end end`);
    expect(scrollTop).toBeGreaterThanOrEqual(boxTop + 22);                             // not over the field
    // Without the field the page starts where it always did.
    s.run(`NS.windowState().selectTabByName("Guild overview")`);
    expect(g(`return NS.windowState().pageTop`)).toBe(66);
  });
});
