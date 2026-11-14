-- Guild overview (ROADMAP item 17, variant A of docs/plans/GUILD_OVERVIEW_PANEL.md): the guild at a
-- glance on the "Guild overview" page of the Guilded window.
--
--   header   guild name, members, online now, active this week, how many run Guilded
--   classes  one class-coloured bar per class: online / total
--   levels   one bar per level band, the top level first
--
-- Read-only and cheap: everything comes from the game's own guild roster (GetGuildRosterInfo), so
-- it covers every member with or without Guilded. Nothing is sent to anyone. The page asks the
-- game for a fresh roster when it opens and redraws on GUILD_ROSTER_UPDATE (at most every
-- REFRESH_SECONDS) while it is shown. Only Guilded's own plain frames are touched (text and bar
-- values), never a protected call, so it is safe in combat too.
local addonName, ns = ...
ns = ns or {}

local MAX_MEMBERS = 1000
local REFRESH_SECONDS = 2
local WEEK = 7 * 24 * 3600
local TOOLTIP_NAMES = 15
local BAR_TEXTURE = "Interface\\TargetingFrame\\UI-StatusBar"

local module = {}
ns.guildOverview = module

local function L(text) return ns.L and ns.L(text) or text end
local function secret(value) return ns.isSecret and ns.isSecret(value) end
local function baseName(name) return ns.normalizeName and ns.normalizeName(name) or name end
local function display(name) return ns.displayName and ns.displayName(name) or name end

local function maxLevel()
  local ok, value = pcall(function() return GetMaxPlayerLevel and GetMaxPlayerLevel() end)
  return ok and type(value) == "number" and value > 1 and math.floor(value) or 60
end

