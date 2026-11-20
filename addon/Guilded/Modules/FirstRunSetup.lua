-- First-run setup (20 Nov 2026): a short paged window that walks a new member through the things that make
-- Guilded work well: the companion, the Guilded chat tab and the few guild options that matter.
--
--   /guilded setup      open it any time (the old in-game-only / connected chooser is /guilded setup mode)
--
-- It opens by itself once per character until the player finishes it or presses "Don't show again" (that is
-- remembered for the whole account: GuildedDB.setupWizard.done). It never opens in combat or over a loading
-- screen: it waits and opens when the fight is over. It only reads and writes Guilded's own saved settings and
-- uses plain (non-secure) frames, so it cannot taint anything. It does not create or change chat windows (see
-- Modules/ChatTab.lua: that taints the chat boxes); the chat step shows the exact steps and one button that
-- switches Guilded's own lines to the Guilded tab once the player has made it.
local addonName, ns = ...
ns = ns or {}

local module = {}
ns.firstRunSetup = module

local function L(text) return ns.L and ns.L(text) or text end
local function db() return ns.getDb and ns.getDb() end
local function settings() return ns.getSettings and ns.getSettings() end
local function clock() return time and time() or 0 end
local function inCombat()
  return (InCombatLockdown and InCombatLockdown() == true) or (UnitAffectingCombat and UnitAffectingCombat("player") == true)
end

module.STEPS = { "welcome", "companion", "chat", "options", "done" }
local STEP_TITLES = {
  welcome = "Welcome to Guilded",
  companion = "Connect the companion",
  chat = "The Guilded chat tab",
  options = "Guild options",
  done = "All set",
}
-- Seconds after login before the window may open by itself (the other one-time notices come first).
module.AUTO_DELAY = 25

-- ---------------------------------------------------------------------
-- Saved state (account-wide, in GuildedDB; fields are only ever added)
-- ---------------------------------------------------------------------
local function state()
  local d = db()
  if not d then return nil end
  if type(d.setupWizard) ~= "table" then d.setupWizard = {} end
  local w = d.setupWizard
  if type(w.shown) ~= "table" then w.shown = {} end
  if type(w.seen) ~= "table" then w.seen = {} end
  return w
end

local function characterKey()
  local me = ns.playerName and ns.playerName()
  return type(me) == "string" and me ~= "" and string.lower(me) or "?"
end

function module.completed()
  local w = state()
  return w ~= nil and w.done == true
end

function module.complete()
  local w = state()
  if not w then return false end
  w.done = true
  w.doneAt = clock()
  return true
end

-- ---------------------------------------------------------------------
-- What is already done (detected from what the addon knows)
-- ---------------------------------------------------------------------
-- The companion has synced: it wrote its data file (standings or the unsigned device marker), or this
-- character is shown as linked to Discord. Returns done, and a short detail line.
function module.companionStatus()
  local link = ns.companionLink
  local state = link and link.linkedState and link.linkedState() or nil
  if state and state.confirmed and state.name then
    return true, string.format(L("Linked to Discord as %s"), state.name)
  end
  if type(GuildedStandings) == "table" and type(GuildedStandings.updatedAt) == "string" then
    return true, string.format(L("Last companion data: %s"), GuildedStandings.updatedAt)
  end
  if link and link.unsignedCompanion and link.unsignedCompanion() then
    return true, L("The companion is running without a Discord sign-in.")
  end
  return false, L("No companion data yet.")
end

function module.chatTabExists()
  return ns.chatTab ~= nil and ns.chatTab.frame ~= nil and ns.chatTab.frame(false) ~= nil
end

function module.chatTabStatus()
  local exists = module.chatTabExists()
  local on = ns.chatTab ~= nil and ns.chatTab.enabled() or false
  return exists and on, exists, on
end

