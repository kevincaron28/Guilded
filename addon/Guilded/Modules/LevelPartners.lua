-- Levelling partners: online guildmates within 3 levels of you, with Whisper and Invite buttons.
--
--   /guilded partners     open the list (also the minimap quick menu and the Home page)
--
-- Only the guild roster is read (level, class, zone, online), so a guildmate does not need Guilded.
-- Nothing is ever sent by itself: Whisper opens the chat box to that player and Invite sends one
-- party invite per click (WoW only allows invites from a click). At the top level the list is
-- not offered; those characters are done levelling.
local addonName, ns = ...
ns = ns or {}

local RANGE = 3
local MAX_ROWS = 8
local REFRESH_SECONDS = 5

local module = {}
ns.levelPartners = module

local function L(text) return ns.L and ns.L(text) or text end
local function secret(value) return ns.isSecret and ns.isSecret(value) end
local function say(text) if ns.message then ns.message(text) end end
local function display(name) return ns.displayName and ns.displayName(name) or name end
local function baseName(name) return ns.normalizeName and ns.normalizeName(name) or name end
local function playerName() return ns.playerName and ns.playerName() or (UnitName and UnitName("player")) or "?" end

local function myLevel()
  local level = UnitLevel and UnitLevel("player")
  return type(level) == "number" and level or 0
end

local function maxLevel()
  local ok, value = pcall(function() return GetMaxPlayerLevel and GetMaxPlayerLevel() end)
  return ok and type(value) == "number" and value > 0 and value or 60
end

-- Offered while still levelling (below the top level).
function module.available()
  local level = myLevel()
  return level > 0 and level < maxLevel()
end

local function myZone()
  local zone = GetRealZoneText and GetRealZoneText() or (GetZoneText and GetZoneText()) or ""
  if secret(zone) or type(zone) ~= "string" then return "" end
  return zone
end

-- Online guildmates within RANGE levels (not me), closest level first, then those in my zone,
-- then by name; at most MAX_ROWS.
function module.partners()
  local list = {}
  if not module.available() or not (GetNumGuildMembers and GetGuildRosterInfo) then return list end
  local okCount, total = pcall(GetNumGuildMembers)
  if not okCount or type(total) ~= "number" then return list end
  local level, zone, me = myLevel(), myZone(), playerName()
  for i = 1, total do
    local ok, name, _, _, theirLevel, class, rosterZone, _, _, online, _, classFile = pcall(GetGuildRosterInfo, i)
    if ok and name and online and type(theirLevel) == "number" and baseName(name) ~= me
      and math.abs(theirLevel - level) <= RANGE then
      if secret(rosterZone) or type(rosterZone) ~= "string" then rosterZone = "" end
      list[#list + 1] = { name = name, level = theirLevel, class = class, classFile = classFile, zone = rosterZone,
        diff = math.abs(theirLevel - level), sameZone = zone ~= "" and rosterZone == zone }
    end
  end
  table.sort(list, function(a, b)
    if a.diff ~= b.diff then return a.diff < b.diff end
    if a.sameZone ~= b.sameZone then return a.sameZone end
    return a.name < b.name
  end)
  while #list > MAX_ROWS do list[#list] = nil end
  return list
end

local function partyInvite(name)
  if C_PartyInfo and C_PartyInfo.InviteUnit then return pcall(C_PartyInfo.InviteUnit, name) end
  if InviteUnit then return pcall(InviteUnit, name) end
  return false
end

function module.invite(name)
  if not name or name == "" then return false end
  if partyInvite(name) then say(string.format(L("Invited %s to your party."), display(name))); return true end
  say(string.format(L("Could not invite %s."), display(name)))
  return false
end

-- Opens the chat box addressed to the player; the member still types and sends.
function module.whisper(name)
  if not name or name == "" then return false end
  if ChatFrame_SendTell then return pcall(ChatFrame_SendTell, name) end
  if ChatFrame_OpenChat then return pcall(ChatFrame_OpenChat, "/w " .. name .. " ") end
  return false
end

-- ---------------------------------------------------------------------
-- Window (created lazily; plain frames, no protected actions)
-- ---------------------------------------------------------------------

local window
local rows = {}

local function classColor(classFile)
  local colors = RAID_CLASS_COLORS
  local c = colors and classFile and colors[classFile]
  if c then return string.format("|cff%02x%02x%02x", (c.r or 1) * 255, (c.g or 1) * 255, (c.b or 1) * 255) end
  return "|cffffffff"