-- Level bands, the top level first: 60, 50-59, 40-49, 30-39, 10-29, 1-9 at level cap 60.
function module.levelBands(cap)
  cap = cap or maxLevel()
  local bands = { { min = cap, max = cap } }
  local high = cap - 1
  for _ = 1, 3 do
    local low = math.max(10, high - 9)
    if high >= low then bands[#bands + 1] = { min = low, max = high } end
    high = low - 1
  end
  if high >= 10 then bands[#bands + 1] = { min = 10, max = high } end
  bands[#bands + 1] = { min = 1, max = 9 }
  for _, band in ipairs(bands) do
    band.label = band.min == band.max and tostring(band.min) or (band.min .. "-" .. band.max)
    band.count = 0
  end
  return bands
end

-- Whether the roster includes offline members (the guild window's "Show offline members" box).
local function showsOffline()
  if type(GetGuildRosterShowOffline) ~= "function" then return true end
  local ok, value = pcall(GetGuildRosterShowOffline)
  return not (ok and value == false)
end

-- Seen within the past week: online now, or the game's "last online" under 7 days.
local function activeThisWeek(index, online)
  if online then return true end
  if type(GetGuildRosterLastOnline) ~= "function" then return false end
  local ok, years, months, days, hours = pcall(GetGuildRosterLastOnline, index)
  if not ok or (years == nil and months == nil and days == nil and hours == nil) then return false end
  local age = (((tonumber(years) or 0) * 365 + (tonumber(months) or 0) * 30 + (tonumber(days) or 0)) * 24 + (tonumber(hours) or 0)) * 3600
  return age < WEEK
end

local function className(classFile, localized)
  if type(localized) == "string" and localized ~= "" and not secret(localized) then return localized end
  local names = LOCALIZED_CLASS_NAMES_MALE
  return type(names) == "table" and names[classFile] or classFile
end

-- Everything the page shows, from the game roster. nil when not in a guild or the roster is empty.
function module.collect()
  if not (IsInGuild and IsInGuild()) then return nil end
  if type(GetNumGuildMembers) ~= "function" or type(GetGuildRosterInfo) ~= "function" then return nil end
  local okCount, total = pcall(GetNumGuildMembers)
  total = okCount and tonumber(total) or 0
  if total < 1 then return nil end
  local db = ns.getDb and ns.getDb()
  local peers = type(db) == "table" and type(db.peerRoster) == "table" and db.peerRoster or {}
  local me = ns.playerName and ns.playerName() or nil
  local cap = maxLevel()
  local result = { members = 0, online = 0, active = 0, guilded = 0, cap = cap, classes = {},
    levels = module.levelBands(cap), complete = showsOffline() and total <= MAX_MEMBERS }
  local byClass = {}
  for index = 1, math.min(total, MAX_MEMBERS) do
    local ok, name, _, _, level, class, _, _, _, online, _, classFile = pcall(GetGuildRosterInfo, index)
    if ok and type(name) == "string" and name ~= "" and not secret(name) then
      online = online and true or false
      result.members = result.members + 1
      if online then result.online = result.online + 1 end
      if activeThisWeek(index, online) then result.active = result.active + 1 end
      local key = baseName(name)
      if (key and peers[key]) or (me and key == me) then result.guilded = result.guilded + 1 end
      if type(classFile) == "string" and classFile:match("^%u+$") then
        local entry = byClass[classFile]
        if not entry then
          entry = { classFile = classFile, name = className(classFile, class), online = 0, total = 0, onlineNames = {} }
          byClass[classFile] = entry
          result.classes[#result.classes + 1] = entry
        end
        entry.total = entry.total + 1
        if online then
          entry.online = entry.online + 1
          entry.onlineNames[#entry.onlineNames + 1] = name
        end
      end
      level = tonumber(level)
      if level then
        for _, band in ipairs(result.levels) do
          if level >= band.min and level <= band.max then band.count = band.count + 1; break end
        end
      end
    end
  end
  if result.members == 0 then return nil end
  table.sort(result.classes, function(a, b)
    if a.total ~= b.total then return a.total > b.total end
    return a.name < b.name
  end)
  for _, entry in ipairs(result.classes) do table.sort(entry.onlineNames) end
  local okGuild, guildName = pcall(function() return GetGuildInfo and GetGuildInfo("player") end)
  result.guildName = okGuild and type(guildName) == "string" and not secret(guildName) and guildName or nil
  return result
end

-- "Quebec Gold   238 members   41 online   Active this week: 112   Guilded: 57 / 238"
function module.headerText(data)
  if not data then return "" end
  return string.format("%s   " .. L("%d members") .. "   " .. L("%d online") .. "   " .. L("Active this week: %d") .. "   " .. L("Guilded: %d / %d"),
    data.guildName or L("Your guild"), data.members, data.online, data.active, data.guilded, data.members)
end

local function classColor(classFile)
  local c = RAID_CLASS_COLORS and classFile and RAID_CLASS_COLORS[classFile]
  if c and c.r then return c.r, c.g, c.b end
  return 0.6, 0.6, 0.6
end

-- ---------------------------------------------------------------------
-- The page
-- ---------------------------------------------------------------------

local CLASS_ROWS = 13
local LEVEL_ROWS = 7
local ROW_HEIGHT = 18
local ROW_GAP = 4

-- A native-looking bar: the game's status bar texture over a dark track, a label on the left and
-- the count on the right.
local COUNT_WIDTH = 58 -- a fixed column to the right of the longest bar, so a number is never drawn on top of a bar's end
local function newBar(parent, width)
  local bar = CreateFrame("StatusBar", nil, parent)
  bar:SetWidth(width - COUNT_WIDTH)
  bar:SetHeight(ROW_HEIGHT)
  bar:SetStatusBarTexture(BAR_TEXTURE)
  bar:SetMinMaxValues(0, 1)
  bar:SetValue(0)
  bar:EnableMouse(true)
  local back = bar:CreateTexture(nil, "BACKGROUND")
  back:SetAllPoints(bar)
  if back.SetColorTexture then back:SetColorTexture(0, 0, 0, 0.45) end
  bar.label = bar:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  bar.label:SetPoint("LEFT", bar, "LEFT", 4, 0)
  bar.label:SetJustifyH("LEFT")
  bar.count = bar:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  bar.count:SetPoint("LEFT", bar, "RIGHT", 6, 0)
  bar.count:SetWidth(COUNT_WIDTH - 8)
  bar.count:SetJustifyH("LEFT")
  bar:SetScript("OnEnter", function(self)
    if not (GameTooltip and self.tipTitle) then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(self.tipTitle)
    for _, line in ipairs(self.tipLines or {}) do GameTooltip:AddLine(line, 1, 1, 1, true) end
    GameTooltip:Show()
  end)
  bar:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  bar:Hide()
  return bar
end

local function classTooltip(entry)
  local lines = {}
  if #entry.onlineNames == 0 then
    lines[1] = L("Nobody of this class is online.")
    return lines
  end
  lines[1] = L("Online now:")
  for i = 1, math.min(#entry.onlineNames, TOOLTIP_NAMES) do lines[#lines + 1] = display(entry.onlineNames[i]) end
  if #entry.onlineNames > TOOLTIP_NAMES then lines[#lines + 1] = string.format(L("+%d more"), #entry.onlineNames - TOOLTIP_NAMES) end
  return lines
end

-- Draws data (module.collect()) on a page built by module.buildPage.
function module.render(view, data)
  if not view then return end
  if not data then
    view.header:SetText(L((IsInGuild and IsInGuild()) and "The guild roster is still loading. It fills in by itself in a moment." or "Join a guild to see the guild overview."))
    view.note:SetText("")
    view.classHeading:Hide(); view.levelHeading:Hide()
    for _, bar in ipairs(view.classBars) do bar:Hide() end
    for _, bar in ipairs(view.levelBars) do bar:Hide() end
    return
  end
  view.header:SetText(module.headerText(data))
  view.note:SetText(data.complete and L("From the game's guild roster, so every member counts. Guilded = members running the addon.")
    or L("The guild window hides offline members (Show offline members is off), so totals cover online members only."))
  view.classHeading:Show(); view.levelHeading:Show()
  local most = 1
  for _, entry in ipairs(data.classes) do most = math.max(most, entry.total) end
  for i, bar in ipairs(view.classBars) do
    local entry = data.classes[i]
    if entry then
      local r, g, b = classColor(entry.classFile)
      bar:SetStatusBarColor(r, g, b)
      bar:SetMinMaxValues(0, most)
      bar:SetValue(entry.total)
      bar.label:SetText(entry.name)
      bar.count:SetText(entry.online .. " / " .. entry.total)
      bar.tipTitle = entry.name
      bar.tipLines = classTooltip(entry)
      bar:Show()
    else
      bar:Hide()
    end
  end
  most = 1
  for _, band in ipairs(data.levels) do most = math.max(most, band.count) end
  for i, bar in ipairs(view.levelBars) do
    local band = data.levels[i]
    if band then
      if band.min == data.cap then bar:SetStatusBarColor(1, 0.82, 0) else bar:SetStatusBarColor(0.25, 0.55, 0.9) end
      bar:SetMinMaxValues(0, most)
      bar:SetValue(band.count)
      bar.label:SetText(band.min == data.cap and string.format(L("Level %d"), band.min) or band.label)
      bar.count:SetText(tostring(band.count))
      bar.tipTitle = nil
      bar:Show()
    else
      bar:Hide()
    end
  end
end

local function requestRoster()
  local fn = C_GuildInfo and C_GuildInfo.GuildRoster or GuildRoster
  if type(fn) == "function" then pcall(fn) end
end

-- Builds the page once (inside the Guilded window, out of combat); it redraws itself on show.
-- helpers = { newLabel, newButton, at, width } from Modules/Minimap.lua.
function module.buildPage(page, helpers)
  local width = helpers.width or 580
  local half = math.floor((width - 16) / 2)
  local view = { classBars = {}, levelBars = {}, page = page }
  view.header = helpers.at(helpers.newLabel(page, "", "GameFontNormal"), page, 0, 0)
  view.header:SetWidth(width)
  -- Everything below hangs from the text above it, so a translated header that wraps never overlaps.
  view.note = helpers.newLabel(page, "", "GameFontDisableSmall")
  view.note:SetPoint("TOPLEFT", view.header, "BOTTOMLEFT", 0, -4)
  view.note:SetWidth(width)
  view.classHeading = helpers.newLabel(page, "Classes (online / total)", "GameFontNormal")
  view.classHeading:SetPoint("TOPLEFT", view.note, "BOTTOMLEFT", 0, -14)
  view.levelHeading = helpers.newLabel(page, "Levels", "GameFontNormal")
  view.levelHeading:SetPoint("TOPLEFT", view.classHeading, "TOPLEFT", half + 16, 0)
  local step = ROW_HEIGHT + ROW_GAP
  for i = 1, CLASS_ROWS do
    local bar = newBar(page, half)
    bar:SetPoint("TOPLEFT", view.classHeading, "BOTTOMLEFT", 0, -6 - (i - 1) * step)
    view.classBars[i] = bar
  end
  for i = 1, LEVEL_ROWS do
    local bar = newBar(page, half)
    bar:SetPoint("TOPLEFT", view.levelHeading, "BOTTOMLEFT", 0, -6 - (i - 1) * step)
    view.levelBars[i] = bar
  end
  if helpers.newButton then
    view.refreshButton = helpers.newButton(page, "Refresh", 90, function() requestRoster(); module.refresh() end)
    view.refreshButton:SetPoint("TOPLEFT", view.levelHeading, "BOTTOMLEFT", 0, -6 - LEVEL_ROWS * step - 10)
  end
  module.view = view
  page:HookScript("OnShow", function() requestRoster(); module.refresh() end)
  return view
end

-- Redraws the page if it is built and shown.
function module.refresh()
  local view = module.view
  if not view then return end
  if view.page and view.page.IsShown and not view.page:IsShown() then return end
  local ok, err = pcall(function() module.render(view, module.collect()) end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "guild overview: " .. tostring(err)) end
end

-- New roster data while the page is open: redraw, at most every REFRESH_SECONDS.
local pending = false
local frame = CreateFrame("Frame")
frame:RegisterEvent("GUILD_ROSTER_UPDATE")
frame:SetScript("OnEvent", function()
  local view = module.view
  if not view or pending or not (view.page and view.page.IsShown and view.page:IsShown()) then return end
  if C_Timer and C_Timer.After then
    pending = true
    C_Timer.After(REFRESH_SECONDS, function() pending = false; module.refresh() end)
  else
    module.refresh()
  end
end)
