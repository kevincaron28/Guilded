-- Minimap button and the Guilded tools window.
--
-- Each rank sees only what it can use:
--   officers: Raid, EPGP, Loot, Games, Me, Standings, Dungeons, Tools
--   members:  Me, Standings, Tools (officer-only tools hidden)
-- Rank is re-checked every time the window opens, so a promotion shows up
-- without a reload.
--
-- One shared Player box sits at the top. Targeting a player fills it in
-- automatically, Me / Group... fill it on demand (Group... lists your
-- raid/party, or online guildmates when solo). Every button runs the
-- matching /guilded command, so permissions and validation stay in one place.
--
-- Deliberately avoided: dropdown-menu APIs, hooks into Blizzard's
-- right-click unit menus, and StaticPopup dialogs - the usual ways an addon
-- taints Blizzard UI and triggers "blocked from an action" popups.
-- Everything is created inside pcall so a UI problem can never break the
-- core addon.
local addonName, ns = ...
ns = ns or {}

local ICON = "Interface\\Icons\\INV_Misc_Coin_01"
local DEFAULT_ANGLE = math.rad(220)
local RADIUS_PAD = 5
local PANEL_WIDTH = 790
local PANEL_HEIGHT = 540
-- A sidebar of tabs on the left (grouped, like most modern addons), the page on the right.
local SIDEBAR_WIDTH = 160
local CONTENT_X = SIDEBAR_WIDTH + 26
local PAGE_WIDTH = PANEL_WIDTH - CONTENT_X - 22
local ATTUNEMENT_PRESETS = { "Barrow Deeps", "Hyjal Summit", "Onyxia's Lair" }

local button, panel

-- Player-facing text goes through ns.L (Locale.lua) for English/French.
local function L(text) return ns.L and ns.L(text) or text end
local built = false
local ui = { tabs = {}, officerOnly = {}, currentTab = nil }
-- Read-only view of the window state, for tests (tests/lua/window.test.ts).
ns.windowState = function() return ui end

local function settings()
  return ns.getSettings and ns.getSettings()
end

-- ---------------------------------------------------------------------
-- Small widget helpers
-- ---------------------------------------------------------------------

local function at(widget, parent, x, y)
  widget:ClearAllPoints()
  widget:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y)
  return widget
end

local function newButton(parent, text, width, onClick, height)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetWidth(width or 110)
  b:SetHeight(height or 22)
  b:SetText(text)
  if onClick then b:SetScript("OnClick", onClick) end
  return b
end

-- Hidden entirely for members (not just greyed out).
local function officerOnly(widget)
  table.insert(ui.officerOnly, widget)
  return widget
end

-- Widgets that belong to an optional module (/guilded modules): shown only while
-- it is on (and, with officer = true, only to officers).
local function forModule(key, widget, officer)
  ui.moduleWidgets = ui.moduleWidgets or {}
  table.insert(ui.moduleWidgets, { key = key, widget = widget, officer = officer })
  return widget
end

local function moduleOn(key)
  return not ns.moduleActive or ns.moduleActive(key)
end

local function newEdit(parent, width, numeric)
  local e = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
  e:SetWidth(width)
  e:SetHeight(20)
  e:SetAutoFocus(false)
  if numeric then e:SetNumeric(true) end
  e:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  e:SetScript("OnEnterPressed", function(self) self:ClearFocus() end)
  return e
end

local function newLabel(parent, text, font)
  local l = parent:CreateFontString(nil, "OVERLAY", font or "GameFontNormal")
  l:SetJustifyH("LEFT")
  l:SetJustifyV("TOP")
  l:SetText(text or "")
  return l
end

local function atan2(y, x)
  if math.atan2 then return math.atan2(y, x) end
  return math.atan(y, x)
end

-- Big actions (whole-group awards, ending a raid) need a second click
-- within 3 seconds instead of a popup dialog.
local function confirmClick(b, label, action)
  b:SetScript("OnClick", function(self)
    if self.armed or not C_Timer then
      self.armed = false
      self:SetText(label)
      action()
      return
    end
    self.armed = true
    self:SetText("Click again to confirm")
    C_Timer.After(3, function()
      if self.armed then
        self.armed = false
        self:SetText(label)
      end
    end)
  end)
end

-- ---------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------

local refresh

local function run(text)
  if not ns.runCommand then return end
  ns.runCommand(text)
  if refresh then refresh() end
end

local function selectedPlayer()
  local text = ui.playerBox and ui.playerBox:GetText() or ""
  return ns.normalizeName and ns.normalizeName(text)
end

local function needPlayer()
  local name = selectedPlayer()
  if not name then ns.message("Pick a player first: target them, or use Me / Group... next to Player.") end
  return name
end

local function amount()
  local n = tonumber(ui.amountBox and ui.amountBox:GetText() or "")
  if not n or n <= 0 then ns.message("Enter an amount first.") end
  return n and n > 0 and n or nil
end

local function reasonText()
  local text = ui.reasonBox and ui.reasonBox:GetText() or ""
  return (string.gsub(text, '"', ""))
end

local function setPlayer(name)
  if ui.playerBox and name and name ~= "" then
    ui.playerBox:SetText(name)
    if refresh then refresh() end
  end
end

local function fillFromTarget()
  if UnitExists("target") and UnitIsPlayer("target") then
    setPlayer((UnitName("target")))
  else
    ns.message("Target a player first.")
  end
end

-- ---------------------------------------------------------------------
-- Player picker: clickable list of raid/party members (or online guild)
-- ---------------------------------------------------------------------

local picker
local pickerButtons = {}

local function pickerNames()
  local names = ns.groupMembers and ns.groupMembers() or {}
  if #names <= 1 and GetNumGuildMembers and GetGuildRosterInfo then
    local seen = {}
    for _, name in ipairs(names) do seen[name] = true end
    for i = 1, GetNumGuildMembers() do
      local rosterName, _, _, _, _, _, _, _, online = GetGuildRosterInfo(i)
      local name = ns.normalizeName(rosterName)
      if online and name and not seen[name] then
        seen[name] = true
        table.insert(names, name)
      end
      if #names >= 40 then break end
    end
  end
  table.sort(names)
  return names
end

