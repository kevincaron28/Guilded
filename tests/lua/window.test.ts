import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Builds the real tools window (Modules/Minimap.lua) against frames that answer
// with plausible values, to catch errors in the layout code and check who
// sees which tab and what the Home page says.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const RICH_FRAMES = String.raw`
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

function openWindow(rank: number, extraLua = ""): LuaSession {
  session = newLuaSession();
  session.run(RICH_FRAMES);
  session.run(String.raw`
    GuildedDB = nil; NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    function GetGuildInfo() return "Alpha", "Rank", ${rank} end
    ${extraLua}
  `);
  for (const file of ["Core.lua", "Compat.lua", "Modules/Sync.lua", "Modules/SyncNow.lua", "Modules/Games.lua", "Modules/ConsumableData.lua", "Modules/Consumables.lua", "Modules/Ready.lua", "Modules/Minimap.lua"]) session.load(file);
  session.run(`fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD"); NS.commandHandlers["menu"]()`);
  return session;
}

const visibleTabs = (s: LuaSession) => s.run(`local n = {}; for _, t in ipairs(NS.windowState().tabs) do if t.visible then n[#n + 1] = t.name end end; return table.concat(n, ",")`);
const homeText = (s: LuaSession, field: string) => s.run(`return NS.windowState().${field}.text`);

describe("the tools window (sidebar and Home page)", () => {
  it("opens without errors and starts on Home", () => {
    const s = openWindow(1);
    expect(s.chat().join("\n")).not.toContain("failed");
    expect(s.run(`return NS.windowState().tabs[NS.windowState().currentTab].name`)).toBe("Home");
  });

  it("officers see every group in order; members only what they can use", () => {
    expect(visibleTabs(openWindow(1))).toBe("Home,Me,Standings,Ready,Reserves,Calendar,Raid,EPGP,Loot,Council,Dungeons,Games,Crafting,Tools");
    session?.close();
    expect(visibleTabs(openWindow(5))).toBe("Home,Me,Standings,Reserves,Dungeons,Games,Crafting,Tools");
  });

  it("Home says who you are, what is running, and why there is no standing yet", () => {
    const s = openWindow(1);
    expect(homeText(s, "homeGreeting")).toContain("Kev");
    expect(homeText(s, "homeGreeting")).toContain("Officer");
    expect(homeText(s, "homeNow")).toContain("No raid is running");
    expect(homeText(s, "homeStanding")).toContain("have not arrived yet");
    expect(homeText(s, "homeGear")).toContain("No gear check yet");
    expect(homeText(s, "homeSync")).toContain("Everything is saved");
  });

  it("Home shows the standing when Discord has sent it, and unsent changes when something happened", () => {
    const s = openWindow(1);
    s.run(`
      GuildedDB.standings = { updatedAt = "2026-09-28T00:00:00Z", baseGp = 0, players = { Kev = { ep = 120, gp = 40, pr = 3 } } }
      NS.syncNow.mark()
      SlashCmdList["GUILDED"]("menu"); SlashCmdList["GUILDED"]("menu")
    `);
    expect(homeText(s, "homeStanding")).toBe("EP 120    GP 40    PR 3.00");
    expect(homeText(s, "homeSync")).toContain("Changes are waiting");
    expect(s.run(`return NS.windowState().sidebarSync.text`)).toBe("Unsent changes");
  });

  it("the Player field appears only on pages that act on a player", () => {
    const s = openWindow(1);
    const shown = () => s.run(`return tostring(NS.windowState().playerBox.shown)`);
    expect(shown()).toBe("false");                       // Home
    s.run(`NS.windowState().selectTabByName("Raid")`);
    expect(shown()).toBe("true");
    s.run(`NS.windowState().selectTabByName("Tools")`);
    expect(shown()).toBe("false");
  });

  it("shows Reserves or Council only when the raid's own loot system uses them", () => {
    const withLoot = (rank: number, lootMode?: string) => {
      const s = newLuaSession();
      s.run(RICH_FRAMES);
      s.run(String.raw`
        GuildedDB = nil; NS = {}
        MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
        function GetGuildInfo() return "Alpha", "Rank", ${rank} end
      `);
      for (const file of ["Core.lua", "Compat.lua", "Modules/Sync.lua", "Modules/SyncNow.lua", "Modules/Games.lua", "Modules/ConsumableData.lua", "Modules/Consumables.lua", "Modules/Ready.lua", "Modules/Loot.lua", "Modules/Minimap.lua"]) s.load(file);
      s.run(`fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD")`);
      if (lootMode) s.run(`NS.getSettings().lootMode = ${JSON.stringify(lootMode)}`);
      s.run(`NS.commandHandlers["menu"]()`);
      return s;
    };
    // No mode set: falls back to the guild default (EPGP) — neither shows.
    const none = withLoot(1);
    expect(visibleTabs(none)).not.toContain("Reserves");
    expect(visibleTabs(none)).not.toContain("Council");
    none.close();

    const reserve = withLoot(1, "RESERVE");
    expect(visibleTabs(reserve)).toContain("Reserves");
    expect(visibleTabs(reserve)).not.toContain("Council");
    reserve.close();

    const council = withLoot(1, "COUNCIL");
    expect(visibleTabs(council)).toContain("Council");
    expect(visibleTabs(council)).not.toContain("Reserves");
    council.close();

    // EPGP priority uses the Council tab's award flow too.
    const priority = withLoot(1, "PRIORITY");
    expect(visibleTabs(priority)).toContain("Council");
    expect(visibleTabs(priority)).not.toContain("Reserves");
    priority.close();
  });

  it("titles each page with what it is for", () => {
    const s = openWindow(1);
    expect(s.run(`return NS.windowState().pageTitle.text`)).toContain("Home");
    s.run(`NS.windowState().selectTabByName("EPGP")`);
    expect(s.run(`return NS.windowState().pageTitle.text`)).toContain("award EP and GP");
  });
});

