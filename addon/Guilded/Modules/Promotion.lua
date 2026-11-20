-- The "Ready to promote" panel and alert for officers (rework of 16 November 2026).
-- Who is ready comes from the Discord bot's rule (GuildedPromotion, written by the companion for officers only):
-- only the members the bot lists in `ready` are offered, and only while their in-game rank is still the rule's
-- starting rank. Without that list the panel falls back to a local rule (rank + days seen on this roster).
-- Nothing is promoted on a timer. When members are ready, a small alert ("N ready to promote") opens this panel;
-- the panel has one Promote button per member and a "Promote next (N left)" button. WoW lets one click run one
-- protected guild action, and RosterTools refuses to stack requests until the roster verified the last one, so
-- the batch is a step-through: one member per click. Each promotion goes through the reviewed RosterTools engine
-- (fresh roster, permission check, audit, verification on the next roster event). The Alt rank is never promoted.
-- Manual helper (19 Nov 2026): WoW Forever refuses addon guild actions, and an alt rank directly above a member
-- would catch the one-step promote. Then the panel only lists who is ready, opens the guild roster and copies names:
-- the officer promotes by hand. The addon never calls a promotion in that mode.
local _, ns = ...
ns = ns or {}
local module = {}
ns.promotion = module
local function L(s) return ns.L and ns.L(s) or s end
local function db() return ns.getDb and ns.getDb() end
local DAY = 86400
local MAX_ROWS = 12
local ALT_ROWS = 6
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
    local voice = tonumber(f.minVoice)
    return { fromRank = f.fromRank, minDays = days and math.max(0, math.min(365, math.floor(days))) or 7,
      minLevel = level and math.max(0, math.min(100, math.floor(level))) or 0, fromBot = true,
      minVoice = voice and math.max(0, math.min(10080, math.floor(voice))) or nil, requireLink = f.requireLink }
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

