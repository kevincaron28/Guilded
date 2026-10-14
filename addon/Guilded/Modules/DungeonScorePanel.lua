-- A separate, non-secure Guilded tab attached to the client's group finder.
-- Never replace Blizzard tab handlers, queue controls, or protected attributes.
local addonName, ns = ...
local view = {}
ns.dungeonScorePanel = view
local function L(text) return ns.L and ns.L(text) or text end
local function enabled() return not ns.moduleActive or ns.moduleActive("scores") end
local function duration(sec)
  return string.format("%d:%02d", math.floor(sec / 60), sec % 60)
end

-- Client-owned journal artwork; never download or persist image paths from a
-- season snapshot. New Forever instances use thematic art until dedicated
-- client artwork is known. Missing textures leave the solid card intact.
local dungeonArt = {
  rfc = "ragefirechasm", wc = "wailingcaverns", dm = "deadmines",
  sfk = "shadowfangkeep", bfd = "blackfathomdeeps", stocks = "thestockade",
  gnomer = "gnomeregan", rfk = "razorfenkraul", sm = "scarletmonastery",
  rfd = "razorfendowns", ulda = "uldaman", zf = "zulfarrak",
  mara = "maraudon", st = "sunkentemple", brd = "blackrockdepths",
  brs = "blackrockspire", dmaul = "diremaul", scholo = "scholomance", strat = "stratholme",
}
local foreverArt = { [3065] = "hallsofstone", [2999] = "stratholme", [2998] = "uldaman", [2959] = "violethold" }
local function artwork(row)
  local dungeon = ns.scores.dungeonFor(row.name)
  local art = foreverArt[tonumber(row.instanceId)] or (dungeon and dungeonArt[dungeon.key]) or "default"
  return "Interface\\EncounterJournal\\UI-EJ-DungeonButton-" .. art
end

