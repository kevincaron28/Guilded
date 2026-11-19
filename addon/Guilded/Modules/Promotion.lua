-- The "Ready to promote" panel and alert for officers (rework of 16 November 2026).
-- Who is ready comes from the Discord bot's rule (GuildedPromotion, written by the companion for officers only):
-- only the members the bot lists in `ready` are offered, and only while their in-game rank is still the rule's
-- starting rank. Without that list the panel falls back to a local rule (rank + days seen on this roster).
-- Nothing is promoted on a timer. When members are ready, a small alert ("N ready to promote") opens this panel;
-- the panel has one Promote button per member and a "Promote next (N left)" button. WoW lets one click run one
-- protected guild action, and RosterTools refuses to stack requests until the roster verified the last one, so
-- the batch is a step-through: one member per click. Each promotion goes through the reviewed RosterTools engine
-- (fresh roster, permission check, audit, verification on the next roster event). The Alt rank is never promoted.
local _, ns = ...
ns = ns or {}
local module = {}
ns.promotion = module
local function L(s) return ns.L and ns.L(s) or s end
local function db() return ns.getDb and ns.getDb() end
local DAY = 86400
local MAX_ROWS = 12
module.MAX_TRIES = 3 -- unverified attempts per member and session before the panel stops offering one-click retries
local lastScan, lastUpdate = -1000, -1000
local tried = {} -- character key -> attempts this session; cleared when the roster verified the promotion
local function nowSeconds() return (GetServerTime and GetServerTime()) or (time and time()) or 0 end
local function clock() return GetTime and GetTime() or 0 end
local function bare(name) return ns.normalizeName and ns.normalizeName(name) or name end
local function outOfCombat()
  if type(InCombatLockdown) ~= "function" then return true end
  local ok, value = pcall(InCombatLockdown)
  return ok and not value
end

-- The bot's rule and list, when the officer's companion wrote them.
local function feed()
  local data = _G.GuildedPromotion
  if type(data) == "table" and type(data.ready) == "table" and type(data.fromRank) == "string" and data.fromRank ~= "" then return data end
end
module.feed = feed

function module.rule()
  local f = feed()
  if f then
    local days, level = tonumber(f.minDays), tonumber(f.minLevel)
    return { fromRank = f.fromRank, minDays = days and math.max(0, math.min(365, math.floor(days))) or 7,
      minLevel = level and math.max(0, math.min(100, math.floor(level))) or 0, fromBot = true }
  end
  local d = db() or {}
  local rule = type(d.promotionRule) == "table" and d.promotionRule or {}
  local days = tonumber(rule.minDays)
  return { fromRank = type(rule.fromRank) == "string" and rule.fromRank ~= "" and rule.fromRank or "Initiate", minDays = days and math.max(0, math.min(365, math.floor(days))) or 7, minLevel = 0 }
end

function module.setRule(fromRank, minDays)
  local d = db(); if not d then return false end
  local tools = ns.rosterTools
  if tools and tools.isAltRank and tools.isAltRank(fromRank) then return false end
  d.promotionRule = d.promotionRule or {}
  if type(fromRank) == "string" and fromRank ~= "" and #fromRank <= 40 then d.promotionRule.fromRank = fromRank end
  if tonumber(minDays) then d.promotionRule.minDays = math.max(0, math.min(365, math.floor(tonumber(minDays)))) end
  return true
end

local function ruleLine(rule)
  if rule.minLevel and rule.minLevel > 0 then return string.format(L("Rule: rank %s for %d+ days, level %d+."), rule.fromRank, rule.minDays, rule.minLevel) end
  return string.format(L("Rule: rank %s for %d+ days."), rule.fromRank, rule.minDays)
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

local function keySet(list)
  local out = {}
  for _, name in ipairs(list or {}) do
    if type(name) == "string" then out[bare(name) or name] = true end
  end
  return out
end

-- An alt rank on either side of the move: never promote.
local function altInvolved(snapshot, row)
  local tools = ns.rosterTools
  if not tools or not tools.isAltRank then return false end
  return tools.isAltRank(row.rankName) or tools.isAltRank(snapshot.rankNames and snapshot.rankNames[row.rank])
end

local function levelOf(row)
  if GetGuildRosterInfo then
    local ok, _, _, _, lvl = pcall(GetGuildRosterInfo, row.index)
    if ok and type(lvl) == "number" then return lvl end
  end
end

