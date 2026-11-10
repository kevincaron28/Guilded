-- "Get the companion" (8.5.0 E4). Addons cannot open web pages, so the window shows the links in
-- a box to copy, and a gentle reminder (at most once a week, on by default) goes to members who
-- do not seem to have their own companion running.
--
--   /guilded companion          show the links
--   /guilded companion off|on   turn the weekly reminder off or on
--
-- "Does not have a companion" means: the officer bridge listed this character in
-- `needsCompanion` (names the officer's companion saw without a recent upload), or this
-- computer has never had a companion file (no GuildedStandings.updatedAt).
local addonName, ns = ...
ns = ns or {}

local module = {}
ns.companionLink = module

module.SHORT = "https://guilded.kcaron.top/companion/"
-- The website serves the installer (R2 mirror, then the bot server, then GitHub): members never need GitHub.
module.DIRECT = "https://guilded.kcaron.top/downloads/Guilded.Companion.Setup.exe"
local WEEK = 7 * 24 * 3600

local function L(text) return ns.L and ns.L(text) or text end
local function clock() return time and time() or 0 end

function module.enabled()
  local s = ns.getSettings and ns.getSettings()
  return not (s and s.companionReminder == false)
end

function module.setEnabled(on)
  local s = ns.getSettings and ns.getSettings()
  if s then s.companionReminder = on and true or false end
end

-- True when this player seems to lack a companion of their own.
function module.needed()
  local d = ns.getDb and ns.getDb()
  local snapshot = d and d.officerBridge and d.officerBridge.snapshot
  local me = ns.playerName and ns.playerName()
  local list = type(snapshot) == "table" and snapshot.needsCompanion
  if type(list) == "table" and me then
    for _, name in ipairs(list) do
      if ns.normalizeName and ns.normalizeName(name) == ns.normalizeName(me) or name == me then return true end
    end
  end
  if module.linkedState() then return false end
  -- (9.1.3) An unsigned (zero-setup) companion that wrote its data file is a companion.
  if module.unsignedCompanion() then return false end
  return not (type(GuildedStandings) == "table" and type(GuildedStandings.updatedAt) == "string")
end

-- "Linked to Discord as <name>" (8.5 Track L), per character since 9.1.4: the companion writes the map
-- GuildedLinked[characterKey] = { discord = "<name>", confirmed = true|false } for THIS PC's own characters, with
-- GuildedLinkedMeta.updatedAt. The line is said only for the character being played: "Linked to Discord as <name>"
-- when confirmed, "Reported, not confirmed" when the bot only holds the character as reported, nothing otherwise.
-- A map older than 14 days is ignored. The old PC-wide GuildedLinkedAs is read only when no map exists (an older
-- companion), never once the map is there and never from an unsigned companion.
-- (9.1.3) An unsigned (zero-setup) companion writes GuildedCompanion.mode = "device".
local MAP_MAX_AGE = 14 * 24 * 3600

function module.unsignedCompanion()
  return type(GuildedCompanion) == "table" and GuildedCompanion.mode == "device"
end

local function plainName(name)
  if type(name) ~= "string" then return nil end
  name = string.gsub(name, "|", "")
  if name == "" or string.len(name) > 60 then return nil end
  return name
end

-- The map key of the character being played: ASCII-lowercase, single spaces (the companion writes the same).
local function currentKey()
  local me = ns.playerName and ns.playerName()
  if type(me) ~= "string" or me == "" then return nil end
  return string.lower((string.gsub(string.match(me, "^%s*(.-)%s*$") or me, "%s+", " ")))
end

local function mapFresh()
  local meta = type(GuildedLinkedMeta) == "table" and GuildedLinkedMeta.updatedAt or nil
  local at = ns.util and ns.util.isoEpoch and ns.util.isoEpoch(meta)
  if not at then return false end
  local age = clock() - at
  return age < MAP_MAX_AGE
end

-- nil (say nothing), or { name = "<discord name>", confirmed = true }, or { confirmed = false } (reported only).
function module.linkedState()
  if type(GuildedLinked) == "table" then
    if not mapFresh() then return nil end
    local key = currentKey()
    local entry = key and GuildedLinked[key]
    if type(entry) ~= "table" then return nil end
    if entry.confirmed == true then
      local name = plainName(entry.discord)
      return name and { name = name, confirmed = true } or nil
    end
    return { confirmed = false }
  end
  -- No map (an older companion): the one PC-wide name, never from an unsigned companion.
  if module.unsignedCompanion() then return nil end
  local name = plainName(GuildedLinkedAs)
  return name and { name = name, confirmed = true } or nil
end

function module.linkedAs()
  local state = module.linkedState()
  return state and state.confirmed and state.name or nil
end

function module.linkedLine(name)
  return string.format(L("Linked to Discord as %s"), name) .. " |cff40ff40\226\156\147|r"
end

function module.reportedLine()
  return L("Reported, not confirmed")
end

local function stateLine(state)
  if not state then return nil end
  if state.confirmed then return module.linkedLine(state.name) end
  return module.reportedLine()
end

-- Says the linked line in chat once per game session for this character and state. Returns true when it spoke.
-- Once per game session (every login while linked), and again if the state changes.
local announced
function module.announceLinked()
  local state = module.linkedState()
  local line = stateLine(state)
  if not line or announced == line then return false end
  announced = line
  ns.message(line)
  return true
end

-- A small window with the download link in a box that is already selected: press Ctrl+C.
local popup
function module.openCopyWindow()
  if not popup then
    popup = CreateFrame("Frame", "GuildedCompanionCopy", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
    popup:SetSize(500, 210)
    popup:SetPoint("CENTER", UIParent, "CENTER", 0, 120)
    popup:SetFrameStrata("DIALOG")
    if UISpecialFrames then table.insert(UISpecialFrames, "GuildedCompanionCopy") end
    popup:SetMovable(true)
    popup:EnableMouse(true)
    popup:RegisterForDrag("LeftButton")
    popup:SetScript("OnDragStart", popup.StartMoving)
    popup:SetScript("OnDragStop", popup.StopMovingOrSizing)
    if popup.SetBackdrop then
      popup:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background", edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
        tile = true, tileSize = 32, edgeSize = 32, insets = { left = 8, right = 8, top = 8, bottom = 8 } })
    end
    local title = popup:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    title:SetPoint("TOPLEFT", popup, "TOPLEFT", 20, -18)
    title:SetText(L("Get the Windows companion"))
    local hint = popup:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    hint:SetPoint("TOPLEFT", popup, "TOPLEFT", 20, -46)
    hint:SetWidth(460)
    hint:SetJustifyH("LEFT")
    hint:SetText(L("The game cannot open web pages. Press Ctrl+C to copy the link, then paste it (Ctrl+V) in your browser."))
    popup.box = CreateFrame("EditBox", nil, popup, "InputBoxTemplate")
    popup.box:SetSize(450, 20)
    popup.box:SetPoint("TOPLEFT", popup, "TOPLEFT", 26, -86)
    popup.box:SetAutoFocus(false)
    popup.steps = popup:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    popup.steps:SetPoint("TOPLEFT", popup, "TOPLEFT", 26, -116)
    popup.steps:SetWidth(450)
    popup.steps:SetJustifyH("LEFT")
    popup.box:SetScript("OnTextChanged", function(self, user)
      if user and self:GetText() ~= module.DIRECT then self:SetText(module.DIRECT); self:HighlightText() end
    end)
    popup.box:SetScript("OnEscapePressed", function() popup:Hide() end)
    local close = CreateFrame("Button", nil, popup, "UIPanelButtonTemplate")
    close:SetSize(90, 22)
    close:SetPoint("BOTTOMRIGHT", popup, "BOTTOMRIGHT", -20, 16)
    close:SetText(L("Close"))
    close:SetScript("OnClick", function() popup:Hide() end)
  end
  popup.box:SetText(module.DIRECT)
  popup.steps:SetText(table.concat(module.steps(), "\n"))
  popup:Show()
  popup.box:SetFocus()
  popup.box:HighlightText()
  return popup
