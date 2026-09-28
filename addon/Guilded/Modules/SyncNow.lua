-- Getting your data to Discord sooner.
--
-- The game only writes the addon's saved file when you /reload or log out, and the companion
-- can only read that file. So "send to Discord" means "save now", which is a UI reload.
--
-- Newer clients do not let an addon call ReloadUI() itself: it is blocked ("Guilded tried to
-- call ReloadUI"). A *secure* button whose click runs the macro "/reload" is allowed, because
-- the click is yours. So every "Send to Discord" button (the banner, the window) is such a
-- button (module.reloadButton), and nothing ever reloads by itself.
--
--   /guilded sync              how to save now (type /reload, or press Send to Discord)
--   /guilded sync status
--
-- Officers (the people who run the companion) get a small banner with a "Send to Discord"
-- button when data is waiting, at safe moments (out of combat, outside instances, changes
-- quiet for 90 seconds), at most every 20 minutes. Logging out also saves the data.
local addonName, ns = ...
ns = ns or {}

local CHECK_SECONDS = 60
local SETTLE_SECONDS = 90
local BANNER_REPEAT_SECONDS = 20 * 60

local module = {}
ns.syncNow = module

local dirtyAt        -- when unsaved data first appeared (this session)
local bannerShownAt
local banner

local function clock() return time and time() or 0 end

local function officer()
  return ns.isOfficer and ns.isOfficer() or false
end

-- Called by Core whenever something worth saving happens.
function module.mark()
  dirtyAt = dirtyAt or clock()
end

function module.isDirty() return dirtyAt ~= nil end

local function inCombat()
  if InCombatLockdown and InCombatLockdown() then return true end
  if UnitAffectingCombat and UnitAffectingCombat("player") then return true end
  return false
end

local function inInstance()
  if not IsInInstance then return false end
  local ok, inside = pcall(IsInInstance)
  return ok and inside and true or false
end

function module.safeMoment()
  return not inCombat() and not inInstance()
end

-- A button that reloads the UI when clicked: a secure action button running the macro
-- "/reload" (allowed from a click; calling ReloadUI() from addon code is blocked). Must be
-- created out of combat, which is always the case here (the window and the banner are built
-- from the login and ticker code, never mid-fight). `onClick` runs as well (hide a banner...).
-- `macro` replaces "/reload" (e.g. "/guilded export\n/reload" for an officer's Export and send).
function module.reloadButton(parent, text, width, height, onClick, macro)
  -- In combat a secure button cannot be set up (that is blocked too): a plain button that
  -- explains, until the window is built again after a /reload.
  if inCombat() then
    local plain = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    plain:SetWidth(width or 140)
    plain:SetHeight(height or 22)
    plain:SetText(text)
    plain:SetScript("OnClick", function()
      if onClick then pcall(onClick) end
      ns.message("Type /reload to send your data to Discord (the button works when the window is opened out of combat).")
    end)
    return plain
  end
  local ok, button = pcall(CreateFrame, "Button", nil, parent, "SecureActionButtonTemplate,UIPanelButtonTemplate")
  if not ok or not button then button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate") end
  button:SetWidth(width or 140)
  button:SetHeight(height or 22)
  button:SetText(text)
  -- Newer clients fire secure clicks on the key-down or key-up edge depending on a setting.
  if button.RegisterForClicks then button:RegisterForClicks("AnyUp", "AnyDown") end
  if button.SetAttribute then
    button:SetAttribute("type", "macro")
    button:SetAttribute("macrotext", macro or "/reload")
  end
  if onClick and button.HookScript then button:HookScript("OnClick", onClick) end
  return button
end

local function hideBanner()
  if banner then banner:Hide() end
end

local function showBanner()
  bannerShownAt = clock()
  if not banner then
    banner = CreateFrame("Frame", "GuildedSyncBanner", UIParent)
    banner:SetSize(320, 56)
    banner:SetPoint("TOP", 0, -120)
    banner:SetFrameStrata("HIGH")
    local background = banner:CreateTexture(nil, "BACKGROUND")
    background:SetAllPoints()
    background:SetColorTexture(0, 0, 0, 0.8)
    local text = banner:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    text:SetPoint("TOPLEFT", 10, -8)
    text:SetText("Guilded: new data is waiting to go to Discord.")
    local send = module.reloadButton(banner, "Send to Discord", 140, 22, hideBanner)
    send:SetPoint("BOTTOMLEFT", 10, 6)
    local later = CreateFrame("Button", nil, banner, "UIPanelButtonTemplate")
    later:SetSize(90, 22)
    later:SetPoint("BOTTOMRIGHT", -10, 6)
    later:SetText("Later")
    later:SetScript("OnClick", hideBanner)
  end
  banner:Show()
end
module.showBanner = showBanner

-- One check, once a minute: officers get the banner when data is waiting (never in combat:
-- a secure button cannot be shown then, and nobody wants a popup mid-fight).
function module.tick()
  if ns.moduleActive and not ns.moduleActive("syncnow") then return end
  if not dirtyAt then return end
  local now = clock()
  if now - dirtyAt < SETTLE_SECONDS then return end
  if not module.safeMoment() then return end
  if officer() and (not bannerShownAt or now - bannerShownAt >= BANNER_REPEAT_SECONDS) then
    showBanner()
  end
end

-- One plain-language sentence for the Home page.
function module.statusLine()
  if dirtyAt then
    local minutes = math.floor((clock() - dirtyAt) / 60)
    return string.format("Changes are waiting (%s). Press Send to Discord (it reloads the UI), or they are sent when you log out.",
      minutes <= 0 and "just now" or (minutes .. " min"))
  end
  return "Everything is saved. After changes, press Send to Discord."
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", function()
  if C_Timer and C_Timer.NewTicker then
    C_Timer.NewTicker(CHECK_SECONDS, function()
      local ok, err = pcall(module.tick)
      if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "syncnow: " .. tostring(err)) end
    end)
  end
end)

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["sync"] = function(args)
  if ns.moduleActive and not ns.moduleActive("syncnow") then return end
  local action = string.lower(args[1] or "")
  if action == "auto" then
    -- The old automatic reload: the game no longer allows it (see the top of this file).
    ns.message("Automatic saving is no longer possible: the game only reloads on your own click. Press Send to Discord, or type /reload.")
  elseif action == "status" then
    ns.message("Sync to Discord: " .. (dirtyAt and ("changes waiting since " .. math.floor((clock() - dirtyAt) / 60) .. " min") or "nothing waiting") .. ".")
  else
    -- A slash command cannot reload either; the player types it (or clicks the button).
    ns.message("To send your data to Discord now, type /reload (or press Send to Discord in the Guilded window).")
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded sync | sync status - how to send your data to Discord now (/reload, or the Send to Discord button)")
