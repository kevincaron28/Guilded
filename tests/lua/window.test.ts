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
    f.SetWidth = function(self, width) self.width = width end
    f.SetHeight = function(self, height) self.height = height end
    f.SetVerticalScroll = function(self, value) self.verticalScroll = value end
    f.GetVerticalScroll = function(self) return rawget(self, "verticalScroll") or 0 end
    -- Like the game's scrollbar: starts with a stale (short) range, clamps to it and snaps to its step,
    -- and moves its frame when its value changes.
    f.ScrollBar = {
      step = 1, max = 0,
      Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
      SetValueStep = function(self, v) self.step = v end,
      SetMinMaxValues = function(self, a, b) self.min = a; self.max = b end,
      GetMinMaxValues = function(self) return self.min or 0, self.max end,
      SetValue = function(self, v)
        v = math.max(self.min or 0, math.min(self.max, v))
        v = math.floor(v / self.step + 0.5) * self.step
        self.value = v
        f:SetVerticalScroll(v)
      end,
    }
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

describe("the five member tabs", () => {
  const shownGroups = (s: LuaSession) => s.run(`local n = {}; for _, g in ipairs({ "Home", "Guild", "Dungeons", "Crafting", "Raids", "Settings" }) do local b = NS.windowState().groupButtons[g]; if b and b.shown then n[#n + 1] = g end end; return table.concat(n, ",")`);
  const shownPages = (s: LuaSession) => s.run(`local n = {}; for _, t in ipairs(NS.windowState().tabs) do if t.button.shown then n[#n + 1] = t.name end end; return table.concat(n, ",")`);

  it("shows the five tabs and Settings, and only the open tab lists its pages", () => {
    const s = openWindow(5, `NS.dungeonScorePanel = { open = function(mode) openedMode = mode end }`);
    expect(shownGroups(s)).toBe("Home,Guild,Dungeons,Crafting,Raids,Settings");
    expect(shownPages(s)).toBe("Home,Me");
    s.run(`NS.windowState().groupButtons.Raids.scripts.OnClick()`);
    expect(shownPages(s)).toBe("Open raids,Reserves,Signups");
    s.run(`NS.windowState().groupButtons.Guild.scripts.OnClick()`);
    expect(shownPages(s)).toBe("Guild overview,Board,Standings,Availability,Duels");
  });

  it("shows Guild and Crafting as one page each, with their sections in a row at the top", () => {
    const s = openWindow(5);
    const row = () => s.run(`local out = {}; for _, t in ipairs(NS.windowState().tabs) do if t.button.shown then local p = t.button.points[#t.button.points]; out[#out + 1] = t.name .. "@" .. tostring(p[5]) end end; return table.concat(out, ",")`);
    s.run(`NS.windowState().groupButtons.Guild.scripts.OnClick()`);
    expect(row()).toBe("Guild overview@-12,Board@-12,Standings@-12,Availability@-12,Duels@-12");
    expect(s.run(`return NS.windowState().pageTitle.text`)).toBe("");
    s.run(`NS.windowState().groupButtons.Crafting.scripts.OnClick()`);
    expect(row()).toBe("Crafting@-12,Orders@-12");
    expect(s.run(`return NS.windowState().tabs[NS.windowState().currentTab].name`)).toBe("Crafting");
    // Old names open the right section of the right tab.
    s.run(`NS.windowState().selectTabByName("Availability")`);
    expect(s.run(`return NS.windowState().tabs[NS.windowState().currentTab].group`)).toBe("Guild");
    s.run(`NS.windowState().selectTabByName("Orders")`);
    expect(row()).toBe("Crafting@-12,Orders@-12");
  });

  it("keeps every old page name working", () => {
    const s = openWindow(5, `NS.dungeonScorePanel = { open = function(mode) openedMode = mode end }`);
    for (const [name, group] of [["Home", "Home"], ["Me", "Home"], ["Board", "Guild"], ["Orders", "Crafting"], ["Open raids", "Raids"], ["Signups", "Raids"], ["Duels", "Guild"], ["Tools", "Settings"], ["Announcements", "Settings"], ["Info", "Settings"]]) {
      s.run(`NS.windowState().selectTabByName("${name}")`);
      expect(s.run(`return NS.windowState().tabs[NS.windowState().currentTab].group`), name).toBe(group);
    }
    s.run(`NS.windowState().selectTabByName("Dungeons")`);
    expect(s.run("return openedMode")).toBe("run");
  });

  it("opens Standings from the Guild page and Dungeons from its tab", () => {
    const s = openWindow(5, `NS.dungeonScorePanel = { open = function(mode) openedMode = mode end }`);
    s.run(`NS.windowState().groupButtons.Guild.scripts.OnClick()`);
    s.run(`for _, t in ipairs(NS.windowState().tabs) do if t.name == "Standings" then t.button.scripts.OnClick() end end`);
    expect(s.run("return NS.windowState().tabs[NS.windowState().currentTab].name")).toBe("Standings");
    s.run(`NS.windowState().groupButtons.Dungeons.scripts.OnClick()`);
    expect(s.run("return openedMode")).toBe("run");
  });
  it("shows the raid-night tools to a raid leader or officer under Raids, not hidden until a raid starts", () => {
    const s = openWindow(1);
    s.run(`NS.windowState().groupButtons.Raids.scripts.OnClick()`);
    const pages = s.run(`local n = {}; for _, t in ipairs(NS.windowState().tabs) do if t.button.shown then n[#n + 1] = t.name end end; return table.concat(n, ",")`);
    for (const name of ["Open raids", "Signups", "Ready", "Raid"]) expect(pages).toContain(name);
    expect(s.run(`return tostring(NS.windowState().groupButtons.Raids.shown)`)).toBe("true");
  });
});

