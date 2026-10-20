-- Minimap button and the Guilded tools window.
--
-- Each rank sees only what it can use:
--   officers: Raid, EPGP, Loot, Me, Standings, Dungeons, Tools
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

local ICON = "Interface\\AddOns\\Guilded\\Media\\GuildedLogo"
local DEFAULT_ANGLE = math.rad(220)
local RADIUS_PAD = 5
local PANEL_WIDTH = 790
-- 600 (5.0, was 540): room for the Scores page and officer controls.
local PANEL_HEIGHT = 600
-- A sidebar of tabs on the left (grouped, like most modern addons), the page on the right.
local SIDEBAR_WIDTH = 160
local CONTENT_X = SIDEBAR_WIDTH + 26
local PAGE_WIDTH = PANEL_WIDTH - CONTENT_X - 22
local ATTUNEMENT_PRESETS = { "Barrow Deeps", "Hyjal Summit", "Onyxia's Lair" }

local button, panel

-- Player-facing text goes through ns.L (Locale.lua) for English/French.
local function L(text) return ns.L and ns.L(text) or text end
local built = false
local ui = { tabs = {}, officerOnly = {}, currentTab = nil, scope = "main" }
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

-- Room around a button label (the button art has borders).
local BUTTON_PADDING = 20

local function newButton(parent, text, width, onClick, height)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetWidth(width or 110)
  b:SetHeight(height or 22)
  b:SetText(L(text))
  -- A translation longer than the layout's width widens the button instead of being cut off
  -- ("Partager mon registre comme classement" in French).
  local label = b.GetFontString and b:GetFontString()
  local needed = label and label.GetStringWidth and label:GetStringWidth()
  if type(needed) == "number" and needed + BUTTON_PADDING > (width or 110) then b:SetWidth(needed + BUTTON_PADDING) end
  if onClick then b:SetScript("OnClick", onClick) end
  return b
end

-- string.upper leaves accented letters lowercase, so a French heading such as Systeme would keep a small accented e; French headings need their capitals.
local ACCENT_CAPITALS = { ["\195\160"] = "\195\128", ["\195\162"] = "\195\130", ["\195\167"] = "\195\135", ["\195\168"] = "\195\136",
  ["\195\169"] = "\195\137", ["\195\170"] = "\195\138", ["\195\174"] = "\195\142", ["\195\180"] = "\195\148", ["\195\187"] = "\195\155" }
local function upperText(text)
  return (string.gsub(string.upper(text), "\195[\160-\187]", function(letter) return ACCENT_CAPITALS[letter] or letter end))
end

-- A tick box with a label on its right.
local function newCheck(parent, text)
  local box = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
  box:SetWidth(24)
  box:SetHeight(24)
  local label = box:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  label:SetPoint("LEFT", box, "RIGHT", 2, 0)
  label:SetText(L(text))
  box.label = label
  return box
end

-- A hover tooltip that says what a button does.
local function tip(widget, text)
  if not (widget and widget.SetScript and text) then return widget end
  local function show(self)
    if not GameTooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    GameTooltip:AddLine(L(text), 1, 1, 1, true)
    GameTooltip:Show()
  end
  if widget.HookScript then widget:HookScript("OnEnter", show) else widget:SetScript("OnEnter", show) end
  local function hide() if GameTooltip then GameTooltip:Hide() end end
  if widget.HookScript then widget:HookScript("OnLeave", hide) else widget:SetScript("OnLeave", hide) end
  return widget
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

-- Every "Item" box: shift-clicking an item fills whichever of them has focus.
local itemBoxes = {}
local function itemBox(box) table.insert(itemBoxes, box) return box end

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
  l:SetText(text and text ~= "" and L(text) or "")
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
      self:SetText(L(label))
      action()
      return
    end
    self.armed = true
    self:SetText(L("Click again to confirm"))
    C_Timer.After(3, function()
      if self.armed then
        self.armed = false
        self:SetText(L(label))
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
  -- The selected raid core's roster: its players here PRESENT, its missing mains ABSENT.
  local rosterButton = tip(at(newButton(page, "From core roster", 160), page, 230, -158),
    "Marks the selected raid core's players here PRESENT and its missing mains ABSENT. Click twice.")
  confirmClick(rosterButton, "From core roster", function() run("attendance roster") end)
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
  tip(at(newButton(page, "Deduct GP", 120, function() epgp("gpdeduct") end), page, 378, -126),
    "Takes GP back, for example a mistaken charge or a returned item. Never below 0.")
  local groupButton = at(newButton(page, "Award EP to whole group", 220), page, 0, -158)
  confirmClick(groupButton, "Award EP to whole group", function()
    local n = amount()
    if n then run("award group " .. n .. " " .. reasonText()) end
  end)

  local undoButton = tip(at(newButton(page, "Undo my last award", 170), page, 230, -158),
    "Takes back the last EP/GP entry you made (it stays in the ledger, marked voided). Click twice.")
  confirmClick(undoButton, "Undo my last award", function() run("undo") end)

  at(newLabel(page, "Loot and GP bidding are on the Loot tab.", "GameFontDisableSmall"), page, 0, -198)
end

-- Loot: GP bidding on an item, or giving it directly at a set price.
local function buildLootPage(page)
  at(newLabel(page, "Item (click the box, then shift-click the item)"), page, 0, 0)
  ui.itemBox = itemBox(at(newEdit(page, 400), page, 6, -18))

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

  -- Epic items seen dropping (Loot.lua): one click starts each the way this core decides loot.
  at(newLabel(page, L("Dropped this raid"), "GameFontNormalSmall"), page, 0, -306)
  ui.dropRows = {}
  for i = 1, 4 do
    local y = -322 - (i - 1) * 20
    local row = {}
    row.button = at(newButton(page, L("Drop"), 60, function()
      if row.index then run("drops " .. row.index) end
    end, 20), page, 0, y)
    row.label = at(newLabel(page, "", "GameFontHighlightSmall"), page, 66, y - 4)
    row.label:SetWidth(PAGE_WIDTH - 66)
    ui.dropRows[i] = row
  end
  ui.dropEmpty = at(newLabel(page, "", "GameFontDisableSmall"), page, 0, -326)
  ui.dropEmpty:SetWidth(PAGE_WIDTH)
  ui.tradeText = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -404)
  ui.tradeText:SetWidth(PAGE_WIDTH)
end