local function showPicker()
  if not picker then
    picker = CreateFrame("Frame", "GuildedPlayerPicker", panel, BackdropTemplateMixin and "BackdropTemplate" or nil)
    picker:SetFrameStrata("DIALOG")
    picker:SetFrameLevel(panel:GetFrameLevel() + 20)
    picker:SetPoint("TOPLEFT", panel, "TOPRIGHT", -4, 0)
    picker:EnableMouse(true)
    if picker.SetBackdrop then
      picker:SetBackdrop({
        bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
        edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
        tile = true, tileSize = 32, edgeSize = 32,
        insets = { left = 11, right = 12, top = 12, bottom = 11 }
      })
    end
    picker.title = at(newLabel(picker, L("Pick a player")), picker, 18, -16)
    local close = CreateFrame("Button", nil, picker, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", picker, "TOPRIGHT", -4, -4)
  end
  for _, b in ipairs(pickerButtons) do b:Hide() end
  local names = pickerNames()
  for i, name in ipairs(names) do
    local b = pickerButtons[i]
    if not b then
      b = newButton(picker, "", 104)
      pickerButtons[i] = b
    end
    at(b, picker, 16 + ((i - 1) % 2) * 108, -40 - math.floor((i - 1) / 2) * 24)
    b:SetText(name)
    b:SetScript("OnClick", function() setPlayer(name); picker:Hide() end)
    b:Show()
  end
  picker.title:SetText(#names > 1 and L("Pick a player") or L("Nobody else found"))
  picker:SetWidth(248)
  picker:SetHeight(60 + math.ceil(math.max(#names, 1) / 2) * 24)
  picker:Show()
end

-- ---------------------------------------------------------------------
-- Tab pages
-- ---------------------------------------------------------------------

local function buildRaidPage(page)
  ui.raidInfo = at(newLabel(page, "", "GameFontHighlight"), page, 0, 0)

  at(newLabel(page, "Raid name"), page, 0, -32)
  ui.raidName = at(newEdit(page, 170), page, 86, -28)
  at(newButton(page, "Start raid", 90, function()
    local title = ui.raidName:GetText()
    run("start " .. (title ~= "" and title or "Raid"))
  end), page, 266, -28)
  local endButton = at(newButton(page, "End raid", 80), page, 360, -28)
  confirmClick(endButton, "End raid", function() run("end") end)

  at(newLabel(page, "Boss"), page, 0, -66)
  ui.bossName = at(newEdit(page, 170), page, 86, -62)
  at(newButton(page, "Target", 90, function()
    if UnitExists("target") then ui.bossName:SetText((UnitName("target"))) else ns.message("Target the boss first.") end
  end), page, 266, -62)
  at(newButton(page, "Record kill", 80, function()
    local boss = ui.bossName:GetText()
    if boss == "" then ns.message("Type or target the boss first."); return end
    run("boss " .. boss)
  end), page, 360, -62)

  at(newLabel(page, "Attendance for the selected player"), page, 0, -104)
  local x = 0
  for _, status in ipairs({ "Present", "Late", "Absent" }) do
    at(newButton(page, status, 90, function()
      local name = needPlayer()
      if name then run("attendance " .. name .. " " .. string.upper(status)) end
    end), page, x, -124)
    x = x + 96
  end
  -- "Seen" = everyone who was in the raid group at any point since Start
  -- raid (recorded automatically); players already marked keep their status.
  local seenButton = at(newButton(page, "Mark everyone seen present", 220), page, 0, -158)
  confirmClick(seenButton, "Mark everyone seen present", function() run("attendance seen") end)
end

local function buildEpgpPage(page)
  ui.epgpInfo = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, 0)

  at(newLabel(page, "Amount"), page, 0, -62)
  ui.amountBox = at(newEdit(page, 60, true), page, 66, -58)
  local x = 136
  for _, preset in ipairs({ 5, 10, 25, 50, 100 }) do
    at(newButton(page, tostring(preset), 44, function() ui.amountBox:SetText(tostring(preset)) end), page, x, -58)
    x = x + 48
  end

  at(newLabel(page, "Reason"), page, 0, -94)
  ui.reasonBox = at(newEdit(page, 310), page, 66, -90)

  local function epgp(action)
    local name, n = needPlayer(), amount()
    if name and n then run(action .. " " .. name .. " " .. n .. " " .. reasonText()) end
  end
  at(newButton(page, "Award EP", 120, function() epgp("award") end), page, 0, -126)
  at(newButton(page, "Charge GP", 120, function() epgp("gp") end), page, 126, -126)
  at(newButton(page, "Deduct EP", 120, function() epgp("deduct") end), page, 252, -126)
  local groupButton = at(newButton(page, "Award EP to whole group", 220), page, 0, -158)
  confirmClick(groupButton, "Award EP to whole group", function()
    local n = amount()
    if n then run("award group " .. n .. " " .. reasonText()) end
  end)

  at(newLabel(page, "Loot and GP bidding are on the Loot tab.", "GameFontDisableSmall"), page, 0, -198)
end

-- Loot: GP bidding on an item, or giving it directly at a set price.
local function buildLootPage(page)
  at(newLabel(page, "Item (click the box, then shift-click the item)"), page, 0, 0)
  ui.itemBox = at(newEdit(page, 400), page, 6, -18)

  at(newLabel(page, "Min GP"), page, 0, -52)
  ui.minGpBox = at(newEdit(page, 50, true), page, 60, -48)
  ui.minGpBox:SetText("10")
  local x = 120
  for _, preset in ipairs({ 10, 25, 50, 100 }) do
    at(newButton(page, tostring(preset), 44, function() ui.minGpBox:SetText(tostring(preset)) end), page, x, -48)
    x = x + 48
  end
  forModule("bidding", at(newLabel(page, "Time"), page, 0, -84))
  ui.bidSeconds = 30
  ui.secondsButtons = {}
  x = 60
  for _, seconds in ipairs({ 20, 30, 60 }) do
    local b = forModule("bidding", at(newButton(page, seconds .. "s", 50, function()
      ui.bidSeconds = seconds
      for s, button in pairs(ui.secondsButtons) do
        if s == seconds then button:LockHighlight() else button:UnlockHighlight() end
      end
    end), page, x, -80))
    ui.secondsButtons[seconds] = b
    x = x + 54
  end
  ui.secondsButtons[30]:LockHighlight()

  local function item()
    local text = ui.itemBox:GetText()
    if text == "" then ns.message("Put the item in the Item box first (shift-click it).") end
    return text ~= "" and text or nil
  end
  local function minGp()
    local n = tonumber(ui.minGpBox:GetText())
    if not n then ns.message("Enter a minimum GP.") end
    return n
  end

  forModule("bidding", at(newButton(page, "Open bidding", 110, function()
    local link, n = item(), minGp()
    if link and n then run("bid start " .. n .. " " .. link .. " " .. ui.bidSeconds) end
  end), page, 0, -114))
  forModule("bidding", at(newButton(page, "Close now", 90, function() run("bid close") end), page, 114, -114))
  forModule("bidding", at(newButton(page, "Award winner", 110, function()
    run("bid award")
    ui.itemBox:SetText("")
  end), page, 208, -114))
  local cancel = forModule("bidding", at(newButton(page, "Cancel", 80), page, 322, -114))
  confirmClick(cancel, "Cancel", function() run("bid cancel") end)

  ui.bidStatus = forModule("bidding", at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -146))
  ui.bidStatus:SetWidth(PAGE_WIDTH)

  at(newLabel(page, "No bidding: give it to the selected Player for Min GP", "GameFontNormalSmall"), page, 0, -262)
  at(newButton(page, "Give directly", 110, function()
    local name, link, n = needPlayer(), item(), minGp()
    if name and link and n then
      local plain = string.match(link, "%[(.-)%]") or link
      run("loot " .. name .. " " .. plain .. " " .. n)
      if n > 0 then run("gp " .. name .. " " .. n .. " " .. plain) end
      ui.itemBox:SetText("")
    end
  end), page, 0, -278)
  forModule("bidding", at(newLabel(page, "Pugs without the addon bid by whispering you a number.", "GameFontDisableSmall"), page, 116, -283))
end

-- Guild calendar, both ways with Discord (Modules/Calendar.lua). Creating an event is done from
-- a button here because some clients need a real click for it.
local function buildCalendarPage(page)
  at(newLabel(page, "Read the in-game guild calendar so the answers reach Discord, and make in-game events for your Discord raids.", "GameFontNormalSmall"), page, 0, 0)
  ui.calendarStatus = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -70)
  ui.calendarStatus:SetWidth(PAGE_WIDTH)
  at(newButton(page, "Scan the calendar", 150, function()
    if ns.calendar then ns.message("Reading the guild calendar..."); ns.calendar.sync(false) end
  end), page, 0, -32)
  local x = 156
  for n, label in ipairs({ "Create next raid", "Create #2", "Create #3" }) do
    at(newButton(page, label, n == 1 and 130 or 90, function()
      if ns.calendar then ns.calendar.createNext(n) end
    end), page, x, -32)
    x = x + (n == 1 and 134 or 94)
  end
end

-- Soft reserves: everyone reserves for the raid; officers open, lock and roll.
local function buildReservePage(page)
  at(newLabel(page, "Item (click the box, then shift-click the item)"), page, 0, 0)
  ui.reserveItemBox = at(newEdit(page, 400), page, 6, -18)
  local function itemText()
    local text = ui.reserveItemBox:GetText()
    if text == "" then ns.message("Put the item in the Item box first (shift-click it).") end
    return text ~= "" and text or nil
  end
  at(newButton(page, "Reserve", 90, function()
    local text = itemText()
    if text then run("reserve add " .. text) end
  end), page, 0, -46)
  at(newButton(page, "Remove", 90, function()
    local text = itemText()
    if text then run("reserve remove " .. text) end
  end), page, 94, -46)
  at(newButton(page, "Who reserved it", 120, function()
    local text = itemText()
    if text then run("reserve who " .. text) end
  end), page, 188, -46)

  forModule("reserve", at(newLabel(page, "Per player", "GameFontNormalSmall"), page, 0, -84), true)
  ui.reserveLimitBox = forModule("reserve", at(newEdit(page, 30, true), page, 66, -80), true)
  ui.reserveLimitBox:SetText("1")
  forModule("reserve", at(newButton(page, "Open list", 90, function()
    run("reserve open " .. (tonumber(ui.reserveLimitBox:GetText()) or 1))
  end), page, 106, -80), true)
  forModule("reserve", at(newButton(page, "Lock", 70, function() run("reserve lock") end), page, 202, -80), true)
  forModule("reserve", at(newButton(page, "Unlock", 70, function() run("reserve unlock") end), page, 278, -80), true)
  local clear = forModule("reserve", at(newButton(page, "Clear all", 80), page, 354, -80), true)
  confirmClick(clear, "Clear all", function() run("reserve clear") end)
  forModule("reserve", at(newButton(page, "Roll between reservers", 170, function()
    local text = itemText()
    if text then run("reserve roll " .. text) end
  end), page, 0, -110), true)
  forModule("reserve", at(newButton(page, "Award to selected Player", 170, function()
    local text, name = itemText(), needPlayer()
    if text and name then run("reserve award " .. name .. " " .. text) ui.reserveItemBox:SetText("") end
  end), page, 176, -110), true)

  ui.reserveStatus = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -146)
  ui.reserveStatus:SetWidth(PAGE_WIDTH)
end

-- Loot council: officers open an item, raiders answer BiS / Upgrade / Off-spec / Pass, officers award.
local function buildCouncilPage(page)
  at(newLabel(page, "Item (click the box, then shift-click the item)"), page, 0, 0)
  ui.councilItemBox = at(newEdit(page, 400), page, 6, -18)
  at(newLabel(page, "Time"), page, 0, -52)
  ui.councilSeconds = 60
  ui.councilSecondsButtons = {}
  local x = 60
  for _, seconds in ipairs({ 30, 60, 120 }) do
    local b = at(newButton(page, seconds .. "s", 50, function()
      ui.councilSeconds = seconds
      for s, button in pairs(ui.councilSecondsButtons) do
        if s == seconds then button:LockHighlight() else button:UnlockHighlight() end
      end
    end), page, x, -48)
    ui.councilSecondsButtons[seconds] = b
    x = x + 54
  end
  ui.councilSecondsButtons[60]:LockHighlight()

  at(newButton(page, "Open council", 110, function()
    local text = ui.councilItemBox:GetText()
    if text == "" then ns.message("Put the item in the Item box first (shift-click it).") return end
    run("council start " .. text .. " " .. ui.councilSeconds)
  end), page, 0, -80)
  at(newButton(page, "Close now", 90, function() run("council close") end), page, 114, -80)
  local cancel = at(newButton(page, "Cancel", 80), page, 210, -80)
  confirmClick(cancel, "Cancel", function() run("council cancel") end)

  at(newLabel(page, "Award for", "GameFontNormalSmall"), page, 0, -114)
  at(newLabel(page, "GP", "GameFontNormalSmall"), page, 200, -114)
  ui.councilGpBox = at(newEdit(page, 50, true), page, 226, -110)
  ui.councilGpBox:SetText("0")
  at(newButton(page, "Award selected Player", 160, function()
    local name = needPlayer()
    if name then run("council award " .. name .. " " .. (tonumber(ui.councilGpBox:GetText()) or 0)) ui.councilItemBox:SetText("") end
  end), page, 0, -134)
  at(newButton(page, "Award top pick", 120, function()
    run("council award")
    ui.councilItemBox:SetText("")
  end), page, 166, -134)

  ui.councilStatus = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -170)
  ui.councilStatus:SetWidth(PAGE_WIDTH)
  at(newLabel(page, "Members without the addon whisper you: bis, upgrade, os or pass.", "GameFontDisableSmall"), page, 0, -300)