end

local function makeButton(parent, label, width, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetWidth(width)
  b:SetHeight(22)
  if b.SetText then b:SetText(label) end
  b:SetScript("OnClick", onClick)
  return b
end

local function ensureWindow()
  if window then return window end
  window = CreateFrame("Frame", "GuildedLevelPartners", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  window:SetWidth(380)
  window:SetHeight(90)
  window:SetPoint("CENTER", UIParent, "CENTER", 0, 80)
  if window.SetFrameStrata then window:SetFrameStrata("DIALOG") end
  if window.SetBackdrop then
    pcall(window.SetBackdrop, window, { bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
      edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border", tile = true, tileSize = 16, edgeSize = 16,
      insets = { left = 4, right = 4, top = 4, bottom = 4 } })
  end
  -- A solid back as well: the dialog texture alone left the window see-through on one client.
  if window.CreateTexture then
    local solid = window:CreateTexture(nil, "BACKGROUND")
    solid:SetPoint("TOPLEFT", window, "TOPLEFT", 4, -4)
    solid:SetPoint("BOTTOMRIGHT", window, "BOTTOMRIGHT", -4, 4)
    if solid.SetColorTexture then solid:SetColorTexture(0.04, 0.04, 0.05, 0.96) end
  end
  window.title = window:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  window.title:SetPoint("TOP", window, "TOP", 0, -12)
  window.empty = window:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  window.empty:SetPoint("TOP", window.title, "BOTTOM", 0, -10)
  window.empty:SetWidth(340)
  window.close = makeButton(window, L("Close"), 80, function() window:Hide() end)
  window.close:SetPoint("BOTTOM", window, "BOTTOM", 0, 10)
  if UISpecialFrames then table.insert(UISpecialFrames, "GuildedLevelPartners") end
  window:Hide()
  return window
end

function module.refresh()
  if not window then return 0 end
  local list = module.partners()
  window.title:SetText(L("Levelling partners"))
  for i = 1, MAX_ROWS do
    local row, p = rows[i], list[i]
    if p and not row then
      row = {}
      row.label = window:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
      row.label:SetPoint("TOPLEFT", window, "TOPLEFT", 16, -38 - (i - 1) * 24)
      row.label:SetWidth(210)
      row.whisper = makeButton(window, L("Whisper"), 62, function() module.whisper(row.name) end)
      row.whisper:SetPoint("TOPRIGHT", window, "TOPRIGHT", -80, -34 - (i - 1) * 24)
      row.invite = makeButton(window, L("Invite"), 58, function() module.invite(row.name) end)
      row.invite:SetPoint("TOPRIGHT", window, "TOPRIGHT", -16, -34 - (i - 1) * 24)
      rows[i] = row
    end
    if row then
      if p then
        row.name = p.name
        row.label:SetText(string.format("%s%s|r (%d) %s", classColor(p.classFile), display(p.name), p.level, p.zone))
        row.label:Show(); row.whisper:Show(); row.invite:Show()
      else
        row.name = nil
        row.label:Hide(); row.whisper:Hide(); row.invite:Hide()
      end
    end
  end
  if #list == 0 then
    window.empty:SetText(module.available() and string.format(L("Nobody online within %d levels of you."), RANGE)
      or L("You are at the top level. Levelling partners is for characters still levelling."))
    window.empty:Show()
  else
    window.empty:Hide()
  end
  window:SetHeight(#list == 0 and 110 or (80 + #list * 24))
  return #list
end

function module.open()
  if not (IsInGuild and IsInGuild()) then say(L("Join a guild to find levelling partners.")); return false end
  if not module.available() then say(L("You are at the top level. Levelling partners is for characters still levelling.")); return false end
  ensureWindow()
  if C_GuildInfo and C_GuildInfo.GuildRoster then pcall(C_GuildInfo.GuildRoster) end
  window.elapsed = 0
  window:SetScript("OnUpdate", function(self, elapsed)
    self.elapsed = (self.elapsed or 0) + (elapsed or 0)
    if self.elapsed >= REFRESH_SECONDS then self.elapsed = 0; module.refresh() end
  end)
  module.refresh()
  window:Show()
  return true
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["partners"] = function() module.open() end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded partners - online guildmates within 3 levels of you, with Whisper and Invite buttons (while levelling)")