-- Guild calendar, both ways with Discord (Modules/Calendar.lua). Creating an event is done from
-- a button here because some clients need a real click for it.
local function buildPublicRaidsPage(page)
  ui.pugRole = nil
  ui.pugPage = 1
  local function update()
    if not ns.publicRaids then return end
    local rows, fresh = ns.publicRaids.rows(ui.pugRole, ui.pugRealm:GetText())
    local count = math.max(1, math.ceil(#rows / 3))
    ui.pugPage = math.max(1, math.min(ui.pugPage, count))
    local text = ns.publicRaids.statusText(ui.pugRole, ui.pugRealm:GetText())
    -- Summary and stale state are always visible. Rows have individual copy buttons.
    ui.pugStatus:SetText(fresh and (L("Snapshot from:") .. " " .. tostring(GuildedPublicRaids.fetchedAt) .. "\n" ..
      L("Counts may change. Join the host Discord and confirm there. Reload after companion sync.")) or text)
    for i, entry in ipairs(ui.pugRows) do
      local index = (ui.pugPage - 1) * 3 + i
      local row = rows[index]
      entry.index = index
      if row then
        local clean = function(value) return tostring(value or ""):gsub("|", ""):gsub("[%c]", " ") end
        entry.label:SetText(clean(row.title) .. " - " .. clean(row.guildName) .. "\n" .. clean(row.at) .. " UTC\n"
          .. clean(row.realm) .. " / " .. clean(row.faction) .. " / " .. clean(row.language) .. "\n"
          .. string.format(L("Tank: %d | Healer: %d | DPS: %d"), row.tanks or 0, row.healers or 0, row.dps or 0))
        entry.button:Show()
      else
        entry.label:SetText(i == 1 and fresh and L("No open raids match these filters.") or "")
        entry.button:Hide()
      end
    end
    ui.pugPages:SetText(ui.pugPage .. " / " .. count)
  end
  at(newLabel(page, "Realm"), page, 0, 0)
  ui.pugRealm = at(newEdit(page, 210), page, 6, -20)
  ui.pugRealm:SetScript("OnEnterPressed", function(self) self:ClearFocus(); ui.pugPage = 1; update() end)
  at(newButton(page, "Filter", 80, function() ui.pugPage = 1; update() end), page, 230, -18)
  local roles = { { "All roles", nil }, { "Tank", "tanks" }, { "Healer", "healers" }, { "DPS", "dps" } }
  for i, choice in ipairs(roles) do
    at(newButton(page, choice[1], 90, function() ui.pugRole = choice[2]; ui.pugPage = 1; update() end), page, (i - 1) * 96, -52)
  end
  ui.pugStatus = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -86)
  ui.pugStatus:SetWidth(PAGE_WIDTH)
  ui.pugRows = {}
  for i = 1, 3 do
    local entry = {}
    entry.label = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -150 - (i - 1) * 92)
    entry.label:SetWidth(PAGE_WIDTH - 120)
    entry.button = at(newButton(page, "Copy Discord", 110, function()
      ns.publicRaids.copy(entry.index, ui.pugRole, ui.pugRealm:GetText())
    end), page, PAGE_WIDTH - 114, -150 - (i - 1) * 92)
    ui.pugRows[i] = entry
  end
  at(newButton(page, "Previous", 90, function() ui.pugPage = ui.pugPage - 1; update() end), page, 0, -440)
  at(newButton(page, "Next", 90, function() ui.pugPage = ui.pugPage + 1; update() end), page, 96, -440)
  ui.pugPages = at(newLabel(page, ""), page, 200, -445)
  at(newButton(page, "Website", 100, function() ns.publicRaids.copy() end), page, PAGE_WIDTH - 104, -440)
  local elapsed = 0
  page:SetScript("OnUpdate", function(_, dt)
    elapsed = elapsed + dt
    if elapsed >= 5 then elapsed = 0; update() end
  end)
  ui.refreshPugs = update
end

local function buildCalendarPage(page)
  -- Inside the game's calendar the page is narrower than PAGE_WIDTH; updateGuildScroll narrows
  -- these two labels to what is visible so they wrap instead of being cut off.
  ui.calendarIntro = at(newLabel(page, "Read the in-game guild calendar so the answers reach Discord, and make in-game events for your Discord raids.", "GameFontNormalSmall"), page, 0, 0)
  ui.calendarIntro:SetWidth(PAGE_WIDTH)
  ui.calendarStatus = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -70)
  ui.calendarStatus:SetWidth(PAGE_WIDTH)
  at(newButton(page, "Scan the calendar", 150, function()
    if ns.calendar then ns.message("Reading the guild calendar..."); ns.calendar.sync(false) end
  end), page, 0, -32)
  at(newButton(page, "Sync next missing event", 200, function()
    if ns.calendar then ns.calendar.createMissing() end
  end), page, 156, -32)
end

-- Soft reserves: everyone reserves for the raid; officers open, lock and roll.
local function buildReservePage(page)
  at(newLabel(page, "Item (click the box, then shift-click the item)"), page, 0, 0)
  ui.reserveItemBox = itemBox(at(newEdit(page, 400), page, 6, -18))
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
  ui.councilItemBox = itemBox(at(newEdit(page, 400), page, 6, -18))
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
  -- Another officer's council: vote for the selected Player (the host counts the votes).
  ui.councilVote = at(newButton(page, "Vote for selected", 130, function()
    local name = needPlayer()
    if name then run("council vote " .. name) end
  end), page, 292, -134)

  ui.councilStatus = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -170)
  ui.councilStatus:SetWidth(PAGE_WIDTH)
  at(newLabel(page, "Members without the addon whisper you: bis, upgrade, os or pass.", "GameFontDisableSmall"), page, 0, -300)
end