end

function module.text()
  return L("Guilded companion (Windows): sends your data to Discord and brings standings, raids and signups into the game.")
end

-- The three steps, one chat line each (shared text: Util.lua).
function module.steps()
  return ns.util and ns.util.companionSteps and ns.util.companionSteps() or {}
end

-- Says the reminder in chat when it is due. Returns true when it spoke.
function module.remind(force)
  local d = ns.getDb and ns.getDb()
  if not d then return false end
  if not force then
    if not module.enabled() or not module.needed() then return false end
    if ns.isInGameOnly and ns.isInGameOnly() then return false end
    if clock() - (tonumber(d.companionRemindedAt) or 0) < WEEK then return false end
  end
  d.companionRemindedAt = clock()
  ns.message(module.text() .. " " .. module.SHORT)
  for _, line in ipairs(module.steps()) do ns.message(line) end
  ns.message(L("Open Guilded > Home to copy the link. Turn this reminder off: /guilded companion off"))
  return true
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["companion"] = function(args)
  local action = string.lower(args and args[1] or "")
  if action == "off" then module.setEnabled(false); ns.message(L("Companion reminder off."))
  elseif action == "on" then module.setEnabled(true); ns.message(L("Companion reminder on (at most once a week)."))
  else
    local line = stateLine(module.linkedState())
    if line then ns.message(line) end
    ns.message(module.text())
    for _, line in ipairs(module.steps()) do ns.message(line) end
    ns.message(module.SHORT)
    ns.message(module.DIRECT)
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded companion [on|off] - the Windows companion link and its weekly reminder")

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:SetScript("OnEvent", function()
  -- Let the login chatter and the digest settle first.
  if C_Timer and C_Timer.After then
    C_Timer.After(20, function() pcall(module.announceLinked); pcall(module.remind) end)
  end
end)
