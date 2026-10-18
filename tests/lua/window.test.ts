import { afterEach, describe, expect, it } from "vitest";
import { addonSource, newLuaSession, type LuaSession } from "./harness.js";

// Builds the real tools window (Modules/Minimap.lua) against frames that answer
// with plausible values, to catch errors in the layout code and check who
// sees which tab and what the Home page says.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const RICH_FRAMES = String.raw`
  local numbers = { GetWidth = 100, GetHeight = 100, GetEffectiveScale = 1, GetFrameLevel = 1, GetLeft = 0, GetTop = 0, GetRight = 100, GetBottom = 0, GetStringWidth = 50 }
  function CreateFrame(_, frameName, parent)
    local f = { scripts = {}, shown = false, text = "", children = {}, points = {}, frameName = frameName }
    if parent and type(parent.children) == "table" then table.insert(parent.children, f) end
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

function openWindow(rank: number, extraLua = ""): LuaSession {
  session = newLuaSession();
  session.run(RICH_FRAMES);
  session.run(String.raw`
    GuildedDB = nil; NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    function GetGuildInfo() return "Alpha", "Rank", ${rank} end
    ${extraLua}
  `);
  for (const file of ["Core.lua", "Compat.lua", "Modules/Sync.lua", "Modules/SyncNow.lua", "Modules/LootRoll.lua", "Modules/ConsumableData.lua", "Modules/Consumables.lua", "Modules/Ready.lua", "Modules/Minimap.lua"]) session.load(file);
  session.run(`fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD"); NS.commandHandlers["menu"]()`);
  return session;
}

const visibleTabs = (s: LuaSession) => s.run(`local n = {}; for _, t in ipairs(NS.windowState().tabs) do if t.visible then n[#n + 1] = t.name end end; return table.concat(n, ",")`);
const homeText = (s: LuaSession, field: string) => s.run(`return NS.windowState().${field}.text`);

describe("standalone games host window", () => {
  it("builds without Guilded and starts a lobby through its actual button", () => {
    session = newLuaSession(); const s = session;
    s.run(RICH_FRAMES);
    s.run(`NS={}; function IsInGroup() return true end`);
    for (const file of ["Locale.lua", "Questions.lua", "Core.lua", "Window.lua"]) {
      s.run(`loadaddon("GuildedGames", [====[${addonSource(`../GuildedGames/${file}`)}]====], NS)`);
    }
    s.run(`NS.open(); for _, f in ipairs(FRAMES) do if f.text=="High roll" then f.scripts.OnClick(f); break end end`);
    expect(s.run(`return NS.state().game..":"..NS.state().phase`)).toBe("high:JOINING");
    // The window shows readable names, not the internal keys ("high - JOINING").
    expect(s.run(`return NS.L("high") .. " - " .. NS.L("JOINING")`)).toBe("High roll - Joining");
    expect(s.run(`return tostring(NS.util)..":"..tostring(GuildedDB)`)).toBe("nil:nil");
    s.run(`NS.cancel(); function InCombatLockdown() return true end; NS.open()`);
    expect(s.chat().join("\n")).toContain("after combat");
  });
});