end

local function buildGamesPage(page)
  at(newLabel(page, "Fun roll games. No gold, nothing owed. Players type 1 in party/raid chat to join, then /roll.", "GameFontNormalSmall"), page, 0, -4)
  at(newButton(page, "High roll", 100, function() run("games highroll") end), page, 0, -28)
  at(newButton(page, "Deathroll", 100, function() run("games deathroll") end), page, 104, -28)
  at(newButton(page, "Call the roll", 110, function() run("games roll") end), page, 208, -28)
  at(newButton(page, "Remind", 76, function() run("games remind") end), page, 0, -56)
  at(newButton(page, "Add player", 96, function()
    local name = needPlayer()
    if name then run("games add " .. name) end
  end), page, 80, -56)
  local cancelGame = at(newButton(page, "Cancel game", 100), page, 180, -56)
  confirmClick(cancelGame, "Cancel game", function() run("games cancel") end)

  at(newLabel(page, "Duel: you and the selected Player, classic deathroll (roll the last number, first to roll 1 loses)", "GameFontNormalSmall"), page, 0, -92)
  at(newButton(page, "Start duel", 100, function()
    local name = needPlayer()
    if name then run("games duel " .. name) end
  end), page, 0, -112)

  ui.gamesStatus = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -150)
  ui.gamesStatus:SetWidth(PAGE_WIDTH)
end

local function buildMePage(page)
  at(newButton(page, L("Check my gear"), 180, function() run("inspect") end), page, 0, 0)
  ui.gearInfo = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -30)
  ui.gearInfo:SetWidth(PAGE_WIDTH)

  local attuneBlock = CreateFrame("Frame", nil, page)
  attuneBlock:SetWidth(PAGE_WIDTH)
  attuneBlock:SetHeight(120)
  attuneBlock:SetPoint("TOPLEFT", ui.gearInfo, "BOTTOMLEFT", 0, -14)
  at(newLabel(attuneBlock, L("Attunements")), attuneBlock, 0, 0)
  local x = 0
  for _, preset in ipairs(ATTUNEMENT_PRESETS) do
    at(newButton(attuneBlock, preset, 104, function() ui.attuneBox:SetText(preset) end), attuneBlock, x, -20)
    x = x + 108
  end
  ui.attuneBox = at(newEdit(attuneBlock, 200), attuneBlock, 6, -52)
  local function attune(clear)
    local key = string.gsub(ui.attuneBox:GetText(), '"', "")
    if key == "" then ns.message("Pick or type an attunement first."); return end
    local target = selectedPlayer()
    if ns.isOfficer() and target and target ~= ns.playerName() then
      run('attune ' .. target .. ' "' .. key .. '"' .. (clear and " clear" or ""))
    else
      run('attune "' .. key .. '"' .. (clear and " clear" or ""))
    end
  end
  at(newButton(attuneBlock, L("Mark done"), 90, function() attune(false) end), attuneBlock, 214, -52)
  at(newButton(attuneBlock, L("Clear"), 70, function() attune(true) end), attuneBlock, 308, -52)
  ui.attuneInfo = at(newLabel(attuneBlock, "", "GameFontHighlightSmall"), attuneBlock, 0, -84)
  ui.attuneInfo:SetWidth(PAGE_WIDTH)
end

local function buildStandingsPage(page)
  ui.standingsPlayer = at(newLabel(page, "", "GameFontHighlight"), page, 0, 0)
  ui.standingsPlayer:SetWidth(PAGE_WIDTH)
  ui.standingsList = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -28)
  ui.standingsList:SetWidth(PAGE_WIDTH)
end

local function buildToolsPage(page)
  local everyone = {
    { "Diagnostics", "diag" }, { "Raid status", "status" }, { "All commands", "help" }, { "Addon version", "version" }
  }
  for i, item in ipairs(everyone) do
    at(newButton(page, L(item[1]), 136, function() run(item[2]) end), page, ((i - 1) % 3) * 142, -math.floor((i - 1) / 3) * 28)
  end
  at(newButton(page, L("Hide minimap button"), 180, function() run("minimap hide") end), page, 0, -64)

  officerOnly(at(newLabel(page, "Officer", "GameFontNormalSmall"), page, 0, -100))
  officerOnly(at(newButton(page, "Export data", 136, function() run("export") end), page, 0, -116))
  officerOnly(at(newButton(page, "Officer setup", 136, function() run("officer list") end), page, 142, -116))
  forModule("games", at(newButton(page, "Games help", 136, function() run("games") end), page, 284, -116), true)
  ui.exportHelp = officerOnly(at(newLabel(page,
    "Export: press it, then /reload so the game saves; the companion uploads it to Discord.", "GameFontHighlightSmall"), page, 0, -142))
  ui.exportHelp:SetWidth(PAGE_WIDTH)

  local help = at(newLabel(page,
    L("Minimap button hidden? /guilded minimap show. Problem? Press Diagnostics and send a screenshot to an officer."),
    "GameFontHighlightSmall"), page, 0, -164)
  help:SetWidth(PAGE_WIDTH)

  -- Optional modules: your own switch, and (officers) the guild-wide one. There are more of
  -- these than fit in the page, so they scroll instead of running off the bottom of the window.
  at(newLabel(page, L("Modules"), "GameFontNormal"), page, 0, -196)
  local scroll = CreateFrame("ScrollFrame", nil, page, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -214)
  scroll:SetPoint("BOTTOMRIGHT", page, "BOTTOMRIGHT", -24, 2)
  local scrollChild = CreateFrame("Frame", nil, scroll)
  scrollChild:SetWidth(PAGE_WIDTH - 24)
  scrollChild:SetHeight(math.max(1, #(ns.MODULES or {}) * 22))
  scroll:SetScrollChild(scrollChild)

  ui.moduleRows = {}
  for i, module in ipairs(ns.MODULES or {}) do
    local y = -(i - 1) * 22
    local row = { key = module.key }
    row.label = at(newLabel(scrollChild, "", "GameFontHighlightSmall"), scrollChild, 0, y - 4)
    row.label:SetWidth(330)
    row.mine = at(newButton(scrollChild, "", 86, function()
      local s = ns.getSettings and ns.getSettings()
      local mineOff = s and s.modules and s.modules[module.key] == false
      run("modules " .. (mineOff and "on " or "off ") .. module.key)
    end), scrollChild, 334, y)
    row.guild = officerOnly(at(newButton(scrollChild, "", 110, function()
      local s = ns.getSettings and ns.getSettings()
      local guildOff = s and s.guildModules and s.guildModules.off and s.guildModules.off[module.key]
      run("modules guild " .. (guildOff and "on " or "off ") .. module.key)
    end), scrollChild, 424, y))
    ui.moduleRows[i] = row
  end
end

-- Dungeon challenge: the run being recorded, recent runs, and the
-- season's points from Discord (roadmap D9). Start/complete/abandon check
-- permissions themselves (group leader, officer, or solo).
local function buildDungeonPage(page)
  ui.dgnCurrent = at(newLabel(page, "", "GameFontHighlight"), page, 0, 0)
  ui.dgnCurrent:SetWidth(PAGE_WIDTH)
  at(newButton(page, L("Status"), 90, function() run("dungeon status") end), page, 0, -44)
  at(newButton(page, L("Start now"), 90, function() run("dungeon start") end), page, 94, -44)
  local complete = at(newButton(page, L("Complete"), 90), page, 188, -44)
  confirmClick(complete, L("Complete"), function() run("dungeon complete") end)
  local abandon = at(newButton(page, L("Abandon"), 90), page, 282, -44)
  confirmClick(abandon, L("Abandon"), function() run("dungeon abandon") end)
  at(newButton(page, L("Check"), 90, function() run("dungeon check") end), page, 376, -44)

  at(newLabel(page, L("Recent runs"), "GameFontNormal"), page, 0, -80)
  ui.dgnRuns = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -98)
  ui.dgnRuns:SetWidth(PAGE_WIDTH)
  ui.dgnBoardTitle = at(newLabel(page, "", "GameFontNormal"), page, 0, -196)
  ui.dgnBoard = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -214)
  ui.dgnBoard:SetWidth(PAGE_WIDTH)
