-- Guilded in the game's own options (Esc > Options > AddOns > Guilded), for the settings
-- that were slash-command only. Every switch runs the same /guilded command you could type,
-- so the permission checks and messages are the same.
--
--   /guilded options   opens this page
local addonName, ns = ...
ns = ns or {}

local module = {}
ns.options = module

local function L(text) return ns.L and ns.L(text) or text end

local function settings() return ns.getSettings and ns.getSettings() end
local function db() return ns.getDb and ns.getDb() end

local function run(line)
  if ns.runCommand then ns.runCommand(line) end
end

local setupPanel
function module.chooseSetup(mode, quiet)
  if mode ~= "local" and mode ~= "connected" then return false end
  local s = settings()
  if not s then return false end
  if s.setupMode ~= mode then
    local previous = s.setupMode == "local" and "local" or "connected"
    s.coreSelections = s.coreSelections or {}
    s.coreSelections[previous] = { core = s.activeCore, mode = s.lootMode }
    local selection = s.coreSelections[mode] or {}
    s.activeCore, s.lootMode = selection.core, selection.mode
  end
  s.setupMode = mode
  s.setupModeAuto = nil
  if setupPanel then setupPanel:Hide() end
  if ns.onSetupChange then ns.onSetupChange() end
  if not quiet then ns.message(L(mode == "local" and "In-game only selected. Your saved data and guild permissions are preserved." or "Connected setup selected. Pair the companion when you are ready; your saved data is preserved.")) end
  return true
end

-- In-game only, then the Local guild page (create a raid core, loot rules, raiders).
function module.guildSetup()
  if not (ns.isOfficer and ns.isOfficer()) then
    ns.message(L("Only a guild officer sets up raid cores. Ask an officer, or use the tools as a member."))
    return
  end
  local s = settings()
  if s and s.setupMode ~= "local" then module.chooseSetup("local") end
  -- Setting up a local guild is a choice: a companion connected later must not switch it.
  if s then s.setupModeAuto = nil end
  if setupPanel then setupPanel:Hide() end
  if ns.openToolsPage then ns.openToolsPage("Local guild") end
end

function module.openSetup()
  if InCombatLockdown and InCombatLockdown() then ns.message(L("Open setup after combat.")); return end
  if not setupPanel then
    setupPanel = CreateFrame("Frame", "GuildedSetupPanel", UIParent, "BasicFrameTemplateWithInset")
    setupPanel:SetSize(520, 330)
    setupPanel:SetPoint("CENTER")
    setupPanel:SetFrameStrata("DIALOG")
    local background = setupPanel:CreateTexture(nil, "BACKGROUND")
    background:SetAllPoints()
    background:SetTexture("Interface\\Buttons\\WHITE8X8")
    background:SetVertexColor(0.04, 0.04, 0.05, 1)
    local title = setupPanel:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    title:SetPoint("TOP", 0, -6); title:SetText(L("Guilded setup"))
    local text = setupPanel:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    text:SetPoint("TOPLEFT", 20, -42); text:SetWidth(480); text:SetJustifyH("LEFT")
    text:SetText(L("In-game only: gear checks, dungeon recording, raid attendance and loot tools work without Discord or signups. Officers can share local standings with online guildmates.\n\nConnected: optional companion sync adds Discord rosters, signups and verified season scores.\n\nData stays in SavedVariables. Keep backups. This choice preserves existing rosters and points; it does not stop a running companion. Change it any time with /guilded setup."))
    for i, choice in ipairs({ { "local", "In-game only (default)" }, { "connected", "Optional Discord connection" } }) do
      local b = CreateFrame("Button", nil, setupPanel, "UIPanelButtonTemplate")
      b:SetSize(230, 28); b:SetPoint("BOTTOMLEFT", 20 + (i - 1) * 245, 58)
      b:SetText(L(choice[2])); local mode = choice[1]
      b:SetScript("OnClick", function() module.chooseSetup(mode) end)
    end
    -- New guilds: straight to the three-step Local guild page.
    local guide = CreateFrame("Button", nil, setupPanel, "UIPanelButtonTemplate")
    guide:SetSize(475, 28); guide:SetPoint("BOTTOMLEFT", 20, 22)
    guide:SetText(L("Officers: set up my guild in game, step by step"))
    guide:SetScript("OnClick", function() module.guildSetup() end)
    if UISpecialFrames then table.insert(UISpecialFrames, "GuildedSetupPanel") end
  end
  setupPanel:Show()
end

-- The switches are one shared list (Modules/SettingsPage.lua), drawn here as tabs with grouped sections and
-- in the Settings page of the Guilded window. This is the old flat list, for callers that want the switches.
function module.switches()
  return ns.settingsPage and ns.settingsPage.switches() or {}
end

local panel, category, ui

local function refresh()
  if ui then ui.refresh() end
end
module.refresh = refresh