describe("the tools window (sidebar and Home page)", () => {
  it("routes dungeon shortcuts to one pane and keeps calendar administration officer-only", () => {
    const s = openWindow(5);
    s.run(`NS.dungeonScorePanel = { open = function(mode) openedMode = mode end }
      NS.windowState().selectTabByName("Scores")`);
    expect(s.run("return openedMode")).toBe("season");
    s.run(`NS.windowState().selectTabByName("Dungeons")`);
    expect(s.run("return openedMode")).toBe("run");
    s.run(`CalendarFrame = CreateFrame(); NS.windowState().selectTabByName("Calendar")`);
    expect(s.run('return NS.windowState().scope')).toBe("main");
    expect(s.run('return tostring(CalendarFrame.shown)')).toBe("true");
    s.run(`NS.openGuildPanel(CalendarFrame, "calendar", "Calendar")`);
    expect(s.run('return NS.windowState().scope')).toBe("main");
    expect(s.run(`local n = {}; for _, t in ipairs(NS.windowState().tabs) do n[#n+1]=t.name end; return table.concat(n,",")`)).not.toMatch(/Dungeons|Season|Scores/);
    expect(s.run('return tostring(NS.windowState().homeSave == NS.windowState().sidebarSave)')).toBe("true");
  });

  it("gives each officer feature a single menu scope", () => {
    const s = openWindow(1);
    s.run(`NS.openGuildPanel(nil, "guild", "Standings")`);
    expect(visibleTabs(s)).toBe("Standings,Crafting,EPGP,Local guild");
    s.run(`NS.openGuildPanel(nil, "calendar", "Calendar")`);
    expect(visibleTabs(s)).toBe("Calendar");
  });

  it("keeps short guild pages stationary and anchors repeated calendar selections", () => {
    const s = openWindow(1);
    s.run(`HOST = CreateFrame(); NS.openGuildPanel(HOST, "guild", "EPGP")
      UI=NS.windowState(); UI.guildScroll.GetHeight=function() return 300 end
      UI.selectTabByName("EPGP")
      UI.guildScroll:GetScript("OnMouseWheel")(UI.guildScroll, -1)`);
    expect(s.run('return UI.guildScrollRange..":"..UI.guildScroll:GetVerticalScroll()')).toBe("0:0");
    expect(s.run('return tostring(UI.guildScroll.ScrollBar.shown)')).toBe("false");
    s.run(`NS.openGuildPanel(HOST,"calendar","Calendar"); UI.selectTabByName("Calendar"); UI.selectTabByName("Calendar")`);
    expect(s.run(`local p=UI.tabs[UI.currentTab].page; return tostring(#p.points==1 and p.points[1][1]=="TOPLEFT" and p.points[1][2]==UI.guildScroll)`)).toBe("true");
    s.run(`UI.guildScroll.GetHeight=function() return 100 end; NS.openGuildPanel(HOST,"guild","EPGP"); UI.guildScroll:GetScript("OnMouseWheel")(UI.guildScroll,-1)`);
    expect(s.run('return UI.guildScroll:GetVerticalScroll()')).toBe("24");
  });

  it("docks guild pages with the same permissions and restores the full menu", () => {
    const s = openWindow(5);
    s.run(`
      HOST = CreateFrame()
      HOST.GetWidth = function() return 800 end
      HOST.GetHeight = function() return 600 end
      NS.openGuildPanel(HOST)
    `);
    expect(visibleTabs(s)).toBe("Standings,Crafting");
    expect(s.run(`return NS.windowState().tabs[NS.windowState().currentTab].name`)).toBe("Standings");
    expect(s.run(`return tostring(NS.windowState().guildHost == HOST)`)).toBe("true");
    expect(s.run(`
      for _, f in ipairs(FRAMES) do
        if f.frameName == "GuildedPanel" then
          return tostring(f.scale == 1 and #f.points == 2 and f.points[1][1] == "TOPLEFT" and f.points[2][1] == "BOTTOMRIGHT")
        end
      end
    `)).toBe("true");
    expect(s.run(`return tostring(NS.windowState().tabs[1].page.level > 1000)`)).toBe("true");
    expect(s.run(`
      local ui = NS.windowState()
      return tostring(ui.guildScroll.scrollChild == ui.tabs[ui.currentTab].page and ui.guildScroll.shown)
    `)).toBe("true");
    s.run(`
      for _, f in ipairs(FRAMES) do if f.scripts.OnHide and f.scripts.OnShow then f.scripts.OnHide(f) end end
      NS.commandHandlers["menu"]()
      NS.commandHandlers["menu"]()
      for _, f in ipairs(FRAMES) do if f.scripts.OnShow then f.scripts.OnShow(f) end end
    `);
    expect(s.run(`return tostring(NS.windowState().guildHost == nil)`)).toBe("true");
    expect(s.run(`return tostring(NS.windowState().guildScroll.shown)`)).toBe("false");
    expect(s.run(`
      for _, f in ipairs(FRAMES) do if f.frameName == "GuildedPanel" then return tostring(f.width == 790 and f.height == 600) end end
    `)).toBe("true");
    expect(visibleTabs(s)).toContain("Home");
    expect(visibleTabs(s)).toContain("Me");
    expect(visibleTabs(s)).not.toContain("EPGP");
  });

  it("defers the guild tab in combat and does not replace native handlers", () => {
    const s = openWindow(1);
    s.run(`
      CommunitiesFrame = CreateFrame()
      CommunitiesFrame.ChatTab = false
      CommunitiesFrame.RosterTab = false
      CommunitiesFrame.GuildBenefitsTab = false
      CommunitiesFrame.SetDisplayMode = false
      CommunitiesFrame.GuildInfoTab = CreateFrame()
      CommunitiesFrame.GuildInfoTab:SetScript("OnClick", function() nativeClicked = true end)
      nativeHandler = CommunitiesFrame.GuildInfoTab:GetScript("OnClick")
      function InCombatLockdown() return true end
    `);
    // Guild integration loads with Minimap.lua, including on /reload.
    s.run(`NS.guildPanel.attach()`);
    expect(s.run(`return tostring(NS.guildPanel.tab == nil)`)).toBe("true");
    s.run(`function InCombatLockdown() return false end; NS.guildPanel.attach(); firstTab = NS.guildPanel.tab; NS.guildPanel.attach()`);
    expect(s.run(`return tostring(firstTab == NS.guildPanel.tab)`)).toBe("true");
    expect(s.run(`return tostring(CommunitiesFrame.GuildInfoTab:GetScript("OnClick") == nativeHandler)`)).toBe("true");
  });

  it("filters core rosters, uses each pool, and never changes the loot selection", () => {
    const s = openWindow(1, `
      GuildedStandings = { updatedAt = "2026-10-14", baseGp = 0, players = {
        { name = "Kev", ep = 100, gp = 10 }, { name = "Outsider", ep = 900, gp = 10 }
      } }
      GuildedLoot = { cores = {
        { id = "a", name = "Alpha", pool = true, baseGp = 10,
          players = { { name = "Kev", ep = 80, gp = 10 }, { name = "Outsider", ep = 900, gp = 10 } },
          roster = { { name = "Kev" }, { name = "Backup", backup = true } } },
        { id = "b", name = "Beta", pool = false, roster = { { name = "Outsider" } } }
      } }
    `);
    s.run(`NS.windowState().playerBox:SetText("Kev"); NS.windowState().selectTabByName("Standings")`);
    expect(homeText(s, "standingsView")).toBe("Core: Alpha");
    expect(homeText(s, "standingsList")).toContain("Kev");
    expect(homeText(s, "standingsList")).toContain("Backup");
    expect(homeText(s, "standingsList")).not.toContain("Outsider");
    expect(homeText(s, "standingsPlayer")).toContain("EP 80   GP 10   PR 4.00");
    s.run(`NS.getSettings().activeCore = "a"; NS.windowState().standingsView.scripts.OnClick()`);
    expect(homeText(s, "standingsView")).toBe("Core: Beta");
    expect(homeText(s, "standingsList")).toContain("Outsider");
    expect(homeText(s, "standingsList")).not.toContain("Kev");
    expect(homeText(s, "standingsScope")).toContain("shared guild");
    expect(homeText(s, "standingsPlayer")).toContain("not in this core");
    expect(s.run(`return NS.getSettings().activeCore`)).toBe("a");
    s.run(`NS.windowState().standingsView.scripts.OnClick()`);
    expect(homeText(s, "standingsView")).toBe("Guild-wide standings");
    expect(homeText(s, "standingsList")).toContain("Outsider");
    expect(homeText(s, "standingsPlayer")).toContain("EP 100");
    s.run(`NS.windowState().standingsView.scripts.OnClick(); NS.getDb().lootRules.cores[1].roster = {}; NS.windowState().selectTabByName("Standings")`);
    expect(homeText(s, "standingsList")).toContain("No characters in this view.");
    expect(homeText(s, "standingsList")).not.toContain("Outsider");
  });

  it("shows live priority answers on Loot as well as Council, with officer feedback", () => {
    const s = openWindow(1);
    s.load("Modules/Council.lua");
    s.run(`
      NS.getActiveRaid = function() return { test = true } end
      NS.council.startPriority("Test Sword", 20, 60)
      NS.council.addResponse("Seria", "os")
    `);
    expect(homeText(s, "bidStatus")).toContain("Seria  off-spec");
    expect(homeText(s, "councilStatus")).toContain("Seria  off-spec");
    expect(s.chat().join("\n")).toContain("Seria answered Off-spec for Test Sword.");
    s.run(`NS.council.addResponse("Seria", "os")`);
    expect(s.chat().filter(x => x.includes("answered Off-spec"))).toHaveLength(1);
    s.run(`NS.council.addResponse("Seria", "want")`);
    expect(homeText(s, "bidStatus")).toContain("Seria  wants it");
  });

  it("opens without errors and starts on Home", () => {
    const s = openWindow(1);
    expect(s.chat().join("\n")).not.toContain("failed");
    expect(s.run(`return NS.windowState().tabs[NS.windowState().currentTab].name`)).toBe("Home");
  });

  it("keeps the map shortcut and does not restore retired marker controls", () => {
    const s = openWindow(1, `
      local original = CreateFrame
      function CreateFrame(kind, name, ...)
        local frame = original(kind, name, ...)
        if name then _G[name] = frame end
        return frame
      end
    `);
    s.run(`
      local db = NS.getDb()
      db.raidPlans = { test = { boss = "Test", lines = { "Keep this" } } }
      db.markersShown = true
      db.markerWindow = { point = "CENTER", x = 12 }
      fire_event("PLAYER_LOGIN")
      function IsAltKeyDown() return true end
      NS.commandHandlers["map"] = function(args) MAP_ACTION = args[1] end
      GuildedMinimapButton.scripts.OnClick(GuildedMinimapButton, "LeftButton")
    `);
    expect(s.run("return MAP_ACTION")).toBe("open");
    expect(s.run("return tostring(NS.raidTools)")).toBe("nil");
    expect(s.run('return tostring(NS.commandHandlers["rt"])')).toBe("nil");
    expect(s.run('return NS.getDb().raidPlans.test.lines[1]')).toBe("Keep this");
    expect(s.run('return NS.getDb().markerWindow.x')).toBe("12");
    expect(s.chat().join("\n")).not.toContain("failed");
  });

  it("officers see every group in order; members only what they can use", () => {
    expect(visibleTabs(openWindow(1))).toBe("Home,Me,Ready,Reserves,Raid,Loot,Council,Tools");
    session?.close();
    expect(visibleTabs(openWindow(5))).toBe("Home,Me,Reserves,Tools");
  });

  it("Home says who you are, what is running, and why there is no standing yet", () => {
    const s = openWindow(1);
    expect(homeText(s, "homeGreeting")).toContain("Kev");
    expect(homeText(s, "homeGreeting")).toContain("Rank");   // the game's own rank name (mocked as "Rank")
    expect(homeText(s, "homeNow")).toContain("No raid is running");
    expect(homeText(s, "homeGear")).toContain("No gear check yet");
    expect(s.run(`return NS.windowState().syncStatus`)).toContain("Everything is saved");
  });

  it("Home shows the standing when Discord has sent it, and unsent changes when something happened", () => {
    const s = openWindow(1);
    s.run(`
      GuildedDB.standings = { updatedAt = "2026-09-28T00:00:00Z", baseGp = 0, players = { Kev = { ep = 120, gp = 40, pr = 3 } } }
      NS.syncNow.mark()
      SlashCmdList["GUILDED"]("menu"); SlashCmdList["GUILDED"]("menu")
    `);
    expect(s.run(`return NS.windowState().syncStatus`)).toContain("Changes are waiting");
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
      for (const file of ["Core.lua", "Compat.lua", "Modules/Sync.lua", "Modules/SyncNow.lua", "Modules/LootRoll.lua", "Modules/ConsumableData.lua", "Modules/Consumables.lua", "Modules/Ready.lua", "Modules/Loot.lua", "Modules/Minimap.lua"]) s.load(file);
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

describe("Home shows how fresh the shared data is (6.3)", () => {
  it("dates the standings and dungeon standings, and keeps the floating window opaque", () => {
    const s = openWindow(5, `
      function GetServerTime() return 1800000000 end
      GuildedDB = { settings = {}, standings = { updatedAt = "2027-01-15T08:00:00Z", players = {}, from = "companion" },
        dungeonBoard = { season = "S1", updatedAt = "2027-01-15T07:00:00Z", rows = {}, from = "Amy" } }`);
    s.run(`NS.windowState().selectTabByName("Home")`);
    const now = homeText(s, "homeNow");
    expect(now).toMatch(/Standings: Connected snapshot, (today|yesterday|\d\d\/\d\d) \d\d:\d\d\./);
    expect(now).toMatch(/Dungeon standings: .*, shared by Amy\./);
    expect(now).not.toContain("2027-01-15T");
    expect(s.run("return tostring(NS.windowState().solidBack.shown)")).toBe("true");
    s.run(`HOST = CreateFrame(); HOST.GetWidth = function() return 800 end; HOST.GetHeight = function() return 600 end; NS.openGuildPanel(HOST)`);
    expect(s.run("return tostring(NS.windowState().solidBack.shown)")).toBe("false");
  });
});
