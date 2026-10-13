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

function view.model(name, seasonIndex)
  local db = ns.getDb and ns.getDb() or {}
  local score = ns.scores
  local total, count, bests = score.compute(name)
  local byKey, cards = {}, {}
  for _, line in ipairs(bests) do byKey[line.key] = line end
  for _, dungeon in ipairs(score.DUNGEONS) do
    local line = byKey[dungeon.key]
    cards[#cards + 1] = { name = dungeon.name, points = line and line.points, sec = line and line.sec }
    byKey[dungeon.key] = nil
  end
  -- Include custom Forever dungeons even when they are not in the Classic list.
  for _, line in pairs(byKey) do cards[#cards + 1] = { name = line.name, points = line.points, sec = line.sec } end
  table.sort(cards, function(a, b) return a.name < b.name end)
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
  return { total = total, count = count, cards = cards, seasons = seasons, seasonIndex = seasonIndex,
    season = selected, rows = rows, own = own }
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

function view.build(parent)
  local pane = CreateFrame("Frame", nil, parent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  pane:SetSize(620, 492); pane:EnableMouse(true)
  local background = pane:CreateTexture(nil, "BACKGROUND")
  background:SetAllPoints(); background:SetColorTexture(0.035, 0.045, 0.065, 1)
  pane.title = label(pane, 16, -12, 535, "GameFontNormalLarge")
  pane.title:SetText(L("Dungeon scores"))
  pane.summary = label(pane, 16, -42, 590)
  pane.note = label(pane, 16, -69, 590)
  pane.note:SetText(L("Recorded bests - all time. Season standings are separate below."))
  pane.cards = {}
  for i = 1, 8 do
    local x, y = 16 + ((i - 1) % 2) * 299, -94 - math.floor((i - 1) / 2) * 51
    local card = CreateFrame("Frame", nil, pane)
    card:SetPoint("TOPLEFT", pane, "TOPLEFT", x, y); card:SetSize(287, 45)
    local bg = card:CreateTexture(nil, "BACKGROUND"); bg:SetAllPoints(); bg:SetColorTexture(0.08, 0.1, 0.14, 1)
    card.name = label(card, 9, -5, 269)
    card.value = label(card, 9, -24, 269)
    pane.cards[i] = card
  end
  pane.page, pane.seasonIndex = 1, 1
  pane.pageLabel = label(pane, 136, -305, 340)
  pane.seasonTitle = label(pane, 16, -342, 585, "GameFontNormal")
  pane.seasonRows = label(pane, 16, -368, 585)
  pane.footer = label(pane, 16, -458, 585)
  pane.footer:SetText(L("Guild members only. Local records and shared snapshots may be incomplete."))
  function pane:Refresh()
    if not enabled() then self.summary:SetText(L("Dungeon scores are off (Tools).")); self:Hide(); return end
    local name = ns.playerName()
    local model = view.model(name, self.seasonIndex)
    self.seasonIndex = model.seasonIndex
    local pages = math.max(1, math.ceil(#model.cards / 8))
    self.page = math.min(self.page, pages)
    self.summary:SetText(string.format(L("%s: %d recorded points / %d dungeons"), name, model.total, model.count))
    for i, card in ipairs(self.cards) do
      local row = model.cards[(self.page - 1) * 8 + i]
      if row then
        card:Show(); card.name:SetText(row.name)
        card.value:SetText(row.points and ("|cffefca68" .. row.points .. "|r  |cffb5c6dc" .. duration(row.sec) .. "|r") or ("|cff8993a4" .. L("Not recorded") .. "|r"))
      else card:Hide() end
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
  button(pane, "Next", 500, -299, 100, function() pane.page = math.min(math.ceil(#view.model(ns.playerName()).cards / 8), pane.page + 1); pane:Refresh() end)
  button(pane, "Newer season", 314, -423, 138, function() pane.seasonIndex = math.max(1, pane.seasonIndex - 1); pane:Refresh() end)
  button(pane, "Older season", 462, -423, 138, function() pane.seasonIndex = pane.seasonIndex + 1; pane:Refresh() end)
  button(pane, "Close", 542, -8, 62, function() pane:Hide() end)
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
  local finder = PVEFrame or LFGParentFrame or LFGFrame
  if not finder then return end
  view.pane = view.build(finder)
  view.pane:SetPoint("TOPLEFT", finder, "TOPLEFT", 0, -28)
  view.tab = button(finder, "Guilded scores", 12, 26, 150, function()
    if InCombatLockdown and InCombatLockdown() then return end
    if view.pane:IsShown() then view.pane:Hide() else view.pane:Show() end
  end)
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
