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
-- Lower-right of the minimap (9.0.1): the old default, 220 degrees, sat under the game's own round
-- buttons (mail, group finder) at the lower left on the Forever client.
local DEFAULT_ANGLE = math.rad(315)
local OLD_DEFAULT_ANGLE = math.rad(220)
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
-- German (a o u umlauts) and Spanish (a e i o u acute, n tilde) headings too (7.4).
local ACCENT_CAPITALS = { ["\195\160"] = "\195\128", ["\195\162"] = "\195\130", ["\195\167"] = "\195\135", ["\195\168"] = "\195\136",
  ["\195\169"] = "\195\137", ["\195\170"] = "\195\138", ["\195\174"] = "\195\142", ["\195\180"] = "\195\148", ["\195\187"] = "\195\155",
  ["\195\164"] = "\195\132", ["\195\182"] = "\195\150", ["\195\188"] = "\195\156", ["\195\161"] = "\195\129", ["\195\173"] = "\195\141",
  ["\195\179"] = "\195\147", ["\195\186"] = "\195\154", ["\195\177"] = "\195\145" }
local function upperText(text)
  return (string.gsub(string.upper(text), "\195[\160-\191]", function(letter) return ACCENT_CAPITALS[letter] or letter end))
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
    local shown = type(text) == "function" and text() or text
    if type(shown) ~= "string" or shown == "" then return end
    GameTooltip:AddLine(L(shown), 1, 1, 1, true)
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

-- A light grey hint inside an empty box, gone once something is typed or the box has focus.
local function placeholder(box, text)
  local hint = box:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  hint:SetPoint("LEFT", box, "LEFT", 6, 0)
  hint:SetText(L(text))
  local function update(self)
    local empty = (self:GetText() or "") == ""
    if empty and not (self.HasFocus and self:HasFocus()) then hint:Show() else hint:Hide() end
  end
  local function chain(name, extra)
    local old = box:GetScript(name)
    box:SetScript(name, function(self, ...) if old then old(self, ...) end extra(self) end)
  end
  chain("OnTextChanged", update)
  chain("OnEditFocusGained", function() hint:Hide() end)
  chain("OnEditFocusLost", update)
  update(box)
  box.placeholder = hint
  return box
end

-- Scroll pages whose content can be taller than their viewport: the range is the child height
-- less the viewport, a wheel tick moves a useful distance (SCROLL_STEP), and the last row keeps
-- bottom padding so it is never cut mid-button.
local SCROLL_STEP, SCROLL_PADDING, SCROLL_SLACK = 48, 24, 160
local function scrollRange(contentHeight, viewportHeight)
  return math.max(0, (contentHeight or 0) + SCROLL_PADDING - (viewportHeight or 0))
end
local wheelState = setmetatable({}, { __mode = "k" })
-- Where each scroll frame is supposed to be. The game's template re-applies the scrollbar's own
-- value whenever the page's range changes, which undid wheel moves (a 4 px crawl and a page that
-- stopped a row short). The wheel, the scrollbar and any later range change all agree on this
-- one number.
local wantedScroll = setmetatable({}, { __mode = "k" })
local function enableWheel(scroll, getRange)
  scroll:EnableMouseWheel(true)
  local bar = scroll.ScrollBar
  if type(bar) ~= "table" or type(bar.SetValue) ~= "function" then bar = nil end
  if bar and bar.SetValueStep then bar:SetValueStep(1) end
  local function fullRange(self)
    local range = getRange()
    local real = self.GetVerticalScrollRange and self:GetVerticalScrollRange()
    -- Never stop short of the real end of the content: the larger of our estimate and the game's.
    if type(real) == "number" and real > range then range = real end
    return range
  end
  local function moveTo(self, target)
    wantedScroll[self] = target
    if bar and bar.SetMinMaxValues and bar.GetMinMaxValues then
      local _, barMax = bar:GetMinMaxValues()
      if type(barMax) ~= "number" or barMax < fullRange(self) then bar:SetMinMaxValues(0, fullRange(self)) end
    end
    self:SetVerticalScroll(target)
    if bar then bar:SetValue(target) end
  end
  scroll:SetScript("OnMouseWheel", function(self, delta)
    local range = fullRange(self)
    local from = wantedScroll[self] or self:GetVerticalScroll() or 0
    local target = math.max(0, math.min(range, from - delta * SCROLL_STEP))
    moveTo(self, target)
    -- /guilded debug scroll prints the last tick so a stuck page can be read from the game.
    local n = wheelState[self] and wheelState[self].n or 0
    wheelState[self] = { n = n + 1, delta = delta, from = from, target = target, range = range, after = self:GetVerticalScroll(), bar = bar and bar.GetValue and bar:GetValue() or nil }
  end)
  -- A range change (the page was resized or its text changed) must not move the page.
  if scroll.HookScript then
    pcall(scroll.HookScript, scroll, "OnScrollRangeChanged", function(self)
      local want = wantedScroll[self]
      if want and (self:GetVerticalScroll() or 0) ~= want then moveTo(self, math.min(want, fullRange(self))) end
    end)
  end
  -- Dragging the thumb is also a choice of position.
  if bar and bar.HookScript then
    pcall(bar.HookScript, bar, "OnValueChanged", function(_, value)
      if type(value) == "number" then wantedScroll[scroll] = value end
    end)
  end