-- The rule in one line, from the feed's values (nothing hardcoded): "Promotions need a linked character, 7 days at
-- Initiate and 3 h of voice a week." Only the parts the feed carries are named.
local function requirementLine(rule)
  if not rule.fromBot then return "" end
  local parts = {}
  if rule.requireLink == true then parts[#parts + 1] = L("a linked character") end
  parts[#parts + 1] = string.format(L("%d days at %s"), rule.minDays, rule.fromRank)
  if rule.minVoice and rule.minVoice > 0 then
    local m = rule.minVoice
    parts[#parts + 1] = (m % 60 == 0) and string.format(L("%d h of voice a week"), m / 60) or string.format(L("%d min of voice a week"), m)
  end
  return string.format(L("Promotions need %s."), table.concat(parts, ", "))
end
module.requirementLine = function() return requirementLine(module.rule()) end

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

-- ----- alts and main changes (owner request, 20 Nov 2026; safety review the same day) ------------------------
-- Alt evidence: the bot's `alts` list, which it builds only from a main a member or officer CHOSE (never from a flag
-- that is just the first linked character). A guild/officer note that STARTS with alt / alt of / reroll / twink is shown
-- as information ("maybe an alt") with no button, and never takes anyone out of the promotion list. Nothing at or above
-- the rule's starting rank is ever offered (so no officer), nor the officer's own characters. The move goes to the guild's
-- Alt rank only when a rank whose name passes isAltRank exists; otherwise the officer does it by hand. A demotion needs
-- an explicit second click (armed for ARM_SECONDS). A main change (`swaps`) is a pair: the new main gets the old main's
-- rank, then the old main goes to the Alt rank.
local NOTE_WORDS = { "^%s*alts?%f[%A]", "^%s*reroll%f[%A]", "^%s*re%-roll%f[%A]", "^%s*twinks?%f[%A]", "^%s*r\195\169roll%f[%A]" }
local function noteSaysAlt(note)
  if type(note) ~= "string" or note == "" then return false end
  local t = note:lower()
  for _, pattern in ipairs(NOTE_WORDS) do if t:find(pattern) then return true end end
  return false
end
module.noteSaysAlt = noteSaysAlt
local ARM_SECONDS = 15
local armed -- { key = lowercase name, at = clock } after the first click of a demotion

local function altMap()
  local f, out = feed(), {}
  if f and type(f.alts) == "table" then
    for _, e in ipairs(f.alts) do
      if type(e) == "table" and type(e.name) == "string" then out[bare(e.name) or e.name] = type(e.main) == "string" and e.main or "?" end
    end
  end
  return out
end

local function rankIndexByName(snapshot, name)
  if type(name) ~= "string" then return nil end
  for i = 0, (snapshot.ranks or 0) - 1 do
    local n = snapshot.rankNames and snapshot.rankNames[i + 1]
    if type(n) == "string" and n:lower() == name:lower() then return i end
  end
end
-- Where the rules allow a move: below the officer (actor) and at or below the starting rank, strictly above the Alt rank.
local function limits(snapshot)
  local tools = ns.rosterTools
  local f = feed()
  local fromIdx = f and rankIndexByName(snapshot, f.fromRank)
  local dest = tools.altRankIndex(snapshot)
  return fromIdx, dest
end
local function movable(snapshot, row, fromIdx, dest)
  return fromIdx ~= nil and dest ~= nil and row.key ~= snapshot.actor.key and row.rank > snapshot.actor.rank and row.rank >= fromIdx and row.rank < dest
end

-- Pairs still to do: { { to = row, from = row, rankName, rankIndex, needGive } }. Nothing when there is no Alt rank, the old
-- main is outside the allowed ranks or already in the Alt rank, or either character is the officer's own.
function module.swaps()
  local f, tools = feed(), ns.rosterTools
  local out = {}
  if not f or type(f.swaps) ~= "table" or not tools or not tools.authorized() then return out end
  local snapshot = tools.snapshot(); if not snapshot then return out end
  local fromIdx, dest = limits(snapshot)
  for _, e in ipairs(f.swaps) do
    if type(e) == "table" and type(e.to) == "string" and type(e.from) == "string" then
      local toRow, fromRow = snapshot.rows[bare(e.to) or e.to], snapshot.rows[bare(e.from) or e.from]
      if toRow and fromRow and toRow.key ~= fromRow.key and toRow.key ~= snapshot.actor.key and movable(snapshot, fromRow, fromIdx, dest)
        and toRow.rank > snapshot.actor.rank then
        out[#out + 1] = { to = toRow, from = fromRow, rankName = fromRow.rankName, rankIndex = fromRow.rank, needGive = toRow.rank > fromRow.rank }
      end
    end
  end
  table.sort(out, function(a, b) return a.to.display < b.to.display end)
  return out
end

-- Alts still to move: ({ { key, name, display, main, hint, rankName } }, alreadyInAltRank). Bot alts first; note hints
-- (hint = true) are information only. Excludes the old and new mains of a pending swap.
function module.alts()
  local tools = ns.rosterTools
  if not tools or not tools.authorized() then return {}, 0 end
  local snapshot = tools.snapshot(); if not snapshot then return {}, 0 end
  local fromIdx, dest = limits(snapshot)
  local map, inSwap = altMap(), {}
  for _, s in ipairs(module.swaps()) do inSwap[s.from.key] = true; inSwap[s.to.key] = true end
  local out, done = {}, 0
  for key, row in pairs(snapshot.rows) do
    if key ~= snapshot.actor.key and not inSwap[key] then
      local main = map[key]
      local hint = main == nil and (noteSaysAlt(row.public) or noteSaysAlt(row.officer))
      if main ~= nil and dest ~= nil and row.rank == dest then done = done + 1
      elseif main ~= nil and movable(snapshot, row, fromIdx, dest) then
        out[#out + 1] = { key = key, name = row.name, display = row.display, main = main, hint = false, rankName = row.rankName }
      elseif hint and row.rank > snapshot.actor.rank and (dest == nil or row.rank < dest) then
        out[#out + 1] = { key = key, name = row.name, display = row.display, hint = true, rankName = row.rankName }
      end
    end
  end
  table.sort(out, function(a, b) if a.hint ~= b.hint then return not a.hint end return a.display < b.display end)
  return out, done
end

-- Rows the bot says are alts or part of a main change: never offered for promotion. Notes do NOT exclude anyone.
local function altKeys(snapshot)
  local keys, map = {}, altMap()
  for key in pairs(map) do keys[key] = true end
  for _, s in ipairs(module.swaps()) do keys[s.to.key] = true; keys[s.from.key] = true end
  return keys
end

local ALT_MANUAL_LINE = "Move to the Alt rank from the guild roster: right-click the name, then set the rank to Alt."
-- One rank change, one click: the same reviewed path a promotion uses (fresh roster, permission check, audit, verification,
-- rank-number base calibration, per-build refusal memory). `dest` is a rank index.
function module.changeRank(name, dest)
  local tools = ns.rosterTools
  if not tools or not tools.authorized() then return false, L("Current officer access is required.") end
  if type(name) ~= "string" or name == "" or name:find("[\t\r\n]") then return false, L("Unknown or ambiguous character.") end
  if tools.isBlocked and tools.isBlocked("setrank") then return false, L(ALT_MANUAL_LINE) end
  if tools.plan and tools.plan.pending then return false, L("Wait for the roster to confirm the previous promotion.") end
  local plan, err = tools.preview("character\taction\tvalue\n" .. name .. "\tsetrank\t" .. tostring(dest))
  if not plan then return false, L(err or "Not applied. Check the preview and confirmation.") end
  if plan.blocked then tools.cancel(); return false, L(plan.rows[1] and plan.rows[1].status or "Permission or rank hierarchy prevents this action.") end
  if not tools.confirm(plan.phrase) then tools.cancel(); return false, L("Not applied. Check the preview and confirmation.") end
  local ok, message = tools.step()
  if not ok then return false, L(message or "Not applied. Check the preview and confirmation.") end
  return true, L("Rank change requested. Wait for the roster to confirm it before the next one.")
end

-- True while the first click of this demotion is still waiting for its confirming click.
function module.isArmed(name)
  return armed ~= nil and type(name) == "string" and armed.key == name:lower() and clock() - armed.at <= ARM_SECONDS and clock() >= armed.at
end

-- Moving a character to the Alt rank is a demotion: the first click only arms it, the second click (within ARM_SECONDS)
-- sends it. Refused without an alt-named rank, and into the last rank before the rank numbering has been calibrated.
function module.moveToAlt(name)
  local tools = ns.rosterTools
  local snapshot = tools and tools.authorized() and tools.snapshot()
  if not snapshot then return false, L("Refresh the full guild roster first.") end
  local dest = tools.altRankIndex(snapshot)
  if dest == nil then return false, L(ALT_MANUAL_LINE) end
  if type(name) ~= "string" or name == "" then return false, L("Unknown or ambiguous character.") end
  -- Only what this window lists: a bot alt in the allowed ranks, or the old main of a pending swap. Never a note hint or an officer.
  local listed = false
  for _, a in ipairs((module.alts())) do if not a.hint and a.name:lower() == name:lower() then listed = true end end
  for _, w in ipairs(module.swaps()) do if w.from.name:lower() == name:lower() then listed = true end end
  if not listed then return false, L("Unknown or ambiguous character.") end
  if dest == (snapshot.ranks or 0) - 1 and select(2, tools.rankBase()) ~= true then
    return false, L("Promote someone once first so Guilded can check the rank numbering for this game build, or set the rank from the guild roster.")
  end
  if not module.isArmed(name) then
    armed = { key = name:lower(), at = clock() }
    return false, string.format(L("Click again within %d seconds to confirm: move %s to the Alt rank."), ARM_SECONDS, name)
  end
  armed = nil
  return module.changeRank(name, dest)
end

-- A swap's next step: give the new main the old main's rank first (unless it already ranks as high), then the old main to Alt.
function module.swapStep(swap)
  if swap.needGive then return module.changeRank(swap.to.name, swap.rankIndex) end
  return module.moveToAlt(swap.from.name)
end

function module.altsText()
  local lines = {}
  for _, s in ipairs(module.swaps()) do
    lines[#lines + 1] = string.format(L("%s is now the main (was %s): give rank %s, then move %s to Alt"), s.to.display, s.from.display, tostring(s.rankName), s.from.display)
  end
  local alts, done = module.alts()
  for _, a in ipairs(alts) do
    lines[#lines + 1] = a.hint and string.format(L("%s - maybe an alt (note says alt) (%s)"), a.display, tostring(a.rankName)) or string.format(L("%s - alt of %s (%s)"), a.display, tostring(a.main), tostring(a.rankName))
  end
  if done > 0 then lines[#lines + 1] = string.format(L("%d alts already in the Alt rank"), done) end
  if #lines == 0 then lines[1] = L("No alts to move.") end
  return table.concat(lines, "\n")
end

-- A member whose own rank is an alt rank: never promote. (Until 17 Nov 2026 this also refused when the rank one
-- step up was an alt rank, which dropped every Initiate in a guild that keeps Alt between Member and Initiate;
-- RosterTools now skips the alt rank and lands the promotion on the next real rank.)
local function altInvolved(snapshot, row)
  local tools = ns.rosterTools
  if not tools or not tools.isAltRank then return false end
  return tools.isAltRank(row.rankName)
end

-- Manual mode: this client refuses addon rank changes (remembered per client build), or an alt rank sits directly
-- above a ready member. `ready` is the list module.ready() returned (optional).
function module.manual(ready)
  local tools = ns.rosterTools
  if tools and tools.isBlocked and tools.isBlocked("promote") then return true end
  if ready then for _, item in ipairs(ready) do if item.altInWay then return true end end end
  return false
end
local MANUAL_LINE = "Promote from the guild roster: right-click the name, then Promote (or set the rank to Member)."
function module.openGuildRoster()
  if not outOfCombat() then return false, L("Promote next: not while in combat.") end
  for _, name in ipairs({ "ToggleGuildFrame", "ToggleCommunitiesFrame" }) do
    local fn = _G[name]
    if type(fn) == "function" and pcall(fn) then return true end
  end
  local host = _G.CommunitiesFrame or _G.GuildFrame
  if host and type(_G.ShowUIPanel) == "function" and pcall(_G.ShowUIPanel, host) then return true end
  if host and host.Show and pcall(host.Show, host) then return true end
  return false, L("Open the guild roster with the J key.")
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
  local stats = { rows = 0, atRank = 0, wrongRank = 0, self = 0, alt = 0, notListed = 0, tooLow = 0, listed = 0, fromRank = rule.fromRank, bot = f ~= nil, botNames = 0, botMissing = 0, noTarget = 0 }
  local altSkip = altKeys(snapshot)
  module.lastStats = stats
  if f then for _ in pairs(fromBot) do stats.botNames = stats.botNames + 1 end
    for k in pairs(fromBot) do if not snapshot.rows[k] then stats.botMissing = stats.botMissing + 1 end end end
  for key, row in pairs(snapshot.rows) do
    stats.rows = stats.rows + 1
    if row.rankName:lower() ~= rule.fromRank:lower() then stats.wrongRank = stats.wrongRank + 1
    elseif row.key == snapshot.actor.key then stats.self = stats.self + 1
    elseif altInvolved(snapshot, row) or altSkip[key] then stats.alt = stats.alt + 1
    elseif tools.promoteTarget and tools.promoteTarget(snapshot, row) <= snapshot.actor.rank then stats.noTarget = stats.noTarget + 1
    else
      stats.atRank = stats.atRank + 1
      local seen = d.rankSince and d.rankSince[key]
      local days = seen and seen.rank == row.rankName and math.floor((at - seen.since) / DAY) or 0
      local level = levelOf(row)
      local listed = fromBot[key] == true
      local take
      if f then take = listed and (rule.minLevel == 0 or not level or level >= rule.minLevel)
      else take = days >= rule.minDays end
      if not take then
        if f and not listed then stats.notListed = stats.notListed + 1 else stats.tooLow = stats.tooLow + 1 end
      else
        stats.listed = stats.listed + 1
        out[#out + 1] = { key = key, name = row.name, display = row.display, days = days, level = level, rank = row.rankName, fromBot = listed, exhausted = (tried[key] or 0) >= module.MAX_TRIES,
          altInWay = tools.altInWay and not tools.canSetRank() and tools.altInWay(snapshot, row) or false }
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
  if why == "" then
    if (row.daysLeft or 0) <= 0 then return string.format(L("%s - waiting for the Discord rule"), row.display) end
    return string.format(L("%s - waiting (%d days left)"), row.display, row.daysLeft)
  end
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
  local altSkip = altKeys(snapshot)
  for _, entry in ipairs(f.waiting) do
    if type(entry) == "table" and type(entry.name) == "string" then
      local row = snapshot.rows[bare(entry.name) or entry.name]
      if row and row.rankName:lower() == rule.fromRank:lower() and not altInvolved(snapshot, row) and not altSkip[row.key] then
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
  if tools.isBlocked and tools.isBlocked("promote") then return false, L(tools.blockedMessage("promote")) end
  if tools.plan and tools.plan.pending then return false, L("Wait for the roster to confirm the previous promotion.") end
  local snapshot = tools.snapshot()
  local target
  if snapshot then
    for _, row in pairs(snapshot.rows) do
      if row.name:lower() == name:lower() or row.display:lower() == name:lower() then target = row; break end
    end
    if target and altInvolved(snapshot, target) then return false, L("Alts are never promoted.") end
    if target and tools.altInWay and not tools.canSetRank() and tools.altInWay(snapshot, target) then return false, L(MANUAL_LINE) end
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
  if module.manual(ready) then return false, L(MANUAL_LINE) end
  for _, item in ipairs(ready) do
    if not item.exhausted and not item.altInWay then
      local ok, message = module.promote(item.name)
      return ok, message, item.display
    end
  end
  return false, L("Nobody is ready to promote yet.")
end

-- The key binding (Bindings.xml): one press, one reviewed promotion, out of combat. A key press counts as the
-- hardware event the protected guild call needs; the result is always printed.
function module.onKey()
  local function say(text) if ns.message then ns.message(text) end end
  if not (ns.isOfficer and ns.isOfficer()) then say(L("Officers only.")); return false end
  if not outOfCombat() then say(L("Promote next: not while in combat.")); return false end
  local tools = ns.rosterTools
  if tools and tools.isBlocked and tools.isBlocked("promote") then say(L(MANUAL_LINE)); return false end
  if tools and tools.requestRoster then tools.requestRoster() end
  local ok, message, display = module.promoteNext()
  if ok then say(string.format(L("Promotion requested: %s. Wait for the roster to confirm it before the next one."), display or "?"))
  else say(message or L("Nobody is ready to promote yet.")) end
  return ok
end

-- "/guilded promote test <name>": prints the call a promotion would make (function, roster index, rank number) and
-- calls nothing, so the officer can check it on the real client before clicking. Diagnostic text, English only.
function module.testLines(name)
  local tools = ns.rosterTools
  if not tools or not tools.authorized() then return { "Officer access is required." } end
  if type(name) ~= "string" or name == "" then return { "Usage: /guilded promote test <name>" } end
  local snapshot, err = tools.snapshot()
  if not snapshot then return { tostring(err or "Refresh the full guild roster first.") } end
  local target
  for _, row in pairs(snapshot.rows) do
    if row.name:lower() == name:lower() or row.display:lower() == name:lower() then target = row; break end
  end
  if not target then return { "Not found in the roster: " .. name } end
  local dest = tools.promoteTarget(snapshot, target)
  local function rn(i) return tostring(snapshot.rankNames and snapshot.rankNames[i + 1] or "?") end
  local lines = { string.format("%s: roster index %d, rank index %d (%s), promotion target rank index %d (%s). Calls nothing.", target.display, target.index or -1, target.rank, rn(target.rank), dest, rn(dest)) }
  if tools.altInWay(snapshot, target) then lines[#lines + 1] = "An alt rank is directly above this member." end
  if tools.isBlocked("promote") then lines[#lines + 1] = "This client build refused rank changes before: manual mode."
  elseif dest <= snapshot.actor.rank then lines[#lines + 1] = "No rank below yours to promote into."
  elseif tools.canSetRank() then lines[#lines + 1] = string.format("Would call: %s(%d, %d)  [rank number = rank index + %d; base %s]", tools.RANK_SETTER, target.index or -1, tools.rankNumber(dest), (tools.rankBase()), select(2, tools.rankBase()) and "confirmed" or "not confirmed yet")
  elseif dest == target.rank - 1 then lines[#lines + 1] = string.format("Would call: %s(%q)", tools.LEGACY_PROMOTE, tostring(target.name))
  else lines[#lines + 1] = "Would call nothing: the rank setter is missing and an alt rank is in the way (manual mode)." end
  return lines
end

-- "/guilded promote why": for each filter, how many roster rows it dropped.
function module.why()
  local ready, rule = module.ready()
  if not ready then return { tostring(rule) } end
  local st = module.lastStats or {}
  local lines = { string.format(L("Promote check, rank %s: %d roster rows, %d at another rank, %d you, %d alt rank, %d with no rank to move up to."),
    tostring(st.fromRank), st.rows or 0, st.wrongRank or 0, st.self or 0, st.alt or 0, st.noTarget or 0) }
  if st.bot then
    lines[#lines + 1] = string.format(L("Discord list: %d names, %d not found in the roster. Of %d at the rank: %d not on the list, %d ready."),
      st.botNames or 0, st.botMissing or 0, (st.atRank or 0), st.notListed or 0, st.listed or 0)
  else
    lines[#lines + 1] = string.format(L("No Discord list from the companion: the local rule applies. %d ready."), st.listed or 0)
  end
  return lines
end

function module.text()
  local ready, rule = module.ready()
  if not ready then return rule end
  local lines = { ruleLine(module.rule()) }
  if requirementLine(module.rule()) ~= "" then lines[#lines + 1] = requirementLine(module.rule()) end
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

local window, rows, altRows = nil, {}, {}
function module.refresh()
  if not window then return end
  local ready, rule = module.ready()
  window.status:SetText(ready and ruleLine(module.rule()) or tostring(rule))
  window.req:SetText(requirementLine(module.rule()))
  local waiting = ready and module.waiting() or {}
  local shown = 0
  local manual = module.manual(ready)
  window.manual = manual
  for i = 1, MAX_ROWS do
    local row, item = rows[i], ready and ready[i]
    if item then
      row.button:SetText(manual and L("Copy name") or L("Promote"))
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
  if manual then
    window.all:SetText(L("Open guild roster"))
    if window.all.SetEnabled then window.all:SetEnabled(true) end
    window.tip:SetText(L(MANUAL_LINE))
  else
    window.all:SetText(string.format(L("Promote next (%d left)"), actionable))
    if window.all.SetEnabled then window.all:SetEnabled(actionable > 0) end
    window.tip:SetText(L("Tip: bind a key in Key Bindings > Guilded"))
  end
  -- Alts and main changes, below the promotion rows: one button per row (the next rank change).
  local swaps = ready and module.swaps() or {}
  local alts, altDone = {}, 0
  if ready then alts, altDone = module.alts() end
  local entries = {}
  for _, s in ipairs(swaps) do entries[#entries + 1] = { swap = s } end
  for _, a in ipairs(alts) do entries[#entries + 1] = { alt = a } end
  for i = 1, ALT_ROWS do
    local row, e = altRows[i], entries[i]
    if e and e.swap then
      local s = e.swap
      row.label:SetText(string.format(L("%s is now the main (was %s): give rank %s, then move %s to Alt"), s.to.display, s.from.display, tostring(s.rankName), s.from.display) .. (s.needGive and " (1/2)" or " (2/2)"))
      row.button:SetText(manual and L("Copy name") or (s.needGive and L("Give rank") or (module.isArmed(s.from.name) and L("Confirm") or L("Move to Alt"))))
      row.item = e; row.label:Show(); row.button:Show()
    elseif e and e.alt then
      local a = e.alt
      row.label:SetText(a.hint and string.format(L("%s - maybe an alt (note says alt) (%s)"), a.display, tostring(a.rankName)) or string.format(L("%s - alt of %s (%s)"), a.display, tostring(a.main), tostring(a.rankName)))
      row.button:SetText(manual and L("Copy name") or (module.isArmed(a.name) and L("Confirm") or L("Move to Alt")))
      row.item = e; row.label:Show(); if a.hint then row.button:Hide() else row.button:Show() end
    else row.item = nil; row.label:Hide(); row.button:Hide() end
  end
  window.altHead:SetText((#entries > 0 or altDone > 0) and L("Alts and main changes") or "")
  window.altMore:SetText(#entries > ALT_ROWS and string.format(L("+%d more alts"), #entries - ALT_ROWS) or (altDone > 0 and string.format(L("%d alts already in the Alt rank"), altDone) or ""))
  window.empty:SetText(ready and #ready == 0 and L("Nobody is ready to promote yet.") or "")
  window.more:SetText(ready and #ready > MAX_ROWS and string.format(L("+%d more"), #ready - MAX_ROWS) or "")
end

function module.open()
  local tools = ns.rosterTools
  if not tools or not tools.authorized() then if ns.message then ns.message(tools and tools.accessMessage and tools.accessMessage() or L("Current officer access is required.")) end; return end
  tools.requestRoster()
  if window then window:Show(); if window.Raise then window:Raise() end; module.refresh(); return end
  local f = CreateFrame("Frame", "GuildedPromotionPanel", UIParent, "BasicFrameTemplateWithInset")
  window = f; f:SetSize(420, 250 + MAX_ROWS * 26 + ALT_ROWS * 26); f:SetPoint("CENTER");
  -- Above the Roster admin window (DIALOG), which opens this panel: at the default strata it opened behind it.
  if f.SetFrameStrata then f:SetFrameStrata("DIALOG") end
 f:SetMovable(true); f:EnableMouse(true); f:SetClampedToScreen(true)
  f:RegisterForDrag("LeftButton"); f:SetScript("OnDragStart", f.StartMoving); f:SetScript("OnDragStop", f.StopMovingOrSizing)
  if f.TitleText then f.TitleText:SetText(L("Ready to promote")) end
  if UISpecialFrames then table.insert(UISpecialFrames, "GuildedPromotionPanel") end
  local function text(y, template)
    local t = f:CreateFontString(nil, "OVERLAY", template or "GameFontHighlightSmall")
    t:SetPoint("TOPLEFT", 18, y); t:SetWidth(380); t:SetJustifyH("LEFT"); return t
  end
  f.status = text(-34)
  f.req = text(-50)
  f.req:SetHeight(28)
  f.empty = text(-110)
  f.tip = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  f.tip:SetPoint("BOTTOMLEFT", 18, 12); f.tip:SetWidth(380); f.tip:SetJustifyH("LEFT")
  f.tip:SetText(L("Tip: bind a key in Key Bindings > Guilded"))
  f.tip:SetHeight(30)
  f.more = text(-134 - MAX_ROWS * 26)
  local all = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  all:SetPoint("TOPLEFT", 18, -82); all:SetSize(230, 24); all:SetText(string.format(L("Promote next (%d left)"), 0))
  all:SetScript("OnClick", function()
    if f.manual then
      local opened, why = module.openGuildRoster()
      f.status:SetText(opened and L(MANUAL_LINE) or why or "")
      return
    end
    local ok, message = module.promoteNext()
    f.status:SetText(message or "")
    if ok then module.refresh() end
  end)
  f.all = all
  for i = 1, MAX_ROWS do
    local y = -126 - (i - 1) * 26
    local label = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    label:SetPoint("TOPLEFT", 18, y - 4); label:SetWidth(280); label:SetJustifyH("LEFT")
    local button = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
    button:SetPoint("TOPLEFT", 310, y); button:SetSize(90, 22); button:SetText(L("Promote"))
    local row = { label = label, button = button }
    button:SetScript("OnClick", function()
      if not row.item then return end
      if f.manual then
        if ns.showCopyText then ns.showCopyText(row.item.display, L("Copy name")) end
        f.status:SetText(L(MANUAL_LINE))
        return
      end
      local ok, message = module.promote(row.item.name)
      f.status:SetText(message or "")
      if ok then button:Hide() end
    end)
    rows[i] = row
  end
  -- Alts and main changes (20 Nov 2026).
  local altTop = -150 - MAX_ROWS * 26
  f.altHead = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  f.altHead:SetPoint("TOPLEFT", 18, altTop); f.altHead:SetWidth(380); f.altHead:SetJustifyH("LEFT")
  for i = 1, ALT_ROWS do
    local y = altTop - 18 - (i - 1) * 26
    local label = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    label:SetPoint("TOPLEFT", 18, y - 2); label:SetWidth(285); label:SetJustifyH("LEFT"); label:SetHeight(24)
    local button = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
    button:SetPoint("TOPLEFT", 310, y); button:SetSize(90, 22); button:SetText(L("Move to Alt"))
    local row = { label = label, button = button }
    button:SetScript("OnClick", function()
      local e = row.item; if not e then return end
      local display = e.swap and (e.swap.needGive and e.swap.to.display or e.swap.from.display) or e.alt.display
      if f.manual then
        if ns.showCopyText then ns.showCopyText(display, L("Copy name")) end
        f.status:SetText(L(ALT_MANUAL_LINE))
        return
      end
      local ok, message
      if e.swap then ok, message = module.swapStep(e.swap) else ok, message = module.moveToAlt(e.alt.name) end
      f.status:SetText(message or "")
      if ok then button:Hide() else module.refresh() end
    end)
    altRows[i] = row
  end
  f.altMore = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  f.altMore:SetPoint("TOPLEFT", 18, altTop - 20 - ALT_ROWS * 26); f.altMore:SetWidth(380); f.altMore:SetJustifyH("LEFT")
  f:SetScript("OnShow", function(self) if self.Raise then self:Raise() end; module.refresh() end)
  module.refresh()
end

-- The key binding (Bindings.xml: Options > Keybindings > Guilded).
BINDING_NAME_GUILDED_PROMOTE_NEXT = L("Promote next ready member")
function GuildedPromoteNext_OnKey() return module.onKey() end

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
  elseif sub == "why" then
    if ns.message then for _, line in ipairs(module.why()) do ns.message(line) end end
  elseif sub == "test" then
    local name = table.concat(args, " ", 3)
    if ns.message then for _, line in ipairs(module.testLines(name)) do ns.message(line) end end
  elseif sub == "alts" then
    if ns.showCopyText then ns.showCopyText(module.altsText(), L("Alts and main changes")) end
  elseif sub == "list" then
    if ns.showCopyText then ns.showCopyText(module.text(), L("Ready to promote")) end
  else module.open() end
end
table.insert(ns.commandHelp, { officer = true, text = "/guilded promote - officers: who is ready to promote, one click each (rule: /guilded promote rule <rank> <days>; why: /guilded promote why; a key can promote the next one: Keybindings > Guilded)" })
