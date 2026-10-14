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
  for _, d in ipairs(profile and profile.details or {}) do byId[d.instanceId] = d end
  for _, dungeon in ipairs(snapshot and snapshot.catalog or {}) do
    local best = byId[dungeon.instanceId]
    cards[#cards + 1] = { name = dungeon.name, points = available and (best and best.points or 0) or nil,
      reason = best and best.unrankedReason, bosses = best and best.bosses, sec = best and best.durationSec, speedBonus = best and best.speedBonus, targetSec = dungeon.targetSec }
    local mapped = score.dungeonFor(dungeon.name)
    if mapped then known[mapped.key] = true end
  end
  -- Keep known unvisited Classic dungeons visible without merging actual instance IDs.
  for _, dungeon in ipairs(score.DUNGEONS) do
    if not known[dungeon.key] then cards[#cards + 1] = { name = dungeon.name, points = available and 0 or nil } end
  end
  table.sort(cards, function(a, b) return a.name < b.name end)
  return { total = profile and profile.points or own, count = profile and #profile.details or nil,
    cards = cards, seasons = seasons, seasonIndex = seasonIndex, season = selected, rows = rows,
    own = profile and profile.points or own, available = available, version = snapshot and snapshot.version }

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
  pane.note:SetText(L("100 per dungeon + up to 20 speed. Only your best run counts."))
  pane.cards = {}
  for i = 1, 8 do
    local x, y = 16 + ((i - 1) % 2) * 299, -94 - math.floor((i - 1) / 2) * 51
    local card = CreateFrame("Frame", nil, pane)
    card:SetPoint("TOPLEFT", pane, "TOPLEFT", x, y); card:SetSize(287, 45)
    local bg = card:CreateTexture(nil, "BACKGROUND"); bg:SetAllPoints(); bg:SetColorTexture(0.08, 0.1, 0.14, 1)
    card.name = label(card, 9, -5, 269)
    card.value = label(card, 9, -24, 269)
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
  pane.pageLabel = label(pane, 136, -305, 340)
  pane.seasonTitle = label(pane, 16, -342, 585, "GameFontNormal")
  pane.seasonRows = label(pane, 16, -368, 585)
  pane.footer = label(pane, 16, -458, 585)
  pane.footer:SetText(L("Guild members only. Best time / fixed target. Past seasons keep their original rules."))
  function pane:Refresh()
    if not enabled() then self.summary:SetText(L("Dungeon scores are off (Tools).")); self:Hide(); return end
    local name = ns.playerName()
    local model = view.model(name, self.seasonIndex)
    self.seasonIndex = model.seasonIndex
    local pages = math.max(1, math.ceil(#model.cards / 8))
    self.page = math.min(self.page, pages)
    self.summary:SetText(name .. " - " .. L("Your season score") .. ": " .. (model.total and tostring(model.total) or L("Not in this snapshot")))
    self.note:SetText(model.available and (model.version == 3 and L("200 at target. Best run per dungeon. Hover for boss records.") or model.version == 2 and L("100 per dungeon + up to 20 speed. Only your best run counts.")
      or L("Historical rules: 100 per distinct dungeon, no speed bonus."))
      or L("Per-dungeon breakdown unavailable in this snapshot."))
    if not model.available and ns.seasonDetails then ns.seasonDetails.request(model.seasonIndex) end
    for i, card in ipairs(self.cards) do
      local row = model.cards[(self.page - 1) * 8 + i]
      if row then
        card.row = row
        card:Show(); card.name:SetText(row.name)
        card.value:SetText(row.sec and ("|cffefca68" .. (row.reason and L("Unranked") or tostring(row.points)) .. (model.version == 2 and " (+" .. row.speedBonus .. ")" or "") .. "|r  " .. duration(row.sec)
          .. " / " .. (row.targetSec and duration(row.targetSec) or L("No target")))
          or ("|cff8993a4" .. (model.available and L("Not completed this season") or L("Breakdown unavailable")) .. "|r"))
        card.bar:SetWidth(math.max(1, 287 * (row.points or 0) / (model.version == 3 and 400 or 120)))
        if (row.points or 0) > 0 then card.bar:Show() else card.bar:Hide() end
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
  button(pane, "Next", 500, -299, 100, function() pane.page = math.min(math.ceil(#view.model(ns.playerName(), pane.seasonIndex).cards / 8), pane.page + 1); pane:Refresh() end)
  button(pane, "Newer season", 314, -423, 138, function() pane.seasonIndex = math.max(1, pane.seasonIndex - 1); pane.page = 1; pane:Refresh() end)
  button(pane, "Older season", 462, -423, 138, function() pane.seasonIndex = pane.seasonIndex + 1; pane.page = 1; pane:Refresh() end)
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