end
function ns.resetScrollWanted(scroll) if scroll then wantedScroll[scroll] = 0 end end
ns.layoutMath = { scrollRange = scrollRange, SCROLL_STEP = SCROLL_STEP, SCROLL_PADDING = SCROLL_PADDING, PAGE_WIDTH = PAGE_WIDTH }

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
-- within 10 seconds instead of a popup dialog. Each arm owns its timeout.
local function confirmClick(b, label, action)
  local generation = 0
  b:SetScript("OnClick", function(self)
    generation = generation + 1
    if self.armed == true or not C_Timer then
      self.armed = false
      self:SetText(L(label))
      action()
      return
    end
    self.armed = true
    self:SetText(L("Confirm?"))
    local armedGeneration = generation
    C_Timer.After(10, function()
      if self.armed and generation == armedGeneration then
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
    ui.playerBox:SetText(ns.displayName(name))
    if refresh then refresh() end
  end
end

local function fillFromTarget()
  if UnitExists("target") and UnitIsPlayer("target") then
    setPlayer(ns.util.unitKey("target"))
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
    b:SetText(ns.displayName(name))
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
  ui.attendButtons = {}
  for _, status in ipairs({ "Present", "Late", "Absent" }) do
    local b = tip(at(newButton(page, status, 90, function()
      local name = needPlayer()
      if name then run("attendance " .. name .. " " .. string.upper(status)) end
    end), page, x, -124), "Needs a running raid: press Start raid first.")
    table.insert(ui.attendButtons, b)
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

  -- A note on the running raid (it shows in the end-of-raid summary), templates, and the raid
  -- records kept on this PC (the same as /guilded raids and /guilded raids report).
  at(newLabel(page, "Note"), page, 0, -200)
  ui.raidNote = at(newEdit(page, 260), page, 86, -196)
  at(newButton(page, "Add note", 110, function()
    local text = ui.raidNote:GetText()
    if text == "" then ns.message("Type the note first."); return end
    run("note " .. text)
    ui.raidNote:SetText("")
  end), page, 352, -196)
  tip(at(newButton(page, "Save as template", 140, function()
    local name = ui.raidName:GetText()
    if name == "" then ns.message("Type the template's name in Raid name first."); return end
    run("template save " .. string.gsub(string.lower(name), "%s+", "-") .. " " .. name)
  end), page, 0, -234), "Saves the raid name with the selected raid core. Next time, type that name and Start raid.")
  at(newButton(page, "Templates", 90, function() run("template list") end), page, 146, -234)
  at(newButton(page, "Raid history", 140, function() run("raids 10") end), page, 242, -234)
  tip(at(newButton(page, "Attendance report", 140, function() run("raids report 10") end), page, 388, -234),
    "Each player's attendance, lates, loot and EP over the last 10 raids on this PC, to copy.")
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

  at(newLabel(page, "Loot and GP bidding are on the Loot page of the /guilded window.", "GameFontDisableSmall"), page, 0, -198)
  tip(at(newButton(page, "Open the Loot page", 170, function() ui.selectTabByName("Loot") end), page, 0, -218),
    "Opens the Guilded window on its Loot page. The guild window has no Loot tab.")
end

-- Loot: GP bidding on an item, or giving it directly at a set price.
local function buildLootPage(page)
  at(newLabel(page, "Item (click the box, then shift-click the item)"), page, 0, 0)
  ui.itemBox = placeholder(itemBox(at(newEdit(page, 400), page, 6, -18)), "Shift-click an item here, for example [Thunderfury]")

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

  at(newLabel(page, "Or skip bidding: give it straight to the selected Player for Min GP", "GameFontNormalSmall"), page, 0, -262)
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
  ui.dropEmpty = at(newLabel(page, "", "GameFontNormalSmall"), page, 0, -326)
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
    -- One page needs no Previous / Next.
    for _, widget in ipairs(ui.pugPaging or {}) do
      if count > 1 then widget:Show() else widget:Hide() end
    end
  end
  at(newLabel(page, "Realm"), page, 0, 0)
  ui.pugRealm = at(newEdit(page, 210), page, 6, -20)
  -- Start on your own realm; clear the box to see every realm.
  local realmName = GetRealmName and GetRealmName()
  if type(realmName) == "string" and realmName ~= "" then ui.pugRealm:SetText(realmName) end
  tip(ui.pugRealm, "Your realm. Clear the box to see raids on every realm.")
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
  local previous = at(newButton(page, "Previous", 90, function() ui.pugPage = ui.pugPage - 1; update() end), page, 0, -440)
  local nextPage = at(newButton(page, "Next", 90, function() ui.pugPage = ui.pugPage + 1; update() end), page, 96, -440)
  ui.pugPages = at(newLabel(page, ""), page, 200, -445)
  ui.pugPaging = { previous, nextPage, ui.pugPages }
  -- The website is the way to find raids when the snapshot is stale, so it sits beside the filters.
  tip(at(newButton(page, "Website", 100, function() ns.publicRaids.copy() end), page, PAGE_WIDTH - 104, -52),
    "Shows the website address to copy, where every open raid is listed.")
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

-- A box showing a link that can be selected and copied (Ctrl+C); typing does not change it.
local function copyBox(parent, text, width)
  local box = newEdit(parent, width)
  box:SetText(text)
  if box.SetCursorPosition then box:SetCursorPosition(0) end
  box:SetScript("OnTextChanged", function(self, user)
    if user and self:GetText() ~= text then self:SetText(text) end
  end)
  box:SetScript("OnEditFocusGained", function(self) if self.HighlightText then self:HighlightText() end end)
  return box
end

local function buildGeneralSettings(page)
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

  -- Personal switches (moved here from the Info page in 9.2).
  for i, def in ipairs({
    { "Digest on", "digest", { "on" }, "Show what changed since your last login, once at login." },
    { "Digest off", "digest", { "off" }, "Stop the login digest." },
    { "Names on", "chattags", { "on" }, "Show an alt's main name in guild and officer chat." },
    { "Names off", "chattags", { "off" }, "Stop showing main names in chat." },
  }) do
    tip(at(newButton(page, def[1], 84, function()
      local handler = ns.commandHandlers and ns.commandHandlers[def[2]]
      if handler then handler(def[3]) end
    end), page, 232 + (i - 1) * 90, -274), def[4])
  end
  -- Announcements (merged in from their own page in 9.2).
  if ui.announcementsBlock then ui.announcementsBlock(page, -146) end
  -- Advanced: info and data, developer tools, speed report and the GRM import.
  tip(at(newButton(page, "Advanced...", 170, function() if ui.showAdvanced then ui.showAdvanced(true) end end), page, PAGE_WIDTH - 170, -28), "Data and guildmate status, test tools, speed report, GRM import. Closed by default.")

  -- Window size, kept between sessions.
  at(newLabel(page, "Window size", "GameFontNormalSmall"), page, 0, -278)
  tip(at(newButton(page, "-", 30, function() run("menu scale smaller") end), page, 90, -274), "Smaller window")
  tip(at(newButton(page, "+", 30, function() run("menu scale bigger") end), page, 124, -274), "Bigger window")
  tip(at(newButton(page, "Reset", 60, function() run("menu scale reset") end), page, 158, -274), "Normal size, back in the middle of the screen")

  -- Get the companion (8.5.0): addons cannot open web pages, so the links are here to copy.
  at(newLabel(page, L("Get the Windows companion (select a link, Ctrl+C):"), "GameFontNormalSmall"), page, 0, -306)
  if ns.companionLink then
    at(copyBox(page, ns.companionLink.SHORT, 250), page, 6, -322)
    at(copyBox(page, ns.companionLink.DIRECT, 250), page, 270, -322)
    local steps = at(newLabel(page, table.concat(ns.companionLink.steps(), "\n"), "GameFontHighlightSmall"), page, 0, -348)
    steps:SetWidth(PAGE_WIDTH - 40)
    steps:SetJustifyH("LEFT")
  end

  local help = at(newLabel(page,
    L("Minimap button hidden? /guilded minimap show. Problem? Press Diagnostics and send a screenshot to an officer. A key can open this window: Options > Keybindings > Guilded.")
      .. " " .. L("Guilded is free. A coffee helps pay for hosting: kcaron.top/support"),
    "GameFontHighlightSmall"), page, 0, -406)
  help:SetWidth(PAGE_WIDTH - 40)

  -- Optional modules: your own switch, and (officers) the guild-wide one. There are more of
  -- these than fit in the page, so they scroll instead of running off the bottom of the window.
  -- The heading hangs below the help text (however many lines it wraps to), never over it.
  local modulesHeading = newLabel(page, L("Modules"), "GameFontNormal")
  modulesHeading:SetPoint("TOPLEFT", help, "BOTTOMLEFT", 0, -18)
  local scroll = CreateFrame("ScrollFrame", nil, page, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", modulesHeading, "BOTTOMLEFT", 0, -6)
  -- Keep the last module row clear of the shared status footer.
  scroll:SetPoint("BOTTOMRIGHT", page, "BOTTOMRIGHT", -24, 24)
  local scrollChild = CreateFrame("Frame", nil, scroll)
  scrollChild:SetWidth(PAGE_WIDTH - 24)
  local moduleHeight = math.max(1, #(ns.MODULES or {}) * 22)
  -- Bottom padding so the last row is reachable whole, not cut at the viewport edge.
  scrollChild:SetHeight(moduleHeight + SCROLL_PADDING * 2 + SCROLL_SLACK)
  scroll:SetScrollChild(scrollChild)
  ui.moduleScroll = scroll
  enableWheel(scroll, function() return scrollRange(moduleHeight + SCROLL_PADDING, scroll:GetHeight()) end)

  ui.moduleRows = {}
  for i, module in ipairs(ns.MODULES or {}) do
    local y = -(i - 1) * 22
    local row = { key = module.key, parent = scrollChild, y = y }
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
local function buildAvailabilityPage(page)
  local function action(command) return function() run("free " .. command) end end
  at(newButton(page, "Share availability", 150, action("share on")), page, 0, 0)
  at(newButton(page, "Stop sharing", 130, action("share off")), page, 158, 0)
  at(newButton(page, "Free", 70, action("status free")), page, 0, -34)
  at(newButton(page, "Busy", 70, action("status busy")), page, 78, -34)
  at(newButton(page, "Away", 70, action("status away")), page, 156, -34)
  at(newLabel(page, "My role", "GameFontNormalSmall"), page, 0, -74)
  for i, role in ipairs({ "any", "tank", "healer", "dps" }) do
    at(newButton(page, role:upper(), 80, action("role " .. role)), page, 88 + (i - 1) * 88, -68)
  end
  local note = at(newLabel(page, "Instances automatically mark you busy. Reports pause in combat. Location is never shared.", "GameFontHighlightSmall"), page, 0, -104)
  note:SetWidth(PAGE_WIDTH)
  at(newButton(page, "Observe locally", 130, action("observe on")), page, 0, -146)
  at(newButton(page, "Stop observing", 130, action("observe off")), page, 138, -146)
  at(newButton(page, "Clear observations", 150, action("clear")), page, 276, -146)
  at(newButton(page, "Copy activity", 130, action("activity")), page, 0, -180)
  local heading = at(newLabel(page, "Local activity observations", "GameFontNormal"), page, 0, -218)
  tip(heading, "Only opt-in reports observed on this character. UTC hours, last 28 days. Grey means unknown; zero is a real observed sample.")
  ui.presenceCells = {}
  local days = { "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" }
  for hour = 0, 23 do at(newLabel(page, tostring(hour), "GameFontNormalSmall"), page, 40 + hour * 19, -240) end
  for day = 0, 6 do
    at(newLabel(page, days[day + 1], "GameFontNormalSmall"), page, 0, -260 - day * 20)
    for hour = 0, 23 do
      local cellDay, cellHour = day, hour
      local cell = CreateFrame("Frame", nil, page)
      cell:SetSize(17, 17); cell:SetPoint("TOPLEFT", page, "TOPLEFT", 40 + hour * 19, -260 - day * 20)
      cell.texture = cell:CreateTexture(nil, "BACKGROUND"); cell.texture:SetAllPoints(cell)
      cell:EnableMouse(true)
      -- The 168 cells take the mouse for their tooltips, which also swallowed the wheel: inside
      -- the guild window the page could not scroll past the grid (Sunday and the filters hidden).
      -- Hand the wheel to the page's scroll frame.
      cell:EnableMouseWheel(true)
      cell:SetScript("OnMouseWheel", function(_, delta)
        local scroll = ui.guildScroll
        local handler = scroll and scroll:IsShown() and scroll:GetScript("OnMouseWheel")
        if handler then handler(scroll, delta) end
      end)
      cell:SetScript("OnEnter", function(self)
        if not GameTooltip then return end
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT"); GameTooltip:AddLine(L(days[cellDay + 1]) .. " " .. cellHour .. ":00 UTC")
        if self.data then
          GameTooltip:AddLine(string.format(L("Average reports: %.1f; free: %.1f; samples: %d"), self.data.total / self.data.samples, self.data.free / self.data.samples, self.data.samples))
        else GameTooltip:AddLine(L("Unknown")) end
        GameTooltip:Show()
      end)
      cell:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
      ui.presenceCells[day * 24 + hour] = cell
    end
  end
  local filter = {}
  local function update() if ui.refreshPresence then ui.refreshPresence() end end
  at(newLabel(page, "Filter reports by name", "GameFontNormalSmall"), page, 0, -412)
  local search = at(newEdit(page, 190), page, 6, -432)
  search:SetMaxLetters(80)
  search:SetScript("OnTextChanged", function(self) filter.name = self:GetText(); update() end)
  local roles, roleIndex = { "ANY", "TANK", "HEALER", "DPS" }, 1
  local roleButton
  roleButton = at(newButton(page, "ANY", 90, function()
    roleIndex = roleIndex % #roles + 1; filter.role = roles[roleIndex]; roleButton:SetText(L(filter.role)); update()
  end), page, 210, -430)
  tip(roleButton, "Filter by reported role")
  local freeButton
  freeButton = at(newButton(page, "Free only: Off", 170, function()
    filter.free = not filter.free; freeButton:SetText(L(filter.free and "Free only: On" or "Free only: Off")); update()
  end), page, 308, -430)
  at(newButton(page, "My recorded characters", 210, action("characters")), page, 0, -466)
  ui.presenceText = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -540)
  ui.presenceText:SetWidth(PAGE_WIDTH)
  ui.refreshPresence = function()
    if not ns.presence then return end
    ui.presenceText:SetText(ns.presence.describe(filter))
    local cells = ns.presence.heatmap()
    for key, cell in pairs(ui.presenceCells) do
      cell.data = cells[key] or false
      if cell.data then
        local strength = math.min(1, cell.data.total / cell.data.samples / 20)
        cell.texture:SetColorTexture(0.08, 0.25 + strength * 0.7, 0.15, 1)
      else cell.texture:SetColorTexture(0.22, 0.22, 0.22, 1) end
    end
  end
end

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

  -- Headings hang below the text above them, so a short result leaves no empty gap.
  local professions = newLabel(page, "My professions", "GameFontNormal")
  professions:SetPoint("TOPLEFT", ui.craftResult, "BOTTOMLEFT", 0, -16)
  local share = tip(newButton(page, "Share now", 100, function() run("recipes share") end),
    "Send your recipes to the guild now (it also happens by itself twice a day).")
  share:ClearAllPoints()
  share:SetPoint("TOPLEFT", professions, "TOPLEFT", PAGE_WIDTH - 100, 4)
  ui.craftMine = newLabel(page, "", "GameFontHighlightSmall")
  ui.craftMine:SetPoint("TOPLEFT", professions, "BOTTOMLEFT", 0, -8)
  ui.craftMine:SetWidth(PAGE_WIDTH)

  local cooldowns = newLabel(page, "Cooldowns", "GameFontNormal")
  cooldowns:SetPoint("TOPLEFT", ui.craftMine, "BOTTOMLEFT", 0, -16)
  ui.craftCooldowns = newLabel(page, "", "GameFontHighlightSmall")
  ui.craftCooldowns:SetPoint("TOPLEFT", cooldowns, "BOTTOMLEFT", 0, -8)
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
local READY_STATUS_X = 146
local CELL_X, CELL_STEP, CELL_SIZE = 210, 24, 18
local DUR_X = CELL_X + #READY_COLUMNS * CELL_STEP + 2
local GEAR_X = DUR_X + 36
local WHY_X = GEAR_X + 28

local function readyTooltip(anchor, entry)
  if not GameTooltip or not entry then return end
  GameTooltip:SetOwner(anchor, "ANCHOR_RIGHT")
  GameTooltip:AddLine(ns.displayName(entry.name))
  GameTooltip:AddLine(L(ns.ready.LABEL[entry.status]), 1, 1, 1)
  for _, reason in ipairs(entry.reasons) do GameTooltip:AddLine("- " .. reason, 1, 0.82, 0.3) end
  local source = entry.source == "none" and L("nothing known yet") or (L("from") .. ": " .. entry.source)
  GameTooltip:AddLine(source, 0.6, 0.6, 0.6)
  GameTooltip:Show()
end

-- Officers: every guildmate's last shared gear check (Ready.lua's gearText), best item level first.
local function buildGearPage(page)
  local intro = at(newLabel(page, "Each member's last gear check, shared by their own Guilded. Members without Guilded are not listed.", "GameFontHighlightSmall"), page, 0, 0)
  intro:SetWidth(PAGE_WIDTH)
  ui.gearList = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, -40)
  ui.gearList:SetWidth(PAGE_WIDTH)
end

local function buildReadyPage(page)
  ui.readySummary = at(newLabel(page, "", "GameFontNormal"), page, 0, 0)
  ui.readySummary:SetWidth(PAGE_WIDTH)
  ui.readyPage = 1
  at(newButton(page, L("Refresh"), 90, function() if ns.ready then refresh() end end), page, 0, -34)
  at(newButton(page, L("Ask everyone to check"), 170, function() if ns.ready then ns.ready.ask() end end), page, 94, -34)
  -- Posting writes in the group's chat, so it asks for a second click.
  local postButton = tip(at(newButton(page, L("Post to group chat"), 150), page, 268, -34), "Writes the ready summary in group chat. Click twice to confirm.")
  confirmClick(postButton, "Post to group chat", function() if ns.ready then ns.ready.post() end end)
  ui.readyPrev = at(newButton(page, "<", 32, function() ui.readyPage = math.max(1, (ui.readyPage or 1) - 1); refresh() end), page, PAGE_WIDTH - 170, -34)
  ui.readyPageLabel = at(newLabel(page, "", "GameFontHighlightSmall"), page, PAGE_WIDTH - 134, -40)
  ui.readyPageLabel:SetWidth(70)
  ui.readyNext = at(newButton(page, ">", 32, function() ui.readyPage = (ui.readyPage or 1) + 1; refresh() end), page, PAGE_WIDTH - 60, -34)
  at(newLabel(page, L("Player"), "GameFontDisableSmall"), page, 0, -68)
  at(newLabel(page, L("Status"), "GameFontDisableSmall"), page, READY_STATUS_X, -68)
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
      status = at(newLabel(page, "", "GameFontHighlightSmall"), page, READY_STATUS_X, y - 1),
      dur = at(newLabel(page, "", "GameFontHighlightSmall"), page, DUR_X, y - 1),
      gear = CreateFrame("Frame", nil, page),
      why = at(newLabel(page, "", "GameFontHighlightSmall"), page, WHY_X, y - 1),
      cells = {}
    }
    row.name:SetWidth(READY_STATUS_X - 6)
    row.name:SetHeight(14)
    row.status:SetWidth(CELL_X - READY_STATUS_X - 2)
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
  ui.readyHint:SetWidth(PAGE_WIDTH - 180)
  at(newButton(page, L("Buff coverage"), 170, function() if ns.ready then ns.showCopyText(ns.ready.buffCoverageText(), L("Buff coverage")) end end), page, PAGE_WIDTH - 170, -86 - READY_ROWS * 21 - 6)
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
      row.name:SetText(classColor(entry.class) .. ns.displayName(entry.name) .. "|r")
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
  ui.readyHint:SetText((result.inRaid and L("It checks by itself when a ready check starts: every Guilded reports what it carries. Hover a row for details; a question mark means the game hides it.")
    or L("Flask and food are only required in a raid group."))
    .. "\n" .. L("? = not checked. It needs a group, and the game hides some buffs."))
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
  -- Everything below hangs from the text above it, so short pages leave no empty gap.
  local gearHeading = newLabel(page, L("Your gear check"), "GameFontNormal")
  gearHeading:SetPoint("TOPLEFT", ui.homeNow, "BOTTOMLEFT", 0, -16)
  ui.homeGear = newLabel(page, "", "GameFontHighlight")
  ui.homeGear:SetPoint("TOPLEFT", gearHeading, "BOTTOMLEFT", 0, -6)
  ui.homeGear:SetWidth(PAGE_WIDTH)
  local function below(widget, x, y)
    widget:ClearAllPoints()
    widget:SetPoint("TOPLEFT", ui.homeGear, "BOTTOMLEFT", x, y)
    return widget
  end
  ui.homeLinks = {}
  local function link(name, label, x, y, width, hint)
    ui.homeLinks[name] = tip(below(newButton(page, label, width, function() ui.selectTabByName(name) end, 30), x, y), hint)
    return ui.homeLinks[name]
  end
  link("Me", "My character", 0, -18, 170, "Your gear check and attunements.")
  link("Dungeons", "Dungeons", 178, -18, 170, "Opens the Guilded dungeons page in the game's group finder.")
  link("Standings", "Guild tools", 356, -18, 170, "Opens Guilded inside the game's guild window: standings, crafting, availability.")
  link("Calendar", "Calendar", 0, -56, 170, "Opens Guilded inside the game's calendar.")
  officerOnly(link("Raid", "Run a raid", 178, -56, 170, "Start a raid, record bosses and attendance."))
  officerOnly(link("Loot", "Give loot", 356, -56, 170, "Bids, council and direct loot."))
  officerOnly(link("Local guild", "Pick a raid core", 0, -94, 170, "Choose or create the raid core (team) that loot and standings use."))
  -- Online guildmates within 3 levels of you; shown only while levelling (refreshHome).
  ui.homeLevelling = tip(below(newButton(page, "Levelling partners", 170, function() if ns.levelPartners then ns.levelPartners.open() end end, 30), 178, -94), "Online guildmates within 3 levels of you, with Whisper and Invite buttons.")

  -- Linking to Discord, in the open: the Windows app does it in one step; the code is the fallback.
  ui.linkWidgets = {}
  local function linkWidget(widget) table.insert(ui.linkWidgets, widget) return widget end
  linkWidget(below(newLabel(page, "Link to Discord", "GameFontNormal"), 0, -138))
  if ns.companionLink then
    linkWidget(tip(below(newButton(page, "Get the companion", 170, function() ns.companionLink.openCopyWindow() end, 24), PAGE_WIDTH - 170, -134), "Opens a box with the download link to copy (Ctrl+C). The game cannot open web pages."))
  end
  ui.linkStatus = linkWidget(below(newLabel(page, "", "GameFontHighlightSmall"), 0, -158))
  ui.linkStatus:SetWidth(PAGE_WIDTH)
  local howTo = linkWidget(below(newLabel(page,
    "Easiest: install the Guilded Windows app (steps below). It syncs by itself, no sign-in needed. No app? In Discord use /character pair, then paste the code below.",
    "GameFontDisableSmall"), 0, -176))
  howTo:SetWidth(PAGE_WIDTH)
  ui.linkBox = linkWidget(placeholder(below(newEdit(page, 170), 6, -222), "Code from /character pair"))
  ui.linkBox:SetMaxLetters(24)
  ui.linkBox:SetScript("OnEnterPressed", function(self)
    self:ClearFocus()
    if self:GetText() ~= "" then run("verify " .. self:GetText()); self:SetText("") end
  end)
  local saveCode = linkWidget(tip(below(newButton(page, "Save code", 100, function()
    local text = ui.linkBox:GetText() or ""
    if text == "" then ns.message(L("Paste the code from Discord (/character pair) first.")); return end
    run("verify " .. text)
    ui.linkBox:SetText("")
  end), 182, -218), "Links all your characters on this WoW account. A guildmate's Guilded companion passes the code on when it next syncs."))
  -- Beside Save code, wherever its (translated) width ends, so the two never overlap.
  local removeCode = linkWidget(tip(below(newButton(page, "Remove code", 110, function() run("verify off") end), 288, -218), "Forgets the saved code on this WoW account."))
  removeCode:ClearAllPoints()
  removeCode:SetPoint("LEFT", saveCode, "RIGHT", 6, 0)

  -- Get the companion (8.5.0): links to copy, since an addon cannot open a web page.
  if ns.companionLink then
    below(newLabel(page, L("Get the Windows companion (select a link, Ctrl+C):"), "GameFontNormal"), 0, -262)
    below(copyBox(page, ns.companionLink.SHORT, 250), 6, -282)
    below(copyBox(page, ns.companionLink.DIRECT, 250), 270, -282)
    local steps = below(newLabel(page, table.concat(ns.companionLink.steps(), "\n"), "GameFontHighlightSmall"), 0, -312)
    steps:SetWidth(PAGE_WIDTH)
    steps:SetJustifyH("LEFT")
  end
