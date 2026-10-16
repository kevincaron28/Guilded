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
function module.chooseSetup(mode)
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
  if setupPanel then setupPanel:Hide() end
  if ns.onSetupChange then ns.onSetupChange() end
  ns.message(L(mode == "local" and "In-game only selected. Your saved data and guild permissions are preserved." or "Connected setup selected. Pair the companion when you are ready; your saved data is preserved."))
  return true
end

function module.openSetup()
  if InCombatLockdown and InCombatLockdown() then ns.message(L("Open setup after combat.")); return end
  if not setupPanel then
    setupPanel = CreateFrame("Frame", "GuildedSetupPanel", UIParent, "BasicFrameTemplateWithInset")
    setupPanel:SetSize(520, 300)
    setupPanel:SetPoint("CENTER")
    setupPanel:SetFrameStrata("DIALOG")
    local title = setupPanel:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    title:SetPoint("TOP", 0, -6); title:SetText(L("Guilded setup"))
    local text = setupPanel:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    text:SetPoint("TOPLEFT", 20, -42); text:SetWidth(480); text:SetJustifyH("LEFT")
    text:SetText(L("In-game only: gear checks, dungeon recording, raid attendance and loot tools work without Discord or signups. Officers can share local standings with online guildmates.\n\nConnected: optional companion sync adds Discord rosters, signups and verified season scores.\n\nData stays in SavedVariables. Keep backups. This choice preserves existing rosters and points; it does not stop a running companion. Change it any time with /guilded setup."))
    for i, choice in ipairs({ { "local", "In-game only (default)" }, { "connected", "Optional Discord connection" } }) do
      local b = CreateFrame("Button", nil, setupPanel, "UIPanelButtonTemplate")
      b:SetSize(230, 28); b:SetPoint("BOTTOMLEFT", 20 + (i - 1) * 245, 24)
      b:SetText(L(choice[2])); local mode = choice[1]
      b:SetScript("OnClick", function() module.chooseSetup(mode) end)
    end
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
      label = L("Show what changed since my last login"),
      get = function() local d = db(); return not (d and d.digest and d.digest.enabled == false) end,
      set = function(on) run(on and "digest on" or "digest off") end
    },
  }
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
    local ok, value = pcall(box.switch.get)
    box:SetChecked(ok and value and true or false)
    if box.state and box.switch.module and ns.moduleStateText then
      box.state:SetText(ns.moduleStateText(box.switch.module))
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

  boxes = {}
  local y = -100
  for index, switch in ipairs(module.switches()) do
    if index == 4 then
      local header = panel:CreateFontString(nil, "ARTWORK", "GameFontNormal")
      header:SetPoint("TOPLEFT", 16, y - 6)
      header:SetText(L("Optional parts (a part turned back on starts after /reload)"))
      y = y - 26
    end
    local box = CreateFrame("CheckButton", nil, panel, "UICheckButtonTemplate")
    box:SetSize(24, 24)
    box:SetPoint("TOPLEFT", 16, y)
    box.switch = switch
    local label = panel:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    label:SetPoint("LEFT", box, "RIGHT", 4, 0)
    label:SetText(switch.label)
    if switch.module then
      box.state = panel:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
      box.state:SetPoint("LEFT", label, "RIGHT", 8, 0)
    end
    box:SetScript("OnClick", function(self)
      pcall(self.switch.set, self:GetChecked() and true or false)
      refresh()
    end)
    table.insert(boxes, box)
    y = y - 26
  end
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
  if not module.chooseSetup(string.lower(args[1] or "")) then module.openSetup() end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded options - Guilded's page in the game's options (minimap button, chat tab, modules)")
table.insert(ns.commandHelp, "/guilded setup - choose in-game only or optional Discord connection")

-- Built once saved settings exist (after Core.lua's PLAYER_LOGIN).
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", function()
  if panel then return end
  local ok, err = pcall(build)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "options: " .. tostring(err)) end
end)

function module.checkFirstRun()
  local s, d = settings(), db()
  if not s or s.setupMode then return end
  -- Only a companion source proves a connection. Officer-shared snapshots may
  -- come from an addon-only guild and do not carry the localPublish flag.
  if (d and d.standings and d.standings.updatedAt and d.standings.from == "companion" and not d.standings.localPublish)
    or (type(GuildedStandings) == "table" and GuildedStandings.updatedAt) then
    s.setupMode = "connected"
    return
  end
  -- Fresh/unconnected installations start working immediately without a forced chooser.
  -- Assign directly so existing local core selections and saved records remain intact.
  s.setupMode = "local"
  ns.message(L("Addon-only is ready. Discord linking and companion sync are optional; use /guilded setup later."))
end
local firstRun = CreateFrame("Frame")
firstRun:RegisterEvent("PLAYER_ENTERING_WORLD")
firstRun:SetScript("OnEvent", function(_, event)
  if event ~= "PLAYER_ENTERING_WORLD" then return end
  firstRun:UnregisterEvent("PLAYER_ENTERING_WORLD")
  module.checkFirstRun()
end)