function view.model(name, seasonIndex)
  local db = ns.getDb and ns.getDb() or {}
  local score = ns.scores
  local seasons = {}
  if db.dungeonBoard then
    seasons[1] = db.dungeonBoard
    for _, past in ipairs(db.dungeonBoard.history or {}) do seasons[#seasons + 1] = past end
  end
  seasonIndex = math.max(1, math.min(seasonIndex or 1, math.max(1, #seasons)))
  local selected, rows = seasons[seasonIndex], {}
  for _, row in ipairs(selected and selected.rows or {}) do
    if score.isMember(row.name) then rows[#rows + 1] = row end
  end
  local own
  for _, row in ipairs(rows) do
    if ns.normalizeName(row.name) == ns.normalizeName(name) then own = row.points end
  end
  local snapshot = ns.seasonDetails and ns.seasonDetails.get(seasonIndex, name)
  local available = snapshot and snapshot.available
  local profile = available and snapshot.profile
  local byId, known, cards = {}, {}, {}
  for _, d in ipairs(profile and profile.details or {}) do byId[d.dungeonKey or tostring(d.instanceId)] = d end
  for _, dungeon in ipairs(snapshot and snapshot.catalog or {}) do
    local best = byId[dungeon.dungeonKey or tostring(dungeon.instanceId)]
    cards[#cards + 1] = { name = dungeon.name, instanceId = dungeon.instanceId, minLevel = dungeon.minLevel, maxLevel = dungeon.maxLevel, points = available and (best and best.points or 0) or nil,
      reason = best and best.unrankedReason, bosses = best and best.bosses, sec = best and best.durationSec, speedBonus = best and best.speedBonus, targetSec = dungeon.targetSec }
    local mapped = score.dungeonFor(dungeon.name)
    if mapped then known[mapped.key] = true end
  end
  -- Keep known unvisited Classic dungeons visible without merging actual instance IDs.
  for _, dungeon in ipairs(snapshot and snapshot.provisional and {} or score.DUNGEONS) do
    if not known[dungeon.key] then cards[#cards + 1] = { name = dungeon.name, minLevel = dungeon.minLevel, maxLevel = dungeon.maxLevel, points = available and 0 or nil } end
  end
  table.sort(cards, function(a, b)
    if (a.minLevel or math.huge) ~= (b.minLevel or math.huge) then return (a.minLevel or math.huge) < (b.minLevel or math.huge) end
    if (a.maxLevel or math.huge) ~= (b.maxLevel or math.huge) then return (a.maxLevel or math.huge) < (b.maxLevel or math.huge) end
    return a.name < b.name
  end)
  return { total = profile and profile.points or own, count = profile and #profile.details or nil,
    cards = cards, seasons = seasons, seasonIndex = seasonIndex, season = selected, rows = rows,
    own = profile and profile.points or own, available = available, version = snapshot and snapshot.version, provisional = snapshot and snapshot.provisional }

end

local function label(parent, x, y, width, font)
  local text = parent:CreateFontString(nil, "OVERLAY", font or "GameFontHighlightSmall")
  text:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y)
  text:SetWidth(width); text:SetJustifyH("LEFT"); text:SetJustifyV("TOP")
  return text
end
local function button(parent, text, x, y, width, action)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y); b:SetSize(width, 24)
  b:SetText(L(text)); b:SetScript("OnClick", action)
  return b
end

function view.build(parent, compact)
  local width, columns = compact and 440 or 620, compact and 1 or 2
  local perPage = columns * 4
  local cardWidth = (width - 32 - (columns - 1) * 12) / columns
  local pane = CreateFrame("Frame", nil, parent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  pane:SetSize(width, 492); pane:EnableMouse(true)
  if not compact then pane:SetFrameStrata("DIALOG") end
  pane:SetClampedToScreen(true)
  local background = pane:CreateTexture(nil, "BACKGROUND")
  background:SetAllPoints(); background:SetColorTexture(0.035, 0.045, 0.065, 1)
  pane.title = label(pane, 16, -12, width - 100, "GameFontNormalLarge")
  pane.title:SetText(L("Dungeon scores"))
  pane.summary = label(pane, 16, -42, width - 32)
  pane.note = label(pane, 16, -64, width - 32)
  pane.note:SetText(L("100 per dungeon + up to 20 speed. Only your best run counts."))
  pane.cards = {}
  for i = 1, perPage do
    local x, y = 16 + ((i - 1) % columns) * (cardWidth + 12), -94 - math.floor((i - 1) / columns) * 51
    local card = CreateFrame("Frame", nil, pane)
    card:SetPoint("TOPLEFT", pane, "TOPLEFT", x, y); card:SetSize(cardWidth, 45)
    local bg = card:CreateTexture(nil, "BACKGROUND", nil, -2); bg:SetAllPoints(); bg:SetColorTexture(0.08, 0.1, 0.14, 1)
    card.art = card:CreateTexture(nil, "BACKGROUND", nil, -1)
    card.art:SetAllPoints(); card.art:SetAlpha(0.28)
    -- Journal buttons are 2:1 artwork. Crop a central strip without stretching
    -- the scenery across the wider compact rows.
    local visibleHeight = math.min(1, 90 / cardWidth)
    card.art:SetTexCoord(0, 1, (1 - visibleHeight) / 2, (1 + visibleHeight) / 2)
    local shade = card:CreateTexture(nil, "BORDER")
    shade:SetAllPoints(); shade:SetColorTexture(0.02, 0.03, 0.05, 0.25)
    card.name = label(card, 9, -5, cardWidth - 18)
    card.value = label(card, 9, -24, cardWidth - 18)
    card.bar = card:CreateTexture(nil, "ARTWORK")
    card.bar:SetPoint("BOTTOMLEFT", card, "BOTTOMLEFT", 0, 0); card.bar:SetHeight(2)
    card.bar:SetColorTexture(0.83, 0.69, 0.22, 1)
    card:EnableMouse(true)
    card:SetScript("OnEnter", function(self)
      if not GameTooltip or not self.row then return end
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine(self.row.name)
      if self.row.reason then GameTooltip:AddLine(L(self.row.reason), 1, 0.6, 0.2) end
      GameTooltip:AddLine(L("Competitive boss records"), 0.83, 0.69, 0.22)
      if #(self.row.bosses or {}) == 0 then GameTooltip:AddLine(L("No eligible timed boss kills recorded.")) end
      for _, b in ipairs(self.row.bosses or {}) do GameTooltip:AddDoubleLine(b.name, duration(b.durationSec)) end
      GameTooltip:Show()
    end)
    card:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
    pane.cards[i] = card
  end
  pane.page, pane.seasonIndex = 1, 1
  pane.pageLabel = label(pane, 126, -305, width - 252)
  pane.seasonTitle = label(pane, 16, -334, width - 32, "GameFontNormal")
  pane.seasonRows = label(pane, 16, -368, width - 32)
  pane.footer = label(pane, 16, -458, width - 32)
  pane.footer:SetText(L("Guild members only. Best time / fixed target. Past seasons keep their original rules."))
  function pane:Refresh()
    if not enabled() then self.summary:SetText(L("Dungeon scores are off (Tools).")); self:Hide(); return end
    local name = ns.playerName()
    local model = view.model(name, self.seasonIndex)
    self.seasonIndex = model.seasonIndex
    local pages = math.max(1, math.ceil(#model.cards / perPage))
    self.page = math.min(self.page, pages)
    self.summary:SetText(name .. " - " .. L("Your season score") .. ": " .. (model.total and tostring(model.total) or L("Not in this snapshot")))
    self.note:SetText(model.available and (model.version == 3 and L("200 at target. Best run per dungeon. Hover for boss records.") or model.version == 2 and L("100 per dungeon + up to 20 speed. Only your best run counts.")
      or L("Historical rules: 100 per distinct dungeon, no speed bonus."))
      or L("Per-dungeon breakdown unavailable in this snapshot."))
    if model.provisional then self.note:SetText(L("Provisional targets, fixed for this season. Hover for boss records.")) end
    if not model.available and ns.seasonDetails then ns.seasonDetails.request(model.seasonIndex) end
    for i, card in ipairs(self.cards) do
      local row = model.cards[(self.page - 1) * perPage + i]
      if row then
        card.row = row
        card.art:Hide()
        if card.art:SetTexture(artwork(row)) then card.art:Show() end
        card:Show(); card.name:SetText(row.name .. (row.minLevel and (" (" .. row.minLevel .. "-" .. row.maxLevel .. ")") or ""))
        card.value:SetText(row.sec and ("|cffefca68" .. (row.reason and L("Unranked") or tostring(row.points)) .. (model.version == 2 and " (+" .. row.speedBonus .. ")" or "") .. "|r  " .. duration(row.sec)
          .. " / " .. (row.targetSec and duration(row.targetSec) or L("No target")))
          or ("|cff8993a4" .. (model.available and L("Not completed this season") or L("Breakdown unavailable")) .. "|r"
            .. (row.targetSec and (" / " .. duration(row.targetSec)) or "")))
        card.bar:SetWidth(math.max(1, cardWidth * math.min(1, (row.points or 0) / (model.version == 3 and 400 or 120))))
        if (row.points or 0) > 0 then card.bar:Show() else card.bar:Hide() end
      else card.row = nil; card.art:SetTexture(nil); card.art:Hide(); card:Hide() end
    end
    self.pageLabel:SetText(string.format(L("Dungeons %d / %d"), self.page, pages))
    local season = model.season
    self.seasonTitle:SetText(season and ((season.status == "ENDED" and L("Past season") or L("Current season")) .. ": " .. season.season)
      or L("No season snapshot yet"))
    local lines = {}
    if season then
      lines[1] = L("Your season score") .. ": " .. (model.own and tostring(model.own) or L("Not in this snapshot"))
      for i = 1, math.min(3, #model.rows) do
        local row = model.rows[i]
        lines[#lines + 1] = string.format("%s  %d", row.name, row.points)
      end
    else lines[1] = L("Season scores arrive through your companion or a guild officer.") end
    self.seasonRows:SetText(table.concat(lines, "\n"))
  end
  button(pane, "Previous", 16, -299, 100, function() pane.page = math.max(1, pane.page - 1); pane:Refresh() end)
  button(pane, "Next", width - 116, -299, 100, function() pane.page = math.min(math.max(1, math.ceil(#view.model(ns.playerName(), pane.seasonIndex).cards / perPage)), pane.page + 1); pane:Refresh() end)
  button(pane, "Newer season", width - 306, -423, 138, function() pane.seasonIndex = math.max(1, pane.seasonIndex - 1); pane.page = 1; pane:Refresh() end)
  button(pane, "Older season", width - 158, -423, 138, function() pane.seasonIndex = pane.seasonIndex + 1; pane.page = 1; pane:Refresh() end)
  button(pane, "Close", width - 78, -8, 62, function() pane:Hide() end)
  pane:SetScript("OnShow", function() pane:Refresh() end)
  pane:Hide()
  return pane
end

function view.open()
  if not enabled() or (InCombatLockdown and InCombatLockdown()) then return end
  if not view.window then
    view.window = view.build(UIParent)
    view.window:SetPoint("CENTER", UIParent, "CENTER")
    view.window:SetFrameStrata("DIALOG")
  end
  view.window:Show()
end

-- Retry on load-on-demand UI loads; no polling or changes to queue behavior.
function view.attach()
  if InCombatLockdown and InCombatLockdown() then return end
  if view.tab then return end
  local finder = LFGParentFrame or PVEFrame or LFGFrame
  if not finder then return end
  if finder.WhoListingTab and LFGParentFrameRightTabMixin then
    -- Forever's fourth page uses the same side-tab template as its three
    -- native pages. Keep Blizzard's selection and handlers untouched.
    view.chrome = CreateFrame("Frame", nil, finder, "PortraitFrameTemplateNoCloseButton")
    view.chrome:SetAllPoints(finder)
    view.chrome:SetTitle(L("Guilded scores"))
    view.chrome:Hide()
    view.pane = view.build(view.chrome, true)
    view.pane:SetPoint("TOPLEFT", finder, "TOPLEFT", 9, -30)
    view.pane:SetFrameLevel(finder:GetFrameLevel() + 20)
    view.tab = CreateFrame("Frame", nil, finder, "LFGVanillaRightTabTemplate")
    view.tab.tooltipText = L("Guilded scores")
    view.tab.Icon:SetTexture("Interface\\Icons\\INV_Misc_Coin_01")
    view.tab:SetPoint("TOPLEFT", finder.WhoListingTab, "BOTTOMLEFT", 0, -2)
    local nativePages, previousPages = {}, {}
    for _, name in ipairs({ "LFGListingFrame", "LFGBrowseFrame", "LFGWhoListFrame" }) do
      if _G[name] then nativePages[#nativePages + 1] = _G[name] end
    end
    local switching = false
    local function updateChecks()
      view.tab:SetChecked(view.pane:IsShown())
      if view.pane:IsShown() then
        for _, name in ipairs({ "ListingTab", "BrowsingTab", "WhoListingTab" }) do
          if finder[name] then finder[name]:SetChecked(false) end
        end
      end
    end
    view.pane:HookScript("OnHide", function()
      view.chrome:Hide()
      view.tab:SetChecked(false)
      if switching then return end
      switching = true
      for _, page in ipairs(previousPages) do page:Show() end
      previousPages = {}
      switching = false
      finder:UpdateTabs()
    end)
    for _, page in ipairs(nativePages) do
      page:HookScript("OnShow", function()
        if switching or not view.pane:IsShown() then return end
        switching = true
        view.pane:Hide()
        previousPages = {}
        switching = false
      end)
    end
    finder:HookScript("OnHide", function() view.pane:Hide() end)
    if hooksecurefunc then hooksecurefunc(finder, "UpdateTabs", updateChecks) end
    view.tab:SetCustomOnMouseUpHandler(function(_, mouseButton, upInside)
      if mouseButton ~= "LeftButton" or not upInside or not enabled() or (InCombatLockdown and InCombatLockdown()) then return end
      if not view.pane:IsShown() then
        previousPages = {}
        for _, page in ipairs(nativePages) do
          if page:IsShown() then previousPages[#previousPages + 1] = page; page:Hide() end
        end
        view.chrome:Show()
        view.pane:Show()
      end
      updateChecks()
    end)
    view.tab:SetChecked(false)
    return
  end
  view.pane = view.build(finder)
  view.pane:SetPoint("CENTER", UIParent, "CENTER")
  view.tab = button(finder, "Guilded scores", 0, 0, 150, function()
    if InCombatLockdown and InCombatLockdown() then return end
    if view.pane:IsShown() then view.pane:Hide() else view.pane:Show() end
  end)
  -- Classic's finder can sit flush with the top of the screen. Keep the
  -- entry inside its footer, between Back and List Self, not above the frame.
  view.tab:ClearAllPoints()
  view.tab:SetPoint("BOTTOM", finder, "BOTTOM", 0, 8)
end

function view.refreshVisible()
  if view.pane and view.pane:IsShown() then view.pane:Refresh() end
  if view.window and view.window:IsShown() then view.window:Refresh() end
end

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "ADDON_LOADED", "PLAYER_REGEN_ENABLED", "GUILD_ROSTER_UPDATE" }) do
  frame:RegisterEvent(event)
end
frame:SetScript("OnEvent", function()
  local ok, err = pcall(function()
    view.attach()
    if view.pane and view.pane:IsShown() then view.pane:Refresh() end
    if view.window and view.window:IsShown() then view.window:Refresh() end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "score panel: " .. tostring(err)) end
end)