local function build()
  panel = CreateFrame("Frame", "GuildedOptionsPanel", UIParent)
  panel.name = "Guilded"
  -- An opaque dark body: the canvas has no background of its own, so the world and nameplates showed through the text.
  local solid = panel:CreateTexture(nil, "BACKGROUND")
  solid:SetAllPoints(panel)
  if solid.SetColorTexture then solid:SetColorTexture(0.05, 0.055, 0.07, 1) end
  local title = panel:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOPLEFT", 16, -16)
  title:SetText(string.format(L("Guilded - Version %s"), ns.settingsPage and ns.settingsPage.version() or ""))
  local hint = panel:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  hint:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -6)
  hint:SetText(L("Everything here affects only you, except the Officers tab, which affects the whole guild."))

  local x = 16
  for _, item in ipairs({
    { "Open the tools window", 200, function() run("menu") end },
    { "Guilded setup", 150, module.openSetup },
    { "Diagnostics", 130, function() run("diag") end },
  }) do
    local b = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
    local w = math.max(item[2], #L(item[1]) * 6 + 20) -- room for the translated labels
    b:SetSize(w, 22)
    b:SetPoint("TOPLEFT", panel, "TOPLEFT", x, -56)
    b:SetText(L(item[1]))
    b:SetScript("OnClick", item[3])
    x = x + w + 8
  end

  -- Tabs with grouped sections, like the model options page; the content scrolls inside its tab.
  ui = ns.settingsPage.build(panel, { width = 660, left = 16, top = -90, right = -30, bottom = 8 })
  panel:SetScript("OnShow", function() ui.update() end)

  if Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory then
    category = Settings.RegisterCanvasLayoutCategory(panel, "Guilded")
    Settings.RegisterAddOnCategory(category)
  elseif InterfaceOptions_AddCategory then
    InterfaceOptions_AddCategory(panel)
  end
end

function module.open()
  if InCombatLockdown and InCombatLockdown() then ns.message(L("Open the options after combat.")); return end
  if not panel then
    ns.message(L("The options page is not ready yet."))
    return
  end
  if Settings and Settings.OpenToCategory and category then
    local id = category.GetID and category:GetID() or category.ID
    pcall(Settings.OpenToCategory, id)
  elseif InterfaceOptionsFrame_OpenToCategory then
    pcall(InterfaceOptionsFrame_OpenToCategory, panel)
  else
    ns.message(L("This game version has no options page for addons: use /guilded help."))
  end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["options"] = function() module.open() end
ns.commandHandlers["settings"] = ns.commandHandlers["options"]
ns.commandHandlers["setup"] = function(args)
  local choice = string.lower(args[1] or "")
  if choice == "guild" then module.guildSetup() return end
  if not module.chooseSetup(choice) then module.openSetup() end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded options - Guilded's page in the game's options: tabs for general, chat, announcements, dungeons and PvP, raids and loot, officers, advanced")
table.insert(ns.commandHelp, "/guilded setup - choose in-game only or optional Discord connection; /guilded setup guild - set up raid cores step by step (officers)")

-- Built once saved settings exist (after Core.lua's PLAYER_LOGIN).
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", function()
  if panel then return end
  local ok, err = pcall(build)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "options: " .. tostring(err)) end
end)

-- Only a companion source proves a connection. Officer-shared snapshots may
-- come from an addon-only guild and do not carry the localPublish flag.
local function companionStandings(d)
  return (d and d.standings and d.standings.updatedAt and d.standings.from == "companion" and not d.standings.localPublish)
    or (type(GuildedStandings) == "table" and GuildedStandings.updatedAt)
end

function module.checkFirstRun()
  local s, d = settings(), db()
  if not s then return end
  if s.setupMode then
    if s.setupMode ~= "local" or not companionStandings(d) then return end
    if s.setupModeAuto then
      -- In-game only was the automatic default, not the player's choice: the companion they
      -- connected since then switches it, with no /guilded setup step (8.1).
      module.chooseSetup("connected", true)
      ns.message(L("Your companion is connected, so Guilded now uses your Discord standings. /guilded setup local switches back."))
    elseif not s.connectedHintShown then
      -- Installed before 8.1, when the default and a real choice looked the same: say it once.
      s.connectedHintShown = true
      ns.message(L("Your companion is sending Discord standings. To use them in game: /guilded setup connected"))
    end
    return
  end
  if companionStandings(d) then
    s.setupMode = "connected"
    return
  end
  -- Fresh/unconnected installations start working immediately without a forced chooser.
  -- Assign directly so existing local core selections and saved records remain intact.
  s.setupMode = "local"
  s.setupModeAuto = true
  ns.message(L("Addon-only is ready. Discord linking and companion sync are optional; use /guilded setup later."))
  if ns.isOfficer and ns.isOfficer() then
    ns.message(L("Officers: /guilded setup guild walks you through creating your raid team, loot rules and roster."))
  end
end
local firstRun = CreateFrame("Frame")
firstRun:RegisterEvent("PLAYER_ENTERING_WORLD")
firstRun:SetScript("OnEvent", function(_, event)
  if event ~= "PLAYER_ENTERING_WORLD" then return end
  firstRun:UnregisterEvent("PLAYER_ENTERING_WORLD")
  module.checkFirstRun()
end)