-- The member options shown in step 4: label, description, getter, setter.
function module.options()
  local list = {}
  if ns.milestones then
    table.insert(list, { key = "announce", label = L("Announce my milestones in guild chat"),
      get = function() return ns.milestones.enabled() end,
      set = function(on) ns.milestones.setEnabled(on and true or false) end })
  end
  if ns.companionLink then
    table.insert(list, { key = "reminder", label = L("Remind me about the companion (at most once a week)"),
      get = function() return ns.companionLink.enabled() end,
      set = function(on) ns.companionLink.setEnabled(on and true or false) end })
  end
  table.insert(list, { key = "quiet", label = L("Quiet login: no Guilded messages in chat at login"),
    get = function() local s = settings(); return s ~= nil and s.quietLogin == true end,
    set = function(on) local s = settings(); if s then s.quietLogin = on and true or nil end end })
  if ns.chatTab then
    table.insert(list, { key = "chattab", label = L("Send Guilded's own messages to the Guilded chat tab"),
      get = function() return ns.chatTab.enabled() end,
      set = function(on) local s = settings(); if s then s.chatTab = on and true or false end end })
  end
  return list
end

-- Which steps show a green check: the companion and chat steps by detection, the others once visited.
function module.stepDone(key)
  if key == "companion" then return (module.companionStatus()) end
  if key == "chat" then return (module.chatTabStatus()) end
  local w = state()
  return w ~= nil and w.seen[key] == true
end

-- ---------------------------------------------------------------------
-- Text of each step (returns lines; the window shows them as one block)
-- ---------------------------------------------------------------------
function module.body(key)
  if key == "welcome" then
    return {
      L("Guilded keeps your guild together in game: standings and loot, raids and signups, dungeon scores, crafting orders and a guild map."),
      L("A Windows companion sends your data to your Discord server and brings Discord back into the game."),
      L("This short setup takes a minute: the companion, the Guilded chat tab and a few options. You can reopen it any time with /guilded setup."),
    }
  elseif key == "companion" then
    local lines = {}
    local done, detail = module.companionStatus()
    table.insert(lines, (done and "|cff33ff33" or "|cffffd100") .. detail .. "|r")
    for _, line in ipairs(ns.util and ns.util.companionSteps and ns.util.companionSteps() or {}) do table.insert(lines, line) end
    table.insert(lines, L("The game cannot open web pages: click a box below and press Ctrl+C to copy the link, then paste it in your browser."))
    return lines
  elseif key == "chat" then
    local lines = {}
    local ok, exists, on = module.chatTabStatus()
    local status
    if ok then status = L("The Guilded chat tab exists and is in use.")
    elseif exists then status = L("The Guilded chat tab exists. Press the button to send Guilded's messages there.")
    else status = L("There is no Guilded chat tab yet. Make it with the steps below.") end
    table.insert(lines, (ok and "|cff33ff33" or "|cffffd100") .. status .. "|r")
    if ok then
      table.insert(lines, L("Already set up. To change it: right-click the Guilded tab > Settings."))
      return lines
    end
    table.insert(lines, L("WoW keeps chat windows and their settings and addons cannot change them without breaking the game's chat, so you make the tab once yourself: right-click a chat tab, choose New Window and name it Guilded."))
    if ns.chatTab and ns.chatTab.howTo then
      local how = ns.chatTab.howTo()
      for i = 2, #how do table.insert(lines, how[i]) end
    end
    return lines
  elseif key == "options" then
    return {
      L("Tick what you want. Everything here affects only you and can be changed later in Guilded > Settings."),
    }
  end
  -- done
  local lines = { L("Your setup:") }
  local function tick(on) return on and "|cff33ff33[x]|r " or "|cffffd100[ ]|r " end
  table.insert(lines, tick(module.stepDone("companion")) .. L("Companion"))
  table.insert(lines, tick(module.stepDone("chat")) .. L("Guilded chat tab"))
  for _, option in ipairs(module.options()) do
    if option.key == "announce" then table.insert(lines, tick(option.get()) .. L("Milestone announcements in guild chat")) end
  end
  table.insert(lines, "")
  table.insert(lines, L("Useful commands: /guilded (open Guilded), /guilded help, /guilded companion, /guilded chattab, /guilded announce, /guilded options."))
  table.insert(lines, L("Reopen this setup any time with /guilded setup."))
  return lines