describe("the section rows of the Guild and Crafting pages", () => {
  it("keep every button inside the page width, sized to its text, in English", () => {
    const s = openWindow(1);
    for (const group of ["Guild", "Crafting"]) {
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
      }
    }
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
    s.run(`NS.windowState().selectTabByName("Calendar")`);
    expect(s.run("return NS.windowState().tabs[NS.windowState().currentTab].name")).toBe("Home");
    expect(s.run(`local n = {}; for _, t in ipairs(NS.windowState().tabs) do n[#n+1]=t.name end; return table.concat(n,",")`)).not.toMatch(/Season|Scores/);
    expect(s.run('return tostring(NS.windowState().homeSave == NS.windowState().sidebarSave)')).toBe("true");
  });

  it("keeps long review reports in a scrollable viewport without dropping lines", () => {
    const s = openWindow(1);
    s.run('NS.showCopyText(string.rep("Review row\\n", 50), "Audit")');
    expect(s.run('for _,f in ipairs(FRAMES) do if f.frameName=="GuildedCharacterExport" then return f.scroll.height..":"..f.box.height end end')).toBe("240:824");
    expect(s.run('for _,f in ipairs(FRAMES) do if f.frameName=="GuildedCharacterExport" then return tostring(f.scroll.scrollChild==f.box) end end')).toBe("true");
    s.run('NS.showCopyText("GGRM1:fixture", "Archive")');
    expect(s.run('for _,f in ipairs(FRAMES) do if f.frameName=="GuildedCharacterExport" then return f.scroll.height..":"..f.box.text end end')).toBe("24:GGRM1:fixture");
  });

  it("puts the officer pages in one Officer tab, for officers only", () => {
    const s = openWindow(1);
    s.run(`NS.windowState().groupButtons.Officer.scripts.OnClick()`);
    expect(s.run(`local n = {}; for _, t in ipairs(NS.windowState().tabs) do if t.group == "Officer" and t.button.shown then n[#n + 1] = t.name end end; return table.concat(n, ",")`))
      .toBe("Gear,Calendar,EPGP,Local guild,Roster admin,Officer tools");
    session?.close();
    const member = openWindow(5);
    expect(member.run("return tostring(NS.windowState().groupButtons.Officer)")).toBe("nil");
  });
  it("keeps short officer pages stationary and anchors repeated calendar selections", () => {
    const s = openWindow(1);
    s.run(`UI=NS.windowState(); UI.selectTabByName("Roster admin"); UI.guildScroll.GetHeight=function() return 300 end
      UI.selectTabByName("Roster admin")
      UI.guildScroll:GetScript("OnMouseWheel")(UI.guildScroll, -1)`);
    expect(s.run('return UI.guildScrollRange..":"..UI.guildScroll:GetVerticalScroll()')).toBe("0:0");
    expect(s.run('return tostring(UI.guildScroll.ScrollBar.shown)')).toBe("false");
    s.run(`UI.selectTabByName("Calendar"); UI.selectTabByName("Calendar")`);
    expect(s.run(`local p=UI.tabs[UI.currentTab].page; return tostring(#p.points==1 and p.points[1][1]=="TOPLEFT" and p.points[1][2]==UI.guildScroll)`)).toBe("true");
    s.run(`UI.guildScroll.GetHeight=function() return 100 end; UI.selectTabByName("EPGP"); UI.guildScroll:GetScript("OnMouseWheel")(UI.guildScroll,-1)`);
    expect(s.run('return UI.guildScroll:GetVerticalScroll()')).toBe("48");
  });

  it("scrolls the long pages and leaves the short ones on the window", () => {
    const s = openWindow(1);
    s.run(`UI = NS.windowState(); UI.selectTabByName("Standings")`);
    expect(s.run("return tostring(UI.guildScroll.shown and UI.guildScroll.scrollChild == UI.tabs[UI.currentTab].page)")).toBe("true");
    s.run(`UI.selectTabByName("Home")`);
    expect(s.run("return tostring(UI.guildScroll.shown)")).toBe("false");
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

  it("gives a raid leader who is not an officer the Raids pages but no Officer tab", () => {
    const s = openWindow(5, `function UnitIsGroupLeader() return true end`);
    const tabs = visibleTabs(s);
    for (const name of ["Ready", "Open raids", "Signups"]) expect(tabs).toContain(name);
    for (const name of ["Raid", "Gear", "EPGP", "Local guild", "Roster admin", "Officer tools"]) expect(tabs).not.toContain(name);
    expect(s.run("return tostring(NS.windowState().groupButtons.Officer)")).toBe("nil");
    expect(s.run("return tostring(NS.windowState().groupButtons.Raids ~= nil)")).toBe("true");
  });

  it("adds the Guilded tab to the guild window when that window loads later, and opens the main window from it", () => {
    const s = openWindow(5);
    s.run(`function InCombatLockdown() return false end; NS.guildPanel.attach()`);
    expect(s.run("return tostring(NS.guildPanel.tab == nil)")).toBe("true"); // no guild window yet: nothing breaks
    s.run(`
      CommunitiesFrame = CreateFrame()
      CommunitiesFrame.ChatTab = false; CommunitiesFrame.RosterTab = false; CommunitiesFrame.GuildBenefitsTab = false
      CommunitiesFrame.SetDisplayMode = false; CommunitiesFrame.GuildInfoTab = CreateFrame()
      fire_event("ADDON_LOADED")
      for _, f in ipairs(FRAMES) do if f.frameName == "GuildedPanel" then PANEL = f end end; PANEL:Hide()`);
    expect(s.run("return tostring(NS.guildPanel.tab ~= nil)")).toBe("true");
    s.run(`NS.guildPanel.tab.scripts.OnClick(NS.guildPanel.tab)`);
    expect(s.run("return tostring(PANEL:IsShown())")).toBe("true");
    expect(s.run("return NS.windowState().tabs[NS.windowState().currentTab].group")).toBe("Guild");
  });

  it("adds the calendar button when the calendar loads later, for officers only, and it opens the Calendar page", () => {
    const officer = openWindow(1);
    officer.run("NS.guildPanel.calendarTab = nil; fire_event('PLAYER_LOGIN')");
    expect(officer.run("return tostring(NS.guildPanel.calendarTab == nil)")).toBe("true"); // no calendar yet
    officer.run(`CalendarFrame = CreateFrame(); fire_event("ADDON_LOADED")`);
    expect(officer.run("return tostring(NS.guildPanel.calendarTab ~= nil and NS.guildPanel.calendarTab.shown)")).toBe("true");
    officer.run("NS.guildPanel.calendarTab.scripts.OnClick(NS.guildPanel.calendarTab)");
    expect(officer.run("return NS.windowState().tabs[NS.windowState().currentTab].name")).toBe("Calendar");
    session?.close();
    const member = openWindow(5);
    member.run(`CalendarFrame = CreateFrame(); fire_event("ADDON_LOADED")`);
    expect(member.run("return tostring(NS.guildPanel.calendarTab ~= nil and NS.guildPanel.calendarTab.shown == true)")).toBe("false");
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
      NS.commandHandlers["map"] = function(args) MAP_ACTION = args[1] end
      GuildedMinimapButton.scripts.OnClick(GuildedMinimapButton, "RightButton")
      for _, f in ipairs(FRAMES) do if f.frameName == "GuildedQuickMenu" then f.buttons[2].scripts.OnClick() end end
    `);
    expect(s.run("return MAP_ACTION")).toBe("open");
    expect(s.run("return tostring(NS.raidTools)")).toBe("nil");
    expect(s.run('return tostring(NS.commandHandlers["rt"])')).toBe("nil");
    expect(s.run('return NS.getDb().raidPlans.test.lines[1]')).toBe("Keep this");
    expect(s.run('return NS.getDb().markerWindow.x')).toBe("12");
    expect(s.chat().join("\n")).not.toContain("failed");
  });

  it("Info and data runs the formerly slash-only commands from buttons", () => {
    const s = openWindow(1);
    s.run(`CALLED = {}
      for _, name in ipairs({ "peers", "relay", "professions", "names", "bgcapture", "ledgersync", "bridge", "options", "digest", "chattags", "invites", "promote", "autoinvite", "lootroll", "consumes" }) do
        NS.commandHandlers[name] = function(args) CALLED[#CALLED + 1] = name .. ":" .. table.concat(args or {}, ",") end
      end
      NS.windowState().selectTabByName("Info")`);
    const labels = ["Who runs which version", "Data relay status", "Sync EP/GP history now", "Interface options", "Digest off", "Invite queue", "Pending loot rolls"];
    for (const label of labels) s.run(`for _, f in ipairs(FRAMES) do if f.text == "${label}" and f.scripts.OnClick then f.scripts.OnClick(f) end end`);
    expect(s.run(`return table.concat(CALLED, ";")`)).toBe("peers:;relay:;ledgersync:now;options:;digest:off;invites:;lootroll:");
  });

  it("officers see every group in order; members only what they can use", () => {
    expect(visibleTabs(openWindow(1))).toBe("Home,Guild overview,Board,Crafting,Orders,Me,Open raids,Standings,Availability,Gear,Ready,Reserves,Signups,Calendar,Raid,EPGP,Local guild,Roster admin,Officer tools,Loot,Council,Duels,Tools");
    session?.close();
    expect(visibleTabs(openWindow(5))).toBe("Home,Guild overview,Board,Crafting,Orders,Me,Open raids,Standings,Availability,Reserves,Signups,Duels,Tools");
  });

  it("lets ordinary members page through open raids, filter them and copy the matching host", () => {
    const s = openWindow(5);
    s.load("Modules/PublicRaids.lua");
    s.run(`
      function GetServerTime() return NS.util.isoEpoch("2026-10-20T18:00:00Z") end
      GuildedPublicRaids = { fetchedAt = "2026-10-20T18:00:00Z", raids = {} }
      for i = 1, 7 do GuildedPublicRaids.raids[i] = {
        title = "Raid " .. i, guildName = "Host", at = "2026-10-21T18:00:00Z", realm = "Forever",
        faction = "HORDE", language = "fr", tanks = 0, healers = 1, dps = 0, inviteUrl = "https://discord.gg/host" .. i
      } end
      NS.showCopyText = function(t) COPIED = t end
      NS.commandHandlers.pug({})
      NS.windowState().pugRealm:SetText("")
      NS.windowState().refreshPugs()
    `);
    expect(s.run("return NS.windowState().tabs[NS.windowState().currentTab].name")).toBe("Open raids");
    expect(homeText(s, "pugPages")).toBe("1 / 3");
    s.run("NS.windowState().pugPage = 2; NS.windowState().refreshPugs(); NS.windowState().pugRows[1].button.scripts.OnClick()");
    expect(s.run("return COPIED")).toBe("https://discord.gg/host4");
    s.run('NS.windowState().pugRealm:SetText("Other"); NS.windowState().refreshPugs()');
    expect(s.run("return NS.windowState().pugRows[1].label.text")).toContain("No open raids");
    expect(s.run("return tostring(NS.windowState().pugRows[1].button.shown)")).toBe("false");
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
  it("builds availability filters and routes clicks without changing observation settings", () => {
    const s = openWindow(5);
    s.run(`NS.presence = { describe = function(filter) FILTER = filter; return "Visible reports" end, heatmap = function() return {} end }; NS.windowState().selectTabByName("Availability")`);
    expect(s.run(`return NS.windowState().presenceText.text`)).toBe("Visible reports");
    s.run(`for _, f in ipairs(FRAMES) do if f.text == "Free only: Off" and f.scripts.OnClick then f.scripts.OnClick(f) end end`);
    expect(s.run(`return tostring(FILTER.free)`)).toBe("true");
    expect(s.run(`for _, f in ipairs(FRAMES) do if f.text == "Blizzard group finder" then return "found" end end return "none"`)).toBe("none");
    expect(s.chat().join("\n")).not.toContain("failed");
  });
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
  });
});

describe("in-game UI fixes from the 5 November pass", () => {
  it("scrolls with a useful step and keeps padding under the last row", () => {
    const s = openWindow(1);
    // 24 modules x 22 px + 16 px padding, in a 100 px viewport.
    expect(s.run("local m = NS.layoutMath; return m.scrollRange(500, 300) .. ':' .. m.SCROLL_STEP .. ':' .. m.SCROLL_PADDING")).toBe("224:48:24");
    s.run(`UI = NS.windowState(); UI.moduleScroll:GetScript("OnMouseWheel")(UI.moduleScroll, -1)`);
    expect(s.run("return UI.moduleScroll:GetVerticalScroll()")).toBe("48");
    s.run(`for _ = 1, 100 do UI.moduleScroll:GetScript("OnMouseWheel")(UI.moduleScroll, -1) end`);
    expect(s.run("return tostring(UI.moduleScroll:GetVerticalScroll() == NS.layoutMath.scrollRange(#NS.MODULES * 22 + NS.layoutMath.SCROLL_PADDING, 100))")).toBe("true");
    s.run(`UI.moduleScroll:GetScript("OnMouseWheel")(UI.moduleScroll, 1000)`);
    expect(s.run("return UI.moduleScroll:GetVerticalScroll()")).toBe("0");
  });

  it("lets the wheel reach the very end even when the scrollbar's own range is stale or stepped", () => {
    const s = openWindow(1);
    s.run(`UI = NS.windowState(); BAR = UI.moduleScroll.ScrollBar`);
    expect(s.run("return BAR.max")).toBe("0"); // stale: the game has not re-measured yet
    const end = "NS.layoutMath.scrollRange(#NS.MODULES * 22 + NS.layoutMath.SCROLL_PADDING, 100)";
    s.run(`for _ = 1, 100 do UI.moduleScroll:GetScript("OnMouseWheel")(UI.moduleScroll, -1) end`);
    expect(s.run(`return tostring(UI.moduleScroll:GetVerticalScroll() == ${end})`)).toBe("true");
    // One tick moves a useful distance and the bar keeps its step at 1 (no 48 px snapping).
    expect(s.run("return BAR.step")).toBe("1");
    s.run(`UI.moduleScroll:SetVerticalScroll(0); BAR:SetValue(0); NS.resetScrollWanted(UI.moduleScroll); UI.moduleScroll:GetScript("OnMouseWheel")(UI.moduleScroll, -1)`);
    expect(s.run("return UI.moduleScroll:GetVerticalScroll()")).toBe("48");
  });

  it("prints scroll numbers for /guilded debug scroll without needing /script", () => {
    const s = openWindow(1);
    s.run(`UI = NS.windowState(); UI.selectTabByName("Standings")
      UI.guildScroll:GetScript("OnMouseWheel")(UI.guildScroll, -1); NS.commandHandlers.debug({ "scroll" })`);
    const out = s.chat().join(" | ");
    expect(out).toContain("scroll debug, page Standings");
    expect(out).toContain("estimated range=");
    expect(out).toContain("wheel ticks=1");
  });

  it("has one Settings tab: announcements are inside it, Info and data is its closed Advanced view", () => {
    const s = openWindow(1);
    const names = s.run(`local names = {}; for _, t in ipairs(NS.windowState().tabs) do names[#names + 1] = t.name end; return table.concat(names, ",")`);
    expect(names).not.toContain("Announcements");
    expect(names).not.toContain("Info");
    expect(names).toContain("Tools");
    // Closed by default; the old page names still open Settings (Info opens the Advanced view).
    s.run(`NS.windowState().selectTabByName("Tools")`);
    expect(s.run(`return tostring(NS.windowState().settingsAdvanced:IsShown())`)).toBe("false");
    expect(s.run(`return tostring(NS.windowState().settingsGeneral:IsShown())`)).toBe("true");
    // From another tab (showing the page resets it to the general view first).
    s.run(`NS.windowState().selectTabByName("Home")`);
    s.run(`NS.windowState().selectTabByName("Info")`);
    expect(s.run(`return tostring(NS.windowState().settingsAdvanced:IsShown())`)).toBe("true");
    expect(s.run(`return tostring(NS.windowState().settingsGeneral:IsShown())`)).toBe("false");
    s.run(`NS.windowState().selectTabByName("Home")`);
    s.run(`NS.windowState().selectTabByName("Announcements")`);
    expect(s.run(`return tostring(NS.windowState().settingsAdvanced:IsShown())`)).toBe("false");
    expect(s.run(`return tostring(NS.windowState().announceChecks ~= nil)`)).toBe("true");
  });

  it("lays the Settings page out without overlaps, with the call alerts in the scrolling Advanced view", () => {
    const s = openWindow(1);
    // Every widget anchored TOPLEFT to its parent: its box from the anchor and its own size (a check box adds its label).
    const report = s.run(String.raw`
      local W = NS.windowState()
      local function box(f)
        local p = f.points[1]
        local w = rawget(f, "width") or 100
        -- The frames' fixed string width (50) widens every short button to 70 here: size those by their text instead.
        local text = rawget(f, "text")
        if w == 70 and type(text) == "string" then w = math.max(30, #text * 7 + 20) end
        local h = rawget(f, "height") or 22
        local label = rawget(f, "label")
        if type(label) == "table" and type(label.text) == "string" then w = w + 2 + #label.text * 6 end
        return p[4], p[5], w, h
      end
      local problems, count = {}, 0
      local function walk(parent)
        local list = {}
        for _, f in ipairs(parent.children) do
          local p = f.points[1]
          if p and p[1] == "TOPLEFT" and p[2] == parent and type(p[4]) == "number" and type(p[5]) == "number" then list[#list + 1] = f end
          walk(f)
        end
        for i = 1, #list do
          local x1, y1, w1, h1 = box(list[i])
          count = count + 1
          for j = i + 1, #list do
            local x2, y2, w2, h2 = box(list[j])
            if x1 < x2 + w2 and x2 < x1 + w1 and y1 > y2 - h2 and y2 > y1 - h1 then
              problems[#problems + 1] = string.format("(%d,%d %dx%d) overlaps (%d,%d %dx%d)", x1, y1, w1, h1, x2, y2, w2, h2)
            end
          end
        end
      end
      walk(W.settingsGeneral)
      walk(W.settingsAdvanced)
      return count .. "|" .. table.concat(problems, "; ")`);
    const [count, problems] = report.split("|");
    expect(Number(count)).toBeGreaterThan(20);
    expect(problems).toBe("");
    // The block is in the Advanced view (which scrolls), not squeezed into the general page above the Modules list.
    expect(s.run(`return tostring(NS.windowState().callAlertSound ~= nil) .. tostring(NS.windowState().callAlertHeight)`)).toBe("true112");
    expect(s.run(`local W = NS.windowState(); local function inside(parent, target) for _, f in ipairs(parent.children) do if f == target or inside(f, target) then return true end end return false end return tostring(inside(W.settingsAdvanced, W.callAlertSound)) .. tostring(inside(W.settingsGeneral, W.callAlertSound))`)).toBe("truefalse");
    // The block fits in its reserved height: label 0, buttons -16, checks -44 and -68, status -94 (+ line).
    expect(s.run(`local W = NS.windowState(); return W.callAlertStatus.points[1][5] - W.callAlertSound.points[1][5]`)).toBe("-50");
  });

  it("shows every member that an officer turned announcements off for the guild", () => {
    const s = openWindow(5, `NS.milestones = { enabled = function() return true end, guildOff = function() return true end }`);
    s.run(`NS.windowState().selectTabByName("Announcements"); NS.windowState().refreshAnnouncements()`);
    expect(s.run(`return NS.windowState().announceStatus.text`)).toBe("Milestone announcements are turned off for the whole guild by an officer.");
  });

  it("hangs the Modules heading below the help text instead of at a fixed offset", () => {
    const s = openWindow(5);
    expect(s.run(`local top; for _, p in ipairs(NS.windowState().moduleScroll.points) do if p[1] == "TOPLEFT" then top = p end end
      return tostring(top[2] ~= nil and top[3] == "BOTTOMLEFT" and top[5] == -6)`)).toBe("true");
  });

  it("offers linking on Home, saves a pasted code through the same command, and shows the state", () => {
    const s = openWindow(5, `function IsInGuild() return true end; GetInventoryItemLink = function() return nil end`);
    s.run(`NS.windowState().selectTabByName("Home")`);
    expect(homeText(s, "linkStatus")).toContain("Not linked to Discord yet.");
    s.run(`UI = NS.windowState(); UI.linkBox:SetText("abcd-efgh"); UI.linkBox:GetScript("OnEnterPressed")(UI.linkBox)`);
    expect(s.run("return GuildedDB.verifyCode")).toBe("ABCDEFGH");
    expect(homeText(s, "linkStatus")).toContain("Code saved");
    // Once the member shows up in the shared standings, the addon knows they are linked.
    s.run(`NS.getStanding = function() return { ep = 1, gp = 1, pr = 1 } end; NS.windowState().selectTabByName("Home")`);
    expect(homeText(s, "linkStatus")).toContain("Linked to Discord.");
  });

  it("hides the link block for guilds without Discord and for players outside a guild", () => {
    const s = openWindow(5, `function IsInGuild() return false end`);
    s.run(`NS.windowState().selectTabByName("Home")`);
    expect(s.run("return tostring(NS.windowState().linkStatus.shown)")).toBe("false");
  });

  it("no longer sends officers to a Loot tab the guild window does not have", () => {
    const s = openWindow(1);
    const labels = s.run(`local out = {}; for _, f in ipairs(FRAMES) do if f.text and f.text ~= "" then out[#out + 1] = f.text end end; return table.concat(out, " ")`);
    expect(labels).not.toContain("are on the Loot tab");
    expect(labels).toContain("Loot page of the /guilded window");
  });

  it("hides the Unsent changes block on pages that only read", () => {
    const s = openWindow(5);
    s.run(`UI = NS.windowState(); UI.selectTabByName("Open raids")`);
    expect(s.run("return tostring(UI.sidebarSync.shown)")).toBe("false");
    s.run(`UI.selectTabByName("Home")`);
    expect(s.run("return tostring(UI.sidebarSync.shown)")).toBe("true");
  });

  it("starts Open raids on the player's own realm and hides paging for a single page", () => {
    const s = openWindow(5, `function GetRealmName() return "Forever" end`);
    expect(s.run("return NS.windowState().pugRealm:GetText()")).toBe("Forever");
    s.load("Modules/PublicRaids.lua");
    s.run(`NS.windowState().refreshPugs()`);
    expect(s.run("return tostring(NS.windowState().pugPaging[1].shown)")).toBe("false");
  });

});

describe("minimap button shortcuts (Track E2)", () => {
  const setup = (rank = 5) => {
    const s = openWindow(rank);
    s.run(String.raw`
      KEYS = {}
      function IsAltKeyDown() return KEYS.alt == true end
      function IsShiftKeyDown() return KEYS.shift == true end
      function IsControlKeyDown() return KEYS.ctrl == true end
      COMBAT = false
      function InCombatLockdown() return COMBAT end
      DONE = {}
      NS.runCommand = function(text) DONE[#DONE + 1] = text end
      NS.dungeonScorePanel = { open = function(mode) DONE[#DONE + 1] = "dungeons " .. mode end }
    `);
    return s;
  };
  const click = (s: LuaSession, button: string, keys = "") =>
    s.run(`KEYS = { ${keys} }; return NS.minimapClick(${JSON.stringify(button)})`);

  it("routes each click to its action", () => {
    const s = setup();
    expect(click(s, "LeftButton")).toBe("window");
    // The other modifier clicks are gone: they open the window like a plain click.
    expect(click(s, "LeftButton", "shift = true")).toBe("window");
    expect(click(s, "LeftButton", "ctrl = true")).toBe("window");
    expect(click(s, "LeftButton", "alt = true")).toBe("window");
    expect(click(s, "MiddleButton")).toBe("window");
    expect(click(s, "RightButton")).toBe("menu");
    expect(click(s, "RightButton", "shift = true")).toBe("unavailable");
    s.run(`NS.callForHelp = { open = function() DONE[#DONE + 1] = "sos" end }; COMBAT = true`);
    expect(click(s, "RightButton", "shift = true")).toBe("help"); // works in combat
    expect(s.run(`return table.concat(DONE, ",")`)).toBe("sos");
  });
  it("lists the short set of clicks in the tooltip", () => {
    const s = setup();
    s.run(`TIP = {}; GameTooltip = { SetOwner = function() end, AddLine = function(_, t) TIP[#TIP + 1] = t end, Show = function() end, Hide = function() end }
      Guilded_OnAddonCompartmentEnter(nil, UIParent)`);
    const tip = s.run(`return table.concat(TIP, "|")`);
    for (const word of ["Left-click", "Right-click: quick menu"]) expect(tip).toContain(word);
    for (const word of ["Shift-click", "Ctrl-click", "Alt-click", "Middle-click"]) expect(tip).not.toContain(word);
  });
  it("does nothing protected in combat, apart from toggling Guilded's own window", () => {
    const s = setup();
    s.run(`COMBAT = true`);
    expect(click(s, "RightButton")).toBe("blocked");
    expect(s.run(`return #DONE`)).toBe("0");
  });

  it("hides the click catcher when the menu closes by Escape, so the next click reaches the button", () => {
    const s = setup();
    click(s, "RightButton");
    s.run(`for _, f in ipairs(FRAMES) do if f.frameName == "GuildedQuickMenu" then MENU = f end end`);
    expect(s.run(`return tostring(MENU.catcher.shown)`)).toBe("true");
    // Escape hides the frame through UISpecialFrames; the game then runs its OnHide script.
    s.run(`MENU:Hide(); MENU.scripts.OnHide(MENU)`);
    expect(s.run(`return tostring(MENU.catcher.shown)`)).toBe("false");
    expect(click(s, "LeftButton")).toBe("window");
  });

  it("the quick menu has four items: dungeons, guild map, call for help, settings", () => {
    const s = setup();
    click(s, "RightButton");
    s.run(`for _, f in ipairs(FRAMES) do if f.frameName == "GuildedQuickMenu" then MENU = f end end`);
    expect(s.run(`return tostring(#MENU.buttons)`)).toBe("3");
    s.run(`NS.callForHelp = { open = function() DONE[#DONE + 1] = "help" end }`);
    click(s, "RightButton");
    const names = s.run(`local t = {}; for i = 1, #MENU.buttons do if MENU.buttons[i].shown then t[#t + 1] = MENU.buttons[i].text.text end end; return table.concat(t, ",")`);
    expect(names).toBe("Dungeons,Guild map,Call for help,Settings");
  });});

// 8.5 in-game test (French Forever): the minimap button was missing and /guilded minimap show was silent.
describe("the minimap button", () => {
  // A frame that really reports whether it is visible, and a client that rejects the middle button and the highlight texture.
  const STRICT_CLIENT = String.raw`
    local make = CreateFrame
    function CreateFrame(kind, frameName, ...)
      local f = make(kind, frameName, ...)
      if frameName == "GuildedMinimapButton" then
        MINIMAP_BUTTON = f
        f.IsVisible = function(self) return self.shown end
        f.RegisterForClicks = function(self, ...)
          for _, name in ipairs({ ... }) do if name == "MiddleButtonUp" then error("unknown click type") end end
          self.clicks = { ... }
        end
        f.SetHighlightTexture = function() error("no such texture") end
      end
      return f
    end
  `;
  const minimap = (s: LuaSession, ...args: string[]) => s.run(`NS.commandHandlers["minimap"]({ ${args.map((a) => JSON.stringify(a)).join(", ")} }); return NS.windowState and "ok" or "ok"`);

  it("is anchored and shown even when the client refuses parts of its setup", () => {
    const s = openWindow(1, STRICT_CLIENT);
    expect(s.run(`return tostring(MINIMAP_BUTTON.shown) .. ":" .. #MINIMAP_BUTTON.points .. ":" .. #MINIMAP_BUTTON.clicks`)).toBe("true:1:2");
  });

  it("always says what show, hide and reset did", () => {
    const s = openWindow(1, STRICT_CLIENT);
    minimap(s, "hide");
    expect(s.chat().join("\n")).toContain("Minimap button hidden");
    expect(s.run(`return tostring(MINIMAP_BUTTON.shown)`)).toBe("false");
    minimap(s, "show");
    expect(s.chat().join("\n")).toContain("Minimap button shown");
    expect(s.run(`return tostring(MINIMAP_BUTTON.shown) .. ":" .. tostring(GuildedDB.settings.minimapHidden)`)).toBe("true:false");
    minimap(s, "reset");
    expect(s.chat().filter((line) => line.includes("Minimap button shown")).length).toBe(2);
  });

  it("defaults to the lower right, away from the game's own round buttons (9.0.1)", () => {
    const s = openWindow(1, STRICT_CLIENT);
    // Button x/y offset from the minimap centre: lower right is positive x, negative y.
    expect(s.run(`local p = MINIMAP_BUTTON.points[#MINIMAP_BUTTON.points]; return (p[4] > 0 and p[5] < 0) and "lower-right" or (p[4] .. "," .. p[5])`)).toBe("lower-right");
  });

  it("moves a position saved at the old default once, and keeps a dragged one", () => {
    const moved = openWindow(1, STRICT_CLIENT + `
      GuildedDB = { settings = { minimapAngle = math.rad(220) } }`);
    expect(moved.run(`return tostring(GuildedDB.settings.minimapAngle)`)).toBe("nil");
    expect(moved.run(`return tostring(GuildedDB.settings.minimapAngleMoved)`)).toBe("true");
    const custom = openWindow(1, STRICT_CLIENT + `
      GuildedDB = { settings = { minimapAngle = math.rad(100) } }`);
    expect(custom.run(`return string.format("%.2f", GuildedDB.settings.minimapAngle)`)).toBe("1.75");
  });

  it("moves the button onto the screen when the minimap itself is hidden", () => {
    const s = openWindow(1, STRICT_CLIENT);
    // Button shows but the game says it is not visible (its parent is hidden).
    s.run(`MINIMAP_BUTTON.IsVisible = function() return false end`);
    minimap(s, "show");
    expect(s.chat().join("\n")).toContain("top right of the screen");
    expect(s.run(`return MINIMAP_BUTTON.points[1][1]`)).toBe("TOPRIGHT");
  });
});

describe("Home page link buttons (8.5 in-game fix)", () => {
  it("puts Remove code right beside Save code, so a longer translation cannot overlap it", () => {
    const s = openWindow(1);
    const anchor = s.run(`local save, remove
      for _, f in ipairs(FRAMES) do
        if f.text == "Save code" then save = f end
        if f.text == "Remove code" then remove = f end
      end
      local p = remove.points[#remove.points]
      return p[1] .. ":" .. p[3] .. ":" .. tostring(p[2] == save) .. ":" .. p[4]`);
    expect(anchor).toBe("LEFT:RIGHT:true:6");
  });
});
