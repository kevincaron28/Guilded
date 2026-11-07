-- Dungeon stats (9.1): per-dungeon detail and guild comparison, computed on this client from
-- the runs it saved (its own and the ones guildmates' addons shared). Nothing is sent or stored:
-- this module only reads GuildedDB.dungeon.runs and the season board, and draws the detail page
-- the dungeon season panel (Modules/DungeonScorePanel.lua) opens when a dungeon card is clicked.
-- Plain, non-secure frames only, so it is safe to open in combat.
local addonName, ns = ...
local stats = {}
ns.dungeonStats = stats
local function L(text) return ns.L and ns.L(text) or text end
local function norm(name) return ns.normalizeName and ns.normalizeName(name) or name end

function stats.clock(sec)
  sec = math.max(0, math.floor((tonumber(sec) or 0) + 0.5))
  return string.format("%d:%02d", math.floor(sec / 60), sec % 60)
end

-- "+0:12" (slower) or "-0:05" (faster), for split comparisons.
function stats.delta(sec)
  if not sec then return "" end
  return (sec > 0 and "+" or sec < 0 and "-" or "") .. stats.clock(math.abs(sec))
end

-- Score colours: the game's item-quality ladder, by share of the best possible (or of the top
-- score on a board). Colours are a hint only; every value is also written as a number.
stats.TIERS = {
  { min = 0.9, hex = "ff8000", rgb = { 1, 0.5, 0 } },
  { min = 0.75, hex = "a335ee", rgb = { 0.64, 0.21, 0.93 } },
  { min = 0.5, hex = "0070dd", rgb = { 0, 0.44, 0.87 } },
  { min = 0.25, hex = "1eff00", rgb = { 0.12, 1, 0 } },
  { min = 0, hex = "9d9d9d", rgb = { 0.62, 0.62, 0.62 } },
}
function stats.tier(fraction)
  fraction = tonumber(fraction) or 0
  for _, tier in ipairs(stats.TIERS) do if fraction >= tier.min then return tier end end
  return stats.TIERS[#stats.TIERS]
end
function stats.colorize(text, fraction) return "|cff" .. stats.tier(fraction).hex .. tostring(text) .. "|r" end

-- A run counts for someone who was really there (half the run, as in Modules/Scores.lua).
local function present(player, sec)
  return player.presentSec == nil or not sec or (tonumber(player.presentSec) or 0) >= sec * 0.5
end
local function member(name)
  if ns.scores and ns.scores.isMember then return ns.scores.isMember(name) end
  return true
end

-- Boss kills of one run as splits from the run's start, first kill first. Each boss once.
function stats.splits(run)
  local out, seen = {}, {}
  local start, total = tonumber(run.startedAt), tonumber(run.durationSec)
  if not start then return out end
  for _, e in ipairs(run.encounters or {}) do
    local key = e.id and tostring(e.id) or e.name
    local at = tonumber(e.at)
    if e.success and key and at and not seen[key] then
      local sec = at - start
      if sec >= 0 and (not total or sec <= total + 60) then
        seen[key] = true
        out[#out + 1] = { key = key, name = e.name or ("#" .. key), sec = sec }
      end
    end
  end
  table.sort(out, function(a, b) return a.sec < b.sec end)
  return out
end

local function dungeonKey(run)
  return run.instanceId and tostring(run.instanceId) or (run.name and string.lower(run.name)) or nil
end

-- Every dungeon this client knows a run of, for `me` (default: this character):
-- { list = { dungeon... }, byKey = {}, totals = { runs, completed, deaths, dungeons } } where a
-- dungeon is { key, name, instanceId, runs, completed, deaths, deathRuns, best, bestAt, average,
-- lastAt, members, guildBest = { name, sec }, guildAverage, rank, topPercent, bosses = { ... } }.
function stats.compute(me, runs)
  me = norm(me or (ns.playerName and ns.playerName()))
  if not runs then
    local db = ns.getDb and ns.getDb()
    runs = db and db.dungeon and db.dungeon.runs or {}
  end
  local edition = ns.util and ns.util.gameEdition and ns.util.gameEdition()
  local byKey, list = {}, {}
  local totals = { runs = 0, completed = 0, deaths = 0, dungeons = 0 }
  for _, run in pairs(runs) do
    local key = type(run) == "table" and dungeonKey(run)
    local sameGame = not (run and run.gameEdition and edition and run.gameEdition ~= edition)
    if key and sameGame and run.state ~= "INVALID" then
      local d = byKey[key]
      if not d then
        d = { key = key, name = run.name or "?", instanceId = run.instanceId, runs = 0, completed = 0, deaths = 0, deathRuns = 0,
          times = {}, memberBest = {}, boss = {} }
        byKey[key] = d; list[#list + 1] = d
      end
      local sec = run.state == "COMPLETED" and tonumber(run.durationSec) or nil
      if sec and sec <= 0 then sec = nil end
      local splits = sec and stats.splits(run) or {}
      for name, player in pairs(run.players or {}) do
        local who = norm(name)
        local mine = who == me
        if mine then
          d.runs = d.runs + 1; totals.runs = totals.runs + 1
          d.lastAt = math.max(d.lastAt or 0, tonumber(run.endedAt or run.startedAt) or 0)
          if player.deaths ~= nil and player.addon ~= false then
            d.deaths = d.deaths + (tonumber(player.deaths) or 0); d.deathRuns = d.deathRuns + 1
            totals.deaths = totals.deaths + (tonumber(player.deaths) or 0)
          end
          if sec and present(player, sec) then
            d.completed = d.completed + 1; totals.completed = totals.completed + 1
            d.times[#d.times + 1] = sec
            if not d.best or sec < d.best then d.best, d.bestAt = sec, run.endedAt end
          end
        end
        local counts = sec and present(player, sec)
        if counts and mine then
          for _, s in ipairs(splits) do
            local b = d.boss[s.key] or { key = s.key, name = s.name }
            d.boss[s.key] = b
            if not b.mine or s.sec < b.mine then b.mine = s.sec end
          end
        end
        -- Guild comparison: members' own bests (and each boss's fastest split).
        if counts and (mine or member(name)) then
          if not d.memberBest[who] or sec < d.memberBest[who] then d.memberBest[who] = sec end
          for _, s in ipairs(splits) do
            local b = d.boss[s.key] or { key = s.key, name = s.name }
            d.boss[s.key] = b
            if not b.guild or s.sec < b.guild then b.guild, b.guildBy = s.sec, who end
          end
        end
      end
    end
  end
  for _, d in ipairs(list) do
    if #d.times > 0 then
      local sum = 0
      for _, t in ipairs(d.times) do sum = sum + t end
      d.average = sum / #d.times
    end
    local bests = {}
    for who, sec in pairs(d.memberBest) do bests[#bests + 1] = { name = who, sec = sec } end
    table.sort(bests, function(a, b) if a.sec ~= b.sec then return a.sec < b.sec end return a.name < b.name end)
    d.members = #bests
    if #bests > 0 then
      d.guildBest = bests[1]
      local sum = 0
      for _, b in ipairs(bests) do sum = sum + b.sec end
      d.guildAverage = sum / #bests
    end
    if d.best and #bests > 0 then
      local faster = 0
      for _, b in ipairs(bests) do if b.sec < d.best then faster = faster + 1 end end
      d.rank = faster + 1
      d.topPercent = math.max(1, math.ceil(100 * d.rank / #bests))
    end
    d.bosses = {}
    for _, b in pairs(d.boss) do d.bosses[#d.bosses + 1] = b end
    table.sort(d.bosses, function(a, b)
      local x, y = a.guild or a.mine or math.huge, b.guild or b.mine or math.huge
      if x ~= y then return x < y end
      return a.name < b.name
    end)
    d.times, d.memberBest, d.boss = nil, nil, nil
    if d.runs > 0 then totals.dungeons = totals.dungeons + 1 end
  end
  local function level(d)
    local known = ns.scores and ns.scores.dungeonFor and ns.scores.dungeonFor(d.name)
    return known and known.minLevel or math.huge
  end
  table.sort(list, function(a, b)
    if level(a) ~= level(b) then return level(a) < level(b) end
    return a.name < b.name
  end)
  return { list = list, byKey = byKey, totals = totals }
end

-- The computed dungeon for a season card (matched by instance ID, then by name).
function stats.forCard(data, card)
  if not (data and card) then return nil end
  local d = card.instanceId and data.byKey[tostring(card.instanceId)]
  if d then return d end
  local wanted = card.name and string.lower(card.name)
  for _, entry in ipairs(data.list) do
    if string.lower(entry.name or "") == wanted then return entry end
  end
  return nil
end

-- The season board compared with you: { rank, count, topPercent, best = row, average }.
function stats.boardSummary(rows, me)
  me = norm(me or (ns.playerName and ns.playerName()))
  if type(rows) ~= "table" or #rows == 0 then return nil end
  local own, best, sum = nil, nil, 0
  for _, row in ipairs(rows) do
    local points = tonumber(row.points) or 0
    sum = sum + points
    if not best or points > (tonumber(best.points) or 0) then best = row end
    if norm(row.name) == me then own = points end
  end
  local out = { count = #rows, best = best, average = sum / #rows, own = own }
  if own then
    local ahead = 0
    for _, row in ipairs(rows) do if (tonumber(row.points) or 0) > own then ahead = ahead + 1 end end
    out.rank = ahead + 1
    out.topPercent = math.max(1, math.ceil(100 * out.rank / #rows))
  end
  return out
end

function stats.boardLine(summary)
  if not summary then return "" end
  local parts = {}
  if summary.rank then
    parts[#parts + 1] = string.format(L("You: #%d of %d (top %d%%)"), summary.rank, summary.count, summary.topPercent)
  end
  if summary.best then
    parts[#parts + 1] = string.format(L("Guild best: %s %d"), ns.displayName and ns.displayName(summary.best.name) or summary.best.name, tonumber(summary.best.points) or 0)
  end
  parts[#parts + 1] = string.format(L("Average: %d"), math.floor(summary.average + 0.5))
  return table.concat(parts, "  |  ")
end

local function who(name) return ns.displayName and ns.displayName(name) or name end

-- Tooltip lines for a season card (Raider.IO-style: your record, then the guild's).
function stats.tooltipLines(d)
  local lines = {}
  if not d or d.runs == 0 and not d.guildBest then
    lines[1] = { L("No run of yours saved here yet.") }
    return lines
  end
  lines[#lines + 1] = { L("Your runs"), string.format("%d (%d %s)", d.runs, d.completed, L("completed")) }
  if d.best then lines[#lines + 1] = { L("Best time"), stats.clock(d.best) .. (d.average and ("  (" .. L("avg") .. " " .. stats.clock(d.average) .. ")") or "") } end
  if d.deathRuns > 0 then lines[#lines + 1] = { L("Deaths per run"), string.format("%.1f", d.deaths / d.deathRuns) } end
  if d.guildBest then lines[#lines + 1] = { L("Guild best"), stats.clock(d.guildBest.sec) .. " (" .. who(d.guildBest.name) .. ")" } end
  if d.rank and d.members > 1 then lines[#lines + 1] = { L("Your rank"), string.format("#%d / %d", d.rank, d.members) } end
  return lines
end

-- ---------------------------------------------------------------------------------------------
-- Detail page: one dungeon. Built once per panel; Show(card) fills it.
-- ---------------------------------------------------------------------------------------------
local function text(parent, x, y, width, font)
  local t = parent:CreateFontString(nil, "OVERLAY", font or "GameFontHighlightSmall")
  t:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y)
  t:SetWidth(width); t:SetJustifyH("LEFT"); t:SetJustifyV("TOP")
  return t
end
local function solid(parent, layer, r, g, b, a)
  local t = parent:CreateTexture(nil, layer or "ARTWORK")
  t:SetColorTexture(r, g, b, a or 1)
  return t
end

local TILE_KEYS = { "best", "average", "runs", "deaths" }
local TILE_LABELS = { best = "Best time", average = "Average time", runs = "Runs", deaths = "Deaths per run" }
local BAR_COLORS = { you = { 0.83, 0.69, 0.22 }, best = { 0.12, 0.8, 0.3 }, average = { 0.55, 0.58, 0.64 } }
local MAX_BOSSES = 7

function stats.buildDetail(parent, width, onBack)
  local page = CreateFrame("Frame", nil, parent)
  page:EnableMouse(true)
  local bg = page:CreateTexture(nil, "BACKGROUND"); bg:SetAllPoints()
  bg:SetTexture("Interface\\FrameGeneral\\UI-Background-Marble", "REPEAT", "REPEAT")
  if bg.SetHorizTile then bg:SetHorizTile(true); bg:SetVertTile(true) end
  page.title = text(page, 16, -6, width - 120, "GameFontNormalLarge")
  page.back = CreateFrame("Button", nil, page, "UIPanelButtonTemplate")
  page.back:SetPoint("TOPRIGHT", page, "TOPRIGHT", -16, -4); page.back:SetSize(80, 22)
  page.back:SetText(L("Back"))
  page.back:SetScript("OnClick", function() page:Hide(); if onBack then onBack() end end)
  page.season = text(page, 16, -30, width - 32)
  -- Four stat tiles: best, average, runs, deaths.
  page.tiles = {}
  local gap = 8
  local tileWidth = (width - 32 - gap * 3) / 4
  for i, key in ipairs(TILE_KEYS) do
    local tile = CreateFrame("Frame", nil, page)
    tile:SetPoint("TOPLEFT", page, "TOPLEFT", 16 + (i - 1) * (tileWidth + gap), -50); tile:SetSize(tileWidth, 44)
    local back = solid(tile, "BACKGROUND", 0.08, 0.1, 0.14, 0.9); back:SetAllPoints()
    local edge = solid(tile, "ARTWORK", 0.83, 0.69, 0.22, 0.8)
    edge:SetPoint("TOPLEFT", tile, "TOPLEFT"); edge:SetPoint("TOPRIGHT", tile, "TOPRIGHT"); edge:SetHeight(2)
    tile.value = text(tile, 8, -6, tileWidth - 16, "GameFontNormalLarge")
    tile.label = text(tile, 8, -27, tileWidth - 16, "GameFontDisableSmall")
    tile.label:SetText(L(TILE_LABELS[key]))
    page.tiles[key] = tile
  end
  -- Guild comparison: your best, the guild best and the guild average as bars (shorter is faster).
  page.compareTitle = text(page, 16, -106, width - 32, "GameFontNormal")
  page.compareTitle:SetText(L("You and the guild"))
  page.rank = text(page, 16, -124, width - 32)
  page.bars = {}
  local labelWidth, valueWidth = 120, 120
  local barWidth = width - 32 - labelWidth - valueWidth
  for i, key in ipairs({ "you", "best", "average" }) do
    local y = -142 - (i - 1) * 18
    local bar = {}
    bar.label = text(page, 16, y, labelWidth - 6)
    bar.track = solid(page, "BORDER", 0.1, 0.11, 0.14, 0.9)
    bar.track:SetPoint("TOPLEFT", page, "TOPLEFT", 16 + labelWidth, y); bar.track:SetSize(barWidth, 12)
    bar.fill = solid(page, "ARTWORK", BAR_COLORS[key][1], BAR_COLORS[key][2], BAR_COLORS[key][3], 1)
    bar.fill:SetPoint("TOPLEFT", page, "TOPLEFT", 16 + labelWidth, y); bar.fill:SetSize(1, 12)
    bar.value = text(page, 16 + labelWidth + barWidth + 8, y, valueWidth - 8)
    bar.width = barWidth
    page.bars[key] = bar
  end
  -- Boss splits: time from the start to each kill, yours against the guild's fastest.
  page.splitTitle = text(page, 16, -204, width - 32, "GameFontNormal")
  page.splitTitle:SetText(L("Boss splits"))
  page.splitHead = text(page, 16, -222, width - 32, "GameFontDisableSmall")
  page.splits = {}
  local nameWidth = math.floor((width - 32) * 0.42)
  local col = math.floor((width - 32 - nameWidth) / 3)
  for i = 1, MAX_BOSSES do
    local y = -238 - (i - 1) * 20
    local row = CreateFrame("Frame", nil, page)
    row:SetPoint("TOPLEFT", page, "TOPLEFT", 16, y); row:SetSize(width - 32, 18)
    row.stripe = solid(row, "BACKGROUND", 1, 1, 1, i % 2 == 0 and 0.04 or 0); row.stripe:SetAllPoints()
    row.fill = solid(row, "BORDER", 0.83, 0.69, 0.22, 0.18)
    row.fill:SetPoint("TOPLEFT", row, "TOPLEFT"); row.fill:SetSize(1, 18)
    row.name = text(row, 4, -3, nameWidth - 8)
    row.mine = text(row, nameWidth, -3, col)
    row.guild = text(row, nameWidth + col, -3, col)
    row.delta = text(row, nameWidth + col * 2, -3, col)
    row.width = width - 32
    page.splits[i] = row
  end
  page.splitHead:SetText(L("Boss"))
  page.headCols = { text(page, 16 + nameWidth, -222, col, "GameFontDisableSmall"), text(page, 16 + nameWidth + col, -222, col, "GameFontDisableSmall"),
    text(page, 16 + nameWidth + col * 2, -222, col, "GameFontDisableSmall") }
  page.headCols[1]:SetText(L("Yours")); page.headCols[2]:SetText(L("Guild best")); page.headCols[3]:SetText(L("Gap"))
  page.empty = text(page, 16, -240, width - 32, "GameFontDisableSmall")
  page.source = text(page, 16, -390, width - 32, "GameFontDisableSmall")
  page.source:SetText(L("From runs saved by your addon and shared by guildmates' addons."))

  function page:Fill(card, data)
    data = data or stats.compute()
    local d = stats.forCard(data, card) or { name = card and card.name or "?", runs = 0, completed = 0, deaths = 0, deathRuns = 0, members = 0, bosses = {} }
    self.dungeon = d
    self.title:SetText(card and card.name or d.name)
    local season = {}
    if card and card.points ~= nil then
      local max = card.maxPoints or 400
      season[#season + 1] = L("Season points") .. ": " .. stats.colorize(card.points, card.points / max)
    end
    if card and card.sec then season[#season + 1] = L("Ranked best") .. ": " .. stats.clock(card.sec) end
    if card and card.targetSec then season[#season + 1] = L("Target") .. ": " .. stats.clock(card.targetSec) end
    self.season:SetText(table.concat(season, "   "))
    local values = {
      best = d.best and stats.clock(d.best) or "-",
      average = d.average and stats.clock(d.average) or "-",
      runs = d.runs > 0 and string.format("%d / %d", d.completed, d.runs) or "0",
      deaths = d.deathRuns > 0 and string.format("%.1f", d.deaths / d.deathRuns) or "-",
    }
    for key, tile in pairs(self.tiles) do tile.value:SetText(values[key]) end
    self.tiles.runs.label:SetText(L("Completed / runs"))
    -- Rank line and bars.
    if d.rank and d.members > 1 then
      self.rank:SetText(string.format(L("Your best is #%d of %d guild members (top %d%%)."), d.rank, d.members, d.topPercent))
    elseif d.members > 0 and not d.best then
      self.rank:SetText(string.format(L("%d guild members have a time here. Complete a run to be ranked."), d.members))
    elseif d.best then
      self.rank:SetText(L("No other guild member has a time here yet."))
    else self.rank:SetText(L("No completed run here yet.")) end
    local entries = {
      you = { label = L("You"), sec = d.best },
      best = { label = L("Guild best"), sec = d.guildBest and d.guildBest.sec, by = d.guildBest and who(d.guildBest.name) },
      average = { label = L("Guild average"), sec = d.guildAverage },
    }
    local slowest = 0
    for _, e in pairs(entries) do if e.sec and e.sec > slowest then slowest = e.sec end end
    for key, bar in pairs(self.bars) do
      local e = entries[key]
      bar.label:SetText(e.label)
      if e.sec and slowest > 0 then
        bar.fill:SetWidth(math.max(2, bar.width * e.sec / slowest)); bar.fill:Show()
        bar.value:SetText(stats.clock(e.sec) .. (e.by and (" " .. e.by) or ""))
      else bar.fill:Hide(); bar.value:SetText("-") end
    end
    -- Splits.
    local shown = 0
    local last = 0
    for _, b in ipairs(d.bosses) do last = math.max(last, b.mine or 0, b.guild or 0) end
    for i, row in ipairs(self.splits) do
      local b = d.bosses[i]
      if b then
        shown = shown + 1
        row.name:SetText(b.name)
        row.mine:SetText(b.mine and stats.clock(b.mine) or "-")
        row.guild:SetText(b.guild and stats.clock(b.guild) or "-")
        if b.mine and b.guild then
          local gap = b.mine - b.guild
          row.delta:SetText(gap <= 0 and ("|cff40ff40" .. (gap == 0 and L("Best") or stats.delta(gap)) .. "|r") or ("|cffff6060" .. stats.delta(gap) .. "|r"))
        else row.delta:SetText("") end
        if b.mine and last > 0 then row.fill:SetWidth(math.max(1, row.width * b.mine / last)); row.fill:Show() else row.fill:Hide() end
        row:Show()
      else row:Hide() end
    end
    for _, head in ipairs(self.headCols) do if shown > 0 then head:Show() else head:Hide() end end
    if shown > 0 then self.splitHead:Show() else self.splitHead:Hide() end
    self.empty:SetText(shown > 0 and "" or L("No boss kill times saved for this dungeon yet."))
  end
  page:Hide()
  return page
end
