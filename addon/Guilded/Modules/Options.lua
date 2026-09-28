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
    {
      label = L("Save for Discord by itself at safe moments (reloads the UI)"),
      get = function() local d = db(); return d and d.syncNow and d.syncNow.auto == true or false end,
      set = function(on) run(on and "sync auto on" or "sync auto off") end
    }
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
  open:SetSize(180, 22)
  open:SetPoint("TOPLEFT", hint, "BOTTOMLEFT", 0, -10)
  open:SetText(L("Open the tools window"))
  open:SetScript("OnClick", function() run("menu") end)

  boxes = {}
  local y = -100
  for index, switch in ipairs(module.switches()) do
    if index == 5 then
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
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded options - Guilded's page in the game's options (minimap button, chat tab, modules)")

-- Built once saved settings exist (after Core.lua's PLAYER_LOGIN).
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", function()
  if panel then return end
  local ok, err = pcall(build)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "options: " .. tostring(err)) end
end)
