-- 8.5 track C5 (addon half): the "Ready to promote" panel for officers. A member is ready when they have
-- held the starting rank (default Initiate) for the configured days (default 7). The addon notes when it
-- first saw each rank on this officer's own roster, and the Discord bot's list (GuildedPromotion, written by
-- the companion for officers only) adds members the bot already knows are ready. One click promotes one
-- member through the reviewed RosterTools engine: fresh roster, permission check, audit, verification.
-- Nothing is promoted automatically; officer-only data never leaves this computer.
local _, ns = ...
ns = ns or {}
local module = {}
ns.promotion = module
local function L(s) return ns.L and ns.L(s) or s end
local function db() return ns.getDb and ns.getDb() end
local DAY = 86400
local lastScan = -1000
local function nowSeconds() return (GetServerTime and GetServerTime()) or (time and time()) or 0 end
local function clock() return GetTime and GetTime() or 0 end

function module.rule()
  local d = db() or {}
  local rule = type(d.promotionRule) == "table" and d.promotionRule or {}
  local days = tonumber(rule.minDays)
  return { fromRank = type(rule.fromRank) == "string" and rule.fromRank ~= "" and rule.fromRank or "Initiate", minDays = days and math.max(0, math.min(365, math.floor(days))) or 7 }
end

function module.setRule(fromRank, minDays)
  local d = db(); if not d then return false end
  d.promotionRule = d.promotionRule or {}
  if type(fromRank) == "string" and fromRank ~= "" and #fromRank <= 40 then d.promotionRule.fromRank = fromRank end
  if tonumber(minDays) then d.promotionRule.minDays = math.max(0, math.min(365, math.floor(tonumber(minDays)))) end
  return true
end

-- Remember when each member's current rank was first seen on this roster. A changed rank starts over.
function module.observe()
  local tools = ns.rosterTools
  if not tools or not tools.authorized() then return end
  local d = db(); if not d then return end
  local snapshot = tools.snapshot(); if not snapshot then return end
  d.rankSince = type(d.rankSince) == "table" and d.rankSince or {}
  local at = nowSeconds()
  for key, row in pairs(snapshot.rows) do
    local seen = d.rankSince[key]
    if not seen or seen.rank ~= row.rankName then d.rankSince[key] = { rank = row.rankName, since = at } end
  end
  for key in pairs(d.rankSince) do if not snapshot.rows[key] then d.rankSince[key] = nil end end
end

local function botList()
  local data = _G.GuildedPromotion
  local out = {}
  if type(data) == "table" and type(data.ready) == "table" then
    for _, name in ipairs(data.ready) do
      if type(name) == "string" then out[ns.normalizeName and ns.normalizeName(name) or name] = true end
    end
  end
  return out
end