describe("the Ready page", () => {
  const readyText = (s: LuaSession) => s.run(`local w = NS.windowState(); local out = { w.readySummary.text }; for i, r in ipairs(w.readyRows) do if r.name.text ~= "" then out[#out + 1] = r.name.text .. "|" .. r.status.text .. "|" .. r.why.text end end; return table.concat(out, string.char(10))`);

  it("shows just you when solo, and updates when opened", () => {
    const s = openWindow(1);
    s.run(`NS.windowState().selectTabByName("Ready")`);
    const text = readyText(s);
    expect(text).toContain("Not in a group: showing only you.");
    expect(text).toContain("Kev");
  });

  it("draws one icon per check for each player, and none for empty rows", () => {
    const s = openWindow(1);
    s.run(`NS.windowState().selectTabByName("Ready")`);
    // Solo: your row is there, and every check says "unknown" (a question mark) until a raid needs them.
    expect(s.run(`local r = NS.windowState().readyRows; return tostring(r[1].cells.flask.shown) .. tostring(r[1].cells.buffs.shown) .. tostring(r[2].cells.flask.shown)`)).toBe("truetruefalse");
    expect(s.run(`return #NS.windowState().readyHeaders`)).toBe("7");
  });

  it("shows how the latest ready check went", () => {
    const s = openWindow(1);
    s.run(`NS.ready.onReadyCheck("player", 30); NS.windowState().selectTabByName("Ready")`);
    expect(s.run(`return NS.windowState().readySummary.text`)).toContain("Ready check in progress: 1 ready, 0 not ready, 0 no answer");
  });

  it("officers and group leaders see the page; other members do not", () => {
    expect(visibleTabs(openWindow(1))).toContain("Ready");
    expect(visibleTabs(openWindow(5))).not.toContain("Ready");
    const leader = openWindow(5, `function UnitIsGroupLeader() return true end`);
    expect(visibleTabs(leader)).toContain("Ready");
    leader.run(`NS.windowState().selectTabByName("Ready")`);
    expect(leader.chat().join(" ")).not.toContain("failed");
    const assistant = openWindow(5, `function UnitIsGroupAssistant() return true end`);
    expect(visibleTabs(assistant)).toContain("Ready");
  });
});

describe("the tools window in 4.6", () => {
  it("remembers where it was dragged and its size", () => {
    const s = openWindow(1);
    s.run(`local panel = _G.GuildedPanel or NS.windowState().tabs[1].page
      for _, f in ipairs(FRAMES) do if f.scripts.OnDragStop and f.GetPoint then PANEL = f end end`);
    s.run(`PANEL.GetPoint = function() return "TOPLEFT", nil, "TOPLEFT", 120.7, -80.2 end; PANEL.scripts.OnDragStop(PANEL)`);
    expect(s.run(`local p = GuildedDB.settings.panelPoint; return table.concat({ p[1], p[2], p[3], p[4] }, ",")`)).toBe("TOPLEFT,TOPLEFT,120,-81");
    s.run(`NS.commandHandlers["menu"]({ "scale", "bigger" })`);
    s.run(`NS.commandHandlers["menu"]({ "scale", "bigger" })`);
    expect(s.run("return GuildedDB.settings.panelScale")).toBe("1.2");
    s.run(`NS.commandHandlers["menu"]({ "scale", "9" })`);
    expect(s.run("return GuildedDB.settings.panelScale")).toBe("1.5");
    s.run(`NS.commandHandlers["menu"]({ "scale", "reset" })`);
    expect(s.run("return tostring(GuildedDB.settings.panelScale) .. ':' .. tostring(GuildedDB.settings.panelPoint)")).toBe("nil:nil");
  });

  it("has a key binding to open it", () => {
    const s = openWindow(5);
    expect(s.run("return type(Guilded_ToggleWindow) .. ':' .. BINDING_HEADER_GUILDED")).toBe("function:Guilded");
  });

  it("shows the Crafting page for everyone while the Recipes module is on", () => {
    const s = openWindow(5);
    s.run(`NS.windowState().selectTabByName("Crafting")`);
    expect(s.run("return NS.windowState().tabs[NS.windowState().currentTab].name")).toBe("Crafting");
    expect(s.chat().join("\n")).not.toContain("failed");
  });
});