-- Local guild: set up a guild's raid teams and loot without Discord, in three numbered steps, each
-- with one line saying what it is for. Every button says what happened in chat.
local LOOT_MODES = { "EPGP", "COUNCIL", "RESERVE", "PRIORITY" }
local LOOT_MODE_HELP = {
  EPGP = "GP bids: players earn EP for raiding and bid GP on each item; the highest bid wins and pays it.",
  COUNCIL = "Loot council: raiders answer BiS, upgrade or off-spec, and officers decide who gets the item.",
  RESERVE = "Soft reserves: players reserve items before the raid; when one drops, its reservers roll (SR = how many each).",
  PRIORITY = "EPGP priority: every item has a set GP price; it goes to the highest PR (EP/GP) of those who want it.",
}
local function buildLocalGuildPage(page)
  local y = 0
  local function heading(text) at(newLabel(page, text, "GameFontNormal"), page, 0, y); y = y - 18 end
  local function hint(text)
    local label = at(newLabel(page, text, "GameFontDisableSmall"), page, 0, y)
    label:SetWidth(PAGE_WIDTH - 8)
    y = y - 28
  end
  local function selectedCore()
    local core = ns.loot and ns.loot.core()
    return core and core.localOnly and core or nil
  end
  local function needCore()
    local core = selectedCore()
    if not core then ns.message(L("Create a raid core first (step 1).")) end
    return core
  end

  at(newLabel(page, "Run your guild's raid teams, loot and EP/GP right here: no Discord needed. Follow the steps in order.", "GameFontHighlightSmall"), page, 0, y):SetWidth(PAGE_WIDTH - 8)
  y = y - 30

  heading("1. Create a raid core")
  hint("A core is one raid team, for example \"Tuesday MC\". Type its name and press Create. Next core switches between teams.")
  local coreBox = at(newEdit(page, 220), page, 6, y)
  tip(at(newButton(page, "Create core", 130, function()
    if not ns.localGuild then return end
    local name = (coreBox:GetText() or ""):match("^%s*(.-)%s*$")
    if name == "" then ns.message(L("Type a name for the raid core first.")); return end
    if ns.localGuild.create(name) then
      coreBox:SetText("")
      ns.message(string.format(L("Raid core %s created and selected. Next: choose its loot system (step 2)."), name))
    end
    refresh()
  end), page, 240, y), "Creates the raid team and selects it.")
  tip(at(newButton(page, "Next core", 130, function()
    local cores = ns.localGuild and ns.localGuild.rules().cores or {}
    if #cores == 0 then ns.message(L("No raid core yet: create one first.")); return end
    local current = ns.loot and ns.loot.core()
    local index = 0; for i, core in ipairs(cores) do if current and core.id == current.id then index = i end end
    local nextCore = cores[index + 1] or cores[1]
    run("core " .. nextCore.id)
    refresh()
  end), page, 380, y), "Selects the next raid core. Steps 2 and 3 apply to the selected core.")
  y = y - 40

  heading("2. Choose how loot is given")
  hint("Click the first button to change the system, set how many soft reserves each player gets, then Save.")
  local mode, limit = 1, 1
  local modeButton, limitButton
  local function showMode()
    modeButton:SetText(ns.loot and ns.loot.label and ns.loot.label(LOOT_MODES[mode]) or LOOT_MODES[mode])
    limitButton:SetText(string.format(L("SR: %d each"), limit))
  end
  modeButton = at(newButton(page, "EPGP", 170, function() mode = mode % #LOOT_MODES + 1; showMode() end), page, 0, y)
  modeButton:HookScript("OnEnter", function(self)
    if not GameTooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    GameTooltip:AddLine(L(LOOT_MODE_HELP[LOOT_MODES[mode]]), 1, 1, 1, true)
    GameTooltip:AddLine(L("Click to change."), 0.6, 0.6, 0.6, true)
    GameTooltip:Show()
  end)
  modeButton:HookScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  limitButton = tip(at(newButton(page, "SR: 1 each", 120, function() limit = limit % 10 + 1; showMode() end), page, 180, y),
    "Soft reserves per player (used by the soft-reserve system). Click to change.")
  tip(at(newButton(page, "Save loot rules", 150, function()
    local core = needCore()
    if not (core and ns.localGuild) then return end
    if ns.localGuild.configure(core.id, LOOT_MODES[mode], limit) then
      ns.message(string.format(L("%s now uses %s. Next: add your raiders (step 3)."), core.name,
        ns.loot and ns.loot.label and ns.loot.label(LOOT_MODES[mode]) or LOOT_MODES[mode]))
    end
    refresh()
  end), page, 310, y), "Saves the loot system for the selected core.")
  -- Show the selected core's own rules, not a default the player might save over them by mistake.
  ui.localGuildSync = function()
    local core = selectedCore()
    if not core then return end
    for i, value in ipairs(LOOT_MODES) do if value == core.mode then mode = i end end
    limit = tonumber(core.reserves) or 1
    showMode()
  end
  showMode()
  y = y - 40

  heading("3. Add your raiders")
  hint("Type a character's name, pick their role and Main (plays every week) or Bench, then Add. Use Add again to change someone.")
  local player = at(newEdit(page, 200), page, 6, y)
  local roles, role, spot = { "DPS", "TANK", "HEALER" }, 1, "main"
  local roleNames = { DPS = "DPS", TANK = "Tank", HEALER = "Healer" }
  local roleButton, spotButton
  roleButton = tip(at(newButton(page, "DPS", 90, function() role = role % #roles + 1; roleButton:SetText(L(roleNames[roles[role]])) end), page, 220, y), "Role. Click to change.")
  spotButton = tip(at(newButton(page, "Main", 90, function() spot = spot == "main" and "bench" or "main"; spotButton:SetText(L(spot == "main" and "Main" or "Bench")) end), page, 320, y),
    "Main raiders play every week; Bench is the backup list. Click to change.")
  y = y - 32
  local function typedName()
    local name = (player:GetText() or ""):match("^%s*(.-)%s*$")
    if name == "" then ns.message(L("Type the character's name first.")); return nil end
    return name
  end
  tip(at(newButton(page, "Add / update", 130, function()
    local core, name = needCore(), typedName()
    if not (core and name and ns.localGuild) then return end
    if ns.localGuild.member(core.id, name, roles[role], spot) then
      player:SetText("")
      ns.message(string.format(L("%s added to %s (%s, %s)."), name, core.name, L(roleNames[roles[role]]), L(spot == "main" and "Main" or "Bench")))
    else ns.message(L("That name could not be added: check the spelling (no links), or the 80-player limit.")) end
    refresh()
  end), page, 0, y), "Adds the character to the selected core, or updates their role and spot.")
  local remove = at(newButton(page, "Remove player", 130), page, 140, y)
  tip(remove, "Takes the typed character off the selected core. Click twice to confirm.")
  confirmClick(remove, "Remove player", function()
    local core, name = needCore(), typedName()
    if not (core and name and ns.localGuild) then return end
    if ns.localGuild.remove(core.id, name, true) then
      player:SetText("")
      ns.message(string.format(L("%s removed from %s."), name, core.name))
    else ns.message(string.format(L("%s is not on %s."), name, core.name)) end
    refresh()
  end)
  y = y - 40

  heading("Share and keep safe")
  hint("Publish shows the EP/GP standings to every member. Backup saves a copy another officer can load with Restore. Officers can also share awards as they happen: /guilded ledgersync on.")
  tip(at(newButton(page, "Publish standings", 150, function() run("standings publish") end), page, 0, y), "Sends the current EP/GP standings to guild members.")
  tip(at(newButton(page, "Backup", 130, function() run("backup") end), page, 160, y), "Shows a code with this guild's data: copy it (Ctrl+C) somewhere safe, or give it to another officer.")
  tip(at(newButton(page, "Restore preview", 130, function() run("restore") end), page, 300, y), "Shows what a backup would change before you load it.")
  y = y - 40

  ui.localGuildInfo = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, y)
  ui.localGuildInfo:SetWidth(PAGE_WIDTH - 8)
  ui.localGuildInfoTop = -y
end

local function buildMePage(page)
  at(newButton(page, L("Check my gear"), 180, function() run("inspect") end), page, 0, 0)
  tip(at(newButton(page, L("My EP/GP history"), 170, function() run("history") end), page, 190, 0),
    "Your last EP/GP entries and loot, asked from an online officer (officers: from this PC).")
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

local function standingsCores()
  local rules = ns.getLootRules and ns.getLootRules()
  return rules and rules.cores or {}
end

local function standingsCore()
  if ui.standingsCoreId == nil then
    local active = ns.loot and ns.loot.core and ns.loot.core()
    ui.standingsCoreId = active and active.id or ""
    if not active then
      local found
      for _, core in ipairs(standingsCores()) do
        for _, member in ipairs(core.roster or {}) do
          if member.name == ns.playerName() then
            if found and found ~= core.id then return nil end
            found = core.id
          end
        end
      end
      ui.standingsCoreId = found or ""
    end
  end
  for _, core in ipairs(standingsCores()) do
    if core.id == ui.standingsCoreId then return core end
  end
  ui.standingsCoreId = ""
end

local function buildStandingsPage(page)
  ui.standingsView = at(newButton(page, "Guild-wide standings", PAGE_WIDTH, function()
    local cores, index = standingsCores(), 0
    for i, core in ipairs(cores) do if core.id == ui.standingsCoreId then index = i end end
    ui.standingsCoreId = cores[index + 1] and cores[index + 1].id or ""
    refresh()
  end), page, 0, 0)
  tip(ui.standingsView, "Click to switch between guild-wide standings and each core's roster. This does not change the loot core.")
  ui.standingsScope = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -28)
  ui.standingsPlayer = at(newLabel(page, "", "GameFontHighlight"), page, 0, -52)
  ui.standingsPlayer:SetWidth(PAGE_WIDTH)
  ui.standingsList = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -80)
  ui.standingsList:SetWidth(PAGE_WIDTH)
  local sheet = at(newButton(page, "Copy for Excel", 140, function() run("sheet standings") end), page, 0, -420)
  sheet:ClearAllPoints()
  sheet:SetPoint("TOPLEFT", ui.standingsList, "BOTTOMLEFT", 0, -16)
  tip(sheet, "Shows the standings as a table to copy (Ctrl+C) and paste into Excel or Google Sheets. /guilded sheet loot|attendance|raids|dungeons for the others.")
  -- Standalone guilds (no Discord bot): the officer's own ledger becomes everyone's standings.
  local publish = officerOnly(at(newButton(page, "Share my ledger as standings", 230), page, 0, -420))
  ui.standingsPublish = publish
  publish:ClearAllPoints()
  publish:SetPoint("TOPLEFT", sheet, "TOPRIGHT", 6, 0)
  confirmClick(publish, "Share my ledger as standings", function() run("standings publish") end)
  tip(publish, "For guilds without the Discord bot: sends the EP and GP recorded on this PC to the guild as the standings. A newer upload from the bot replaces them.")
end

local function buildToolsPage(page)
  at(newButton(page, "Guilded setup", 170, function() run("setup") end), page, PAGE_WIDTH - 170, -64)
  local everyone = {
    { "Diagnostics", "diag" }, { "Raid status", "status" }, { "All commands", "help" }, { "Addon version", "version" }
  }
  for i, item in ipairs(everyone) do
    at(newButton(page, L(item[1]), 136, function() run(item[2]) end), page, ((i - 1) % 3) * 142, -math.floor((i - 1) / 3) * 28)
  end
  at(newButton(page, L("Hide minimap button"), 180, function() run("minimap hide") end), page, 0, -64)

  officerOnly(at(newLabel(page, "Officer", "GameFontNormalSmall"), page, 0, -100))
  officerOnly(at(newButton(page, "Backup", 136, function() run("backup") end), page, 0, -116))
  officerOnly(tip(at(newButton(page, "Officer setup", 136, function() run("officer list") end), page, 142, -116), "Who counts as an officer in this guild."))

  -- Test tools (/guilded sim): a pretend raid with fake players, to learn the tools alone.
  forModule("sim", at(newLabel(page, "Test tools (fake players, nothing reaches Discord)", "GameFontNormalSmall"), page, 0, -146), true)
  local tests = {
    { "Start test raid", "sim start", "A test raid with fake players; bosses and loot work like a real one." },
    { "Fake bids", "sim bids", "Fake players bid on the item open for GP bids." },
    { "Fake council answers", "sim council", "Fake players answer the open loot council or priority item." },
    { "Test dungeon run", "sim dungeon", "A finished dungeon run with fake players, for the Dungeons page." },
    { "End test raid", "sim end", "Ends the test raid." },
  }
  for i, test in ipairs(tests) do
    forModule("sim", tip(at(newButton(page, test[1], 136, function() run(test[2]) end), page, ((i - 1) % 3) * 142, -162 - math.floor((i - 1) / 3) * 26), test[3]), true)
  end
  local clearTests = forModule("sim", tip(at(newButton(page, "Clear test data", 136), page, 284, -188), "Deletes every test raid and test dungeon run from this PC."), true)
  confirmClick(clearTests, "Clear test data", function() run("sim clear") end)

  -- Window size, kept between sessions.
  at(newLabel(page, "Window size", "GameFontNormalSmall"), page, 0, -224)
  tip(at(newButton(page, "-", 30, function() run("menu scale smaller") end), page, 90, -220), "Smaller window")
  tip(at(newButton(page, "+", 30, function() run("menu scale bigger") end), page, 124, -220), "Bigger window")
  tip(at(newButton(page, "Reset", 60, function() run("menu scale reset") end), page, 158, -220), "Normal size, back in the middle of the screen")

  local help = at(newLabel(page,
    L("Minimap button hidden? /guilded minimap show. Problem? Press Diagnostics and send a screenshot to an officer. A key can open this window: Options > Keybindings > Guilded.")
      .. " " .. L("Guilded is free. A coffee helps pay for hosting: kcaron.top/support"),
    "GameFontHighlightSmall"), page, 0, -250)
  help:SetWidth(PAGE_WIDTH)

  -- Optional modules: your own switch, and (officers) the guild-wide one. There are more of
  -- these than fit in the page, so they scroll instead of running off the bottom of the window.
  at(newLabel(page, L("Modules"), "GameFontNormal"), page, 0, -280)
  local scroll = CreateFrame("ScrollFrame", nil, page, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -298)
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

-- Crafting: who in the guild can craft an item, your own professions, and cooldowns
-- (Modules/Recipes.lua; recipes are read by themselves when a profession window opens).
local function buildCraftingPage(page)
  at(newLabel(page, "Item or recipe (a name, or click the box and shift-click the item)"), page, 0, 0)
  ui.craftBox = itemBox(at(newEdit(page, 300), page, 6, -18))
  local function who()
    local text = ui.craftBox:GetText()
    if text == "" then ns.message(L("Type a name or shift-click an item first.")) return end
    ui.craftResult:SetText(ns.recipes and ns.recipes.whoText and ns.recipes.whoText(text) or "")
  end
  ui.craftBox:SetScript("OnEnterPressed", function(self) self:ClearFocus(); who() end)
  tip(at(newButton(page, "Who can craft it", 130, who), page, 314, -16), "Guildmates who know the recipe (from their own addon).")
  ui.craftResult = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -46)
  ui.craftResult:SetWidth(PAGE_WIDTH)

  at(newLabel(page, "My professions", "GameFontNormal"), page, 0, -130)
  tip(at(newButton(page, "Share now", 100, function() run("recipes share") end), page, PAGE_WIDTH - 100, -126),
    "Send your recipes to the guild now (it also happens by itself twice a day).")
  ui.craftMine = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -150)
  ui.craftMine:SetWidth(PAGE_WIDTH)

  at(newLabel(page, "Cooldowns", "GameFontNormal"), page, 0, -230)
  ui.craftCooldowns = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -250)
  ui.craftCooldowns:SetWidth(PAGE_WIDTH)
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
  heading(page, L("Your gear check"), -180)
  ui.homeGear = at(newLabel(page, "", "GameFontHighlight"), page, 0, -204)
  ui.homeGear:SetWidth(PAGE_WIDTH)
  ui.homeLinks = {}
  local function link(name, label, x, y, width)
    ui.homeLinks[name] = at(newButton(page, label, width, function() ui.selectTabByName(name) end, 30), page, x, y)
    return ui.homeLinks[name]
  end
  link("Me", "My character", 0, -266, 170)
  link("Dungeons", "Dungeons", 178, -266, 170)
  link("Standings", "Guild tools", 356, -266, 170)
  link("Calendar", "Calendar", 0, -308, 170)
  officerOnly(link("Raid", "Run a raid", 178, -308, 170))
  officerOnly(link("Loot", "Give loot", 356, -308, 170))
