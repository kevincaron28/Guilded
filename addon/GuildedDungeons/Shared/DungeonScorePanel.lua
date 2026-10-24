-- Copied from addon/Guilded/Modules/DungeonScorePanel.lua by scripts/build-dungeons-addon.mjs. Edit the original, then run npm run dungeons:sync.
-- A separate, non-secure Guilded tab attached to the client's group finder.
-- Never replace Blizzard tab handlers, queue controls, or protected attributes.
local addonName, ns = ...
local view = {}
ns.dungeonScorePanel = view
local function L(text) return ns.L and ns.L(text) or text end
local function active(key) return not ns.moduleActive or ns.moduleActive(key) end
local function enabled() return active("scores") or active("dungeon") end
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

-- bracketKey: the level bracket to show in an all-level season (default: the player's own).
-- period "week": the current season's board since the weekly reset (when the bot sent one).
function view.model(name, seasonIndex, bracketKey, period, role)
  local db = ns.getDb and ns.getDb() or {}
  local score = ns.scores
  local seasons = {}
  if db.dungeonBoard then
    seasons[1] = db.dungeonBoard
    for _, past in ipairs(db.dungeonBoard.history or {}) do seasons[#seasons + 1] = past end
  end
  seasonIndex = math.max(1, math.min(seasonIndex or 1, math.max(1, #seasons)))
  local selected, rows = seasons[seasonIndex], {}
  local okLevel, level = pcall(UnitLevel, "player")
  local bracket = score.bracketByKey(selected, bracketKey)
    or score.bracketByKey(selected, score.defaultBracket(selected, ns.normalizeName(name), okLevel and level or nil))
  local week = seasonIndex == 1 and selected and type(selected.week) == "table" and type(selected.week.rows) == "table" and selected.week or nil
  if period ~= "week" or not week then period = "month" end
  for _, row in ipairs(period == "week" and week.rows or selected and selected.rows or {}) do
    if score.isMember(row.name) and (not bracket or row.bracket == bracket.key) then rows[#rows + 1] = row end
  end
  local own
  for _, row in ipairs(rows) do
    if ns.normalizeName(row.name) == ns.normalizeName(name) then own = row.points end
  end
  local snapshot = ns.seasonDetails and ns.seasonDetails.get(seasonIndex, name, bracket and bracket.key)
  local available = snapshot and snapshot.available
  local profile = available and snapshot.profile
  local roles = profile and profile.roles
  if role and roles then
    for _, r in ipairs(roles) do if r.role == role then profile = r; break end end
  else role = nil end
  local guidance = period ~= "week" and selected and selected.status == "ACTIVE" and profile and profile.guidance
  local plans = {}
  for _, r in ipairs(guidance and guidance.routes or {}) do plans[r.key] = r end
  local byId, known, cards = {}, {}, {}
  for _, d in ipairs(profile and profile.details or {}) do byId[d.dungeonKey or tostring(d.instanceId)] = d end
  for _, dungeon in ipairs(snapshot and snapshot.catalog or {}) do
    if not bracket or not dungeon.bracket or dungeon.bracket == bracket.key then
      local best = byId[dungeon.dungeonKey or tostring(dungeon.instanceId)]
      cards[#cards + 1] = { name = dungeon.name, instanceId = dungeon.instanceId, minLevel = dungeon.minLevel, maxLevel = dungeon.maxLevel, points = available and (best and best.points or 0) or nil,
        guidance = plans[dungeon.dungeonKey or tostring(dungeon.instanceId)], scenarioLevel = guidance and guidance.level, historical = selected and selected.status == "ENDED",
        counted = best and best.counted, reason = best and best.unrankedReason, penalty = best and best.penaltyPercent, bosses = best and best.bosses, sec = best and best.durationSec, speedBonus = best and best.speedBonus, targetSec = dungeon.targetSec,
        -- The officer relay (SeasonDetails) carries only the season's flag, not each route's.
        provisional = snapshot.version == 6 and (dungeon.provisional == true or dungeon.provisional == nil and snapshot.provisional == true) }
      local mapped = score.dungeonFor(dungeon.name)
      if mapped then known[mapped.key] = true end
    end
  end
  -- Keep known unvisited Classic dungeons visible without merging actual instance IDs.
  for _, dungeon in ipairs(snapshot and (snapshot.provisional or snapshot.version == 5 or snapshot.version == 6) and {} or score.DUNGEONS) do
    if not known[dungeon.key] then cards[#cards + 1] = { name = dungeon.name, minLevel = dungeon.minLevel, maxLevel = dungeon.maxLevel, points = available and 0 or nil } end
  end
  table.sort(cards, function(a, b)
    if (a.minLevel or math.huge) ~= (b.minLevel or math.huge) then return (a.minLevel or math.huge) < (b.minLevel or math.huge) end
    if (a.maxLevel or math.huge) ~= (b.maxLevel or math.huge) then return (a.maxLevel or math.huge) < (b.maxLevel or math.huge) end
    return a.name < b.name
  end)
  return { total = profile and profile.points or own, count = profile and #profile.details or nil,
    cards = cards, seasons = seasons, seasonIndex = seasonIndex, season = selected, rows = rows, roles = roles, role = role, guidance = guidance,
    own = profile and profile.points or own, available = available, version = snapshot and snapshot.version, provisional = snapshot and snapshot.provisional,
    bracket = bracket, brackets = selected and selected.brackets, period = period, hasWeek = week ~= nil, weekOwn = period == "week" and (own or 0) or nil }

end

function view.guidanceText(row)
  if row and row.historical then return L("Past season: recorded results only.") end
  local g = row and row.guidance
  if not g then return L("Sync your companion for improvement scenarios and role details.") end
  if g.fit == "carry" then return L("Overlevel: this route cannot add ranked points.") end
  if g.fit == "below" then return L("Requires the route's minimum level.") end
  local lines = { string.format(L("Scenario at level %d (party maximum)."), row.scenarioLevel or 0) }
  if g.fit == "below" then lines[#lines + 1] = L("Requires the route's minimum level.") end
  if g.next then
    local when = g.next.durationSec and duration(g.next.durationSec) or L("Any ranked clear")
    lines[#lines + 1] = string.format(L("%s: +%d points (season %d)."), when, g.next.gain, g.next.total)
    if #(g.next.pushedOut or {}) > 0 then lines[#lines + 1] = L("Replaces: ") .. table.concat(g.next.pushedOut, ", ") end
  else lines[#lines + 1] = L("No further seasonal gain on this route.") end
  if (g.penaltyPercent or 0) > 0 then lines[#lines + 1] = string.format(L("Group above the level range: -%d%%"), g.penaltyPercent) end
  lines[#lines + 1] = L("Scenario only: final-boss evidence and 80% presence required. No confirmation yet.")
  return table.concat(lines, "\n")
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

-- The official season (current board or its history) whose dates contain this run's end,
-- or nil. The bot sends dates in ISO UTC; boards from before 6.3 have none.
function view.seasonFor(stamp)
  local util = ns.util
  local at = type(stamp) == "number" and stamp or (util and util.isoEpoch and util.isoEpoch(stamp))
  local db = ns.getDb and ns.getDb()
  local board = db and db.dungeonBoard
  if not at or not util or not util.isoEpoch or type(board) ~= "table" then return nil end
  local seasons = { board }
  for _, past in ipairs(type(board.history) == "table" and board.history or {}) do seasons[#seasons + 1] = past end
  for _, season in ipairs(seasons) do
    local startsAt, endsAt = util.isoEpoch(season.startsAt), util.isoEpoch(season.endsAt)
    if type(season.season) == "string" and startsAt and at >= startsAt
      and ((endsAt and at < endsAt) or (not endsAt and season.status ~= "ENDED")) then
      return season.season
    end
  end
  return nil
end

function view.runModel()
  local db = ns.getDb and ns.getDb() or {}
  local dungeon = db.dungeon or {}
  local recent = {}
  local me = ns.normalizeName(ns.playerName())
  for _, run in pairs(dungeon.runs or {}) do
    for name in pairs(run.players or {}) do
      if ns.normalizeName(name) == me then recent[#recent + 1] = run; break end
    end
  end
  table.sort(recent, function(a, b) return (a.endedAt or 0) > (b.endedAt or 0) end)
  return { current = dungeon.current, recent = recent }
end

local function buildRun(pane, width)
  local run = CreateFrame("Frame", nil, pane)
  run:SetPoint("TOPLEFT", pane, "TOPLEFT", 0, -34)
  run:SetPoint("BOTTOMRIGHT", pane, "BOTTOMRIGHT")
  run:SetFrameLevel(pane:GetFrameLevel() + 40)
  run:EnableMouse(true)
  local bg = run:CreateTexture(nil, "BACKGROUND"); bg:SetAllPoints()
  bg:SetTexture("Interface\\FrameGeneral\\UI-Background-Marble", "REPEAT", "REPEAT"); bg:SetHorizTile(true); bg:SetVertTile(true)
  run.status = label(run, 16, -10, width - 32)
  run.boss = label(run, 16, -82, width - 32)
  run.recent = label(run, 16, -230, width - 32)
  label(run, 16, -204, width - 32, "GameFontNormal"):SetText(L("Recent runs"))
  local function action(key)
    if not active("dungeon") then return end
    local handler = ns.commandHandlers and ns.commandHandlers.dungeon
    if handler then handler({ key }) end
    pane.pendingAction = nil
    pane:Refresh()
  end
  button(run, "Start now", 16, -125, 116, function() action("start") end)
  run.complete = button(run, "Complete", 140, -125, 116, function(self)
    if not active("dungeon") then return end
    if pane.pendingAction ~= "complete" then pane.pendingAction = "complete"; run.abandon:SetText(L("Abandon")); self:SetText(L("Click again")); return end
    self:SetText(L("Complete")); action("complete")
  end)
  run.abandon = button(run, "Abandon", 264, -125, 116, function(self)
    if not active("dungeon") then return end
    if pane.pendingAction ~= "abandon" then pane.pendingAction = "abandon"; run.complete:SetText(L("Complete")); self:SetText(L("Click again")); return end
    self:SetText(L("Abandon")); action("abandon")
  end)
  button(run, "Last result", 16, -163, 116, function() action("results") end)
  run.timer = button(run, "Live timer", 140, -163, 240, function()
    if not active("dungeon") then return end
    if ns.runResults then ns.runResults.setTimerEnabled(not ns.runResults.timerEnabled()) end
    pane:Refresh()
  end)
  run:SetScript("OnHide", function()
    pane.pendingAction = nil
    run.complete:SetText(L("Complete")); run.abandon:SetText(L("Abandon"))
  end)
  function run:Refresh()
    local model = view.runModel()
    if not active("dungeon") then self.status:SetText(L("Dungeon recording is off in Settings.")); self.boss:SetText(""); self.recent:SetText(""); return end
    local current = model.current
    local lines = {}
    if current then
      local now = GetServerTime and GetServerTime() or time()
      lines[1] = (current.name or "?") .. " - " .. L(current.state or "READY")
      lines[2] = duration(math.max(0, current.durationSec or (current.startedAt and now - current.startedAt) or 0))
      local kills = 0
      for _, encounter in ipairs(current.encounters or {}) do if encounter.success then kills = kills + 1 end end
      lines[3] = L("Bosses") .. ": " .. kills .. (current.bossCount and (" / " .. current.bossCount) or "")
    else lines[1] = L("Enter a dungeon to start recording automatically.") end
    self.status:SetText(table.concat(lines, "\n"))
    self.boss:SetText(ns.runResults and ns.runResults.timerEnabled() and ns.runResults.liveText(current, GetServerTime and GetServerTime() or time()) or "")
    lines = {}
    for i = 1, math.min(5, #model.recent) do
      local saved = model.recent[i]
      -- The date shows which runs are older than the current season (they still count in theirs).
      local when = ns.util and ns.util.whenText and ns.util.whenText(saved.endedAt or saved.startedAt)
      local season = view.seasonFor(saved.endedAt or saved.startedAt)
      lines[#lines + 1] = (saved.name or "?") .. " - " .. duration(saved.durationSec or 0) .. " - " .. L(saved.state or "") .. (when and (" - " .. when) or "")
        .. (season and (" - " .. string.format(L("Season: %s"), season)) or "")
    end
    self.recent:SetText(#lines > 0 and table.concat(lines, "\n\n") or L("No saved dungeon result yet."))
    self.timer:SetText(L("Live timer") .. ": " .. L(ns.runResults and ns.runResults.timerEnabled() and "on" or "off"))
  end
  run:Hide()
  return run
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
  background:SetAllPoints(); background:SetTexture("Interface\\FrameGeneral\\UI-Background-Marble", "REPEAT", "REPEAT")
  background:SetHorizTile(true); background:SetVertTile(true)
  pane.title = label(pane, 16, -12, 112, "GameFontNormalLarge")
  pane.title:SetText(L("Dungeons"))
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
      if self.row.penalty then GameTooltip:AddLine(string.format(L("Group above the level range: -%d%%"), self.row.penalty), 1, 0.6, 0.2) end
      GameTooltip:AddLine(view.guidanceText(self.row), 0.8, 0.85, 1, true)
      GameTooltip:AddLine(L("Competitive boss records"), 0.83, 0.69, 0.22)
      if #(self.row.bosses or {}) == 0 then GameTooltip:AddLine(L("No eligible timed boss kills recorded.")) end
      for _, b in ipairs(self.row.bosses or {}) do GameTooltip:AddDoubleLine(b.name, duration(b.durationSec)) end
      GameTooltip:Show()
    end)
    card:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
    pane.cards[i] = card
  end
  pane.page, pane.seasonIndex, pane.elapsed, pane.role = 1, 1, 0, false
  pane.mode, pane.guildRanking = active("scores") and "season" or "run", false
  pane.rankings = label(pane, 16, -94, width - 32)
  pane.rankings:Hide()
  pane.pageLabel = label(pane, 126, -305, width - 252)
  pane.seasonTitle = label(pane, 16, -334, width - 160, "GameFontNormal")
  pane.seasonRows = label(pane, 16, -368, width - 32)
  pane.footer = label(pane, 16, -458, width - 32)
  pane.footer:SetText(L(ns.standalone and "Public personal scores. Sync the companion, then reload. Guild scores may differ."
    or "Guild members only. Best time / fixed target. Past seasons keep their original rules."))
  function pane:Refresh()
    if not enabled() then self.summary:SetText(L("Dungeon scores are off (Tools).")); self:Hide(); return end
    if self.mode == "run" then self.runView:Show(); self.runView:Refresh(); return end
    self.runView:Hide()
    if not active("scores") then self.mode = "run"; self.runView:Show(); self.runView:Refresh(); return end
    local name = ns.playerName()
    local chosenRole = self.role
    if self.guildRanking or self.period == "week" then chosenRole = nil end
    local model = view.model(name, self.seasonIndex, self.bracket, self.period, chosenRole)
    self.role = model.role or false
    self.roleButton:SetText(L(self.role or "Overall"))
    if model.roles and model.period ~= "week" then self.roleButton:Show() else self.roleButton:Hide() end
    self.seasonIndex, self.period = model.seasonIndex, model.period
    local ranking = self.guildRanking or model.period == "week"
    -- The current season: one button switches between this month (the season) and this week.
    if model.hasWeek then
      self.periodButton:SetText(L(model.period == "week" and "This week" or "This month")); self.periodButton:Show()
    else self.periodButton:Hide() end
    self.bracket = model.bracket and model.bracket.key or nil
    -- All-level seasons: one button cycles through the level brackets.
    if model.bracket then
      self.bracketButton:SetText(ns.scores.bracketLabel(model.bracket)); self.bracketButton:Show()
    else self.bracketButton:Hide() end
    local pages = math.max(1, math.ceil(ranking and #model.rows / 12 or #model.cards / perPage))
    self.page = math.min(self.page, pages)
    self.summary:SetText(name .. (self.role and (" (" .. L(self.role) .. ")") or "") .. " - " .. (model.period == "week" and (L("Your score this week") .. ": " .. model.weekOwn)
      or (L("Your season score") .. ": " .. (model.total and tostring(model.total) or L("Not in this snapshot")))))
    self.note:SetText(model.available and (model.version == 6 and model.bracket and string.format(L("%s: best %d distinct routes. Verified route evidence required."), ns.scores.bracketLabel(model.bracket), model.bracket.bestCount)
      or model.version == 5 and L("Level 60: best 8 distinct routes. Maximum 3200. Verified route evidence required.") or model.version == 4 and L("Beta: best 8 distinct routes. Level 30. Maximum 3200. Provisional targets.") or model.version == 3 and L("200 at target. Best run per dungeon. Hover for boss records.") or model.version == 2 and L("100 per dungeon + up to 20 speed. Only your best run counts.")
      or L("Historical rules: 100 per distinct dungeon, no speed bonus."))
      or L("Per-dungeon breakdown unavailable in this snapshot."))
    -- A provisional all-level season: targets are shared and locked for the season.
    if not ns.standalone and model.provisional and model.version == 6 and model.available and model.bracket then
      self.note:SetText(string.format(L("%s: best %d distinct routes. * = provisional target; shared and locked for the season."),
        ns.scores.bracketLabel(model.bracket), model.bracket.bestCount))
    elseif model.provisional and model.version ~= 4 and model.version ~= 5 and model.version ~= 6 then self.note:SetText(L("Provisional targets, fixed for this season. Hover for boss records.")) end
    if ns.standalone and model.available then self.note:SetText(L("Public season rules. Legacy results may lack full evidence. Role totals are separate.")) end
    if not model.available and ns.seasonDetails then ns.seasonDetails.request(model.seasonIndex) end
    for i, card in ipairs(self.cards) do
      local row = model.cards[(self.page - 1) * perPage + i]
      if row and not ranking then
        card.row = row
        card.art:Hide()
        if card.art:SetTexture(artwork(row)) then card.art:Show() end
        -- One level shows as "(30)", not "(30-30)".
        local levels = row.minLevel and ((row.maxLevel and row.maxLevel ~= row.minLevel) and (row.minLevel .. "-" .. row.maxLevel) or tostring(row.minLevel))
        card:Show(); card.name:SetText(row.name .. (levels and (" (" .. levels .. ")") or ""))
        card.value:SetText(row.sec and ("|cffefca68" .. (row.reason and L("Unranked") or tostring(row.points)) .. (row.penalty and (" (-" .. row.penalty .. "%)") or "") .. (model.version == 2 and " (+" .. row.speedBonus .. ")" or "") .. ((model.version == 4 or model.version == 5) and row.counted == false and not row.reason and (" - " .. L("Not counted in best 8")) or "")
          .. (model.version == 6 and model.bracket and row.counted == false and not row.reason and (" - " .. string.format(L("Not counted in best %d"), model.bracket.bestCount)) or "") .. "|r  " .. duration(row.sec)
          .. " / " .. (row.targetSec and (duration(row.targetSec) .. (row.provisional and "*" or "")) or L("No target")))
          or ("|cff8993a4" .. (model.available and L("Not completed this season") or L("Breakdown unavailable")) .. "|r"
            .. (row.targetSec and (" / " .. duration(row.targetSec) .. (row.provisional and "*" or "")) or "")))
        card.bar:SetWidth(math.max(1, cardWidth * math.min(1, (row.points or 0) / ((model.version or 0) >= 3 and 400 or 120))))
        if (row.points or 0) > 0 then card.bar:Show() else card.bar:Hide() end
      else card.row = nil; card.art:SetTexture(nil); card.art:Hide(); card:Hide() end
    end
    if ranking then
      local ranked = {}
      for i = (self.page - 1) * 12 + 1, math.min(#model.rows, self.page * 12) do
        local row = model.rows[i]
        ranked[#ranked + 1] = string.format("%d. %s - %d", i, row.name, row.points)
      end
      self.rankings:SetText(#ranked > 0 and table.concat(ranked, "\n") or L(model.period == "week" and "No scores this week yet." or "No points recorded for this season."))
      self.rankings:Show()
    else self.rankings:Hide() end
    self.rankingToggle:SetText(L(self.guildRanking and "My progress" or "Guild rankings"))
    self.pageLabel:SetText(string.format(L("Page %d / %d"), self.page, pages))
    local season = model.season
    self.seasonTitle:SetText(season and ((season.status == "ENDED" and L("Past season") or L("Current season")) .. ": " .. season.season)
      or L("No season snapshot yet"))
    local lines = {}
    -- The score itself is already on the summary line at the top.
    if not season then lines[1] = L("Season scores arrive through your companion or a guild officer.")
    else
      -- How fresh these scores are, and whose copy (companion or an officer's share).
      local d = ns.getDb and ns.getDb()
      local board = d and d.dungeonBoard
      local when = board and board.updatedAt and ns.util and ns.util.whenText and ns.util.whenText(board.updatedAt)
      if when then
        lines[1] = string.format(L("Updated %s%s."), when, board.from and string.format(L(", shared by %s"), board.from) or "")
      end
    end
    local easiest
    for _, card in ipairs(model.cards) do
      local g = card.guidance
      if g and g.fit == "ok" and g.next then
        local ease = g.next.durationSec and g.next.durationSec / g.targetSec or math.huge
        if not easiest or ease > easiest.ease then easiest = { name = card.name, ease = ease, next = g.next } end
      end
    end
    if easiest and not ranking then
      lines[#lines + 1] = L("Best next improvement") .. ": " .. easiest.name .. " (+" .. easiest.next.gain .. "). " .. L("Hover for the scenario.")
    end
    self.seasonRows:SetText(table.concat(lines, "\n"))
  end
  pane.roleButton = button(pane, "Overall", 16, -394, 110, function()
    local nextRole = { TANK = "HEALER", HEALER = "DAMAGER", DAMAGER = false }
    if pane.role then pane.role = nextRole[pane.role] else pane.role = "TANK" end
    pane.page = 1; pane:Refresh()
  end)
  pane.roleButton:Hide()
  button(pane, "Previous", 16, -299, 100, function() pane.page = math.max(1, pane.page - 1); pane:Refresh() end)
  button(pane, "Next", width - 116, -299, 100, function() pane.page = pane.page + 1; pane:Refresh() end)
  pane.rankingToggle = button(pane, "Guild rankings", 16, -423, 110, function() pane.guildRanking = not pane.guildRanking; pane.page = 1; pane:Refresh() end)
  if ns.standalone then pane.rankingToggle:Hide() end
  button(pane, "Newer season", width - 306, -423, 138, function() pane.seasonIndex = math.max(1, pane.seasonIndex - 1); pane.bracket = nil; pane.page = 1; pane:Refresh() end)
  button(pane, "Older season", width - 158, -423, 138, function() pane.seasonIndex = pane.seasonIndex + 1; pane.bracket = nil; pane.page = 1; pane:Refresh() end)
  pane.bracketButton = button(pane, "Bracket", width - 136, -330, 120, function()
    local season = view.model(ns.playerName(), pane.seasonIndex, pane.bracket).season
    local list = season and season.brackets or {}
    for i, b in ipairs(list) do
      if b.key == pane.bracket then pane.bracket = (list[i % #list + 1] or b).key; break end
    end
    pane.page = 1; pane:Refresh()
  end)
  pane.bracketButton:Hide()
  pane.period = "month"
  pane.periodButton = button(pane, "This month", width - 262, -330, 120, function()
    pane.period = pane.period == "week" and "month" or "week"; pane.page = 1; pane:Refresh()
  end)
  pane.periodButton:Hide()
  -- Inside the game's dungeon finder, Close closes the finder (not just this page).
  button(pane, "Close", width - 78, -8, 62, function()
    if view.chrome and view.chrome:IsShown() then
      ns.util.hideWindow(LFGParentFrame or PVEFrame or LFGFrame)
    else pane:Hide() end
  end)
  pane.runView = buildRun(pane, width)
  button(pane, "Run", width - 270, -8, 86, function() pane.mode = "run"; pane:Refresh() end)
  button(pane, "Season", width - 178, -8, 92, function() pane.mode = "season"; pane:Refresh() end)
  pane:SetScript("OnUpdate", function(self, elapsed)
    if self.mode ~= "run" then return end
    self.elapsed = (self.elapsed or 0) + elapsed
    if self.elapsed >= 1 then self.elapsed = 0; self.runView:Refresh() end
  end)
  pane:SetScript("OnShow", function() pane:Refresh() end)
  pane:Hide()
  return pane
end

function view.open(mode)
  if not enabled() or (InCombatLockdown and InCombatLockdown()) then return end
  view.attach()
  if view.showAttached then
    if view.window then view.window:Hide() end
    local finder = LFGParentFrame or PVEFrame or LFGFrame
    ns.util.showWindow(finder)
    if mode then view.pane.mode = mode end
    view.showAttached()
    view.pane:Refresh()
    return
  end
  if not view.window then
    view.window = view.build(UIParent)
    view.window:SetPoint("CENTER", UIParent, "CENTER")
    view.window:SetFrameStrata("DIALOG")
  end
  if mode then view.window.mode = mode end
  view.window:Show()
  view.window:Refresh()
end

-- Retry on load-on-demand UI loads; no polling or changes to queue behavior.
function view.attach()
  if not enabled() then return end
  if InCombatLockdown and InCombatLockdown() then return end
  if view.tab then return end
  local finder = LFGParentFrame or PVEFrame or LFGFrame
  if not finder then return end
  if view.window then view.window:Hide() end
  if finder.WhoListingTab and LFGParentFrameRightTabMixin then
    -- Forever's fourth page uses the same side-tab template as its three
    -- native pages. Keep Blizzard's selection and handlers untouched.
    view.chrome = CreateFrame("Frame", nil, finder, "PortraitFrameTemplateNoCloseButton")
    view.chrome:SetAllPoints(finder)
    view.chrome:SetTitle(L("Guilded dungeons"))
    view.chrome:Hide()
    view.pane = view.build(view.chrome, true)
    view.pane:SetPoint("TOPLEFT", finder, "TOPLEFT", 9, -30)
    view.pane:SetFrameLevel(finder:GetFrameLevel() + 20)
    view.tab = CreateFrame("Frame", nil, finder, "LFGVanillaRightTabTemplate")
    view.tab.tooltipText = L("Guilded dungeons")
    view.tab.Icon:SetTexture(ns.standalone and "Interface\\Icons\\INV_Misc_Map_01" or "Interface\\AddOns\\Guilded\\Media\\GuildedLogo")
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
    local function showAttached(_, mouseButton, upInside)
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
    end
    view.showAttached = function() showAttached(nil, "LeftButton", true) end
    view.tab:SetCustomOnMouseUpHandler(showAttached)
    view.tab:SetChecked(false)
    return
  end
  view.pane = view.build(finder)
  view.showAttached = function() view.pane:Show() end
  view.pane:SetPoint("CENTER", UIParent, "CENTER")
  view.tab = button(finder, "Guilded dungeons", 0, 0, 150, function()
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