-- Who is ready now: { { key, name, display, days, level, rank, fromBot } }, longest at the rank first.
function module.ready()
  local tools = ns.rosterTools
  if not tools or not tools.authorized() then return nil, L("Current officer access is required.") end
  local snapshot, err = tools.snapshot()
  if not snapshot then return nil, L(err or "Refresh the full guild roster first.") end
  module.observe()
  local d, rule, fromBot = db() or {}, module.rule(), botList()
  local out, at = {}, nowSeconds()
  for key, row in pairs(snapshot.rows) do
    if row.rankName:lower() == rule.fromRank:lower() and row.key ~= snapshot.actor.key then
      local seen = d.rankSince and d.rankSince[key]
      local days = seen and seen.rank == row.rankName and math.floor((at - seen.since) / DAY) or 0
      local listed = fromBot[key] == true
      if days >= rule.minDays or listed then
        local level
        if GetGuildRosterInfo then
          local ok, _, _, _, lvl = pcall(GetGuildRosterInfo, row.index)
          if ok and type(lvl) == "number" then level = lvl end
        end
        out[#out + 1] = { key = key, name = row.name, display = row.display, days = days, level = level, rank = row.rankName, fromBot = listed }
      end
    end
  end
  table.sort(out, function(a, b) if a.days ~= b.days then return a.days > b.days end return a.display < b.display end)
  return out, rule
end

-- One member, one click: preview, confirm and send the single reviewed action. The next promotion needs the
-- roster to verify this one first (RosterTools refuses to stack requests).
function module.promote(name)
  local tools = ns.rosterTools
  if not tools or not tools.authorized() then return false, L("Current officer access is required.") end
  if type(name) ~= "string" or name == "" or name:find("[\t\r\n]") then return false, L("Unknown or ambiguous character.") end
  local plan, err = tools.preview("character\taction\tvalue\n" .. name .. "\tpromote\t")
  if not plan then return false, L(err or "Not applied. Check the preview and confirmation.") end
  if plan.blocked then tools.cancel(); return false, L(plan.rows[1] and plan.rows[1].status or "Permission or rank hierarchy prevents this action.") end
  if not tools.confirm(plan.phrase) then tools.cancel(); return false, L("Not applied. Check the preview and confirmation.") end
  local ok, message = tools.step()
  if not ok then return false, L(message or "Not applied. Check the preview and confirmation.") end
  return true, L("Promotion requested. Wait for the roster to confirm it before the next one.")
end

function module.text()
  local ready, rule = module.ready()
  if not ready then return rule end
  local lines = { string.format(L("Rule: rank %s for %d+ days."), module.rule().fromRank, module.rule().minDays) }
  if #ready == 0 then lines[#lines + 1] = L("Nobody is ready to promote yet.") end
  for _, row in ipairs(ready) do
    lines[#lines + 1] = string.format("%s%s - %d %s", row.display, row.level and (" " .. row.level) or "", row.days, L("days"))
  end
  return table.concat(lines, "\n")
end

-- The panel: up to 12 rows, each with its own Promote button.
local window, rows = nil, {}
local MAX_ROWS = 12
function module.refresh()
  if not window then return end
  local ready, rule = module.ready()
  window.status:SetText(ready and string.format(L("Rule: rank %s for %d+ days."), module.rule().fromRank, module.rule().minDays) or tostring(rule))
  for i = 1, MAX_ROWS do
    local row, item = rows[i], ready and ready[i]
    if item then
      row.label:SetText(string.format("%s%s - %d %s%s", item.display, item.level and (" " .. item.level) or "", item.days, L("days"), item.fromBot and " (Discord)" or ""))
      row.item = item; row.label:Show(); row.button:Show()
    else row.item = nil; row.label:Hide(); row.button:Hide() end
  end
  window.empty:SetText(ready and #ready == 0 and L("Nobody is ready to promote yet.") or "")
  window.more:SetText(ready and #ready > MAX_ROWS and string.format(L("+%d more"), #ready - MAX_ROWS) or "")
end

function module.open()
  local tools = ns.rosterTools
  if not tools or not tools.authorized() then if ns.message then ns.message(L("Current officer access is required.")) end; return end
  tools.requestRoster()
  if window then window:Show(); module.refresh(); return end
  local f = CreateFrame("Frame", "GuildedPromotionPanel", UIParent, "BasicFrameTemplateWithInset")
  window = f; f:SetSize(420, 120 + MAX_ROWS * 26); f:SetPoint("CENTER"); f:SetMovable(true); f:EnableMouse(true)
  f:RegisterForDrag("LeftButton"); f:SetScript("OnDragStart", f.StartMoving); f:SetScript("OnDragStop", f.StopMovingOrSizing)
  if f.TitleText then f.TitleText:SetText(L("Ready to promote")) end
  if UISpecialFrames then table.insert(UISpecialFrames, "GuildedPromotionPanel") end
  local function text(y, template)
    local t = f:CreateFontString(nil, "OVERLAY", template or "GameFontHighlightSmall")
    t:SetPoint("TOPLEFT", 18, y); t:SetWidth(380); t:SetJustifyH("LEFT"); return t
  end
  f.status = text(-34)
  f.empty = text(-60)
  f.more = text(-90 - MAX_ROWS * 26)
  for i = 1, MAX_ROWS do
    local y = -56 - (i - 1) * 26
    local label = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    label:SetPoint("TOPLEFT", 18, y - 4); label:SetWidth(280); label:SetJustifyH("LEFT")
    local button = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
    button:SetPoint("TOPLEFT", 310, y); button:SetSize(90, 22); button:SetText(L("Promote"))
    local row = { label = label, button = button }
    button:SetScript("OnClick", function()
      if not row.item then return end
      local ok, message = module.promote(row.item.name)
      f.status:SetText(message or "")
      if ok then button:Hide() end
    end)
    rows[i] = row
  end
  f:SetScript("OnShow", function() module.refresh() end)
  module.refresh()
end

-- Keep the "since" dates current while the officer plays; throttled so a busy roster costs nothing.
local frame = CreateFrame("Frame")
pcall(frame.RegisterEvent, frame, "GUILD_ROSTER_UPDATE")
frame:SetScript("OnEvent", function()
  if clock() - lastScan < 60 then return end
  lastScan = clock()
  pcall(module.observe)
end)

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHelp = ns.commandHelp or {}
ns.commandHandlers.promote = function(args)
  local sub = args and args[2] and args[2]:lower()
  if sub == "rule" then
    module.setRule(args[3], args[4])
    local rule = module.rule()
    if ns.message then ns.message(string.format(L("Rule: rank %s for %d+ days."), rule.fromRank, rule.minDays)) end
  elseif sub == "list" then
    if ns.showCopyText then ns.showCopyText(module.text(), L("Ready to promote")) end
  else module.open() end
end
table.insert(ns.commandHelp, { officer = true, text = "/guilded promote - officers: who is ready to promote, one click each (rule: /guilded promote rule <rank> <days>)" })