end

-- Sidebar order: pages are grouped under these headings.
local GROUPS = { "Overview", "Raid night", "Fun and runs", "System" }
local TAB_DEFS = {
  { name = "Home", hint = "what is going on, and your data", group = "Overview", build = buildHomePage },
  { name = "Me", label = "My character", hint = "your gear check and attunements", group = "Overview", usesPlayer = true, build = buildMePage },
  { name = "Open raids", hint = "find a raid with room for you", group = "Overview", build = buildPublicRaidsPage },
  { name = "Standings", scope = "guild", group = "Guild", usesPlayer = true, build = buildStandingsPage },
  { name = "Crafting", scope = "guild", group = "Guild", module = "recipes", build = buildCraftingPage },
  { name = "Ready", hint = "who is ready for the raid", group = "Raid night", leader = true, build = buildReadyPage },
  { name = "Reserves", hint = "soft reserves for the raid", group = "Raid night", module = "reserve", lootModes = { RESERVE = true }, usesPlayer = true, build = buildReservePage },
  { name = "Calendar", scope = "calendar", group = "Calendar", module = "calendar", officer = true, build = buildCalendarPage },
  { name = "Raid", hint = "run a raid: start, bosses, attendance", group = "Raid night", officer = true, usesPlayer = true, build = buildRaidPage },
  { name = "EPGP", label = "Administration", hint = "award EP and GP", scope = "guild", group = "Guild", officer = true, usesPlayer = true, build = buildEpgpPage },
  { name = "Local guild", scope = "guild", group = "Guild", officer = true, build = buildLocalGuildPage },
  { name = "Loot", hint = "bids and loot", group = "Raid night", lootModes = { EPGP = true }, officer = true, usesPlayer = true, build = buildLootPage },
  { name = "Council", hint = "loot council: BiS / upgrade / off-spec answers", group = "Raid night", module = "council", lootModes = { COUNCIL = true, PRIORITY = true }, officer = true, usesPlayer = true, build = buildCouncilPage },
  { name = "Tools", label = "Settings", hint = "switch parts on or off, diagnostics", group = "System", build = buildToolsPage }
}

-- ---------------------------------------------------------------------
-- Refresh: rank-based visibility plus current state in the labels
-- ---------------------------------------------------------------------

local function standingsRows(core)
  local db = ns.getDb and ns.getDb()
  local rows, names = {}, {}
  if core then
    for _, member in ipairs(core.roster or {}) do names[member.name] = true end
  else
    for name in pairs(db and db.standings and db.standings.players or {}) do names[name] = true end
    if ns.isInGameOnly and ns.isInGameOnly() then
      for name in pairs(db and db.epgp or {}) do names[name] = true end
    end
  end
  for name in pairs(names) do
    local row = ns.effectiveStanding(name, core and core.pool and core.id or nil)
    table.insert(rows, { name = name, row = row })
  end
  table.sort(rows, function(a, b)
    if a.row.pr ~= b.row.pr then return a.row.pr > b.row.pr end
    return a.name < b.name
  end)
  return rows
end

local selectTab
local updateGuildScroll

local function clock(seconds)
  seconds = math.max(0, math.floor(seconds or 0))
  return string.format("%d:%02d", math.floor(seconds / 60), seconds % 60)
end