end

-- ---------------------------------------------------------------------
-- The window
-- ---------------------------------------------------------------------
local win
local WIDTH, HEIGHT = 560, 430

local function copyBox(parent, label, text, y)
  local caption = parent:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  caption:SetPoint("TOPLEFT", parent, "TOPLEFT", 24, y)
  caption:SetText(label)
  local box = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
  box:SetSize(500, 20)
  box:SetPoint("TOPLEFT", parent, "TOPLEFT", 30, y - 16)
  box:SetAutoFocus(false)
  box:SetText(text)
  -- Read-only: any edit puts the link back; focusing selects it all so Ctrl+C copies it.
  box:SetScript("OnTextChanged", function(self, user)
    if user and self:GetText() ~= text then self:SetText(text); if self.HighlightText then self:HighlightText() end end
  end)
  box:SetScript("OnEditFocusGained", function(self) if self.HighlightText then self:HighlightText() end end)
  box:SetScript("OnEscapePressed", function(self) if self.ClearFocus then self:ClearFocus() end end)
  box.caption = caption
  return box
end

local function showWidgets(list, on)
  for _, w in ipairs(list) do if on then w:Show() else w:Hide() end end
end

local function build()
  local f = CreateFrame("Frame", "GuildedFirstRunSetup", UIParent, "BasicFrameTemplateWithInset")
  f:SetSize(WIDTH, HEIGHT)
  f:SetPoint("CENTER", UIParent, "CENTER", 0, 20)
  f:SetFrameStrata("FULLSCREEN_DIALOG")
  if f.SetToplevel then f:SetToplevel(true) end
  f:SetMovable(true)
  f:EnableMouse(true)
  f:SetClampedToScreen(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", function(self) self:StartMoving() end)
  f:SetScript("OnDragStop", function(self) self:StopMovingOrSizing() end)
  local bg = f:CreateTexture(nil, "BACKGROUND", nil, 7)
  bg:SetAllPoints()
  bg:SetTexture("Interface\\Buttons\\WHITE8X8")
  bg:SetVertexColor(0.04, 0.04, 0.05, 1)
  if UISpecialFrames then table.insert(UISpecialFrames, "GuildedFirstRunSetup") end
  -- Closing it by hand (X, Escape, any button) counts as dismissed for the whole account: it is not opened
  -- by itself again, on this character or another. /guilded setup still opens it. Hiding it for combat does not count.
  f:SetScript("OnHide", function()
    if module.hidingForCombat then return end
    local w = state()
    if w then w.dismissed = true; w.shown[characterKey()] = true end
  end)

  f.header = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  f.header:SetPoint("TOP", 0, -6)
  f.title = f:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
  f.title:SetPoint("TOPLEFT", 24, -36)
  f.check = f:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
  f.check:SetPoint("TOPRIGHT", -24, -36)
  f.counter = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  f.counter:SetPoint("TOPRIGHT", -24, -62)
  f.body = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  f.body:SetPoint("TOPLEFT", 24, -84)
  f.body:SetWidth(WIDTH - 48)
  f.body:SetJustifyH("LEFT")
  f.body:SetJustifyV("TOP")

  -- Step 2: the two links in boxes to copy.
  f.companionWidgets = {}
  local page = ns.companionLink and ns.companionLink.SHORT or "https://guildedwow.com/companion/"
  local direct = ns.companionLink and ns.companionLink.DIRECT or "https://guildedwow.com/downloads/Guilded.Companion.Setup.exe"
  f.directBox = copyBox(f, L("Download link (Ctrl+C to copy)"), direct, -300)
  f.pageBox = copyBox(f, L("Companion page"), page, -344)
  f.companionWidgets = { f.directBox, f.directBox.caption, f.pageBox, f.pageBox.caption }

  -- Step 3: one button.
  f.chatButton = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  f.chatButton:SetSize(300, 24)
  f.chatButton:SetPoint("TOPLEFT", f, "TOPLEFT", 24, -340)
  f.chatButton:SetScript("OnClick", function()
    local s = settings()
    if s then s.chatTab = true end
    module.render()
  end)
  f.chatButton:SetText(L("Use the Guilded chat tab"))

  -- Step 4: checkboxes (created on first use, one per option).
  f.checks = {}

  -- Navigation.
  f.back = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  f.back:SetSize(90, 24); f.back:SetPoint("BOTTOMLEFT", 24, 16); f.back:SetText(L("Back"))
  f.back:SetScript("OnClick", function() module.go(module.step - 1) end)
  f.next = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  f.next:SetSize(90, 24); f.next:SetPoint("BOTTOMRIGHT", -24, 16)
  f.next:SetScript("OnClick", function()
    if module.step >= #module.STEPS then module.finish() else module.go(module.step + 1) end
  end)
  f.never = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  f.never:SetSize(130, 24); f.never:SetPoint("BOTTOM", 0, 16); f.never:SetText(L("Don't show again"))
  f.never:SetScript("OnClick", function() module.complete(); f:Hide() end)
  return f
end

local function ensureChecks(f, options)
  for i, option in ipairs(options) do
    local box = f.checks[i]
    if not box then
      box = CreateFrame("CheckButton", nil, f, "UICheckButtonTemplate")
      box:SetPoint("TOPLEFT", f, "TOPLEFT", 24, -130 - (i - 1) * 34)
      box.label = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
      box.label:SetPoint("LEFT", box, "RIGHT", 4, 0)
      box.label:SetWidth(WIDTH - 110)
      box.label:SetJustifyH("LEFT")
      f.checks[i] = box
    end
    box.label:SetText(option.label)
    box:SetChecked(option.get() and true or false)
    box:SetScript("OnClick", function(self)
      option.set(self:GetChecked() and true or false)
      box:SetChecked(option.get() and true or false)
    end)
  end
end

module.step = 1

-- Draws the current step.
function module.render()
  if not win then return end
  local key = module.STEPS[module.step]
  local w = state()
  if w then w.seen[key] = true end
  win.header:SetText(L("Guilded setup"))
  win.title:SetText(L(STEP_TITLES[key]))
  win.counter:SetText(string.format(L("Step %d of %d"), module.step, #module.STEPS))
  -- A green check when the step is done (detected, or visited for the informational ones).
  local done = module.stepDone(key)
  win.check:SetText(done and "|TInterface\\RaidFrame\\ReadyCheck-Ready:20|t" or "")
  win.body:SetText(table.concat(module.body(key), "\n\n"))
  -- Widgets under the text start below it, whatever the font size; the window grows when the text is long.
  local bodyHeight = win.body.GetStringHeight and win.body:GetStringHeight()
  local below = 84 + (type(bodyHeight) == "number" and bodyHeight or 0) + 14
  local function under(widget, offset, x)
    widget:ClearAllPoints()
    widget:SetPoint("TOPLEFT", win, "TOPLEFT", x or 24, -offset)
  end
  local chatY, linkY = math.max(340, below), math.max(300, below)
  under(win.chatButton, chatY)
  under(win.directBox.caption, linkY); under(win.directBox, linkY + 16, 30)
  under(win.pageBox.caption, linkY + 44); under(win.pageBox, linkY + 60, 30)
  local lowest = key == "chat" and chatY + 24 or key == "companion" and linkY + 80 or below
  win:SetHeight(math.max(HEIGHT, lowest + 70))
  showWidgets(win.companionWidgets, key == "companion")
  if key == "chat" then win.chatButton:Show() else win.chatButton:Hide() end
  local options = key == "options" and module.options() or {}
  ensureChecks(win, options)
  for i, box in ipairs(win.checks) do
    if i <= #options then box:Show(); box.label:Show() else box:Hide(); box.label:Hide() end
  end
  if module.step <= 1 then win.back:Hide() else win.back:Show() end
  win.next:SetText(module.step >= #module.STEPS and L("Finish") or L("Next"))
end

function module.go(step)
  step = math.max(1, math.min(#module.STEPS, tonumber(step) or 1))
  module.step = step
  module.render()
end

function module.finish()
  module.complete()
  if win then win:Hide() end
end

function module.frame() return win end
function module.isOpen() return win ~= nil and win.IsShown and win:IsShown() and true or false end

local loading = false
local pending = false        -- the player asked for it (/guilded setup) during combat or a loading screen
local pendingAuto = false    -- the automatic first-login open is waiting for a quiet moment

-- Opens the window. `auto` is true for the automatic first-login open (it then waits for a quiet moment).
function module.open(auto, keepStep)
  if not db() then return false end
  local inInstance = false
  if auto and IsInInstance then local ok, value = pcall(IsInInstance); inInstance = ok and value == true end
  if inCombat() or loading or inInstance then
    -- Automatic opens wait for a quiet moment (not in a dungeon or battleground either): the next zone change
    -- or the next login retries. A typed /guilded setup in combat opens when the fight ends.
    if auto then pendingAuto = true else pending = true end
    if not auto and ns.message then ns.message(L("Open setup after combat.")) end
    return false
  end
  pending = false
  pendingAuto = false
  if not win then
    local ok, frame = pcall(build)
    if not ok then
      if ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "first-run setup: " .. tostring(frame)) end
      return false
    end
    win = frame
  end
  if not keepStep then module.step = 1 end
  win.manual = not auto
  local w = state()
  if w then w.shown[characterKey()] = true end
  module.render()
  win:Show()
  if win.Raise then win:Raise() end
  return true
end

-- The automatic open: once per character, until the account has finished the setup.
function module.shouldAutoOpen()
  local w = state()
  if not w or w.done == true or w.dismissed == true then return false end
  if w.shown[characterKey()] == true then return false end
  -- Already set up (companion data and the Guilded chat tab): nothing to walk through.
  if module.companionStatus() and module.chatTabStatus() then return false end
  return true
end

function module.tryAutoOpen()
  if not module.shouldAutoOpen() then pendingAuto = false; return false end
  return module.open(true)
end

-- ---------------------------------------------------------------------
-- Events: login timer, combat, loading screens
-- ---------------------------------------------------------------------
local hiddenByCombat = false

local function retryAuto()
  if pendingAuto then pcall(module.tryAutoOpen) end
end

local function onEvent(_, event)
  if event == "PLAYER_ENTERING_WORLD" then
    loading = false
    if C_Timer and C_Timer.After then
      C_Timer.After(module.AUTO_DELAY, function() pcall(module.tryAutoOpen) end)
    end
    if pending then pcall(module.open, false) end
  elseif event == "ZONE_CHANGED_NEW_AREA" then
    retryAuto()  -- left a dungeon or battleground
  elseif event == "PLAYER_LEAVING_WORLD" then
    loading = true
  elseif event == "PLAYER_REGEN_DISABLED" then
    -- Hide for the fight. Only a window the player opened themselves comes back afterwards, on the same step.
    if win and win:IsShown() then
      module.hidingForCombat = true
      win:Hide()
      module.hidingForCombat = false
      hiddenByCombat = win.manual == true
    end
  elseif event == "PLAYER_REGEN_ENABLED" then
    if hiddenByCombat then
      hiddenByCombat = false
      pcall(module.open, false, true)
    elseif pending then
      pcall(module.open, false)
    else
      retryAuto()
    end
  end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("PLAYER_LEAVING_WORLD")
frame:RegisterEvent("ZONE_CHANGED_NEW_AREA")
frame:RegisterEvent("PLAYER_REGEN_DISABLED")
frame:RegisterEvent("PLAYER_REGEN_ENABLED")
frame:SetScript("OnEvent", onEvent)

function module.command()
  module.open(false)
  return true
end