-- Who is ready now: { { key, name, display, days, level, rank, fromBot, exhausted } }, longest at the rank first.
-- With the bot's list, ONLY its `ready` members at the rule's starting rank. Without it, the local rule.
function module.ready()
  local tools = ns.rosterTools
  if not tools or not tools.authorized() then return nil, L("Current officer access is required.") end
  local snapshot, err = tools.snapshot()
  if not snapshot then return nil, L(err or "Refresh the full guild roster first.") end
  local d0 = db()
  if d0 and (type(d0.rankSince) ~= "table" or next(d0.rankSince) == nil) then module.observe() end -- afterwards the roster listener keeps it current (60 s throttle)
  local d, rule, f = db() or {}, module.rule(), feed()
  local fromBot = f and keySet(f.ready) or {}
  local out, at = {}, nowSeconds()
  for key, row in pairs(snapshot.rows) do
    if row.rankName:lower() == rule.fromRank:lower() and row.key ~= snapshot.actor.key and not altInvolved(snapshot, row) then
      local seen = d.rankSince and d.rankSince[key]
      local days = seen and seen.rank == row.rankName and math.floor((at - seen.since) / DAY) or 0
      local level = levelOf(row)
      local listed = fromBot[key] == true
      local take
      if f then take = listed and (rule.minLevel == 0 or not level or level >= rule.minLevel)
      else take = days >= rule.minDays end
      if take then
        out[#out + 1] = { key = key, name = row.name, display = row.display, days = days, level = level, rank = row.rankName, fromBot = listed, exhausted = (tried[key] or 0) >= module.MAX_TRIES }
      end
    end
  end
  table.sort(out, function(a, b) if a.days ~= b.days then return a.days > b.days end return a.display < b.display end)
  return out, rule
end

-- One waiting row's text. The bot's optional reason is "link" and/or "voice:<have min>:<need min>" (old feeds have none).
local function reasonText(code)
  local parts = {}
  for part in tostring(code or ""):gmatch("[^,]+") do
    if part == "link" then parts[#parts + 1] = L("needs link")
    else
      local have, need = part:match("^voice:(%d+):(%d+)$")
      if have then
        local function hm(n) n = tonumber(n) or 0; if n >= 60 then return string.format("%d h %02d", math.floor(n / 60), n % 60) end return string.format("%d min", n) end
        parts[#parts + 1] = string.format(L("voice %s / %s"), hm(have), hm(need))
      end
    end
  end
  return table.concat(parts, ", ")
end
local function waitingText(row)
  local why = reasonText(row.reason)
  if why == "" then return string.format(L("%s - waiting (%d days left)"), row.display, row.daysLeft) end
  if (row.daysLeft or 0) > 0 then return string.format(L("%s - waiting (%d days left)"), row.display, row.daysLeft) .. ", " .. why end
  return string.format(L("%s - waiting (%s)"), row.display, why)
end

-- The bot's "not yet" members who are still at the starting rank: { { display, daysLeft } }, soonest first.
function module.waiting()
  local f = feed()
  local tools = ns.rosterTools
  if not f or type(f.waiting) ~= "table" or not tools or not tools.authorized() then return {} end
  local snapshot = tools.snapshot(); if not snapshot then return {} end
  local rule, out = module.rule(), {}
  for _, entry in ipairs(f.waiting) do
    if type(entry) == "table" and type(entry.name) == "string" then
      local row = snapshot.rows[bare(entry.name) or entry.name]
      if row and row.rankName:lower() == rule.fromRank:lower() and not altInvolved(snapshot, row) then
        out[#out + 1] = { display = row.display, daysLeft = tonumber(entry.daysLeft) or 0, reason = type(entry.reason) == "string" and entry.reason or nil }
      end
    end
  end
  table.sort(out, function(a, b) if a.daysLeft ~= b.daysLeft then return a.daysLeft < b.daysLeft end return a.display < b.display end)
  return out
end

-- How many members one-click promotion can still offer (the alert count).
function module.actionable()
  local ready = module.ready()
  local n = 0
  if ready then for _, item in ipairs(ready) do if not item.exhausted then n = n + 1 end end end
  return n, ready
end

-- One member, one click: preview, confirm and send the single reviewed action. The next promotion needs the
-- roster to verify this one first (RosterTools refuses to stack requests).
function module.promote(name)
  local tools = ns.rosterTools
  if not tools or not tools.authorized() then return false, L("Current officer access is required.") end
  if type(name) ~= "string" or name == "" or name:find("[\t\r\n]") then return false, L("Unknown or ambiguous character.") end
  if tools.plan and tools.plan.pending then return false, L("Wait for the roster to confirm the previous promotion.") end
  local snapshot = tools.snapshot()
  local target
  if snapshot then
    for _, row in pairs(snapshot.rows) do
      if row.name:lower() == name:lower() or row.display:lower() == name:lower() then target = row; break end
    end
    if target and altInvolved(snapshot, target) then return false, L("Alts are never promoted.") end
  end
  local plan, err = tools.preview("character\taction\tvalue\n" .. name .. "\tpromote\t")
  if not plan then return false, L(err or "Not applied. Check the preview and confirmation.") end
  if plan.blocked then tools.cancel(); return false, L(plan.rows[1] and plan.rows[1].status or "Permission or rank hierarchy prevents this action.") end
  if not tools.confirm(plan.phrase) then tools.cancel(); return false, L("Not applied. Check the preview and confirmation.") end
  local ok, message = tools.step()
  -- A try counts only when the call was actually issued (sent, or rejected by the game), not when a check refused it.
  if target and (ok or message == "The game rejected the request. Preview again.") then tried[target.key] = (tried[target.key] or 0) + 1 end
  if not ok then return false, L(message or "Not applied. Check the preview and confirmation.") end
  return true, L("Promotion requested. Wait for the roster to confirm it before the next one.")
end

-- "Promote next": the first member the list still offers. Called from a click only.
function module.promoteNext()
  local _, ready = module.actionable()
  if not ready then return false, L("Refresh the full guild roster first.") end
  for _, item in ipairs(ready) do
    if not item.exhausted then return module.promote(item.name) end
  end
  return false, L("Nobody is ready to promote yet.")
end

function module.text()
  local ready, rule = module.ready()
  if not ready then return rule end
  local lines = { ruleLine(module.rule()) }
  if #ready == 0 then lines[#lines + 1] = L("Nobody is ready to promote yet.") end
  for _, row in ipairs(ready) do
    lines[#lines + 1] = string.format("%s%s - %d %s", row.display, row.level and (" " .. row.level) or "", row.days, L("days"))
  end
  for _, row in ipairs(module.waiting()) do
    lines[#lines + 1] = waitingText(row)
  end
  return table.concat(lines, "\n")
end

-- ----- the alert ---------------------------------------------------------------

local alert, dismissedAt
function module.alertEnabled()
  return not ns.officerNotes or not ns.officerNotes.enabled or ns.officerNotes.enabled("promote")
end
function module.updateAlert()
  local tools = ns.rosterTools
  local count = 0
  if tools and ns.isOfficer and ns.isOfficer() and tools.authorized() and module.alertEnabled() and feed() and outOfCombat() then
    count = module.actionable()
  end
  if count == 0 or dismissedAt == count then
    if alert then alert:Hide() end
    if count == 0 then dismissedAt = nil end
    return count
  end
  if not alert then
    alert = CreateFrame("Button", "GuildedPromotionAlert", UIParent, "UIPanelButtonTemplate")
    alert:SetSize(200, 24); alert:SetPoint("TOP", UIParent, "TOP", 0, -140)
    if alert.RegisterForClicks then alert:RegisterForClicks("LeftButtonUp", "RightButtonUp") end
    alert:SetScript("OnClick", function(_, button)
      if button == "RightButton" then dismissedAt = alert.count; alert:Hide() else module.open() end
    end)
  end
  alert.count = count
  alert:SetText(string.format(L("%d ready to promote"), count))
  alert:Show()
  return count
end

-- ----- the panel ---------------------------------------------------------------

local window, rows = nil, {}
function module.refresh()
  if not window then return end
  local ready, rule = module.ready()
  window.status:SetText(ready and ruleLine(module.rule()) or tostring(rule))
  local waiting = ready and module.waiting() or {}
  local shown = 0
  for i = 1, MAX_ROWS do
    local row, item = rows[i], ready and ready[i]
    if item then
      row.label:SetText(string.format("%s%s - %d %s%s%s", item.display, item.level and (" " .. item.level) or "", item.days, L("days"), item.fromBot and " (Discord)" or "",
        item.exhausted and (" - " .. L("Tried several times; promote from the guild roster.")) or ""))
      row.item = item; row.label:Show(); row.button:Show(); shown = i
    else row.item = nil; row.label:Hide(); row.button:Hide() end
  end
  -- Members who are not ready yet fill the free rows, without a button.
  for i = shown + 1, MAX_ROWS do
    local row, entry = rows[i], waiting[i - shown]
    if entry then row.label:SetText(waitingText(entry)); row.label:Show() end
  end
  local actionable = 0
  if ready then for _, item in ipairs(ready) do if not item.exhausted then actionable = actionable + 1 end end end
  window.all:SetText(string.format(L("Promote next (%d left)"), actionable))
  if window.all.SetEnabled then window.all:SetEnabled(actionable > 0) end
  window.empty:SetText(ready and #ready == 0 and L("Nobody is ready to promote yet.") or "")
  window.more:SetText(ready and #ready > MAX_ROWS and string.format(L("+%d more"), #ready - MAX_ROWS) or "")
end

function module.open()
  local tools = ns.rosterTools
  if not tools or not tools.authorized() then if ns.message then ns.message(L("Current officer access is required.")) end; return end
  tools.requestRoster()
  if window then window:Show(); module.refresh(); return end
  local f = CreateFrame("Frame", "GuildedPromotionPanel", UIParent, "BasicFrameTemplateWithInset")
  window = f; f:SetSize(420, 150 + MAX_ROWS * 26); f:SetPoint("CENTER"); f:SetMovable(true); f:EnableMouse(true); f:SetClampedToScreen(true)
  f:RegisterForDrag("LeftButton"); f:SetScript("OnDragStart", f.StartMoving); f:SetScript("OnDragStop", f.StopMovingOrSizing)
  if f.TitleText then f.TitleText:SetText(L("Ready to promote")) end
  if UISpecialFrames then table.insert(UISpecialFrames, "GuildedPromotionPanel") end
  local function text(y, template)
    local t = f:CreateFontString(nil, "OVERLAY", template or "GameFontHighlightSmall")
    t:SetPoint("TOPLEFT", 18, y); t:SetWidth(380); t:SetJustifyH("LEFT"); return t
  end
  f.status = text(-34)
  f.empty = text(-90)
  f.more = text(-120 - MAX_ROWS * 26)
  local all = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  all:SetPoint("TOPLEFT", 18, -52); all:SetSize(230, 24); all:SetText(string.format(L("Promote next (%d left)"), 0))
  all:SetScript("OnClick", function()
    local ok, message = module.promoteNext()
    f.status:SetText(message or "")
    if ok then module.refresh() end
  end)
  f.all = all
  for i = 1, MAX_ROWS do
    local y = -86 - (i - 1) * 26
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

-- Event driven, no timers: every roster event (throttled) keeps the "since" dates, the alert and an open panel
-- current; a verified promotion refreshes at once.
local function onRoster()
  local t = clock()
  if t - lastUpdate < 3 then return end
  lastUpdate = t
  if t - lastScan >= 60 then lastScan = t; pcall(module.observe) end
  pcall(module.updateAlert)
  if window and window:IsShown() then pcall(module.refresh) end
end
local function onVerified(item)
  if item and item.action == "promote" and item.key then
    tried[item.key] = nil
    if ns.officerNotes and ns.officerNotes.markPromoted then ns.officerNotes.markPromoted(item.key, item.name, item.beforeRank) end
  end
  lastUpdate = -1000
  pcall(module.updateAlert)
  if window and window:IsShown() then pcall(module.refresh) end
end
function module.attach()
  local tools = ns.rosterTools
  if not tools or module.attached then return end
  module.attached = true
  table.insert(tools.onRoster, onRoster)
  table.insert(tools.onVerified, onVerified)
end
module.attach()
local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED" }) do pcall(frame.RegisterEvent, frame, event) end
frame:SetScript("OnEvent", function(_, event)
  if event == "PLAYER_REGEN_DISABLED" then if alert then alert:Hide() end
  else lastUpdate = -1000; pcall(module.updateAlert) end
end)

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHelp = ns.commandHelp or {}
ns.commandHandlers.promote = function(args)
  if not (ns.isOfficer and ns.isOfficer()) then
    if ns.message then ns.message(L("Officers only.")) end
    return
  end
  local sub = args and args[2] and args[2]:lower()
  if sub == "rule" then
    if not module.setRule(args[3], args[4]) and ns.message then ns.message(L("Alts are never promoted.")) end
    if ns.message then ns.message(ruleLine(module.rule())) end
  elseif sub == "list" then
    if ns.showCopyText then ns.showCopyText(module.text(), L("Ready to promote")) end
  else module.open() end
end
table.insert(ns.commandHelp, { officer = true, text = "/guilded promote - officers: who is ready to promote, one click each (rule: /guilded promote rule <rank> <days>)" })