end

-- The Ready page: everyone in your raid or party, worst first, one icon per check and why.
-- Green tick = there, red cross = missing (and required), grey = missing but not required,
-- question mark = the game hides it and nobody could tell, amber = running out.
local READY_ROWS = 15
local READY_COLORS = { READY = "|cff55dd55", PARTIAL = "|cffffcc33", NOT_READY = "|cffff5555", NODATA = "|cff999999" }
local CELL_TEXTURE = {
  ok = "Interface\\RaidFrame\\ReadyCheck-Ready", warn = "Interface\\RaidFrame\\ReadyCheck-Ready",
  bad = "Interface\\RaidFrame\\ReadyCheck-NotReady", none = "Interface\\RaidFrame\\ReadyCheck-NotReady",
  unknown = "Interface\\RaidFrame\\ReadyCheck-Waiting", waiting = "Interface\\RaidFrame\\ReadyCheck-Waiting",
  ready = "Interface\\RaidFrame\\ReadyCheck-Ready", notready = "Interface\\RaidFrame\\ReadyCheck-NotReady",
  silent = "Interface\\RaidFrame\\ReadyCheck-NotReady"
}
-- Tint per state: { red, green, blue, alpha }.
local CELL_TINT = {
  ok = { 1, 1, 1, 1 }, warn = { 1, 0.8, 0.2, 1 }, bad = { 1, 1, 1, 1 }, none = { 0.5, 0.5, 0.5, 0.35 },
  unknown = { 1, 1, 1, 0.55 }, waiting = { 1, 1, 1, 0.55 }, ready = { 1, 1, 1, 1 }, notready = { 1, 1, 1, 1 },
  silent = { 0.5, 0.5, 0.5, 0.6 }
}
-- The check columns: key in a row's cells, header icon (file id), tooltip title.
local READY_COLUMNS = {
  { key = "rc", text = "RC", title = "Ready check answer" },
  { key = "flask", icon = 3528447, title = "Flask or elixir" },
  { key = "food", icon = 136000, title = "Food" },
  { key = "weapon", icon = 463543, title = "Weapon enchant" },
  { key = "augment", icon = 4549099, title = "Augment rune" },
  { key = "vantus", icon = 4638737, title = "Vantus rune" },
  { key = "buffs", icon = 135987, title = "Raid buffs" },
}
local CELL_X, CELL_STEP, CELL_SIZE = 178, 24, 18
local DUR_X = CELL_X + #READY_COLUMNS * CELL_STEP + 2
local GEAR_X = DUR_X + 36
local WHY_X = GEAR_X + 28

local function readyTooltip(anchor, entry)
  if not GameTooltip or not entry then return end
  GameTooltip:SetOwner(anchor, "ANCHOR_RIGHT")
  GameTooltip:AddLine(entry.name)
  GameTooltip:AddLine(L(ns.ready.LABEL[entry.status]), 1, 1, 1)
  for _, reason in ipairs(entry.reasons) do GameTooltip:AddLine("- " .. reason, 1, 0.82, 0.3) end
  local source = entry.source == "none" and L("nothing known yet") or (L("from") .. ": " .. entry.source)
  GameTooltip:AddLine(source, 0.6, 0.6, 0.6)
  GameTooltip:Show()
end

local function buildReadyPage(page)
  ui.readySummary = at(newLabel(page, "", "GameFontNormal"), page, 0, 0)
  ui.readySummary:SetWidth(PAGE_WIDTH)
  ui.readyPage = 1
  at(newButton(page, L("Refresh"), 90, function() if ns.ready then refresh() end end), page, 0, -34)
  at(newButton(page, L("Ask everyone to check"), 170, function() if ns.ready then ns.ready.ask() end end), page, 94, -34)
  at(newButton(page, L("Post to group chat"), 150, function() if ns.ready then ns.ready.post() end end), page, 268, -34)
  ui.readyPrev = at(newButton(page, "<", 32, function() ui.readyPage = math.max(1, (ui.readyPage or 1) - 1); refresh() end), page, PAGE_WIDTH - 170, -34)
  ui.readyPageLabel = at(newLabel(page, "", "GameFontHighlightSmall"), page, PAGE_WIDTH - 134, -40)
  ui.readyPageLabel:SetWidth(70)
  ui.readyNext = at(newButton(page, ">", 32, function() ui.readyPage = (ui.readyPage or 1) + 1; refresh() end), page, PAGE_WIDTH - 60, -34)
  at(newLabel(page, L("Player"), "GameFontDisableSmall"), page, 0, -68)
  at(newLabel(page, L("Status"), "GameFontDisableSmall"), page, 116, -68)
  -- Column headers: an icon (or RC) that says what the column is when hovered.
  ui.readyHeaders = {}
  for i, column in ipairs(READY_COLUMNS) do
    local header = CreateFrame("Frame", nil, page)
    header:SetWidth(CELL_SIZE)
    header:SetHeight(CELL_SIZE)
    at(header, page, CELL_X + (i - 1) * CELL_STEP, -64)
    if column.icon then
      local tex = header:CreateTexture(nil, "ARTWORK")
      tex:SetAllPoints(header)
      tex:SetTexture(column.icon)
    else
      local text = newLabel(header, column.text, "GameFontDisableSmall")
      text:SetPoint("CENTER", header, "CENTER", 0, 0)
    end
    if header.EnableMouse then header:EnableMouse(true) end
    header:SetScript("OnEnter", function(self)
      if not GameTooltip then return end
      GameTooltip:SetOwner(self, "ANCHOR_TOP")
      GameTooltip:AddLine(L(column.title))
      GameTooltip:Show()
    end)
    header:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
    ui.readyHeaders[i] = header
  end
  at(newLabel(page, L("Dur"), "GameFontDisableSmall"), page, DUR_X, -68)
  at(newLabel(page, L("Gear"), "GameFontDisableSmall"), page, GEAR_X, -68)
  at(newLabel(page, L("Why"), "GameFontDisableSmall"), page, WHY_X, -68)
  ui.readyRows = {}
  for i = 1, READY_ROWS do
    local y = -86 - (i - 1) * 21
    -- One invisible hover area per row shows the full reasons.
    local hover = CreateFrame("Frame", nil, page)
    hover:SetWidth(PAGE_WIDTH)
    hover:SetHeight(20)
    at(hover, page, 0, y + 2)
    if hover.EnableMouse then hover:EnableMouse(true) end
    local row = {
      name = at(newLabel(page, "", "GameFontHighlight"), page, 0, y),
      status = at(newLabel(page, "", "GameFontHighlightSmall"), page, 116, y - 1),
      dur = at(newLabel(page, "", "GameFontHighlightSmall"), page, DUR_X, y - 1),
      gear = CreateFrame("Frame", nil, page),
      why = at(newLabel(page, "", "GameFontHighlightSmall"), page, WHY_X, y - 1),
      cells = {}
    }
    row.name:SetWidth(112)
    row.name:SetHeight(14)
    row.status:SetWidth(60)
    row.dur:SetWidth(34)
    row.why:SetWidth(PAGE_WIDTH - WHY_X)
    row.why:SetHeight(14)
    -- One line each: a long reason is cut off here and shown in full when hovered.
    if row.why.SetWordWrap then row.why:SetWordWrap(false) end
    if row.name.SetWordWrap then row.name:SetWordWrap(false) end
    for c, column in ipairs(READY_COLUMNS) do
      local tex = page:CreateTexture(nil, "ARTWORK")
      tex:SetWidth(CELL_SIZE)
      tex:SetHeight(CELL_SIZE)
      at(tex, page, CELL_X + (c - 1) * CELL_STEP, y + 1)
      row.cells[column.key] = tex
    end
    row.gear:SetWidth(CELL_SIZE)
    row.gear:SetHeight(CELL_SIZE)
    at(row.gear, page, GEAR_X, y + 1)
    row.gearTex = row.gear:CreateTexture(nil, "ARTWORK")
    row.gearTex:SetAllPoints(row.gear)
    hover:SetScript("OnEnter", function(self) readyTooltip(self, row.entry) end)
    hover:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
    ui.readyRows[i] = row
  end
  ui.readyHint = at(newLabel(page, "", "GameFontDisableSmall"), page, 0, -86 - READY_ROWS * 21 - 6)
  ui.readyHint:SetWidth(PAGE_WIDTH)
