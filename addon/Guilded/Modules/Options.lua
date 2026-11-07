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

-- What each switch shows and does: `get` reads the current state, `set(on)` changes it.
function module.switches()
  local list = {
    {
      label = L("Show the minimap button"),
      get = function() local s = settings(); return not (s and s.minimapHidden) end,
      set = function(on) run(on and "minimap show" or "minimap hide") end
    },
    {
      label = L("Guilded's messages in their own chat tab"),
      get = function() local s = settings(); return s and s.chatTab == true or false end,
      set = function(on) run(on and "chat tab" or "chat off") end
    },
    {
      label = L("Guild events in the Guilded tab: joins"),
      get = function() return ns.chatTab and ns.chatTab.eventEnabled("join") or false end,
      set = function(on) if ns.chatTab then ns.chatTab.setEventEnabled("join", on) end end
    },
    {
      label = L("Guild events in the Guilded tab: leaves"),
      get = function() return ns.chatTab and ns.chatTab.eventEnabled("leave") or false end,
      set = function(on) if ns.chatTab then ns.chatTab.setEventEnabled("leave", on) end end
    },
    {
      label = L("Guild events in the Guilded tab: removals"),
      get = function() return ns.chatTab and ns.chatTab.eventEnabled("kick") or false end,
      set = function(on) if ns.chatTab then ns.chatTab.setEventEnabled("kick", on) end end
    },
    {
      label = L("Guild events in the Guilded tab: promotions"),
      get = function() return ns.chatTab and ns.chatTab.eventEnabled("promote") or false end,
      set = function(on) if ns.chatTab then ns.chatTab.setEventEnabled("promote", on) end end
    },
    {
      label = L("Guild events in the Guilded tab: demotions"),
      get = function() return ns.chatTab and ns.chatTab.eventEnabled("demote") or false end,
      set = function(on) if ns.chatTab then ns.chatTab.setEventEnabled("demote", on) end end
    },
    {
      label = L("Guild events in the Guilded tab: coming online"),
      get = function() return ns.chatTab and ns.chatTab.eventEnabled("online") or false end,
      set = function(on) if ns.chatTab then ns.chatTab.setEventEnabled("online", on) end end
    },
    {
      label = L("Guild events in the Guilded tab: going offline"),
      get = function() return ns.chatTab and ns.chatTab.eventEnabled("offline") or false end,
      set = function(on) if ns.chatTab then ns.chatTab.setEventEnabled("offline", on) end end
    },
    {
      label = L("Online and offline lines: officers only"),
      get = function() return ns.chatTab and ns.chatTab.officersOnlyPresence() or false end,
      set = function(on) local s = settings(); if s then s.chatEventsOfficersOnly = on and true or nil end end
    },
    {
      label = L("Weekly reminder to get the Windows companion"),
      get = function() return ns.companionLink and ns.companionLink.enabled() or false end,
      set = function(on) run(on and "companion on" or "companion off") end
    },
    {
      label = L("Show what changed since my last login"),
      get = function() local d = db(); return not (d and d.digest and d.digest.enabled == false) end,
      set = function(on) run(on and "digest on" or "digest off") end
    },
    -- Who can craft an item, on its tooltip: Off / Compact / Full (a button that cycles).
    {
      label = L("Item tooltips: who can craft it"),
      cycle = function()
        local r = ns.recipes
        local mode = r and r.tooltipMode and r.tooltipMode() or "compact"
        return L(r and r.MODE_WORD and r.MODE_WORD[mode] or "Compact")
      end,
      next = function() local r = ns.recipes; if not r then return end
        local order, current = r.MODES, r.tooltipMode()
        for i, mode in ipairs(order) do if mode == current then r.setTooltipMode(order[i % #order + 1]) return end end
        r.setTooltipMode("compact")
      end
    },
    -- Milestone announcements in guild chat: OFF until the player turns them on (8.4.5).
    {
      label = L("Announce my milestones in guild chat"),
      get = function() return ns.milestones and ns.milestones.enabled() or false end,
      set = function(on) run(on and "milestones on" or "milestones off") end
    },
    {
      label = L("Milestones: level 10, 20..."),
      get = function() return ns.milestones and ns.milestones.enabled("level") or false end,
      set = function(on) run("milestones level " .. (on and "on" or "off")) end
    },
    {
      label = L("Milestones: first dungeon clears"),
      get = function() return ns.milestones and ns.milestones.enabled("dungeon") or false end,
      set = function(on) run("milestones dungeon " .. (on and "on" or "off")) end
    },
    {
      label = L("Milestones: honorable kills"),
      get = function() return ns.milestones and ns.milestones.enabled("hk") or false end,
      set = function(on) run("milestones hk " .. (on and "on" or "off")) end
    },
    {
      label = L("Milestones: duel wins"),
      get = function() return ns.milestones and ns.milestones.enabled("duel") or false end,
      set = function(on) run("milestones duel " .. (on and "on" or "off")) end
    },
  }
  -- Officer clients: the jobs they do on their own (Modules/OfficerNotes.lua), each with its own off switch.
  if ns.isOfficer and ns.isOfficer() and ns.officerNotes then
    for _, key in ipairs(ns.officerNotes.KEYS) do
      table.insert(list, {
        label = L(ns.officerNotes.LABELS[key]),
        get = function() return ns.officerNotes.enabled(key) end,
        set = function(on) ns.officerNotes.set(key, on) end
      })
    end
  end
  -- One switch per optional module, just for you (officers still use /guilded modules guild).
  for _, entry in ipairs(ns.MODULES or {}) do
    local key = entry.key
    table.insert(list, {
      label = string.format("%s: %s", entry.name, entry.desc),
      module = key,
      get = function() local s = settings(); return not (s and s.modules and s.modules[key] == false) end,
      set = function(on) run((on and "modules on " or "modules off ") .. key) end
    })
  end
  return list
end

local panel, category, boxes

local function refresh()
  if not boxes then return end
  for _, box in ipairs(boxes) do
    if box.switch.cycle then
      local ok, text = pcall(box.switch.cycle)
      box:SetText(ok and text or "")
    else
    local ok, value = pcall(box.switch.get)
    box:SetChecked(ok and value and true or false)
    if box.state and box.switch.module and ns.moduleStateText then
      box.state:SetText(ns.moduleStateText(box.switch.module))
    end
    end
  end
end
module.refresh = refresh

local function build()
  panel = CreateFrame("Frame", "GuildedOptionsPanel", UIParent)
  panel.name = "Guilded"
  local title = panel:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOPLEFT", 16, -16)
  title:SetText("Guilded")
  local hint = panel:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  hint:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -6)
  hint:SetText(L("Switches for you only. Officers turn modules off for the whole guild with /guilded modules guild."))

  local open = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
  open:SetSize(200, 22) -- room for the French label
  open:SetPoint("TOPLEFT", hint, "BOTTOMLEFT", 0, -10)
  open:SetText(L("Open the tools window"))
  open:SetScript("OnClick", function() run("menu") end)
  local setup = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
  setup:SetSize(180, 22); setup:SetPoint("LEFT", open, "RIGHT", 10, 0)
  setup:SetText(L("Guilded setup")); setup:SetScript("OnClick", module.openSetup)

  -- The switches scroll: with every optional part listed they are taller than the panel.
  local scroll = CreateFrame("ScrollFrame", nil, panel, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", 0, -94)
  scroll:SetPoint("BOTTOMRIGHT", -30, 8)
  local list = CreateFrame("Frame", nil, scroll)
  list:SetWidth(620)
  scroll:SetScrollChild(list)
  boxes = {}
  local y = -6
  local headed = false
  for index, switch in ipairs(module.switches()) do
    if switch.module and not headed then
      headed = true
      local header = list:CreateFontString(nil, "ARTWORK", "GameFontNormal")
      header:SetPoint("TOPLEFT", 16, y - 6)
      header:SetText(L("Optional parts (a part turned back on starts after /reload)"))
      y = y - 26
    end
    local box
    if switch.cycle then
      box = CreateFrame("Button", nil, list, "UIPanelButtonTemplate")
      box:SetSize(90, 22)
      box:SetPoint("TOPLEFT", 18, y - 1)
    else
      box = CreateFrame("CheckButton", nil, list, "UICheckButtonTemplate")
      box:SetSize(24, 24)
      box:SetPoint("TOPLEFT", 16, y)
    end
    box.switch = switch
    local label = list:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    label:SetPoint("LEFT", box, "RIGHT", 4, 0)
    label:SetText(switch.label)
    if switch.module then
      box.state = list:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
      box.state:SetPoint("LEFT", label, "RIGHT", 8, 0)
    end
    box:SetScript("OnClick", function(self)
      if self.switch.cycle then
        pcall(self.switch.next)
      else
        pcall(self.switch.set, self:GetChecked() and true or false)
      end
      refresh()
    end)
    table.insert(boxes, box)
    y = y - 26
  end
  list:SetHeight(-y + 10)
  panel:SetScript("OnShow", refresh)

  if Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory then
    category = Settings.RegisterCanvasLayoutCategory(panel, "Guilded")
    Settings.RegisterAddOnCategory(category)
  elseif InterfaceOptions_AddCategory then
    InterfaceOptions_AddCategory(panel)
  end
end

function module.open()
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
table.insert(ns.commandHelp, "/guilded options - Guilded's page in the game's options (minimap button, chat tab, modules)")
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
