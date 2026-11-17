import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.3.6: the Guilded setup window is movable and sits above the Guilded window, and "Quiet login"
// keeps informational lines (login and guildmates' hello messages) out of chat but never errors.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const toc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "addon", "Guilded", "Guilded.toc"), "utf8");
const FILES = toc.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.endsWith(".lua")).map((line) => line.replace(/\\/g, "/"));

// Frames that answer with plausible values and remember every call (NAMED holds the named frames).
const FRAMES = String.raw`
  NAMED = {}
  CLOCK = 0
  function GetTime() return CLOCK end
  local numbers = { GetWidth = 100, GetHeight = 100, GetEffectiveScale = 1, GetFrameLevel = 1, GetLeft = 0, GetTop = 0, GetRight = 100, GetBottom = 0, GetStringWidth = 50 }
  function CreateFrame(_, name)
    local f = { scripts = {}, shown = false, text = "", calls = {} }
    if name then NAMED[name] = f end
    setmetatable(f, { __index = function(_, k)
      if numbers[k] then return function() return numbers[k] end end
      if k == "GetText" then return function(self) return self.text end end
      if k == "SetText" then return function(self, v) self.text = v or "" end end
      if k == "Show" then return function(self) self.shown = true; if self.scripts.OnShow then self.scripts.OnShow(self) end end end
      if k == "Hide" then return function(self) self.shown = false end end
      if k == "IsShown" then return function(self) return self.shown end end
      if k == "HasFocus" or k == "GetChecked" or k == "IsVisible" then return function() return false end end
      if k == "GetCenter" then return function() return 0, 0 end end
      if k == "GetStringHeight" then return function() return 150 end end
      if k == "CreateFontString" or k == "CreateTexture" then return function() return CreateFrame() end end
      return function(self, ...) self.calls[k] = { ... }; return self end
    end })
    f.SetScript = function(self, name2, fn) self.scripts[name2] = fn end
    f.GetScript = function(self, name2) return self.scripts[name2] end
    f.HookScript = function(self, name2, fn) self.scripts[name2] = self.scripts[name2] or fn end
    FRAMES[#FRAMES + 1] = f
    return f
  end
  Minimap = CreateFrame()
  UIParent = CreateFrame()
  GameTooltip = CreateFrame()
  UISpecialFrames = {}
  function UnitIsPlayer() return true end
`;

function fullAddon(): LuaSession {
  session = newLuaSession();
  session.run(FRAMES);
  session.run(String.raw`
    GuildedDB = nil; NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    function GetGuildInfo() return "Alpha", "Rank", 5 end
    function GetInventoryItemLink() return nil end
    function GetInventoryItemDurability() return nil end
  `);
  for (const file of FILES) session.load(file);
  session.run(`fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD"); NS.commandHandlers["menu"]()`);
  return session;
}

const chat = (s: LuaSession) => s.chat().join("\n");
const clear = (s: LuaSession) => s.run(`CHAT_LOG = {}`);