end

-- Sidebar order: pages are grouped under these headings.
-- The five member tabs of 9.2 (and Settings). The active one expands to its pages in the sidebar. Pages of the
-- guild window show here as link buttons; the officer pages stay in the guild window until the Officer tab.
local GROUPS = { "Home", "Guild", "Dungeons", "Crafting", "Raids", "Officer", "Settings" }
-- Guild and Crafting are one page each: their sections are a row of buttons at the top of the content (the
-- pages keep their own frames), not entries in the sidebar.
local SECTION_ROW = { Guild = true, Crafting = true }
-- The section buttons are as wide as their text (capped); a row that would pass the page width wraps to a
-- second line. The page itself starts at -66, below two lines (12 + 22 high, then 24 per extra line).
local SECTION_Y, SECTION_LINE, SECTION_GAP, SECTION_MAX = 12, 24, 6, 200
local function sectionWidth(text)
  return math.min(SECTION_MAX, math.max(60, #text * 7 + 20))
end
local function buildRosterAdminPage(page)
  local info = at(newLabel(page, "Change guild ranks and notes in bulk: paste a list of actions, preview the changes, then confirm.", "GameFontHighlightSmall"), page, 0, 0)
  info:SetWidth(PAGE_WIDTH - 8)
  local b = newButton(page, "Open roster admin", 170, function() if ns.openRosterAdmin then ns.openRosterAdmin() end end)
  at(b, page, 0, -36)
end
-- Officer tools (7.5.0): each button runs the same thing as its /guilded command.
local OFFICER_TOOLS = {
  { "Guild event log", "guildlog", { "copy" } },
  { "Prospects", "recruit", { "copy" } },
  { "Guild bank", "gbank", { "copy" } },
  { "Check pugs in my group", "pugcheck", { "now" } },
  { "Import softres.it", "import", { "softres" } },
  { "Import That's My BiS", "import", { "tmb" } }
}
local function buildOfficerToolsPage(page)
  for i, def in ipairs(OFFICER_TOOLS) do
    local command, args = def[2], def[3]
    local b = newButton(page, def[1], 220, function()
      local handler = ns.commandHandlers and ns.commandHandlers[command]
      if handler then handler(args) end
    end)
    b:SetPoint("TOPLEFT", ((i - 1) % 2) * 230, -12 - math.floor((i - 1) / 2) * 38)
  end
end
-- Info and data (9.1): the status and switch commands that used to be slash-only, one button each.
-- Each button runs the same handler as its /guilded command. Commands that need an argument
-- (drop <item>, price <item> <GP>, bid, debug) stay slash-only: docs/ADDON_SLASH_ONLY_COMMANDS.md.
local INFO_TOOLS = {
  { "Who runs which version", "peers", {}, "Which guildmates run which Guilded version (this session)." },
  { "Data relay status", "relay", {}, "Which guildmate's companion carries your data to Discord, and how old it is." },
  { "Guildmate professions", "professions", {}, "What guildmates have shared about their professions." },
  { "Saved names check", "names", {}, "Saved entries still filed under a first name shared by several characters." },
  { "Postmatch capture status", "bgcapture", {}, "Status of your own battleground postmatch capture." },
  { "Sync EP/GP history now", "ledgersync", { "now" }, "Asks guild officers and guildmates for EP/GP history." },
  { "Ask an officer for data", "bridge", { "refresh" }, "Requests core and raid data from an online officer." },
  { "Interface options", "options", {}, "Opens Guilded's page in the game's options." },
  { "Daily digest on", "digest", { "on" }, "Show what changed since your last login, once at login." },
  { "Daily digest off", "digest", { "off" }, "Stop the login digest." },
  { "Main names in chat on", "chattags", { "on" }, "Show an alt's main name in guild and officer chat." },
  { "Main names in chat off", "chattags", { "off" }, "Stop showing main names in chat." },
  { "My bank requests", "gbank", { "requests" }, "Your guild bank requests and what officers did with them. Ask with /guilded gbank request <item>." },
  { "Guild bank low stock", "gbank", { "low" }, "Guild bank items below the minimum officers set." },
}
local INFO_OFFICER_TOOLS = {
  { "Invite queue", "invites", {}, "Players waiting for a guild invite, one click each." },
  { "Ready to promote", "promote", {}, "Who is ready to promote, one click each." },
  { "Auto-invite status", "autoinvite", { "status" }, "Whether whispering a phrase invites players." },
  { "Pending loot rolls", "lootroll", {}, "Soft-reserve rolls waiting to be awarded." },
  { "Consumables check", "consumes", { "scan" }, "Who in your group is missing a flask, elixir or food." },
}
-- Settings > Advanced (9.2): what used to be the "Info and data" page plus the developer tools. Closed by
-- default; Settings has an "Advanced..." button and this view has "Back". Personal switches come first, then
-- what concerns other guildmates, then (officers only) the officer buttons, speed report, GRM import and tests.
local PERSONAL_COMMANDS = { digest = true, chattags = true }
-- The call-for-help alert block of the Advanced view is this tall (label, button row, two checks, status line).
local CALL_ALERT_HEIGHT = 112
ui.callAlertHeight = CALL_ALERT_HEIGHT

local function buildInfoPage(page)
  local scroll = CreateFrame("ScrollFrame", nil, page, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -34)
  scroll:SetPoint("BOTTOMRIGHT", page, "BOTTOMRIGHT", -24, 24)
  local child = CreateFrame("Frame", nil, scroll)
  child:SetWidth(PAGE_WIDTH - 24)
  scroll:SetScrollChild(child)
  local y = 0
  local function heading(text, officer)
    local label = newLabel(child, text, "GameFontNormal")
    label:SetPoint("TOPLEFT", child, "TOPLEFT", 0, y)
    if officer then officerOnly(label) end
    y = y - 22
  end
  local function place(list, officer)
    for i, def in ipairs(list) do
      local b = newButton(child, def[1], 220, function()
        local handler = ns.commandHandlers and ns.commandHandlers[def[2]]
        if handler then handler(def[3]) end
      end)
      b:SetPoint("TOPLEFT", child, "TOPLEFT", ((i - 1) % 2) * 230, y - math.floor((i - 1) / 2) * 34)
      tip(b, def[4])
      if officer then officerOnly(b) end
    end
    y = y - math.ceil(#list / 2) * 34 - 8
  end
  -- Personal switches (daily digest, main names in chat) live on the Settings page itself.
  local guildmates = {}
  for _, def in ipairs(INFO_TOOLS) do if not PERSONAL_COMMANDS[def[2]] then table.insert(guildmates, def) end end
  -- Call for help alerts (how a guildmate's call reaches you): window, chat line or off, sound, quiet in combat.
  if ui.callAlertBlock then ui.callAlertBlock(child, y); y = y - CALL_ALERT_HEIGHT end
  heading("Guildmates and data")
  place(guildmates, false)
  heading("Officer", true)
  place(INFO_OFFICER_TOOLS, true)
  place({
    { "Speed report", "perf", { "copy" }, "How much traffic and time the addon uses." },
    { "GRM archive import", "rosteradmin", {}, "Opens Roster admin, where a GRM archive is previewed and imported." },
  }, true)

  -- Developer tools (/guilded sim): a pretend raid with fake players, to learn the tools alone.
  local devLabel = forModule("sim", newLabel(child, "Developer tools: test raids with fake players (saved tests can sync to Discord)", "GameFontDisableSmall"), true)
  devLabel:SetPoint("TOPLEFT", child, "TOPLEFT", 0, y)
  y = y - 22
  local tests = {
    { "Start test raid", "sim start", "A test raid with fake players; bosses and loot work like a real one." },
    { "Fake bids", "sim bids", "Fake players bid on the item open for GP bids." },
    { "Fake council answers", "sim council", "Fake players answer the open loot council or priority item." },
    { "Test dungeon run", "sim dungeon", "A finished dungeon run with fake players, for the Dungeons page." },
    { "End test raid", "sim end", "Ends the test raid." },
  }
  for i, test in ipairs(tests) do
    local b = forModule("sim", tip(newButton(child, test[1], 136, function() run(test[2]) end), test[3]), true)
    b:SetPoint("TOPLEFT", child, "TOPLEFT", ((i - 1) % 3) * 142, y - math.floor((i - 1) / 3) * 26)
  end
  local clearTests = forModule("sim", tip(newButton(child, "Clear test data", 136), "Deletes every test raid and test dungeon run from this PC. Click twice to confirm."), true)
  clearTests:SetPoint("TOPLEFT", child, "TOPLEFT", 284, y - 26)
  confirmClick(clearTests, "Clear test data", function() run("sim clear") end)
  y = y - 60

  child:SetHeight(-y + 24)
  enableWheel(scroll, function() return scrollRange(-y + SCROLL_PADDING, scroll:GetHeight()) end)
  ui.advancedScroll = scroll
  return scroll
end
-- The Rosteradmin button above goes through a command, like every other button here.
ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["rosteradmin"] = ns.commandHandlers["rosteradmin"] or function()
  if ns.openRosterAdmin then ns.openRosterAdmin() end
end

-- Milestone announcements in guild chat (Modules/Milestones.lua): your master switch, one per
-- kind, and (officers) the guild-wide off switch. The same switches exist in Interface Options.
-- Milestone announcements in guild chat (Modules/Milestones.lua), a block of the Settings page since 9.2: your
-- master switch, one per kind, and (officers) the guild-wide off switch. Same switches as Interface Options.
ui.announcementsBlock = function(page, top)
  at(newLabel(page, "Announcements", "GameFontNormalSmall"), page, 0, top)
  local rows = {
    { nil, "Announce my milestones in guild chat" },
    { "level", "Milestones: level 10, 20..." },
    { "dungeon", "Milestones: first dungeon clears" },
    { "hk", "Milestones: honorable kills" },
    { "duel", "Milestones: duel wins" },
  }
  ui.announceChecks = {}
  for i, row in ipairs(rows) do
    local kind = row[1]
    local x, y = 0, top - 20
    if kind then x, y = ((i - 2) % 2) * math.floor(PAGE_WIDTH / 2), top - 46 - math.floor((i - 2) / 2) * 26 end
    local box = at(newCheck(page, row[2]), page, x, y)
    box:SetScript("OnClick", function(self)
      run("announce " .. (kind and (kind .. " ") or "") .. (self:GetChecked() and "on" or "off"))
      if ui.refreshAnnouncements then ui.refreshAnnouncements() end
    end)
    ui.announceChecks[i] = { box = box, kind = kind }
  end
  ui.announceStatus = at(newLabel(page, "", "GameFontHighlightSmall"), page, 300, top - 20)
  ui.announceStatus:SetWidth(PAGE_WIDTH - 300)
  ui.announceGuild = officerOnly(at(newButton(page, "", 440, function()
    run("announce guild " .. ((ns.milestones and ns.milestones.guildOff and ns.milestones.guildOff()) and "on" or "off"))
    if ui.refreshAnnouncements then ui.refreshAnnouncements() end
  end), page, 0, top - 100))
  ui.refreshAnnouncements = function()
    local ms = ns.milestones
    for _, entry in ipairs(ui.announceChecks) do
      entry.box:SetChecked(ms and ms.enabled and ms.enabled(entry.kind) or false)
    end
    local off = ms and ms.guildOff and ms.guildOff() or false
    ui.announceGuild:SetText(L(off and "Guild-wide: turned off (click to allow)" or "Guild-wide: allowed (click to turn off for all)"))
    ui.announceStatus:SetText(off and L("Milestone announcements are turned off for the whole guild by an officer.") or "")
  end
  page:HookScript("OnShow", function() ui.refreshAnnouncements() end)
end

-- Call for help alerts, a block of the Settings page: the same switches as /guilded sos alert|sound|quiet|mute.
ui.callAlertBlock = function(page, top)
  at(newLabel(page, "Call for help alerts", "GameFontNormalSmall"), page, 0, top)
  local modes = { { "toast", "Window" }, { "chat", "Chat line" }, { "off", "Off" } }
  ui.callAlertButtons = {}
  for i, m in ipairs(modes) do
    ui.callAlertButtons[i] = at(newButton(page, m[2], 86, function()
      run("sos alert " .. m[1])
      if ui.refreshCallAlerts then ui.refreshCallAlerts() end
    end), page, (i - 1) * 90, top - 16)
  end
  ui.callAlertSound = at(newCheck(page, "Play a sound"), page, 0, top - 44)
  ui.callAlertSound:SetScript("OnClick", function(self)
    run("sos sound " .. (self:GetChecked() and "on" or "off"))
  end)
  ui.callAlertQuiet = at(newCheck(page, "Quiet in combat: a chat line and a small icon, silent after combat too"), page, 0, top - 68)
  ui.callAlertQuiet:SetScript("OnClick", function(self)
    run("sos quiet " .. (self:GetChecked() and "on" or "off"))
  end)
  tip(at(newButton(page, "Mute 10 min", 110, function() run("sos mute") end), page, 290, top - 16), "No call windows for 10 minutes (this session only).")
  tip(at(newButton(page, "Reset", 60, function() run("sos reset") end), page, 404, top - 16), "Put the call window back at its default place. Drag its title to move it.")
  ui.callAlertStatus = at(newLabel(page, "", "GameFontHighlightSmall"), page, 0, top - 94)
  ui.refreshCallAlerts = function()
    local cfh = ns.callForHelp
    if not (cfh and cfh.alertMode) then return end
    local mode = cfh.alertMode()
    ui.callAlertSound:SetChecked(cfh.sound())
    ui.callAlertQuiet:SetChecked(cfh.quiet())
    ui.callAlertStatus:SetText(L(mode == "toast" and "small window" or mode == "chat" and "chat line only" or "off"))
  end
  page:HookScript("OnShow", function() ui.refreshCallAlerts() end)
end

-- Settings (9.2): one page. The general view holds the switches, announcements, window size, companion links
-- and modules; "Advanced..." swaps it for the advanced view (info and data, developer tools), "Back" returns.
local function buildSettingsPage(page)
  local general = CreateFrame("Frame", nil, page)
  general:SetAllPoints(page)
  buildGeneralSettings(general)
  local advanced = CreateFrame("Frame", nil, page)
  advanced:SetAllPoints(page)
  buildInfoPage(advanced)
  tip(at(newButton(advanced, "Back to settings", 170, function() if ui.showAdvanced then ui.showAdvanced(false) end end), advanced, 0, 0), "Closes the advanced view.")
  advanced:Hide()
  general:Show()
  ui.settingsGeneral, ui.settingsAdvanced = general, advanced
  ui.showAdvanced = function(on)
    if on then general:Hide(); advanced:Show() else advanced:Hide(); general:Show() end
  end
  page:HookScript("OnShow", function() ui.showAdvanced(false) end)
  if general.HookScript then general:HookScript("OnShow", function() if ui.refreshAnnouncements then ui.refreshAnnouncements() end end) end
end

local TAB_DEFS = {
  { name = "Home", hint = "what is going on, and your data", group = "Home", build = buildHomePage },
  { name = "Guild overview", hint = "classes and levels of the whole guild at a glance", group = "Guild", build = function(page) if ns.guildOverview and ns.guildOverview.buildPage then ns.guildOverview.buildPage(page, { newLabel = newLabel, newButton = newButton, at = at, width = PAGE_WIDTH }) end end },
  { name = "Board", label = "Guild board", hint = "officers' news and open polls, vote from the game", group = "Guild", build = function(page) if ns.guildBoard and ns.guildBoard.buildPage then ns.guildBoard.buildPage(page, { newLabel = newLabel, newButton = newButton, newEdit = newEdit, at = at, width = PAGE_WIDTH }) end end },
  { name = "Crafting", label = "Recipes", hint = "who can craft an item, your professions and cooldowns", group = "Crafting", module = "recipes", build = buildCraftingPage },
  { name = "Orders", label = "Crafting orders", hint = "craft requests from Discord you can make", group = "Crafting", build = function(page) if ns.craftOrders and ns.craftOrders.buildPage then ns.craftOrders.buildPage(page, { newLabel = newLabel, newButton = newButton, at = at, width = PAGE_WIDTH }) end end },
  { name = "Me", label = "My character", hint = "your gear check and attunements", group = "Home", usesPlayer = true, build = buildMePage },
  { name = "Open raids", hint = "find a raid with room for you", group = "Raids", build = buildPublicRaidsPage },
  { name = "Standings", group = "Guild", usesPlayer = true, build = buildStandingsPage },
  { name = "Availability", group = "Guild", module = "presence", build = buildAvailabilityPage },
  { name = "Gear", hint = "item level and missing enchants per member", group = "Officer", officer = true, build = buildGearPage },
  { name = "Ready", hint = "who is ready for the raid", group = "Raids", leader = true, build = buildReadyPage },
  { name = "Reserves", hint = "soft reserves for the raid", group = "Raids", module = "reserve", lootModes = { RESERVE = true }, usesPlayer = true, build = buildReservePage },
  { name = "Signups", label = "Raid sign-up", hint = "sign up for raids, with role counts", group = "Raids", module = "raidsignup", build = function(page) if ns.raidSignup and ns.raidSignup.buildPage then ns.raidSignup.buildPage(page, { newLabel = newLabel, newButton = newButton, at = at, width = PAGE_WIDTH }) end end },
  { name = "Calendar", group = "Officer", module = "calendar", officer = true, build = buildCalendarPage },
  { name = "Raid", hint = "run a raid: start, bosses, attendance", group = "Raids", officer = true, usesPlayer = true, build = buildRaidPage },
  { name = "EPGP", label = "Administration", hint = "award EP and GP", group = "Officer", officer = true, usesPlayer = true, build = buildEpgpPage },
  { name = "Local guild", group = "Officer", officer = true, build = buildLocalGuildPage },
  { name = "Roster admin", group = "Officer", officer = true, build = buildRosterAdminPage },
  { name = "Officer tools", hint = "guild log, prospects, guild bank, imports", group = "Officer", officer = true, build = buildOfficerToolsPage },
  { name = "Loot", hint = "bids and loot", group = "Raids", lootModes = { EPGP = true }, officer = true, usesPlayer = true, build = buildLootPage },
  { name = "Council", hint = "loot council: BiS / upgrade / off-spec answers", group = "Raids", module = "council", lootModes = { COUNCIL = true, PRIORITY = true }, officer = true, usesPlayer = true, build = buildCouncilPage },
  { name = "Dungeons", hint = "your runs and the guild's dungeon boards", group = "Dungeons", link = function() if ns.dungeonScorePanel then ns.dungeonScorePanel.open("run") end end, available = function() return ns.dungeonScorePanel ~= nil end, build = function() end },
  { name = "Duels", hint = "guild duel leaderboard", group = "Guild", module = "duels", build = function(page) if ns.duels and ns.duels.buildPage then ns.duels.buildPage(page, { newLabel = newLabel, at = at, width = PAGE_WIDTH }) end end },
  { name = "Tools", label = "Settings", hint = "switch parts on or off, announcements, diagnostics, advanced", group = "Settings", build = buildSettingsPage }
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
-- Pages that only read: the "Unsent changes / Send to Discord" block is hidden there.
local READ_ONLY_PAGES = { ["Open raids"] = true, Calendar = true }
-- Long pages scroll inside the window; the rest sit on the window directly.
local SCROLLED_PAGES = { Standings = true, Gear = true, EPGP = true, ["Local guild"] = true, ["Roster admin"] = true,
  ["Officer tools"] = true, Calendar = true, Crafting = true, Availability = true }

local function clock(seconds)
  seconds = math.max(0, math.floor(seconds or 0))
  return string.format("%d:%02d", math.floor(seconds / 60), seconds % 60)
end

-- Officer tabs are for officers; leader tabs also for the leader or an assistant of the group.
local function tabAllowedFor(tab, officer)
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

-- Opens a page from the sidebar: a link tab runs its action.
local function activateTab(i)
  local tab = ui.tabs[i]
  if not tab then return end
  if tab.link then tab.link(); return end
  selectTab(i)
end

local function tabListed(tab, officer)
  return tabAllowedFor(tab, officer) and (not tab.module or moduleOn(tab.module)) and lootModeAllowed(tab)
    and (not tab.available or tab.available())
end

local function groupList(group, officer)
  local list = {}
  for i, tab in ipairs(ui.tabs) do
    if tab.group == group and tabListed(tab, officer) then table.insert(list, i) end
  end
  return list
end

local function layoutTabs(officer)
  local y = -62
  local firstVisible
  ui.groupButtons = ui.groupButtons or {}
  for _, button in pairs(ui.groupButtons) do button:Hide() end
  for _, tab in ipairs(ui.tabs) do
    tab.visible = false
    tab.button:Hide()
    tab.page:Hide()
  end
  do
    local current = ui.tabs[ui.currentTab or 0]
    local currentGroup = current and current.group
    local sectionX
    local sectionLine = 0
    ui.sectionLayout = {}
    for _, group in ipairs(GROUPS) do
      local list = groupList(group, officer)
      if #list > 0 then
        local button = ui.groupButtons[group]
        if not button then
          button = newButton(panel, L(group), 132, nil, 22)
          ui.groupButtons[group] = button
        end
        -- The click picks from the list as it is now, not as it was when the button was made.
        button:SetScript("OnClick", function()
          local fresh = groupList(group, ns.isOfficer())
          local remembered = ui.lastInGroup and ui.lastInGroup[group]
          local pick = fresh[1]
          for _, i in ipairs(fresh) do if i == remembered then pick = i end end
          if pick then activateTab(pick) end
        end)
        at(button, panel, 20, y)
        button:Show()
        if group == currentGroup then button:LockHighlight() else button:UnlockHighlight() end
        y = y - 26
        for _, i in ipairs(list) do
          local tab = ui.tabs[i]
          if not tab.link then
            tab.visible = true
            firstVisible = firstVisible or i
          end
          if group == currentGroup and SECTION_ROW[group] and #list > 1 then
            local width = sectionWidth(L(tab.label or tab.name))
            if sectionX and sectionX + width > PAGE_WIDTH then sectionX = 0; sectionLine = sectionLine + 1 end
            sectionX = sectionX or 0
            tab.button:SetWidth(width)
            at(tab.button, panel, CONTENT_X + sectionX, -(SECTION_Y + SECTION_LINE * sectionLine))
            ui.sectionLayout[#ui.sectionLayout + 1] = { name = tab.name, x = sectionX, line = sectionLine, width = width }
            sectionX = sectionX + width + SECTION_GAP
            tab.button:Show()
          elseif group == currentGroup and #list > 1 then
            at(tab.button, panel, 26, y)
            tab.button:Show()
            y = y - 24
          end
        end
        y = y - 6
      end
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
    row.guild:SetText(L(guildOff and "Guild: on" or "Guild: off"))
    -- Dynamic labels need the same measured padding as buttons built with text.
    -- Anchor the switches from the right so translations stay inside the page.
    local label = row.guild.GetFontString and row.guild:GetFontString()
    local needed = label and label.GetStringWidth and label:GetStringWidth()
    local guildWidth = math.max(110, type(needed) == "number" and needed + BUTTON_PADDING or 110)
    label = row.mine.GetFontString and row.mine:GetFontString()
    needed = label and label.GetStringWidth and label:GetStringWidth()
    local mineWidth = math.max(86, type(needed) == "number" and needed + BUTTON_PADDING or 86)
    local guildX = PAGE_WIDTH - 24 - guildWidth
    local mineX = guildX - mineWidth - 6
    row.guild:SetWidth(guildWidth); row.guild:SetPoint("TOPLEFT", row.parent, "TOPLEFT", guildX, row.y)
    row.mine:SetWidth(mineWidth); row.mine:SetPoint("TOPLEFT", row.parent, "TOPLEFT", mineX, row.y)
    row.label:SetWidth(math.max(80, mineX - 4))
  end
end

-- Home page text: plain-language state, and the Discord-sync line.
local function refreshHome(db, officer, me)
  if not ui.homeGreeting then return end
  if ui.homeLevelling then
    if ns.levelPartners and ns.levelPartners.available() then ui.homeLevelling:Show() else ui.homeLevelling:Hide() end
  end
  local localOnly = ns.isInGameOnly and ns.isInGameOnly()
  if ui.sidebarSave then ui.sidebarSave:SetText(L(localOnly and "Save my addon data" or (officer and "Send to Discord" or "Save my addon data"))) end
  -- The guild rank name as the game shows it ("Guild Master", custom ranks), else Officer/Member.
  local rankName
  if GetGuildInfo then local _; _, rankName = GetGuildInfo("player") end
  if type(rankName) ~= "string" or rankName == "" then rankName = officer and L("Officer") or L("Member") end
  ui.homeGreeting:SetText(string.format("%s   |cff999999%s|r", ns.displayName(me), rankName))

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

  -- Linking block: shown for guilds that use Discord, with what the addon knows of the state.
  if ui.linkStatus then
    local inGuild = not IsInGuild or IsInGuild()
    local show = not localOnly and inGuild
    for _, widget in ipairs(ui.linkWidgets or {}) do if show then widget:Show() else widget:Hide() end end
    if show then
      local state = ns.verifyStatus and ns.verifyStatus() or {}
      ui.linkStatus:SetText(state.linked and ("|cff55dd55" .. L("Linked to Discord.") .. "|r")
        or state.pending and ("|cffffcc33" .. L("Code saved. Your characters link when a guildmate's Guilded companion next syncs.") .. "|r")
        or ("|cffff7755" .. L("Not linked to Discord yet.") .. "|r"))
    end
  end

  ui.syncStatus = ns.syncNow and ns.syncNow.statusLine and ns.syncNow.statusLine() or ""
  if ui.sidebarSync then
    local dirty = ns.syncNow and ns.syncNow.isDirty and ns.syncNow.isDirty()
    local text = dirty and L(not localOnly and ns.isOfficer() and "Unsent changes" or "Local changes") or L("All saved")
    -- Last save (a /reload or logout, when the companion can pick the data up), next to the button.
    local ago = ns.syncNow and ns.syncNow.savedAgoText and ns.syncNow.savedAgoText()
    ui.sidebarSync:SetText(ago and (text .. " - " .. ago) or text)
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
  local activeGroup = ui.tabs[ui.currentTab or 0] and ui.tabs[ui.currentTab].group
  if ui.lastOfficer ~= officer or ui.lastLeader ~= leader or ui.lastModules ~= modules or ui.lastGroup ~= activeGroup then
    ui.lastGroup = activeGroup
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
  if ui.refreshPresence and ui.tabs[ui.currentTab or 0] and ui.tabs[ui.currentTab].name == "Availability" then ui.refreshPresence() end

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
    for _, b in ipairs(ui.attendButtons or {}) do
      if raid then b:Enable() else b:Disable() end
    end
    ui.raidInfo:SetText(raid and string.format("Active raid: |cffffffff%s|r (started %s, %d seen in group)", raid.title,
      raid.startedAt, ns.getPresenceCount and ns.getPresenceCount() or 0) or "No active raid.")

    local account = name and db.epgp[name]
    local discord = name and ns.getStanding and ns.getStanding(name)
    if not name then
      ui.epgpInfo:SetText("Pick a player at the top (target them, or Me / Group...).")
    else
      -- Discord = the bot's official totals; "this PC" = entries recorded
      -- here that may not have been imported yet.
      local lines = { ns.displayName(name) }
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
        for i, entry in ipairs(voting.candidates) do table.insert(names, string.format("%d. %s (%s)", i, ns.displayName(entry.name), entry.tier)) end
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
    -- (9.1.3) The findings are stored (and sent to officers) in English; the window says them in the player's language.
    local function findingText(finding)
      local text = finding.message or ""
      local list = string.match(text, "^Empty slots %(normal while levelling%): (.-)%.$")
      if list then return string.format(L("Empty slots (normal while levelling): %s."), list) end
      list = string.match(text, "^Missing enchants: (.-)%.$")
      if list then return string.format(L("Missing enchants: %s."), list) end
      return L(text)
    end
    local problems = {}
    for _, finding in ipairs(snapshot.findings or {}) do
      if finding.severity ~= "INFO" then table.insert(problems, findingText(finding)) end
    end
    -- Notes that are not problems (empty slots while levelling) are shown greyed below.
    local notes = {}
    for _, finding in ipairs(snapshot.findings or {}) do
      if finding.code == "EMPTY_SLOTS_LOW_LEVEL" then table.insert(notes, "|cff999999" .. findingText(finding) .. "|r") end
    end
    ui.gearInfo:SetText(string.format(L("Last check: %s%s\n%s"), statusWord(snapshot.status),
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
    ui.craftCooldowns:SetText(#shown > 0 and table.concat(shown, "\n")
      or ("|cff999999" .. L("No profession cooldowns are known. They are read when you open a profession window.") .. "|r"))
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
    ui.standingsPlayer:SetText(core and not row and string.format(L("%s is not in this core's roster."), ns.displayName(name or "?"))
      or row and string.format("%s:  EP %d   GP %d   PR %.2f", ns.displayName(name), row.ep, row.gp, row.pr)
      or (ns.standingProblemText and ns.standingProblemText(name))
      or string.format(L("%s: no standings (character not linked on Discord?)"), ns.displayName(name or "?")))
    local lines = { ns.standingsSource and ns.standingsSource() or L("Local ledger (this PC)") }
    if updatedAt then lines[#lines + 1] = string.format(L("Top by PR (snapshot, %s):"), ns.util.whenText(updatedAt) or updatedAt) end
    if #rows == 0 then table.insert(lines, L("No characters in this view.")) end
    for i = 1, math.min(15, #rows) do
      local r = rows[i]
      table.insert(lines, string.format("%2d. %-14s PR %.2f   EP %d / GP %d", i, ns.displayName(r.name), r.row.pr, r.row.ep, r.row.gp))
    end
    ui.standingsList:SetText(table.concat(lines, "\n"))
  end
  if ui.gearList and ns.ready and ns.ready.gearText then ui.gearList:SetText(ns.ready.gearText()) end
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
  local tab = ui.tabs[ui.currentTab or 0]
  if not ui.guildScroll or not tab or not SCROLLED_PAGES[tab.name] then return end
  local function textHeight(label)
    local height = label and label.GetStringHeight and label:GetStringHeight()
    return type(height) == "number" and height or 16
  end
  local height = 220
  if tab.name == "Standings" then height = 80 + textHeight(ui.standingsList) + 52
  elseif tab.name == "Local guild" then height = (ui.localGuildInfoTop or 220) + textHeight(ui.localGuildInfo) + 12
  elseif tab.name == "Crafting" then
    height = 46 + textHeight(ui.craftResult) + 16 + 20 + textHeight(ui.craftMine) + 16 + 24 + textHeight(ui.craftCooldowns) + 12
  elseif tab.name == "Availability" then height = 540 + textHeight(ui.presenceText) + 12
  elseif tab.name == "Signups" then height = 590
  elseif tab.name == "Gear" then height = 40 + textHeight(ui.gearList) + 12
  elseif tab.name == "Calendar" then height = 70 + textHeight(ui.calendarStatus) + 12 end
  local scroll = ui.guildScroll
  local viewport = math.max(1, scroll:GetHeight())
  local range = scrollRange(height, viewport)
  -- Extra room under the page: the game clamps scrolling to the child height, ours to `range`, so
  -- the game can never be the one stopping short of the last row.
  local pageHeight = math.max(viewport, height + SCROLL_PADDING + SCROLL_SLACK)
  local currentHeight = tab.page.GetHeight and tab.page:GetHeight()
  if type(currentHeight) ~= "number" or math.abs(currentHeight - pageHeight) > 0.5 then tab.page:SetHeight(pageHeight) end
  -- A narrower host (the game's calendar) shows less than PAGE_WIDTH: size the page to what
  -- is visible so text anchored to its right edge wraps instead of being cut off.
  local visible = scroll:GetWidth()
  if type(visible) == "number" and visible > 100 then
    local width = math.min(PAGE_WIDTH, visible)
    tab.page:SetWidth(width)
    for _, label in ipairs({ ui.calendarIntro, ui.calendarStatus }) do label:SetWidth(width - 8) end
  end
  ui.guildScrollRange = range
  -- Tell the scrollbar the true range now: it only re-measures on a later frame and until then
  -- clamped the thumb (and the page) short of the last rows.
  if scroll.ScrollBar and scroll.ScrollBar.SetMinMaxValues then pcall(scroll.ScrollBar.SetMinMaxValues, scroll.ScrollBar, 0, range) end
  -- Clamp to the larger of our estimate and the game's measured range (the estimate is often
  -- smaller and used to pull the page back up).
  local limit = range
  local measured = scroll.GetVerticalScrollRange and scroll:GetVerticalScrollRange()
  if type(measured) == "number" and measured > limit then limit = measured end
  if (scroll:GetVerticalScroll() or 0) > limit then
    scroll:SetVerticalScroll(limit)
    wantedScroll[scroll] = limit
  end
  if scroll.ScrollBar then
    if range > 1 then scroll.ScrollBar:Show() else scroll.ScrollBar:Hide() end
  end
end

selectTab = function(index)
  if not index or not ui.tabs[index] then return end
  if ui.guildScroll and not SCROLLED_PAGES[ui.tabs[index].name] then
    ui.guildScroll:Hide()
  elseif ui.guildScroll then
    local page = ui.tabs[index].page
    ui.guildScroll:Show()
    page:SetParent(ui.guildScroll)
    page:ClearAllPoints()
    page:SetSize(PAGE_WIDTH, PANEL_HEIGHT - 110)
    ui.guildScroll:SetScrollChild(page)
    page:SetPoint("TOPLEFT", ui.guildScroll, "TOPLEFT", 0, 0)
    ui.guildScroll:SetVerticalScroll(0)
    ns.resetScrollWanted(ui.guildScroll)
    raiseWindow(page, ui.guildScroll:GetFrameLevel() + 1)
  end
  -- The status line answers what was just done on a page; another page starts without it.
  if ui.currentTab ~= index and ui.status then ui.status:SetText("") end
  ui.currentTab = index
  ui.lastInGroup = ui.lastInGroup or {}
  ui.lastInGroup[ui.tabs[index].group or ""] = index
  -- The unsent-changes block means nothing on pages that only read (the secure button is left
  -- alone in combat: hiding it then is blocked).
  if not (InCombatLockdown and InCombatLockdown()) then
    local readOnly = READ_ONLY_PAGES[ui.tabs[index].name]
    for _, widget in ipairs({ ui.sidebarSync, ui.sidebarSave }) do
      if widget then if readOnly then widget:Hide() else widget:Show() end end
    end
  end
  for i, tab in ipairs(ui.tabs) do
    if i == index then tab.page:Show(); tab.button:LockHighlight() else tab.page:Hide(); tab.button:UnlockHighlight() end
  end
  if ui.pageTitle and SECTION_ROW[ui.tabs[index].group] and #groupList(ui.tabs[index].group, ns.isOfficer()) > 1 then
    ui.pageTitle:SetText("")
  elseif ui.pageTitle then
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
  panel:SetScript("OnDragStart", function(self) if self:IsMovable() then self:StartMoving() end end)
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
  -- Window size where it can be found (it also lives in Settings).
  ui.sizeButtons = {
    tip(at(newButton(panel, "-", 24, function() run("menu scale smaller") end, 20), panel, PANEL_WIDTH - 88, -8), "Smaller window"),
    tip(at(newButton(panel, "+", 24, function() run("menu scale bigger") end, 20), panel, PANEL_WIDTH - 62, -8), "Bigger window"),
  }

  -- Sidebar footer: one button that gets your data to Discord, and whether anything is waiting.
  ui.sidebarSync = newLabel(panel, "", "GameFontHighlightSmall")
  ui.sidebarSync:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", 24, 70)
  local sendButton = ns.syncNow and ns.syncNow.reloadButton(panel, L(ns.isOfficer() and "Send to Discord" or "Save my addon data"), 132, 26)
    or newButton(panel, L(ns.isOfficer() and "Send to Discord" or "Save my addon data"), 132, function() run("sync") end, 26)
  sendButton:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", 22, 40)
  ui.sidebarSave = sendButton
  ui.homeSave = sendButton -- one shared save action; retained internal alias
  tip(sendButton, function() return ui.syncStatus end)

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
    local tabButton = newButton(panel, L(def.label or def.name), 132, function() activateTab(i) end, 22)
    ui.tabs[i] = { name = def.name, label = def.label, hint = def.hint, group = def.group, officer = def.officer, leader = def.leader, module = def.module, lootModes = def.lootModes, usesPlayer = def.usesPlayer, link = def.link, available = def.available, page = page, button = tabButton }
    tabButton:SetScript("OnEnter", function(self)
      if not GameTooltip then return end
      -- To the left of the sidebar, so the tooltip never covers the page being read.
      GameTooltip:SetOwner(self, "ANCHOR_LEFT")
      GameTooltip:AddLine(L(def.label or def.name))
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
      setPlayer(ns.util.unitKey("target"))
    end
  end)
  panel:SetScript("OnShow", function()
    ui.lastOfficer = nil -- re-check rank and modules every time the window opens
    -- Reopening the window does not show an old result (such as a diagnostics line).
    if ui.status then ui.status:SetText("") end
    if UnitExists("target") and UnitIsPlayer("target") then
      setPlayer(ns.util.unitKey("target"))
    elseif ui.playerBox:GetText() == "" then
      setPlayer(ns.playerName())
    end
    refresh()
  end)
  -- Long pages (standings, crafting, the officer pages) scroll in this frame.
  ui.guildScroll = CreateFrame("ScrollFrame", nil, panel, "UIPanelScrollFrameTemplate")
  ui.guildScroll:SetPoint("TOPLEFT", panel, "TOPLEFT", CONTENT_X, -66)
  ui.guildScroll:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -30, 44)
  enableWheel(ui.guildScroll, function() return ui.guildScrollRange or 0 end)
  ui.guildScroll:SetScript("OnSizeChanged", function() if updateGuildScroll then updateGuildScroll() end end)
  ui.guildScroll:Hide()

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

local selectTabByNameNow
function ui.selectTabByName(name)
  -- 9.2: Announcements and Info and data are parts of Settings now; the old names still open it.
  -- Showing the page resets Settings to its general view, so the Advanced view is chosen after the tab is shown.
  if name == "Announcements" or name == "Info" then
    local advanced = name == "Info"
    selectTabByNameNow("Tools")
    if ui.showAdvanced then ui.showAdvanced(advanced) end
    return
  end
  return selectTabByNameNow(name)
end
selectTabByNameNow = function(name)
  if name == "Loot" and ns.loot and ns.loot.mode then
    local mode = ns.loot.mode()
    if mode == "RESERVE" then name = "Reserves" elseif mode == "COUNCIL" or mode == "PRIORITY" then name = "Council" end
  end
  if name == "Dungeons" or name == "Season" or name == "Scores" then
    if ns.dungeonScorePanel then
      -- The Guilded panel stays open: the dungeons page opens in the group finder beside it.
      ns.dungeonScorePanel.open(name == "Dungeons" and "run" or "season")
    end
    return
  end
  for i, tab in ipairs(ui.tabs) do
    if tab.name == name then
      if not panel:IsShown() then panel:Show(); ui.lastOfficer = nil; refresh() end
      if tab.visible then selectTab(i) end
      return
    end
  end
end

-- Opens one page of the tools by name (the setup window's "Set up my guild" uses it).
function ns.openToolsPage(name)
  if InCombatLockdown and InCombatLockdown() then return end
  if not panel then buildPanel() end
  if not panel:IsShown() then panel:Show(); ui.lastOfficer = nil; refresh() end
  ui.selectTabByName(name)
end

-- /guilded debug scroll: numbers for a page that will not scroll (no /script needed).
local function fmt(value)
  if type(value) == "number" then return string.format("%.1f", value) end
  return tostring(value)
end
local function scrollDebug()
  local scroll = ui.guildScroll
  local tab = ui.tabs[ui.currentTab or 0]
  if not scroll or not tab then ns.message("scroll debug: open a long page first (Guild, Standings)."); return end
  local page = tab.page
  local function call(frame, name, ...)
    if not frame or type(frame[name]) ~= "function" then return "n/a" end
    local ok, a, b = pcall(frame[name], frame, ...)
    if not ok then return "error" end
    return b ~= nil and (fmt(a) .. "/" .. fmt(b)) or fmt(a)
  end
  local bar = scroll.ScrollBar
  local lines = {
    string.format("scroll debug, page %s: viewport h=%s w=%s top=%s bottom=%s scale=%s", tostring(tab.name),
      call(scroll, "GetHeight"), call(scroll, "GetWidth"), call(scroll, "GetTop"), call(scroll, "GetBottom"), call(scroll, "GetEffectiveScale")),
    string.format("page h=%s top=%s bottom=%s scale=%s isChild=%s", call(page, "GetHeight"), call(page, "GetTop"), call(page, "GetBottom"),
      call(page, "GetEffectiveScale"), tostring(scroll.GetScrollChild and scroll:GetScrollChild() == page)),
    string.format("estimated range=%s engine range=%s offset=%s", fmt(ui.guildScrollRange), call(scroll, "GetVerticalScrollRange"), call(scroll, "GetVerticalScroll")),
    string.format("scrollbar min/max=%s value=%s step=%s shown=%s", call(bar, "GetMinMaxValues"), call(bar, "GetValue"), call(bar, "GetValueStep"), call(bar, "IsShown")),
    string.format("panel top=%s bottom=%s", call(panel, "GetTop"), call(panel, "GetBottom")),
  }
  local wheel = wheelState[scroll]
  lines[#lines + 1] = wheel and string.format("wheel ticks=%d last: delta=%s from=%s target=%s range=%s after=%s bar=%s", wheel.n, fmt(wheel.delta), fmt(wheel.from), fmt(wheel.target), fmt(wheel.range), fmt(wheel.after), fmt(wheel.bar))
    or "wheel: our handler has not run yet (scroll with the mouse over the page, then run this again)"
  local pageTop = type(page.GetTop) == "function" and page:GetTop()
  local function below(widget)
    local bottom = widget and widget.GetBottom and widget:GetBottom()
    if type(pageTop) == "number" and type(bottom) == "number" then return fmt(pageTop - bottom) end
    return "n/a"
  end
  if ui.presenceCells and tab.name == "Availability" then
    lines[#lines + 1] = string.format("heat map Sunday row bottom y=%s, Monday row bottom y=%s, presence text bottom y=%s (from page top)",
      below(ui.presenceCells[6 * 24]), below(ui.presenceCells[0]), below(ui.presenceText))
  end
  for _, line in ipairs(lines) do ns.message(line) end
end
ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers.debug = function(args)
  if args[1] == "scroll" then scrollDebug() else ns.message("/guilded debug scroll") end
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

-- Minimap button shortcuts (8.5.0):
--   Left          the window, on the page last used
--   Right         a short menu: dungeons, guild map, call for help, settings
--   Shift + right call for help (works in combat: the one shortcut that matters during a gank)
local function modifier(name)
  local fn = _G["Is" .. name .. "KeyDown"]
  return fn and fn() and true or false
end

local function inCombat()
  return (InCombatLockdown and InCombatLockdown()) and true or false
end

local function openPage(name)
  if ns.openToolsPage then ns.openToolsPage(name) end
end

local function openDungeons()
  if ns.dungeonScorePanel and ns.dungeonScorePanel.open then ns.dungeonScorePanel.open("run") else openPage("Open raids") end
end

-- The quick menu: label, then what it does.
local function quickMenuItems()
  local items = {
    { "Dungeons", openDungeons },
    { "Guild map", function() run("map open") end }
  }
  if ns.callForHelp and ns.callForHelp.open then table.insert(items, { "Call for help", function() ns.callForHelp.open() end }) end
  table.insert(items, { "Settings", function() openPage("Tools") end })
  return items
end

local quickMenu
local function hideQuickMenu()
  if quickMenu then quickMenu:Hide() end
  if quickMenu and quickMenu.catcher then quickMenu.catcher:Hide() end
end

local function showQuickMenu()
  hideQuickMenu()
  local items = quickMenuItems()
  if not quickMenu then
    quickMenu = CreateFrame("Frame", "GuildedQuickMenu", UIParent, "BackdropTemplate")
    quickMenu:SetFrameStrata("DIALOG")
    quickMenu:SetClampedToScreen(true)
    if quickMenu.SetBackdrop then
      quickMenu:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile = true, tileSize = 16, edgeSize = 12, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
      quickMenu:SetBackdropColor(0.05, 0.05, 0.07, 0.95)
    end
    -- A click anywhere else closes the menu.
    quickMenu.catcher = CreateFrame("Button", nil, UIParent)
    quickMenu.catcher:SetAllPoints(UIParent)
    quickMenu.catcher:SetFrameStrata("DIALOG")
    quickMenu.catcher:SetFrameLevel(1)
    quickMenu.catcher:RegisterForClicks("AnyUp")
    quickMenu.catcher:SetScript("OnClick", hideQuickMenu)
    -- However the menu closes (Escape, an item, a click elsewhere), the full-screen catcher goes
    -- with it; otherwise it would swallow the next click on the minimap button.
    quickMenu:SetScript("OnHide", function() if quickMenu.catcher then quickMenu.catcher:Hide() end end)
    quickMenu.buttons = {}
    if UISpecialFrames then table.insert(UISpecialFrames, "GuildedQuickMenu") end
  end
  local height = 10
  for i, item in ipairs(items) do
    local b = quickMenu.buttons[i]
    if not b then
      b = CreateFrame("Button", nil, quickMenu)
      b:SetSize(170, 22)
      b.text = b:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
      b.text:SetPoint("LEFT", 8, 0)
      b:SetHighlightTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight", "ADD")
      quickMenu.buttons[i] = b
    end
    b:ClearAllPoints()
    b:SetPoint("TOPLEFT", quickMenu, "TOPLEFT", 5, -5 - (i - 1) * 22)
    b.text:SetText(L(item[1]))
    local action = item[2]
    b:SetScript("OnClick", function()
      hideQuickMenu()
      if inCombat() then ns.message(L("Not in combat.")) return end
      action()
    end)
    b:Show()
    height = height + 22
  end
  for i = #items + 1, #quickMenu.buttons do quickMenu.buttons[i]:Hide() end
  quickMenu:SetSize(180, height)
  quickMenu:ClearAllPoints()
  if button then quickMenu:SetPoint("TOPRIGHT", button, "BOTTOMLEFT", 8, 8) else quickMenu:SetPoint("CENTER") end
  quickMenu.catcher:Show()
  quickMenu:Show()
  if quickMenu.Raise then quickMenu:Raise() end
end

-- What a click does. Returns a name for the action (the tests read it). In combat only the plain
-- left click (toggling Guilded's own window) works; everything else says so and does nothing.
local function minimapClick(mouseButton)
  if mouseButton == "RightButton" and modifier("Shift") then
    if ns.callForHelp and ns.callForHelp.open then ns.callForHelp.open() return "help" end
    return "unavailable"
  elseif mouseButton == "RightButton" then
    if inCombat() then ns.message(L("Not in combat.")) return "blocked" end
    showQuickMenu()
    return "menu"
  end
  togglePanel()
  return "window"
end
ns.minimapClick = minimapClick

-- The tooltip: every shortcut, then live status.
local function fillTooltip()
  GameTooltip:AddLine("Guilded")
  GameTooltip:AddLine(L("Left-click: open the tools window"), 1, 1, 1)
  GameTooltip:AddLine(L("Right-click: quick menu"), 1, 1, 1)
  if ns.callForHelp and ns.callForHelp.open then GameTooltip:AddLine(L("Shift-right-click: call for help"), 1, 0.5, 0.4) end
  local waiting = ns.syncNow and ns.syncNow.isDirty and ns.syncNow.isDirty()
  if waiting then GameTooltip:AddLine(L("Changes waiting to be saved (/reload)"), 1, 0.82, 0.2) end
end

-- ---------------------------------------------------------------------
-- Minimap button
-- ---------------------------------------------------------------------

local function place(angle)
  local width = Minimap and Minimap.GetWidth and Minimap:GetWidth()
  if type(width) ~= "number" or width < 50 then width = 140 end
  local radius = (width / 2) + RADIUS_PAD
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
  -- Anchored and shown before anything that could fail: a half-built button with no anchor is
  -- invisible, and that is how it was lost on one client (8.5 test, French Forever).
  pcall(place, DEFAULT_ANGLE)
  button:Show()

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

  pcall(button.SetHighlightTexture, button, "Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")
  pcall(button.RegisterForClicks, button, "LeftButtonUp", "RightButtonUp")
  pcall(button.RegisterForDrag, button, "LeftButton")
  button:SetScript("OnClick", function(_, mouseButton)
    minimapClick(mouseButton)
  end)
  button:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    fillTooltip()
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

-- The saved angle and hidden state, once the saved settings exist (they may not at first login).
local function applySettings()
  if not button then return end
  local s = settings()
  if not s then return end
  -- A position saved at the old default was never a choice: move it once. A dragged spot stays.
  if not s.minimapAngleMoved then
    s.minimapAngleMoved = true
    if type(s.minimapAngle) == "number" and math.abs(s.minimapAngle - OLD_DEFAULT_ANGLE) < 0.02 then s.minimapAngle = nil end
  end
  pcall(place, s.minimapAngle or DEFAULT_ANGLE)
  if s.minimapHidden then button:Hide() else button:Show() end
end

local buildError
local function init()
  if built then return end
  built = true
  local ok, err = pcall(buildButton)
  if not ok then
    buildError = tostring(err)
    if ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "minimap button: " .. buildError) end
  end
  applySettings()
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
  if not built then pcall(init) end
  if not button or not s then
    ns.message(L("The minimap button is not ready yet.") .. (buildError and (" " .. buildError) or "") .. " " .. L("Open the window with /guilded menu."))
    return
  end
  -- Says what happened: it must never be silent (a hidden button looks like a broken command).
  local function shown()
    if button.IsVisible and button:IsVisible() then ns.message(L("Minimap button shown. Drag it to move it.")) return end
    -- The minimap itself is hidden (another addon's interface): put the button on the screen edge.
    pcall(function()
      button:SetParent(UIParent)
      button:ClearAllPoints()
      button:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -40, -140)
      button:Show()
    end)
    ns.message(L("The minimap is hidden, so the button was put at the top right of the screen. Open the window with /guilded menu."))
  end
  if action == "hide" then
    s.minimapHidden = true
    button:Hide()
    ns.message(L("Minimap button hidden. /guilded minimap show brings it back."))
  elseif action == "show" then
    s.minimapHidden = false
    button:Show()
    shown()
  elseif action == "reset" then
    s.minimapHidden = false
    s.minimapAngle = DEFAULT_ANGLE
    place(DEFAULT_ANGLE)
    button:Show()
    shown()
  else
    ns.message(L("/guilded minimap show | hide | reset   (or /guilded menu to open the tools window)"))
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
  fillTooltip()
  GameTooltip:Show()
end
function Guilded_OnAddonCompartmentLeave()
  if GameTooltip then GameTooltip:Hide() end
end

-- Wait until the world has loaded so Core.lua's saved settings exist.
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", function(_, event)
  local ok, err = pcall(init)
  if not ok then ns.message("Minimap button failed to load: " .. tostring(err)) end
  -- First login on a new PC: the saved settings can appear after the world loads.
  if event == "PLAYER_LOGIN" and C_Timer and C_Timer.After then
    C_Timer.After(5, function() pcall(applySettings) end)
  end
end)

-- Keep guild integration in this established TOC entry so /reload loads updates.
do
-- A non-secure side tab in the guild window and a button in the calendar: both open the Guilded window.
-- Never add a display mode to Blizzard's own registry.
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
  tab:SetScript("OnClick", function(self)
    self:SetChecked(false)
    if InCombatLockdown and InCombatLockdown() then return end
    if ns.openToolsPage then ns.openToolsPage("Guild overview") end
  end)
  tab:SetScript("OnEnter", function(self)
    if not GameTooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine("Guilded")
    GameTooltip:AddLine(ns.L("Open the Guilded window"))
    GameTooltip:Show()
  end)
  tab:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
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
      view.calendarTab = newButton(host, "Guilded", 100, function()
        if not (InCombatLockdown and InCombatLockdown()) and ns.openToolsPage then ns.openToolsPage("Calendar") end
      end)
      view.calendarTab:SetPoint("TOPLEFT", host, "TOPRIGHT", 0, -30)
    end
    if view.calendarTab then
      if ns.isOfficer() and moduleOn("calendar") then view.calendarTab:Show() else view.calendarTab:Hide() end
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "guild panel: " .. tostring(err)) end
end)

end