end

local function readyTabOpen()
  local tab = ui.tabs[ui.currentTab or 0]
  return tab and tab.name == "Ready" and panel and panel:IsShown()
end

local function setCell(texture, state)
  if not texture then return end
  if not state then texture:Hide() return end
  texture:SetTexture(CELL_TEXTURE[state] or CELL_TEXTURE.unknown)
  local tint = CELL_TINT[state] or CELL_TINT.unknown
  texture:SetVertexColor(tint[1], tint[2], tint[3])
  texture:SetAlpha(tint[4])
  texture:Show()
end

local function classColor(class)
  local c = RAID_CLASS_COLORS and class and RAID_CLASS_COLORS[class]
  if c and c.colorStr then return "|c" .. c.colorStr end
  if c and c.r then return string.format("|cff%02x%02x%02x", c.r * 255, c.g * 255, c.b * 255) end
  return ""
end

-- One line on the latest ready check: how many said yes, no, or nothing.
local function readyCheckLine(result)
  if not result.check then return "" end
  local yes, no, waiting = 0, 0, 0
  for _, entry in ipairs(result.rows) do
    local state = entry.cells and entry.cells.rc
    if state == "ready" then yes = yes + 1
    elseif state == "notready" then no = no + 1
    elseif state == "waiting" or state == "silent" then waiting = waiting + 1 end
  end
  local label = result.check.finished and L("Last ready check") or L("Ready check in progress")
  return string.format("%s: %d %s, %d %s, %d %s", label, yes, L("ready"), no, L("not ready"), waiting, L("no answer"))
end