describe("the Guilded setup window", () => {
  it("can be dragged, stays on screen, and sits above the Guilded window", () => {
    const s = fullAddon();
    s.run(`NS.options.openSetup()`);
    const get = (expr: string) => s.run(`return tostring(${expr})`);
    expect(get(`NAMED.GuildedSetupPanel.shown`)).toBe("true");
    expect(get(`NAMED.GuildedSetupPanel.calls.SetMovable[1]`)).toBe("true");
    expect(get(`NAMED.GuildedSetupPanel.calls.EnableMouse[1]`)).toBe("true");
    expect(get(`NAMED.GuildedSetupPanel.calls.SetClampedToScreen[1]`)).toBe("true");
    expect(get(`NAMED.GuildedSetupPanel.calls.RegisterForDrag[1]`)).toBe("LeftButton");
    // Dragging starts and stops a move.
    s.run(`
      MOVES = {}
      local p = NAMED.GuildedSetupPanel
      p.StartMoving = function() MOVES[#MOVES + 1] = "start" end
      p.StopMovingOrSizing = function() MOVES[#MOVES + 1] = "stop" end
      p.scripts.OnDragStart(p); p.scripts.OnDragStop(p)
    `);
    expect(get(`table.concat(MOVES, ",")`)).toBe("start,stop");
    // The main window lives in the DIALOG strata; the setup panel is in a higher one.
    const order = `({ BACKGROUND = 1, LOW = 2, MEDIUM = 3, HIGH = 4, DIALOG = 5, FULLSCREEN = 6, FULLSCREEN_DIALOG = 7, TOOLTIP = 8 })`;
    expect(get(`NAMED.GuildedPanel.calls.SetFrameStrata[1]`)).toBe("DIALOG");
    expect(get(`${order}[NAMED.GuildedSetupPanel.calls.SetFrameStrata[1]] > ${order}[NAMED.GuildedPanel.calls.SetFrameStrata[1]]`)).toBe("true");
    expect(get(`NAMED.GuildedSetupPanel.calls.SetToplevel[1]`)).toBe("true");
  });

  it("is tall enough for its text and the three buttons", () => {
    const s = fullAddon();
    s.run(`NS.options.openSetup()`);
    // Text starts 42 down; the buttons need 88 at the bottom (two rows).
    expect(Number(s.run(`return NAMED.GuildedSetupPanel.calls.SetSize[2]`))).toBeGreaterThanOrEqual(42 + 150 + 88);
  });
});

describe("Quiet login", () => {
  it("is off by default and both kinds of line show", () => {
    const s = fullAddon();
    clear(s);
    s.run(`NS.infoMessage("a login line"); NS.helloMessage("a hello line")`);
    expect(chat(s)).toContain("a login line");
    expect(chat(s)).toContain("a hello line");
  });

  it("hides login lines for a minute and hello notices always, but never an error or a command answer", () => {
    const s = fullAddon();
    s.run(`NS.commandHandlers["quiet"]({ "on" })`);
    expect(s.run(`return tostring(NS.getSettings().quietLogin)`)).toBe("true");
    clear(s);
    s.run(`NS.infoMessage("a login line"); NS.helloMessage("a hello line"); NS.message("|cffff5555[Diagnostic]|r LUA_ERROR: boom")`);
    expect(chat(s)).not.toContain("a login line");
    expect(chat(s)).not.toContain("a hello line");
    expect(chat(s)).toContain("LUA_ERROR: boom");
    // A real hello site: a guildmate with a newer sync protocol says hello.
    s.run(`NS.relay.handle("HI|99|1|9.9.9", "Bob")`);
    expect(chat(s)).not.toContain("newer Guilded sync");
    // A command the member types still answers.
    s.run(`NS.commandHandlers["quiet"]({})`);
    expect(chat(s)).toContain("Quiet login is on");
    // After the first minute login lines show again, hello notices stay hidden.
    s.run(`CLOCK = 61; NS.infoMessage("a later line"); NS.helloMessage("a later hello")`);
    expect(chat(s)).toContain("a later line");
    expect(chat(s)).not.toContain("a later hello");
  });

  it("shows the hello notice when quiet login is off", () => {
    const s = fullAddon();
    clear(s);
    s.run(`NS.relay.handle("HI|99|1|9.9.9", "Bob")`);
    expect(chat(s)).toContain("newer Guilded sync");
    s.run(`NS.commandHandlers["quiet"]({ "on" }); NS.commandHandlers["quiet"]({ "off" })`);
    expect(s.run(`return tostring(NS.getSettings().quietLogin)`)).toBe("nil");
  });

  it("is a switch in Settings with a French label", () => {
    const s = fullAddon();
    expect(s.run(`
      for _, e in ipairs(NS.options.switches()) do
        if e.label == "Quiet login: no Guilded messages in chat at login" then return tostring(e.get()) end
      end
      return "missing"`)).toBe("false");
    s.run(`NS.getSettings().quietLogin = true`);
    expect(s.run(`
      for _, e in ipairs(NS.options.switches()) do
        if e.label == "Quiet login: no Guilded messages in chat at login" then return tostring(e.get()) end
      end
      return "missing"`)).toBe("true");
  });
});