-- Officer tabs are for officers; leader tabs also for the leader or an assistant of the group.
local function tabAllowed(tab, officer)
  if (tab.scope or "main") ~= (ui.scope or "main") then return false end
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
  for _, tab in ipairs(ui.tabs) do
    tab.visible = false
    tab.button:Hide()
    tab.page:Hide()
  end
  for _, group in ipairs(ui.scope == "guild" and { "Guild" } or ui.scope == "calendar" and { "Calendar" } or GROUPS) do
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
      label:SetText(upperText(L(group)))
      at(label, panel, 24, y)
      if ui.scope == "main" then label:Show(); y = y - 16 end
      for i, tab in ipairs(ui.tabs) do
        if tab.group == group then
          local visible = tabAllowed(tab, officer) and (not tab.module or moduleOn(tab.module)) and lootModeAllowed(tab)
          tab.visible = visible
          if visible then
            at(tab.button, panel, 20, y)
            tab.button:Show()
            y = y - 26
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
  if not current or not current.visible then selectTab(firstVisible) else current.page:Show() end
end

local function moduleSignature()
  local parts = {}
  for _, module in ipairs(ns.MODULES or {}) do table.insert(parts, moduleOn(module.key) and "1" or "0") end
  return table.concat(parts)
end

-- Tools tab rows: "Recipes - on", your switch, and the guild switch.
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
  local localOnly = ns.isInGameOnly and ns.isInGameOnly()
  if ui.sidebarSave then ui.sidebarSave:SetText(L(localOnly and "Save my addon data" or (officer and "Send to Discord" or "Save my addon data"))) end
  -- The guild rank name as the game shows it ("Guild Master", custom ranks), else Officer/Member.
  local rankName
  if GetGuildInfo then local _; _, rankName = GetGuildInfo("player") end
  if type(rankName) ~= "string" or rankName == "" then rankName = officer and L("Officer") or L("Member") end
  ui.homeGreeting:SetText(string.format("%s   |cff999999%s|r", me, rankName))

  local now = {}
  local raid = ns.getActiveRaid and ns.getActiveRaid()
  table.insert(now, raid and string.format(L("Raid running: %s (%d seen in your group)"), raid.title, ns.getPresenceCount and ns.getPresenceCount() or 0)
    or L("No raid is running."))
  local run = db.dungeon and db.dungeon.current
  if run then table.insert(now, string.format(L("Dungeon run: %s (%s)"), run.name or "?", string.lower(run.state or "?"))) end
  local bidText = moduleOn("bidding") and ns.bidding and ns.bidding.statusText and ns.bidding.statusText() or ""
  if bidText ~= "" then table.insert(now, bidText) end
  if ns.loot and ns.loot.describe and ns.getLootRules and ns.getLootRules() then table.insert(now, ns.loot.describe()) end
  local councilText = moduleOn("council") and ns.council and ns.council.current and ns.council.statusText() or ""
  if councilText ~= "" then table.insert(now, councilText) end
  -- How fresh the shared data is, in the player's own time.
  -- (Not "x and f()": that keeps only the first of the two values.)
  local source, madeAt
  if ns.standingsFreshness then source, madeAt = ns.standingsFreshness() end
  if source then
    table.insert(now, string.format(L("Standings: %s, %s."), source, ns.util.whenText(madeAt) or madeAt))
  elseif not localOnly then
    table.insert(now, L("Standings: none received yet (they arrive with the next sync)."))
  end
  -- Officers' ledgers that still differ (in-game-only guilds with ledger sync on).
  local waiting = officer and ns.ledgerSync and ns.ledgerSync.active and ns.ledgerSync.active() and ns.ledgerSync.waiting() or {}
  if #waiting > 0 then
    table.insert(now, string.format(L("Ledger sync: entries from %s are not merged yet; they merge while you are both online."), table.concat(waiting, ", ")))
  end
  local board = db.dungeonBoard
  if board and board.updatedAt then
    table.insert(now, string.format(L("Dungeon standings: %s%s."), ns.util.whenText(board.updatedAt) or board.updatedAt,
      board.from and string.format(L(", shared by %s"), board.from) or ""))
  end
  ui.homeNow:SetText(table.concat(now, "\n"))

  local snapshot = db.readiness and db.readiness[me]
  if snapshot then
    local problems = 0
    for _, finding in ipairs(snapshot.findings or {}) do if finding.severity ~= "INFO" then problems = problems + 1 end end
    ui.homeGear:SetText(problems == 0 and string.format(L("%s: nothing missing."), statusWord(snapshot.status))
      or string.format(L("%s: %d thing(s) to fix (see My character)."), statusWord(snapshot.status), problems))
  else
    ui.homeGear:SetText(L("No gear check yet. Open My character."))
  end

  ui.syncStatus = ns.syncNow and ns.syncNow.statusLine and ns.syncNow.statusLine() or ""
  if ui.sidebarSave then tip(ui.sidebarSave, ui.syncStatus) end
  if ui.sidebarSync then
    ui.sidebarSync:SetText(ns.syncNow and ns.syncNow.isDirty and ns.syncNow.isDirty() and L(not localOnly and ns.isOfficer() and "Unsent changes" or "Local changes") or L("All saved"))
  end
end