local function refreshReady()
  if not ui.readySummary or not ns.ready then return end
  local result = ns.ready.collect()
  local pages = math.max(1, math.ceil(#result.rows / READY_ROWS))
  ui.readyPage = math.min(math.max(1, ui.readyPage or 1), pages)
  local summary = (result.inGroup and "" or (L("Not in a group: showing only you.") .. "  ")) .. ns.ready.summary(result)
  local checkLine = readyCheckLine(result)
  if checkLine ~= "" then summary = summary .. "\n" .. checkLine end
  ui.readySummary:SetText(summary)
  ui.readyPageLabel:SetText(string.format("%d / %d", ui.readyPage, pages))
  local first = (ui.readyPage - 1) * READY_ROWS
  for i = 1, READY_ROWS do
    local row = ui.readyRows[i]
    local entry = result.rows[first + i]
    row.entry = entry
    if entry then
      local color = READY_COLORS[entry.status] or ""
      row.name:SetText(classColor(entry.class) .. entry.name .. "|r")
      row.status:SetText(color .. L(ns.ready.LABEL[entry.status]) .. "|r")
      row.why:SetText(table.concat(entry.reasons, ", "))
      local cells = entry.cells or {}
      for _, column in ipairs(READY_COLUMNS) do setCell(row.cells[column.key], cells[column.key]) end
      row.dur:SetText(cells.durability and (cells.durability .. "%") or "")
      setCell(row.gearTex, cells.gear)
    else
      row.name:SetText("")
      row.status:SetText("")
      row.why:SetText("")
      row.dur:SetText("")
      for _, column in ipairs(READY_COLUMNS) do setCell(row.cells[column.key], nil) end
      setCell(row.gearTex, nil)
    end
  end
  ui.readyHint:SetText(result.inRaid and L("It checks by itself when a ready check starts: every Guilded reports what it carries. Hover a row for details; a question mark means the game hides it.")
    or L("Flask and food are only required in a raid group."))
  -- Keep it current while the page is open (people buff up, addons answer).
  if readyTabOpen() and not ui.readyTickPending and C_Timer then
    ui.readyTickPending = true
    C_Timer.After(3, function() ui.readyTickPending = false; if readyTabOpen() then refresh() end end)
  end
end

-- The Home page: what is going on right now, your standing and gear, whether
-- your data has reached Discord, and the few things worth pressing first.
local STATUS_WORD = { READY = "Ready", PARTIAL = "Partly ready", NOT_READY = "Not ready" }
local function statusWord(status) return L(STATUS_WORD[status] or tostring(status or "?")) end

local function heading(page, text, y)
  return at(newLabel(page, text, "GameFontNormal"), page, 0, y)
end

local function buildHomePage(page)
  ui.homeGreeting = at(newLabel(page, "", "GameFontNormalLarge"), page, 0, 0)
  ui.homeGreeting:SetWidth(PAGE_WIDTH)

  heading(page, L("Right now"), -36)
  ui.homeNow = at(newLabel(page, "", "GameFontHighlight"), page, 0, -54)
  ui.homeNow:SetWidth(PAGE_WIDTH)

  heading(page, L("Your standing (from Discord)"), -112)
  ui.homeStanding = at(newLabel(page, "", "GameFontHighlight"), page, 0, -130)
  ui.homeStanding:SetWidth(PAGE_WIDTH)

  heading(page, L("Your gear check"), -184)
  ui.homeGear = at(newLabel(page, "", "GameFontHighlight"), page, 0, -202)
  ui.homeGear:SetWidth(PAGE_WIDTH)

  heading(page, L("Sending your data to Discord"), -260)
  ui.homeSync = at(newLabel(page, "", "GameFontHighlight"), page, 0, -278)
  ui.homeSync:SetWidth(PAGE_WIDTH)

  at(newButton(page, L("Check my gear"), 170, function() run("inspect") end, 30), page, 0, -322)
  at(newButton(page, L("Send to Discord now"), 190, function()
    if ns.syncNow and ns.syncNow.reloadNow then ns.syncNow.reloadNow() else run("sync") end
  end, 30), page, 178, -322)
  at(newButton(page, L("Standings"), 130, function() ui.selectTabByName("Standings") end, 30), page, 376, -322)
  officerOnly(at(newButton(page, L("Run a raid"), 170, function() ui.selectTabByName("Raid") end, 30), page, 0, -360))
  officerOnly(at(newButton(page, L("Give loot"), 190, function() ui.selectTabByName("Loot") end, 30), page, 178, -360))
  at(newLabel(page, L("Everything here is also a chat command: /guilded help lists them."), "GameFontDisableSmall"), page, 0, -402)
end

-- Sidebar order: pages are grouped under these headings.
local GROUPS = { "Overview", "Raid night", "Fun and runs", "System" }
local TAB_DEFS = {
  { name = "Home", hint = "what is going on, and your data", group = "Overview", build = buildHomePage },
  { name = "Me", hint = "your gear check and attunements", group = "Overview", usesPlayer = true, build = buildMePage },
  { name = "Standings", hint = "EP, GP and PR from Discord", group = "Overview", usesPlayer = true, build = buildStandingsPage },
  { name = "Ready", hint = "who is ready for the raid", group = "Raid night", leader = true, build = buildReadyPage },
  { name = "Reserves", hint = "soft reserves for the raid", group = "Raid night", module = "reserve", lootModes = { RESERVE = true }, usesPlayer = true, build = buildReservePage },
  { name = "Calendar", hint = "guild calendar and Discord raids", group = "Raid night", module = "calendar", officer = true, build = buildCalendarPage },
  { name = "Raid", hint = "run a raid: start, bosses, attendance", group = "Raid night", officer = true, usesPlayer = true, build = buildRaidPage },
  { name = "EPGP", hint = "award EP and GP", group = "Raid night", officer = true, usesPlayer = true, build = buildEpgpPage },
  { name = "Loot", hint = "bids and loot", group = "Raid night", officer = true, usesPlayer = true, build = buildLootPage },
  { name = "Council", hint = "loot council: BiS / upgrade / off-spec answers", group = "Raid night", module = "council", lootModes = { COUNCIL = true, PRIORITY = true }, officer = true, usesPlayer = true, build = buildCouncilPage },
  { name = "Dungeons", hint = "the run being recorded, points", group = "Fun and runs", module = "dungeon", build = buildDungeonPage },
  { name = "Games", hint = "fun roll games", group = "Fun and runs", module = "games", usesPlayer = true, build = buildGamesPage },
  { name = "Tools", hint = "switch parts on or off, diagnostics", group = "System", build = buildToolsPage }
}

-- ---------------------------------------------------------------------
-- Refresh: rank-based visibility plus current state in the labels
-- ---------------------------------------------------------------------

local function standingsRows()
  local db = ns.getDb and ns.getDb()
  local rows = {}
  for name, row in pairs(db and db.standings and db.standings.players or {}) do
    table.insert(rows, { name = name, row = row })
  end
  table.sort(rows, function(a, b) return a.row.pr > b.row.pr end)
  return rows
end

local selectTab

local function clock(seconds)
  seconds = math.max(0, math.floor(seconds or 0))
  return string.format("%d:%02d", math.floor(seconds / 60), seconds % 60)
end

local function refreshDungeons(db)
  if not ui.dgnCurrent then return end
  local d = db.dungeon or {}
  local run = d.current
  if run then
    local kills, deaths, tracked = 0, 0, false
    for _, encounter in ipairs(run.encounters or {}) do if encounter.success then kills = kills + 1 end end
    for _, player in pairs(run.players or {}) do
      if type(player.deaths) == "number" then deaths = deaths + player.deaths; tracked = true end
    end
    local now = GetServerTime and GetServerTime() or time()
    local timer = run.startedAt and clock(now - run.startedAt) or L("waiting for the first pull")
    ui.dgnCurrent:SetText(string.format("%s - %s - %s\n%s %d%s   %s", run.name or "?", run.state or "?", timer,
      L("Bosses"), kills, run.bossCount and ("/" .. run.bossCount) or "",
      tracked and string.format(L("Deaths %d"), deaths) or ""))
    -- Keep the timer moving while this tab is open.
    if run.state == "ACTIVE" and ui.tabs[ui.currentTab or 0] and ui.tabs[ui.currentTab].name == "Dungeons"
      and not ui.dgnTickPending and C_Timer then
      ui.dgnTickPending = true
      C_Timer.After(1, function() ui.dgnTickPending = false; refresh() end)
    end
  else
    ui.dgnCurrent:SetText(L("No dungeon run in progress. Enter a dungeon: the timer starts on the first pull and stops on the last boss."))
  end

  local runs = {}
  for _, stored in pairs(d.runs or {}) do table.insert(runs, stored) end
  table.sort(runs, function(a, b) return (a.endedAt or a.detectedAt or 0) > (b.endedAt or b.detectedAt or 0) end)
  local lines = {}
  for i = 1, math.min(6, #runs) do
    local r = runs[i]
    local shown = r.state == "COMPLETED" and r.durationSec and clock(r.durationSec) or string.lower(r.state or "?")
    table.insert(lines, string.format("%s  %s  %s", r.name or "?", shown, r.synced and L("on Discord") or L("waiting to sync")))
  end
  ui.dgnRuns:SetText(#lines > 0 and table.concat(lines, "\n") or L("None yet."))

  local board = GuildedDungeonBoard
  if type(board) == "table" and type(board.rows) == "table" and #board.rows > 0 then
    ui.dgnBoardTitle:SetText(string.format(L("Dungeon points - %s (from Discord)"), tostring(board.season or "")))
    local rows = {}
    for i, row in ipairs(board.rows) do
      if i > 8 then break end
      table.insert(rows, string.format("%2d. %-14s %d", i, tostring(row.name), tonumber(row.points) or 0))
    end
    ui.dgnBoard:SetText(table.concat(rows, "\n"))
  else
    ui.dgnBoardTitle:SetText(L("Dungeon points"))
    ui.dgnBoard:SetText(L("No points yet. They come from Discord after an officer imports the runs."))
  end
end

-- Officer tabs are for officers; leader tabs also for the leader or an assistant of the group.
local function tabAllowed(tab, officer)
  if officer then return true end
  if tab.leader then return ns.ready ~= nil and ns.ready.canView() end
  return not tab.officer
end

-- A tab tied to specific loot systems (Reserves, Council) only clutters the window when the
-- raid actually being run uses a different one. Fails open (shows the tab) if the mode can't
-- be read yet, same as everything else that reads ns.loot.mode().
local function lootModeAllowed(tab)
  if not tab.lootModes then return true end
  local mode = ns.loot and ns.loot.mode and ns.loot.mode()
  if not mode then return true end
  return tab.lootModes[mode] == true
end

local function layoutTabs(officer)
  local y = -62
  local firstVisible
  ui.groupLabels = ui.groupLabels or {}
  for _, label in pairs(ui.groupLabels) do label:Hide() end
  for _, group in ipairs(GROUPS) do
    local any = false
    for _, tab in ipairs(ui.tabs) do
      if tab.group == group and tabAllowed(tab, officer) and (not tab.module or moduleOn(tab.module)) and lootModeAllowed(tab) then any = true end
    end
    if any then
      local label = ui.groupLabels[group]
      if not label then
        label = newLabel(panel, "", "GameFontNormalSmall")
        ui.groupLabels[group] = label
      end
      label:SetText(string.upper(L(group)))
      at(label, panel, 24, y)
      label:Show()
      y = y - 16
      for i, tab in ipairs(ui.tabs) do
        if tab.group == group then
          local visible = tabAllowed(tab, officer) and (not tab.module or moduleOn(tab.module)) and lootModeAllowed(tab)
          tab.visible = visible
          if visible then
            at(tab.button, panel, 20, y)
            tab.button:Show()
            y = y - 28
            firstVisible = firstVisible or i
          else
            tab.button:Hide()
            tab.page:Hide()
          end
        end
      end
      y = y - 8
    end
  end
  local current = ui.tabs[ui.currentTab or 0]
  if not current or not current.visible then selectTab(firstVisible) end
end

local function moduleSignature()
  local parts = {}
  for _, module in ipairs(ns.MODULES or {}) do table.insert(parts, moduleOn(module.key) and "1" or "0") end
  return table.concat(parts)
end

-- Tools tab rows: "Roll games - on", your switch, and the guild switch.
local function refreshModuleRows()
  local s = ns.getSettings and ns.getSettings() or {}
  for _, row in ipairs(ui.moduleRows or {}) do
    local guildOff = s.guildModules and s.guildModules.off and s.guildModules.off[row.key]
    local mineOff = s.modules and s.modules[row.key] == false
    local state
    if guildOff then state = L("off for the whole guild")
    elseif mineOff then state = L("off (your choice)")
    elseif not moduleOn(row.key) then state = L("on after /reload")
    else state = L("on") end
    row.label:SetText(L(ns.moduleName(row.key)) .. " - " .. state)
    row.mine:SetText(mineOff and L("Turn on") or L("Turn off"))
    row.guild:SetText(guildOff and "Guild: on" or "Guild: off")
  end
end

-- Home page text: plain-language state, and the Discord-sync line.
local function refreshHome(db, officer, me)
  if not ui.homeGreeting then return end
  ui.homeGreeting:SetText(string.format("%s   |cff999999%s|r", me, officer and L("Officer") or L("Member")))

  local now = {}
  local raid = ns.getActiveRaid and ns.getActiveRaid()
  table.insert(now, raid and string.format(L("Raid running: %s (%d seen in your group)"), raid.title, ns.getPresenceCount and ns.getPresenceCount() or 0)
    or L("No raid is running."))
  local run = db.dungeon and db.dungeon.current
  if run then table.insert(now, string.format(L("Dungeon run: %s (%s)"), run.name or "?", string.lower(run.state or "?"))) end
  local gameText = moduleOn("games") and ns.games and ns.games.statusText and ns.games.statusText() or ""
  if gameText ~= "" and gameText ~= "No games running." then table.insert(now, gameText) end
  local bidText = moduleOn("bidding") and ns.bidding and ns.bidding.statusText and ns.bidding.statusText() or ""
  if bidText ~= "" then table.insert(now, bidText) end
  if ns.loot and ns.loot.describe and ns.getLootRules and ns.getLootRules() then table.insert(now, ns.loot.describe()) end
  local councilText = moduleOn("council") and ns.council and ns.council.current and ns.council.statusText() or ""
  if councilText ~= "" then table.insert(now, councilText) end
  ui.homeNow:SetText(table.concat(now, "\n"))

  local row = ns.getStanding and ns.getStanding(me)
  ui.homeStanding:SetText(row and string.format("EP %d    GP %d    PR %.2f", row.ep, row.gp, row.pr)
    or (ns.standingProblemText and ns.standingProblemText(me)) or L("No standing yet."))

  local snapshot = db.readiness and db.readiness[me]
  if snapshot then
    local problems = 0
    for _, finding in ipairs(snapshot.findings or {}) do if finding.severity ~= "INFO" then problems = problems + 1 end end
    ui.homeGear:SetText(problems == 0 and string.format(L("%s: nothing missing."), statusWord(snapshot.status))
      or string.format(L("%s: %d thing(s) to fix (see Me)."), statusWord(snapshot.status), problems))
  else
    ui.homeGear:SetText(L("No gear check yet. Press Check my gear."))
  end

  ui.homeSync:SetText(ns.syncNow and ns.syncNow.statusLine and ns.syncNow.statusLine()
    or L("Your data reaches Discord after you /reload or log out (an officer's companion sends it)."))
  if ui.sidebarSync then
    ui.sidebarSync:SetText(ns.syncNow and ns.syncNow.isDirty and ns.syncNow.isDirty() and L("Unsent changes") or L("All saved"))
  end
end

refresh = function()
  if not panel or not panel:IsShown() then return end
  local db = ns.getDb and ns.getDb()
  if not db then return end
  local officer = ns.isOfficer()
  local modules = moduleSignature()
  local leader = ns.ready ~= nil and ns.ready.canView() or false
  if ui.lastOfficer ~= officer or ui.lastLeader ~= leader or ui.lastModules ~= modules then
    ui.lastOfficer = officer
    ui.lastLeader = leader
    ui.lastModules = modules
    for _, widget in ipairs(ui.officerOnly) do
      if officer then widget:Show() else widget:Hide() end
    end
    for _, entry in ipairs(ui.moduleWidgets or {}) do
      if moduleOn(entry.key) and (officer or not entry.officer) then entry.widget:Show() else entry.widget:Hide() end
    end
    layoutTabs(officer)
  end
  refreshModuleRows()

  local me = ns.playerName()
  local name = selectedPlayer()
  refreshHome(db, officer, me)
  if ui.calendarStatus then
    ui.calendarStatus:SetText(moduleOn("calendar") and ns.calendar and ns.calendar.statusText and ns.calendar.statusText() or "")
  end
  if ui.reserveStatus then
    ui.reserveStatus:SetText(moduleOn("reserve") and ns.reserve and ns.reserve.statusText and ns.reserve.statusText(14) or "")
  end

  if officer then
    local raid = ns.getActiveRaid and ns.getActiveRaid()
    ui.raidInfo:SetText(raid and string.format("Active raid: |cffffffff%s|r (started %s, %d seen in group)", raid.title,
      raid.startedAt, ns.getPresenceCount and ns.getPresenceCount() or 0) or "No active raid.")

    local account = name and db.epgp[name]
    local discord = name and ns.getStanding and ns.getStanding(name)
    if not name then
      ui.epgpInfo:SetText("Pick a player at the top (target them, or Me / Group...).")
    else
      -- Discord = the bot's official totals; "this PC" = entries recorded
      -- here that may not have been imported yet.
      local lines = { name }
      table.insert(lines, discord and string.format("Discord:  EP %d   GP %d   PR %.2f", discord.ep, discord.gp, discord.pr)
        or "Discord:  no standings yet")
      if account then table.insert(lines, string.format("Recorded on this PC:  EP %d   GP %d", account.ep, account.gp)) end
      ui.epgpInfo:SetText(table.concat(lines, "\n"))
    end

    ui.gamesStatus:SetText(moduleOn("games") and ns.games and ns.games.statusText and ns.games.statusText() or "")
    if ui.councilStatus then
      ui.councilStatus:SetText(moduleOn("council") and ns.council and ns.council.statusText and ns.council.statusText() or "")
      local session = moduleOn("council") and ns.council and ns.council.current
      if session and session.open and not ui.councilTickPending and C_Timer then
        ui.councilTickPending = true
        C_Timer.After(1, function() ui.councilTickPending = false; refresh() end)
      end
    end
    ui.bidStatus:SetText(moduleOn("bidding") and ns.bidding and ns.bidding.statusText and ns.bidding.statusText() or "")
    -- Keep the bid countdown moving while bidding is open.
    local auction = moduleOn("bidding") and ns.bidding and ns.bidding.current
    if auction and auction.open and not ui.bidTickPending and C_Timer then
      ui.bidTickPending = true
      C_Timer.After(1, function() ui.bidTickPending = false; refresh() end)
    end
  end

  local snapshot = db.readiness[me]
  if snapshot then
    local problems = {}
    for _, finding in ipairs(snapshot.findings or {}) do
      if finding.severity ~= "INFO" then table.insert(problems, finding.message) end
    end
    ui.gearInfo:SetText(string.format(L("Last check: %s%s\n%s"), snapshot.status or "?",
      snapshot.itemLevel and string.format(L("   Item level %s"), snapshot.itemLevel) or "",
      #problems > 0 and table.concat(problems, "\n") or L("Nothing missing.")))
  else
    ui.gearInfo:SetText(L("No gear check yet."))
  end

  local attuneTarget = (officer and name) or me
  local done = {}
  for key, entry in pairs(db.attunements[attuneTarget] or {}) do
    if entry.completed then table.insert(done, key) end
  end
  table.sort(done)
  local doneText = #done > 0 and table.concat(done, ", ") or L("none recorded")
  ui.attuneInfo:SetText((attuneTarget == me and string.format(L("You have done: %s"), doneText)
    or string.format(L("%s has done: %s"), attuneTarget, doneText)) ..
    (officer and L("\n(Officers: Mark done applies to the selected player.)") or ""))

  refreshDungeons(db)
  refreshReady()

  local updatedAt = ns.getStandingsUpdatedAt and ns.getStandingsUpdatedAt()
  if not updatedAt then
    ui.standingsPlayer:SetText(L("No standings yet."))
    ui.standingsList:SetText(L("They come from the Discord bot through an officer's addon. Check back after the next raid."))
  else
    local row = name and ns.getStanding and ns.getStanding(name)
    ui.standingsPlayer:SetText(row and string.format("%s:  EP %d   GP %d   PR %.2f", name, row.ep, row.gp, row.pr)
      or (ns.standingProblemText and ns.standingProblemText(name))
      or string.format(L("%s: no standings (character not linked on Discord?)"), name or "?"))
    local lines = { string.format(L("Top by PR (from Discord, %s):"), updatedAt) }
    local rows = standingsRows()
    for i = 1, math.min(15, #rows) do
      local r = rows[i]
      table.insert(lines, string.format("%2d. %-14s PR %.2f   EP %d / GP %d", i, r.name, r.row.pr, r.row.ep, r.row.gp))
    end
    ui.standingsList:SetText(table.concat(lines, "\n"))
  end
end

selectTab = function(index)
  if not index or not ui.tabs[index] then return end
  ui.currentTab = index
  for i, tab in ipairs(ui.tabs) do
    if i == index then tab.page:Show(); tab.button:LockHighlight() else tab.page:Hide(); tab.button:UnlockHighlight() end
  end
  if ui.pageTitle then
    ui.pageTitle:SetText(L(ui.tabs[index].name) .. (ui.tabs[index].hint and ("   |cff999999" .. L(ui.tabs[index].hint) .. "|r") or ""))
  end
  -- The Player field only matters on pages that act on a player.
  for _, widget in ipairs(ui.playerRow or {}) do
    if ui.tabs[index].usesPlayer then widget:Show() else widget:Hide() end
  end
  local s = settings()
  if s then s.panelTab = ui.tabs[index].name end
  if picker then picker:Hide() end
  refresh()
end

-- ---------------------------------------------------------------------
-- Window
-- ---------------------------------------------------------------------

local function buildPanel()
  panel = CreateFrame("Frame", "GuildedPanel", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  panel:SetWidth(PANEL_WIDTH)
  panel:SetHeight(PANEL_HEIGHT)
  panel:SetFrameStrata("DIALOG")
  panel:SetPoint("CENTER")
  panel:SetMovable(true)
  panel:SetClampedToScreen(true)
  panel:EnableMouse(true)
  panel:RegisterForDrag("LeftButton")
  panel:SetScript("OnDragStart", panel.StartMoving)
  panel:SetScript("OnDragStop", panel.StopMovingOrSizing)
  if panel.SetBackdrop then
    panel:SetBackdrop({
      bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
      edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
      tile = true, tileSize = 32, edgeSize = 32,
      insets = { left = 11, right = 12, top = 12, bottom = 11 }
    })
  end

  -- Which page this is, and what it is for.
  ui.pageTitle = newLabel(panel, "", "GameFontNormal")
  ui.pageTitle:SetPoint("TOPLEFT", panel, "TOPLEFT", CONTENT_X, -16)

  -- Sidebar background, title and rank line.
  local sidebar = panel:CreateTexture(nil, "BACKGROUND")
  sidebar:SetPoint("TOPLEFT", panel, "TOPLEFT", 14, -14)
  sidebar:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", 14, 14)
  sidebar:SetWidth(SIDEBAR_WIDTH)
  if sidebar.SetColorTexture then sidebar:SetColorTexture(0, 0, 0, 0.35) end
  local title = newLabel(panel, "Guilded", "GameFontNormalLarge")
  title:SetPoint("TOPLEFT", panel, "TOPLEFT", 24, -20)
  local close = CreateFrame("Button", nil, panel, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -4, -4)

  -- Sidebar footer: one button that gets your data to Discord, and whether anything is waiting.
  ui.sidebarSync = newLabel(panel, "", "GameFontHighlightSmall")
  ui.sidebarSync:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", 24, 70)
  local sendButton = newButton(panel, L("Send to Discord"), 132, function()
    if ns.syncNow and ns.syncNow.reloadNow then ns.syncNow.reloadNow() else run("sync") end
  end, 26)
  sendButton:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", 22, 40)

  -- Shared player field (shown only on pages that act on a player).
  ui.playerRow = {}
  local function playerWidget(widget) table.insert(ui.playerRow, widget) return widget end
  playerWidget(at(newLabel(panel, L("Player")), panel, CONTENT_X, -32))
  ui.playerBox = playerWidget(at(newEdit(panel, 150), panel, CONTENT_X + 54, -28))
  ui.playerBox:SetScript("OnTextChanged", function() refresh() end)
  playerWidget(at(newButton(panel, L("Target"), 70, fillFromTarget), panel, CONTENT_X + 212, -28))
  playerWidget(at(newButton(panel, L("Me"), 50, function() setPlayer(ns.playerName()) end), panel, CONTENT_X + 286, -28))
  playerWidget(at(newButton(panel, L("Group..."), 84, showPicker), panel, CONTENT_X + 340, -28))

  for i, def in ipairs(TAB_DEFS) do
    local page = CreateFrame("Frame", nil, panel)
    page:SetPoint("TOPLEFT", panel, "TOPLEFT", CONTENT_X, -66)
    page:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -22, 44)
    def.build(page)
    page:Hide()
    local tabButton = newButton(panel, L(def.name), 132, function() selectTab(i) end, 24)
    ui.tabs[i] = { name = def.name, hint = def.hint, group = def.group, officer = def.officer, leader = def.leader, module = def.module, lootModes = def.lootModes, usesPlayer = def.usesPlayer, page = page, button = tabButton }
    tabButton:SetScript("OnEnter", function(self)
      if not GameTooltip then return end
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine(L(def.name))
      if def.hint then GameTooltip:AddLine(L(def.hint), 1, 1, 1) end
      GameTooltip:Show()
    end)
    tabButton:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  end

  -- Latest addon message, so results show here instead of only in chat.
  ui.status = newLabel(panel, "", "GameFontHighlightSmall")
  ui.status:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", CONTENT_X, 18)
  ui.status:SetWidth(PAGE_WIDTH)
  ui.status:SetHeight(24)
  ns.onMessage = function(text)
    if ui.status then ui.status:SetText(text) end
  end
  ns.onGamesChange = function() refresh() end
  ns.onBiddingChange = function() refresh() end
  ns.onCouncilChange = function() refresh() end
  ns.onReserveChange = function() refresh() end
  ns.onCalendarChange = function() refresh() end
  ns.onDungeonChange = function() refresh() end
  ns.onModulesChange = function() refresh() end
  ns.onPeerReadiness = function() if readyTabOpen() then refresh() end end

  -- Targeting a player while the window is open fills the Player field.
  panel:RegisterEvent("PLAYER_TARGET_CHANGED")
  panel:SetScript("OnEvent", function()
    if UnitExists("target") and UnitIsPlayer("target") and not ui.playerBox:HasFocus() then
      setPlayer((UnitName("target")))
    end
  end)
  panel:SetScript("OnShow", function()
    ui.lastOfficer = nil -- re-check rank and modules every time the window opens
    if UnitExists("target") and UnitIsPlayer("target") then
      setPlayer((UnitName("target")))
    elseif ui.playerBox:GetText() == "" then
      setPlayer(ns.playerName())
    end
    refresh()
  end)

  -- Shift-clicking an item normally inserts its link into chat; also put it
  -- in our Item box when that box is selected. hooksecurefunc runs after the
  -- original and never replaces it, so it cannot taint Blizzard's code.
  if hooksecurefunc and ChatEdit_InsertLink then
    hooksecurefunc("ChatEdit_InsertLink", function(link)
      if ui.itemBox and ui.itemBox:HasFocus() and link then ui.itemBox:Insert(link) end
    end)
  end

  -- Escape closes the window like other dialogs.
  if UISpecialFrames then table.insert(UISpecialFrames, "GuildedPanel") end

  local s = settings()
  ui.currentTab = 1
  for i, tab in ipairs(ui.tabs) do
    if s and s.panelTab == tab.name then ui.currentTab = i end
  end
  panel:Hide()
end

function ui.selectTabByName(name)
  for i, tab in ipairs(ui.tabs) do
    if tab.name == name and tab.visible then selectTab(i) return end
  end
end

local function togglePanel()
  local ok, err = pcall(function()
    if not panel then buildPanel() end
    if panel:IsShown() then
      panel:Hide()
    else
      panel:Show()
      if ui.currentTab then selectTab(ui.currentTab) end
    end
  end)
  if not ok then ns.message("Tools window failed to open: " .. tostring(err)) end
end

-- ---------------------------------------------------------------------
-- Minimap button
-- ---------------------------------------------------------------------

local function place(angle)
  local radius = (Minimap:GetWidth() / 2) + RADIUS_PAD
  button:ClearAllPoints()
  button:SetPoint("CENTER", Minimap, "CENTER", math.cos(angle) * radius, math.sin(angle) * radius)
end

local function cursorAngle()
  local mx, my = Minimap:GetCenter()
  local cx, cy = GetCursorPosition()
  local scale = Minimap:GetEffectiveScale()
  return atan2(cy / scale - my, cx / scale - mx)
end

local function buildButton()
  button = CreateFrame("Button", "GuildedMinimapButton", Minimap)
  button:SetWidth(32)
  button:SetHeight(32)
  button:SetFrameStrata("MEDIUM")
  button:SetFrameLevel(8)

  local icon = button:CreateTexture(nil, "ARTWORK")
  icon:SetTexture(ICON)
  icon:SetWidth(20)
  icon:SetHeight(20)
  icon:SetPoint("TOPLEFT", button, "TOPLEFT", 7, -5)

  local border = button:CreateTexture(nil, "OVERLAY")
  border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
  border:SetWidth(53)
  border:SetHeight(53)
  border:SetPoint("TOPLEFT", button, "TOPLEFT", 0, 0)

  button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")
  button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  button:RegisterForDrag("LeftButton")
  button:SetScript("OnClick", function(_, mouseButton)
    if mouseButton == "RightButton" then run("inspect") else togglePanel() end
  end)
  button:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("Guilded")
    GameTooltip:AddLine(L("Left-click: open the tools window"), 1, 1, 1)
    GameTooltip:AddLine(L("Right-click: check my gear"), 1, 1, 1)
    GameTooltip:AddLine(L("Drag: move this button"), 1, 1, 1)
    GameTooltip:Show()
  end)
  button:SetScript("OnLeave", function() GameTooltip:Hide() end)
  button:SetScript("OnDragStart", function(self)
    self:SetScript("OnUpdate", function()
      local angle = cursorAngle()
      place(angle)
      local s = settings()
      if s then s.minimapAngle = angle end
    end)
  end)
  button:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)
end

local function init()
  if built then return end
  built = true
  buildButton()
  local s = settings()
  place((s and s.minimapAngle) or DEFAULT_ANGLE)
  if s and s.minimapHidden then button:Hide() end
end

-- /guilded minimap show|hide|reset  and  /guilded menu
ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["menu"] = function() togglePanel() end
ns.commandHandlers["minimap"] = function(args)
  local action = string.lower(args[1] or "")
  local s = settings()
  if not button or not s then ns.message("The minimap button is not ready yet."); return end
  if action == "hide" then
    s.minimapHidden = true
    button:Hide()
    ns.message("Minimap button hidden. /guilded minimap show brings it back.")
  elseif action == "show" then
    s.minimapHidden = false
    button:Show()
  elseif action == "reset" then
    s.minimapHidden = false
    s.minimapAngle = DEFAULT_ANGLE
    place(DEFAULT_ANGLE)
    button:Show()
  else
    ns.message("/guilded minimap show | hide | reset   (or /guilded menu to open the tools window)")
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded minimap show|hide|reset - the minimap button")

-- Wait until the world has loaded so Core.lua's saved settings exist.
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:SetScript("OnEvent", function()
  local ok, err = pcall(init)
  if not ok then ns.message("Minimap button failed to load: " .. tostring(err)) end
end)
