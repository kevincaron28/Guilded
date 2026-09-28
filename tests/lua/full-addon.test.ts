import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Loads every file of the addon in the order of the real .toc, in one session, like the game does, then
// runs a command from each part. The other Lua tests load one module at a time, so this is the one that
// catches a load-order or shared-name problem between modules before a release.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const toc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "addon", "Guilded", "Guilded.toc"), "utf8");
const FILES = toc.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.endsWith(".lua")).map((line) => line.replace(/\\/g, "/"));

// Frames that answer with plausible values (same idea as the window test).
const FRAMES = String.raw`
  local numbers = { GetWidth = 100, GetHeight = 100, GetEffectiveScale = 1, GetFrameLevel = 1, GetLeft = 0, GetTop = 0, GetRight = 100, GetBottom = 0, GetStringWidth = 50 }
  function CreateFrame()
    local f = { scripts = {}, shown = false, text = "" }
    setmetatable(f, { __index = function(_, k)
      if numbers[k] then return function() return numbers[k] end end
      if k == "GetText" then return function(self) return self.text end end
      if k == "SetText" then return function(self, v) self.text = v or "" end end
      if k == "Show" then return function(self) self.shown = true end end
      if k == "Hide" then return function(self) self.shown = false end end
      if k == "IsShown" then return function(self) return self.shown end end
      if k == "HasFocus" or k == "GetChecked" or k == "IsVisible" then return function() return false end end
      if k == "GetCenter" then return function() return 0, 0 end end
      if k == "CreateFontString" or k == "CreateTexture" then return function() return CreateFrame() end end
      return function(self) return self end
    end })
    f.SetScript = function(self, name, fn) self.scripts[name] = fn end
    f.GetScript = function(self, name) return self.scripts[name] end
    f.HookScript = function(self, name, fn) self.scripts[name] = self.scripts[name] or fn end
    FRAMES[#FRAMES + 1] = f
    return f
  end
  Minimap = CreateFrame()
  UIParent = CreateFrame()
  GameTooltip = CreateFrame()
  UISpecialFrames = {}
  function UnitIsPlayer() return true end
`;

function fullAddon(rank: number): LuaSession {
  session = newLuaSession();
  session.run(FRAMES);
  session.run(String.raw`
    GuildedDB = nil; NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    function GetGuildInfo() return "Alpha", "Rank", ${rank} end
    -- What the game has and the test harness does not.
    function GetInventoryItemLink() return nil end
    function GetInventoryItemDurability() return nil end
  `);
  for (const file of FILES) session.load(file);
  session.run(`fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD"); NS.commandHandlers["menu"]()`);
  return session;
}

// One harmless command per part of the addon.
const COMMANDS = [
  "help", "modules", "standings", "peers", "status",
  "calendar list", "reserve list", "recipes mine", "cooldowns", "council status", "core", "drop mode",
  "bid status", "games status", "digest", "sync status"
];

const problems = (s: LuaSession) => s.chat().filter((line) => /(^|\s)(error|failed)|attempt to|stack traceback/i.test(line));
const diagnostics = (s: LuaSession) => s.run(`local n = 0; for _, d in ipairs((NS.getDb() or {}).diagnostics or {}) do if d.kind == "LUA_ERROR" then n = n + 1 end end; return tostring(n)`);

describe("the whole addon, loaded in .toc order", () => {
  it("lists the files it is about to load", () => {
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES[0]).toBe("Util.lua");
    expect(FILES[1]).toBe("Core.lua");
    for (const name of ["Modules/Bidding.lua", "Modules/Council.lua", "Modules/Loot.lua", "Modules/Reserve.lua", "Modules/Recipes.lua", "Modules/Calendar.lua", "Modules/Minimap.lua"]) {
      expect(FILES).toContain(name);
    }
  });

  it("loads, logs in and opens the window as an officer without a single error", () => {
    const s = fullAddon(1);
    expect(problems(s)).toEqual([]);
    expect(diagnostics(s)).toBe("0");
    expect(s.run(`return tostring(NS.windowState() ~= nil)`)).toBe("true");
  });

  it("has an options page and an Addon Compartment entry", () => {
    const s = fullAddon(1);
    expect(s.run(`return type(Guilded_OnAddonCompartmentClick) .. type(Guilded_OnAddonCompartmentEnter) .. type(Guilded_OnAddonCompartmentLeave)`)).toBe("functionfunctionfunction");
    expect(s.run(`return tostring(#NS.options.switches() == 4 + #NS.MODULES)`)).toBe("true");
    // A switch runs the same command you could type.
    s.run(`for _, sw in ipairs(NS.options.switches()) do if sw.module == "games" then sw.set(false) end end`);
    expect(s.run(`return tostring(GuildedDB.settings.modules.games)`)).toBe("false");
    s.run(`SlashCmdList["GUILDED"]("options")`);
    expect(problems(s)).toEqual([]);
  });

  it("every part registered its commands", () => {
    const s = fullAddon(1);
    for (const name of ["council", "lc", "drop", "core", "reserve", "res", "recipes", "cooldowns", "calendar", "bid", "games", "menu"]) {
      expect(s.run(`return type(NS.commandHandlers[${JSON.stringify(name)}])`), name).toBe("function");
    }
  });

  it("answers a command from each part, as an officer and as a member, without errors", () => {
    for (const rank of [1, 5]) {
      const s = fullAddon(rank);
      for (const command of COMMANDS) {
        s.run(`SlashCmdList["GUILDED"](${JSON.stringify(command)})`);
      }
      expect(problems(s), `rank ${rank}`).toEqual([]);
      expect(diagnostics(s), `rank ${rank}`).toBe("0");
      session?.close();
    }
  });

  it("the loot commands work together: the core is picked, the system follows, a bid opens", () => {
    const s = fullAddon(1);
    s.run(`
      local db = NS.getDb()
      db.lootRules = { updatedAt = "x", default = "EPGP", minimumBid = 15, values = {}, cores = {
        { id = "c1", name = "Bid Raid", mode = "EPGP", pool = false, reserves = 1, baseGp = 0, values = {}, players = {} },
        { id = "c2", name = "Council Raid", mode = "COUNCIL", pool = false, reserves = 1, baseGp = 0, values = {}, players = {} } } }
      IsInRaid = function() return true end
      IsInGroup = function() return true end
      SlashCmdList["GUILDED"]("core council raid")
    `);
    expect(s.run(`return NS.loot.mode()`)).toBe("COUNCIL");
    s.run(`SlashCmdList["GUILDED"]("drop Big Sword 30")`);
    expect(s.run(`return NS.council.current and NS.council.current.item or "none"`)).toBe("Big Sword");
    s.run(`SlashCmdList["GUILDED"]("council cancel"); SlashCmdList["GUILDED"]("core bid raid"); SlashCmdList["GUILDED"]("drop Other Item 30")`);
    expect(s.run(`return NS.bidding.current and NS.bidding.current.item or "none"`)).toBe("Other Item");
    expect(s.run(`return NS.bidding.current.min`)).toBe("15");
  });
});