refresh = function()
  if ui.localGuildInfo then ui.localGuildInfo:SetText(ns.localGuild and ns.localGuild.describe() or "") end
  if ui.localGuildSync then pcall(ui.localGuildSync) end
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
  if ui.refreshPugs then ui.refreshPugs() end
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
      local source = ns.standingsSource and ns.standingsSource() or L("Connected snapshot")
      if ns.isInGameOnly and ns.isInGameOnly() then
        local row = ns.effectiveStanding(name)
        table.insert(lines, string.format("%s: EP %d   GP %d   PR %.2f", source, row.ep, row.gp, row.pr))
      else
        table.insert(lines, discord and string.format("%s: EP %d   GP %d   PR %.2f", source, discord.ep, discord.gp, discord.pr) or L("No standings yet."))
      end
      if account then table.insert(lines, string.format("Recorded on this PC:  EP %d   GP %d", account.ep, account.gp)) end
      ui.epgpInfo:SetText(table.concat(lines, "\n"))
    end

    if ui.councilStatus then
      local councilText = moduleOn("council") and ns.council and ns.council.statusText and ns.council.statusText() or ""
      local voting = moduleOn("council") and ns.council and ns.council.voting
      if voting and not ns.council.current then
        local names = {}
        for i, entry in ipairs(voting.candidates) do table.insert(names, string.format("%d. %s (%s)", i, entry.name, entry.tier)) end
        councilText = string.format(L("Vote for %s: %s"), voting.item, table.concat(names, ", "))
          .. (voting.mine and ("\n" .. string.format(L("Your vote: %s for %s."), voting.mine, voting.item)) or "")
      end
      ui.councilStatus:SetText(councilText)
      local session = moduleOn("council") and ns.council and ns.council.current
      if session and session.open and not ui.councilTickPending and C_Timer then
        ui.councilTickPending = true
        C_Timer.After(1, function() ui.councilTickPending = false; refresh() end)
      end
    end
    local activeCouncil = moduleOn("council") and ns.council and ns.council.current
    ui.bidStatus:SetText(activeCouncil and ns.council.statusText(4)
      or (moduleOn("bidding") and ns.bidding and ns.bidding.statusText and ns.bidding.statusText() or ""))
    if activeCouncil or moduleOn("bidding") then ui.bidStatus:Show() else ui.bidStatus:Hide() end
    if ui.dropRows and ns.loot and ns.loot.drops then
      local drops = ns.loot.drops()
      for i, row in ipairs(ui.dropRows) do
        local entry = drops[i]
        row.index = entry and i or nil
        if entry then
          row.button:Show()
          row.label:SetText(entry.link .. (entry.holder and ("  |cff999999" .. entry.holder .. "|r") or ""))
        else
          row.button:Hide()
          row.label:SetText("")
        end
      end
      ui.dropEmpty:SetText(#drops == 0 and L("Nothing yet: epic items that drop while you are in a raid show here.") or "")
      ui.tradeText:SetText(ns.loot.tradesText and ns.loot.tradesText() or "")
    end
    if ui.councilVote then
      local voting = ns.council and ns.council.voting
      if voting then ui.councilVote:Show() else ui.councilVote:Hide() end
    end
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
    -- Notes that are not problems (empty slots while levelling) are shown greyed below.
    local notes = {}
    for _, finding in ipairs(snapshot.findings or {}) do
      if finding.code == "EMPTY_SLOTS_LOW_LEVEL" then table.insert(notes, "|cff999999" .. finding.message .. "|r") end
    end
    ui.gearInfo:SetText(string.format(L("Last check: %s%s\n%s"), snapshot.status or "?",
      snapshot.itemLevel and string.format(L("   Item level %s"), snapshot.itemLevel) or "",
      (#problems > 0 and table.concat(problems, "\n") or L("Nothing missing."))
        .. (#notes > 0 and ("\n" .. table.concat(notes, "\n")) or "")))
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

  refreshReady()
  if ui.craftMine and ns.recipes then
    ui.craftMine:SetText(ns.recipes.mineText and ns.recipes.mineText() or "")
    local lines = ns.recipes.cooldownLines and ns.recipes.cooldownLines(false) or {}
    local shown = {}
    for i = 1, math.min(8, #lines) do shown[i] = lines[i] end
    ui.craftCooldowns:SetText(#shown > 0 and table.concat(shown, "\n") or L("No profession cooldowns are known. They are read when you open a profession window."))
  end

  local updatedAt = ns.getStandingsUpdatedAt and ns.getStandingsUpdatedAt()
  local core = standingsCore()
  ui.standingsView:SetText(core and (L("Core") .. ": " .. core.name) or L("Guild-wide standings"))
  ui.standingsScope:SetText(core and (core.pool and L("Core roster - separate point pool") or L("Core roster - shared guild point pool")) or L(ns.isInGameOnly and ns.isInGameOnly() and "Known local and shared characters" or "All linked guild characters"))
  local localOnly = ns.isInGameOnly and ns.isInGameOnly()
  if not updatedAt and not localOnly then
    ui.standingsPlayer:SetText(L("No standings yet."))
    ui.standingsList:SetText(L(ns.isInGameOnly and ns.isInGameOnly() and "No shared standings yet. Officers can publish their local ledger on the Standings page." or "They come from the Discord bot through an officer's addon. Check back after the next raid."))
  else
    local rows = standingsRows(core)
    local row
    for _, entry in ipairs(rows) do if entry.name == name then row = entry.row; break end end
    ui.standingsPlayer:SetText(core and not row and string.format(L("%s is not in this core's roster."), name or "?")
      or row and string.format("%s:  EP %d   GP %d   PR %.2f", name, row.ep, row.gp, row.pr)
      or (ns.standingProblemText and ns.standingProblemText(name))
      or string.format(L("%s: no standings (character not linked on Discord?)"), name or "?"))
    local lines = { ns.standingsSource and ns.standingsSource() or L("Local ledger (this PC)") }
    if updatedAt then lines[#lines + 1] = string.format(L("Top by PR (snapshot, %s):"), ns.util.whenText(updatedAt) or updatedAt) end
    if #rows == 0 then table.insert(lines, L("No characters in this view.")) end
    for i = 1, math.min(15, #rows) do
      local r = rows[i]
      table.insert(lines, string.format("%2d. %-14s PR %.2f   EP %d / GP %d", i, r.name, r.row.pr, r.row.ep, r.row.gp))
    end
    ui.standingsList:SetText(table.concat(lines, "\n"))
  end
  if updateGuildScroll then updateGuildScroll() end
end

local function raiseWindow(frame, level, seen)
  seen = seen or {}
  if seen[frame] then return end
  seen[frame] = true
  frame:SetFrameStrata("DIALOG")
  frame:SetFrameLevel(level)
  for _, child in ipairs({ frame:GetChildren() }) do
    if type(child) == "table" or type(child) == "userdata" then raiseWindow(child, level + 1, seen) end
  end
end

-- Short pages should not scroll. Text-heavy standings/crafting can grow, but
-- never reserve an entire standalone-window height inside a shorter host.
updateGuildScroll = function()
  if not ui.guildHost or not ui.guildScroll then return end
  local tab = ui.tabs[ui.currentTab or 0]
  if not tab then return end
  local function textHeight(label)
    local height = label and label.GetStringHeight and label:GetStringHeight()
    return type(height) == "number" and height or 16
  end
  local height = 220
  if tab.name == "Standings" then height = 80 + textHeight(ui.standingsList) + 52
  elseif tab.name == "Local guild" then height = (ui.localGuildInfoTop or 220) + textHeight(ui.localGuildInfo) + 12
  elseif tab.name == "Crafting" then height = 250 + textHeight(ui.craftCooldowns) + 12
  elseif tab.name == "Calendar" then height = 70 + textHeight(ui.calendarStatus) + 12 end
  local scroll = ui.guildScroll
  local viewport = math.max(1, scroll:GetHeight())
  tab.page:SetHeight(math.max(viewport, height))
  -- A narrower host (the game's calendar) shows less than PAGE_WIDTH: size the page to what
  -- is visible so text anchored to its right edge wraps instead of being cut off.
  local visible = scroll:GetWidth()
  if type(visible) == "number" and visible > 100 then
    local width = math.min(PAGE_WIDTH, visible)
    tab.page:SetWidth(width)
    for _, label in ipairs({ ui.calendarIntro, ui.calendarStatus }) do label:SetWidth(width - 8) end
  end
  local range = math.max(0, height - viewport)
  ui.guildScrollRange = range
  scroll:SetVerticalScroll(math.min(scroll:GetVerticalScroll() or 0, range))
  if scroll.ScrollBar then
    if range > 1 then scroll.ScrollBar:Show() else scroll.ScrollBar:Hide() end
  end
end

selectTab = function(index)
  if not index or not ui.tabs[index] then return end
  if ui.guildHost and ui.guildScroll then
    local page = ui.tabs[index].page
    page:SetParent(ui.guildScroll)
    page:ClearAllPoints()
    page:SetSize(PAGE_WIDTH, PANEL_HEIGHT - 110)
    ui.guildScroll:SetScrollChild(page)
    page:SetPoint("TOPLEFT", ui.guildScroll, "TOPLEFT", 0, 0)
    ui.guildScroll:SetVerticalScroll(0)
    raiseWindow(page, ui.guildScroll:GetFrameLevel() + 1)
  end
  -- The status line answers what was just done on a page; another page starts without it.
  if ui.currentTab ~= index and ui.status then ui.status:SetText("") end
  ui.currentTab = index
  for i, tab in ipairs(ui.tabs) do
    if i == index then tab.page:Show(); tab.button:LockHighlight() else tab.page:Hide(); tab.button:UnlockHighlight() end
  end
  if ui.pageTitle then
    ui.pageTitle:SetText(L(ui.tabs[index].label or ui.tabs[index].name) .. (ui.tabs[index].hint and ("   |cff999999" .. L(ui.tabs[index].hint) .. "|r") or ""))
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
  panel:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    -- Where you left it is where it opens next time.
    local s = settings()
    local point, _, relativePoint, x, y = self:GetPoint()
    if s and point then s.panelPoint = { point, relativePoint, math.floor(x or 0), math.floor(y or 0) } end
  end)
  do
    local s = settings()
    local saved = s and s.panelPoint
    if type(saved) == "table" and saved[1] then
      panel:ClearAllPoints()
      panel:SetPoint(saved[1], UIParent, saved[2] or saved[1], tonumber(saved[3]) or 0, tonumber(saved[4]) or 0)
    end
    if s and tonumber(s.panelScale) and panel.SetScale then panel:SetScale(tonumber(s.panelScale)) end
  end
  if panel.SetBackdrop then
    panel:SetBackdrop({
      bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
      edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
      tile = true, tileSize = 32, edgeSize = 32,
      insets = { left = 11, right = 12, top = 12, bottom = 11 }
    })
  end
  -- The dialog background is see-through: a window under the tools window (the guild window)
  -- showed through it. A dark backing behind the free-floating window; hidden while docked.
  ui.solidBack = panel:CreateTexture(nil, "BACKGROUND", nil, -7)
  ui.solidBack:SetPoint("TOPLEFT", panel, "TOPLEFT", 11, -12)
  ui.solidBack:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -12, 11)
  if ui.solidBack.SetColorTexture then ui.solidBack:SetColorTexture(0.04, 0.04, 0.05, 0.92) end
  ui.solidBack:Show()

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
  ui.closeButton = close

  -- Sidebar footer: one button that gets your data to Discord, and whether anything is waiting.
  ui.sidebarSync = newLabel(panel, "", "GameFontHighlightSmall")
  ui.sidebarSync:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", 24, 70)
  local sendButton = ns.syncNow and ns.syncNow.reloadButton(panel, L(ns.isOfficer() and "Send to Discord" or "Save my addon data"), 132, 26)
    or newButton(panel, L(ns.isOfficer() and "Send to Discord" or "Save my addon data"), 132, function() run("sync") end, 26)
  sendButton:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", 22, 40)
  ui.sidebarSave = sendButton
  ui.homeSave = sendButton -- one shared save action; retained internal alias

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
    local tabButton = newButton(panel, L(def.label or def.name), 132, function() selectTab(i) end, 22)
    ui.tabs[i] = { name = def.name, label = def.label, scope = def.scope, hint = def.hint, group = def.group, officer = def.officer, leader = def.leader, module = def.module, lootModes = def.lootModes, usesPlayer = def.usesPlayer, page = page, button = tabButton }
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
  ns.onSetupChange = function() refresh() end
  ns.onGamesChange = function() refresh() end
  ns.onBiddingChange = function() refresh() end
  ns.onCouncilChange = function() refresh() end
  ns.onLootChange = function() ui.lastOfficer = nil; refresh() end
  ns.onRecipesChange = function() refresh() end
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
    -- Reopening the window does not show an old result (such as a diagnostics line).
    if ui.status then ui.status:SetText("") end
    if UnitExists("target") and UnitIsPlayer("target") then
      setPlayer((UnitName("target")))
    elseif ui.playerBox:GetText() == "" then
      setPlayer(ns.playerName())
    end
    refresh()
  end)
  panel:HookScript("OnHide", function()
    if ui.scope == "main" then return end
    ui.scope = "main"
    ui.guildHost = nil
    if ui.closeButton then ui.closeButton:Show() end
    panel:SetParent(UIParent)
    panel:ClearAllPoints()
    local s = settings() or {}
    local saved = s.panelPoint
    if type(saved) == "table" and saved[1] then
      panel:SetPoint(saved[1], UIParent, saved[2] or saved[1], tonumber(saved[3]) or 0, tonumber(saved[4]) or 0)
    else panel:SetPoint("CENTER", UIParent, "CENTER") end
    panel:SetScale(tonumber(s.panelScale) or 1)
    panel:SetSize(PANEL_WIDTH, PANEL_HEIGHT)
    if ui.guildScroll then
      ui.guildScroll:Hide()
      for _, tab in ipairs(ui.tabs) do
        tab.page:SetParent(panel)
        tab.page:ClearAllPoints()
        tab.page:SetPoint("TOPLEFT", panel, "TOPLEFT", CONTENT_X, -66)
        tab.page:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -22, 44)
      end
    end
    raiseWindow(panel, ui.undockedLevel or 10)
    panel:SetMovable(true)
    if ui.guildBackground then ui.guildBackground:Hide() end
    if ui.solidBack then ui.solidBack:Show() end
    if panel.SetBackdrop then panel:SetBackdrop({
      bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background", edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
      tile = true, tileSize = 32, edgeSize = 32, insets = { left = 11, right = 12, top = 12, bottom = 11 }
    }) end
    if ns.guildPanel and ns.guildPanel.tab then ns.guildPanel.tab:SetChecked(false) end
    ui.lastOfficer = nil
  end)

  -- Shift-clicking an item normally inserts its link into chat; also put it
  -- in our Item box when that box is selected. hooksecurefunc runs after the
  -- original and never replaces it, so it cannot taint Blizzard's code.
  if hooksecurefunc and ChatEdit_InsertLink then
    hooksecurefunc("ChatEdit_InsertLink", function(link)
      if not link then return end
      for _, box in ipairs(itemBoxes) do
        if box:HasFocus() then box:Insert(link) return end
      end
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
  if name == "Loot" and ns.loot and ns.loot.mode then
    local mode = ns.loot.mode()
    if mode == "RESERVE" then name = "Reserves" elseif mode == "COUNCIL" or mode == "PRIORITY" then name = "Council" end
  end
  if name == "Dungeons" or name == "Season" or name == "Scores" then
    if ns.dungeonScorePanel then
      if panel then panel:Hide() end
      ns.dungeonScorePanel.open(name == "Dungeons" and "run" or "season")
    end
    return
  end
  for i, tab in ipairs(ui.tabs) do
    if tab.name == name then
      local scope = tab.scope or "main"
      if scope ~= ui.scope then
        if InCombatLockdown and InCombatLockdown() then return end
        if scope == "guild" then
          if not CommunitiesFrame and ToggleGuildFrame then ToggleGuildFrame() end
          local host = CommunitiesFrame or GuildFrame
          if host then ns.util.showWindow(host) end
          ns.openGuildPanel(host, scope, name)
        elseif scope == "calendar" then
          if not CalendarFrame and ToggleCalendar then ToggleCalendar() end
          if CalendarFrame then ns.util.showWindow(CalendarFrame) end
          if not ns.isOfficer() or not moduleOn("calendar") then panel:Hide(); return end
          ns.openGuildPanel(CalendarFrame, scope, name)
        else
          panel:Hide(); panel:Show(); ui.lastOfficer = nil; refresh()
          if tab.visible then selectTab(i) end
        end
        return
      end
      if tab.visible then selectTab(i) end
      return
    end
  end
end

-- Reuse the actual pages and their permission checks inside the guild window.
-- Only Guilded's own frame is reparented; Blizzard's display mode is untouched.
-- Opens one page of the tools by name (the setup window's "Set up my guild" uses it).
function ns.openToolsPage(name)
  if InCombatLockdown and InCombatLockdown() then return end
  if not panel then buildPanel() end
  if name == "Open raids" then panel:Show(); ui.lastOfficer = nil; refresh() end
  ui.selectTabByName(name)
end

function ns.openGuildPanel(host, scope, initialName)
  if InCombatLockdown and InCombatLockdown() then return end
  if scope == "calendar" and (not ns.isOfficer() or not moduleOn("calendar")) then return end
  if not panel then buildPanel() end
  panel:Hide()
  ui.scope = scope or "guild"
  ui.guildHost = host
  ui.undockedLevel = panel:GetFrameLevel()
  if host then
    panel:SetParent(host)
    panel:ClearAllPoints()
    panel:SetScale(1)
    panel:SetPoint("TOPLEFT", host, "TOPLEFT", 8, -30)
    panel:SetPoint("BOTTOMRIGHT", host, "BOTTOMRIGHT", -8, 8)
  end
  if host and not ui.guildScroll then
    ui.guildScroll = CreateFrame("ScrollFrame", nil, panel, "UIPanelScrollFrameTemplate")
    ui.guildScroll:SetPoint("TOPLEFT", panel, "TOPLEFT", CONTENT_X, -66)
    ui.guildScroll:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -30, 44)
    ui.guildScroll:EnableMouseWheel(true)
    ui.guildScroll:SetScript("OnMouseWheel", function(self, delta)
      local range = ui.guildScrollRange or 0
      self:SetVerticalScroll(math.max(0, math.min(range, (self:GetVerticalScroll() or 0) - delta * 24)))
    end)
    ui.guildScroll:SetScript("OnSizeChanged", function() if updateGuildScroll then updateGuildScroll() end end)
  end
  if host then ui.guildScroll:Show() end
  -- Inside a game window, that window's own X closes it; a second X just below looked broken.
  if ui.closeButton then if host then ui.closeButton:Hide() else ui.closeButton:Show() end end
  -- Raise the whole Guilded subtree, including previously built pages and
  -- controls. Reparenting the outer frame alone leaves native children above it.
  raiseWindow(panel, host and host:GetFrameLevel() + 1000 or ui.undockedLevel)
  panel:SetMovable(false)
  if not ui.guildBackground then
    ui.guildBackground = panel:CreateTexture(nil, "BACKGROUND", nil, -8)
    ui.guildBackground:SetAllPoints()
    ui.guildBackground:SetTexture("Interface\\FrameGeneral\\UI-Background-Marble", "REPEAT", "REPEAT")
    ui.guildBackground:SetHorizTile(true)
    ui.guildBackground:SetVertTile(true)
  end
  if panel.SetBackdrop then panel:SetBackdrop(nil) end
  ui.guildBackground:Show()
  if ui.solidBack then ui.solidBack:Hide() end
  ui.lastOfficer = nil
  panel:Show()
  refresh()
  ui.selectTabByName(initialName or "Standings")
end

function ns.closeGuildPanel(host)
  if ui.scope ~= "main" and panel and (not host or ui.guildHost == host) then panel:Hide() end
end

local function togglePanel()
  local ok, err = pcall(function()
    if not panel then buildPanel() end
    if panel:IsShown() and ui.scope ~= "main" then
      panel:Hide(); panel:Show(); ui.lastOfficer = nil; refresh()
    elseif panel:IsShown() then
      panel:Hide()
    else
      panel:Show()
      if ui.currentTab then selectTab(ui.currentTab) end
    end
  end)
  if not ok then ns.message("Tools window failed to open: " .. tostring(err)) end
end

local function minimapClick(mouseButton)
  if IsAltKeyDown and IsAltKeyDown() then run("map open")
  elseif mouseButton == "RightButton" then run("inspect")
  else togglePanel() end
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
    minimapClick(mouseButton)
  end)
  button:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("Guilded")
    GameTooltip:AddLine(L("Left-click: open the tools window"), 1, 1, 1)
    GameTooltip:AddLine(L("Right-click: check my gear"), 1, 1, 1)
    GameTooltip:AddLine(L("Alt-click: guild map"), 1, 1, 1)
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
ns.commandHandlers["menu"] = function(args)
  local action = string.lower(args and args[1] or "")
  if action ~= "scale" then togglePanel() return end
  local s = settings()
  if not s then return end
  local wanted = string.lower(args[2] or "")
  local scale = tonumber(s.panelScale) or 1
  if wanted == "bigger" then scale = scale + 0.1
  elseif wanted == "smaller" then scale = scale - 0.1
  elseif wanted == "reset" then scale = 1; s.panelPoint = nil
  elseif tonumber(wanted) then scale = tonumber(wanted)
  else ns.message("/guilded menu scale bigger | smaller | reset | <0.6 to 1.5>") return end
  scale = math.max(0.6, math.min(1.5, math.floor(scale * 10 + 0.5) / 10))
  s.panelScale = scale ~= 1 and scale or nil
  if panel then
    if panel.SetScale then panel:SetScale(scale) end
    if wanted == "reset" then panel:ClearAllPoints(); panel:SetPoint("CENTER") end
  end
  ns.message(string.format(L("Window size: %d%%."), math.floor(scale * 100 + 0.5)))
end

-- The key binding (Bindings.xml: Options > Keybindings > Guilded).
BINDING_HEADER_GUILDED = "Guilded"
BINDING_NAME_GUILDED_TOGGLE = L("Open or close the Guilded window")
function Guilded_ToggleWindow() togglePanel() end
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

-- The Addon Compartment (the addon list under the minimap on newer clients; Guilded.toc names
-- these functions): same actions as the minimap button, so hiding that button loses nothing.
function Guilded_OnAddonCompartmentClick(_, mouseButton)
  minimapClick(mouseButton)
end
function Guilded_OnAddonCompartmentEnter(_, anchor)
  if not GameTooltip then return end
  GameTooltip:SetOwner(anchor or UIParent, "ANCHOR_LEFT")
  GameTooltip:AddLine("Guilded")
  GameTooltip:AddLine(L("Left-click: open the tools window"), 1, 1, 1)
  GameTooltip:AddLine(L("Right-click: check my gear"), 1, 1, 1)
  GameTooltip:Show()
end
function Guilded_OnAddonCompartmentLeave()
  if GameTooltip then GameTooltip:Hide() end
end

-- Wait until the world has loaded so Core.lua's saved settings exist.
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:SetScript("OnEvent", function()
  local ok, err = pcall(init)
  if not ok then ns.message("Minimap button failed to load: " .. tostring(err)) end
end)

-- Keep guild integration in this established TOC entry so /reload loads updates.
do
-- A non-secure side tab. Never add a display mode to Blizzard's own registry.
local addonName, ns = ...
local view = {}
ns.guildPanel = view

function view.attach()
  if view.tab or (InCombatLockdown and InCombatLockdown()) then return end
  local host = CommunitiesFrame or GuildFrame
  if not host then return end
  local native = CommunitiesFrameTabMixin ~= nil
  local tab = CreateFrame("CheckButton", nil, host, native and "CommunitiesFrameTabTemplate" or nil)
  tab:SetSize(32, 32)
  -- The upper side rail may already contain other addons' tabs. Anchor to
  -- the host's lower edge, independently of hidden/repositioned native tabs.
  tab:SetPoint("BOTTOMLEFT", host, "BOTTOMRIGHT", 0, 16)
  if native then tab.Icon:SetTexture(ICON) else
    tab:SetNormalTexture(ICON)
    local border = tab:CreateTexture(nil, "BORDER")
    border:SetTexture("Interface\\SpellBook\\SpellBook-SkillLineTab")
    border:SetSize(64, 64); border:SetPoint("TOPLEFT", tab, "TOPLEFT", -3, 11)
  end
  tab:SetHighlightTexture("Interface\\Buttons\\ButtonHilight-Square", "ADD")
  local selected = tab:CreateTexture(nil, "OVERLAY")
  selected:SetAllPoints()
  selected:SetColorTexture(1, 0.8, 0.15, 0.25)
  tab:SetCheckedTexture(selected)
  tab:SetScript("OnClick", function(self)
    if InCombatLockdown and InCombatLockdown() then self:SetChecked(false); return end
    if ns.windowState and ns.windowState().guildHost then
      ns.closeGuildPanel()
    else
      ns.openGuildPanel(host)
      self:SetChecked(true)
    end
  end)
  tab:SetScript("OnEnter", function(self)
    if not GameTooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine("Guilded")
    GameTooltip:AddLine(ns.L("Standings") .. " / " .. ns.L("Crafting"))
    GameTooltip:Show()
  end)
  tab:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  host:HookScript("OnHide", function() ns.closeGuildPanel(host) end)
  if hooksecurefunc and host.SetDisplayMode then
    hooksecurefunc(host, "SetDisplayMode", function() ns.closeGuildPanel(host) end)
  end
  for _, key in ipairs({ "ChatTab", "RosterTab", "GuildBenefitsTab", "GuildInfoTab" }) do
    if host[key] then host[key]:HookScript("OnClick", function() ns.closeGuildPanel(host) end) end
  end
  view.tab = tab
  tab:Show()
end

local events = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "ADDON_LOADED", "PLAYER_REGEN_ENABLED", "GUILD_ROSTER_UPDATE" }) do events:RegisterEvent(event) end
events:SetScript("OnEvent", function()
  local ok, err = pcall(function()
    view.attach()
    if CalendarFrame and not view.calendarTab and not (InCombatLockdown and InCombatLockdown()) then
      local host = CalendarFrame
      view.calendarTab = newButton(host, "Guilded", 100, function() ns.openGuildPanel(host, "calendar", "Calendar") end)
      view.calendarTab:SetPoint("TOPLEFT", host, "TOPRIGHT", 0, -30)
      host:HookScript("OnHide", function() ns.closeGuildPanel(host) end)
    end
    if view.calendarTab then
      if ns.isOfficer() and moduleOn("calendar") then view.calendarTab:Show() else view.calendarTab:Hide() end
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "guild panel: " .. tostring(err)) end
end)

end
