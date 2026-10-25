-- Your EP/GP and loot history, without Discord.
--
--   /guilded history            your last EP/GP entries and loot, asked from an online officer
--   /guilded history <player>   officers: that player's history from this PC's ledger
--
-- Members do not keep the ledger, so a member's addon asks the guild ("REQ|<name>") and one
-- officer whose PC has that player's records whispers back the last entries. Officers wait a
-- moment and stay quiet once another officer has answered ("DONE|<name>"), so a request costs a
-- handful of messages instead of a guild-wide broadcast of everyone's history.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedHist"
local MAX_ENTRIES = 10
local MAX_LOOT = 5
local ANSWER_COOLDOWN = 20
local WAIT_SECONDS = 8

local history = {}
ns.history = history

local function L(text) return ns.L and ns.L(text) or text end
local function db() return ns.getDb and ns.getDb() end
local function now() return (ns.util and ns.util.serverTime and ns.util.serverTime()) or time() end
local function clean(text) return (string.gsub(tostring(text or ""), "[|~;%c]", "")) end
local function day(stamp)
  local epoch = ns.util and ns.util.isoEpoch and ns.util.isoEpoch(stamp)
  return epoch and date("%d/%m", epoch) or ""
end

-- This PC's records for one player: { lines = { "14/10 +10 EP (On time)" ... }, total = n }.
function history.fromLedger(name)
  local d = db()
  local rows = {}
  local account = d and d.epgp and d.epgp[name]
  for _, entry in ipairs(account and account.ledger or {}) do
    if not entry.voided then
      local parts = {}
      if (entry.epAmount or 0) ~= 0 then table.insert(parts, string.format("%+d EP", entry.epAmount)) end
      if (entry.gpAmount or 0) ~= 0 then table.insert(parts, string.format("%+d GP", entry.gpAmount)) end
      table.insert(rows, { at = entry.at or "", text = string.format("%s %s (%s)", day(entry.at), table.concat(parts, ", "), clean(entry.reason)) })
    end
  end
  table.sort(rows, function(a, b) return a.at > b.at end)
  local lines = {}
  for i = 1, math.min(MAX_ENTRIES, #rows) do lines[#lines + 1] = rows[i].text end
  local loot = {}
  for _, row in ipairs(d and d.loot or {}) do
    if row.player == name then table.insert(loot, row) end
  end
  table.sort(loot, function(a, b) return (a.at or "") > (b.at or "") end)
  for i = 1, math.min(MAX_LOOT, #loot) do
    local row = loot[i]
    lines[#lines + 1] = string.format("%s %s: %s%s", day(row.at), L("loot"), clean(row.item), (row.cost or 0) > 0 and (" (" .. row.cost .. " GP)") or "")
  end
  return lines, #rows + #loot
end

local function show(name, lines, source)
  ns.message(string.format(L("History of %s (%s):"), ns.displayName(name), source))
  if #lines == 0 then ns.message(L("Nothing recorded yet.")) end
  for _, line in ipairs(lines) do ns.message("  " .. line) end
end

-- Members: ask the guild; officers: read this PC.
local pending -- { name, lines, at }
function history.request(name)
  local me = ns.playerName()
  name = ns.normalizeName(name) or me
  if ns.isOfficer and ns.isOfficer() then
    local lines = history.fromLedger(name)
    if #lines > 0 or name ~= me then show(name, lines, L("this PC's ledger")) return end
  end
  if not (IsInGuild and IsInGuild()) then ns.message(L("Join a guild first.")) return end
  if name ~= me then ns.message(L("Members can ask for their own history only.")) return end
  pending = { name = name, lines = {}, at = now() }
  ns.comm.send(PREFIX, "REQ|" .. name, "GUILD")
  ns.message(L("Asked the online officers for your history..."))
  if C_Timer and C_Timer.After then
    C_Timer.After(WAIT_SECONDS, function()
      if pending and pending.name == name and #pending.lines == 0 and not pending.done then
        ns.message(L("No officer with your records answered. Try again when an officer is online."))
        pending = nil
      end
    end)
  end
end

-- Officer side.
local answered = {} -- name -> time someone (we or another officer) answered
local function answer(name, sender)
  if answered[name] and now() - answered[name] < ANSWER_COOLDOWN then return end
  local lines = history.fromLedger(name)
  if #lines == 0 then return end
  answered[name] = now()
  ns.comm.send(PREFIX, "DONE|" .. name, "GUILD")
  for i, line in ipairs(lines) do
    ns.comm.send(PREFIX, string.format("ROW|%d|%d|%s", i, #lines, string.sub(line, 1, 220)), "WHISPER", sender)
  end
end

local function onAddon(text, channel, sender)
  local name = ns.normalizeName(sender)
  if not name or name == ns.playerName() then return end
  local kind = string.match(text, "^(%u+)|")
  if kind == "REQ" and channel == "GUILD" then
    local who = ns.normalizeName(string.match(text, "^REQ|(.+)$"))
    -- Only for the player asking, and only officers' PCs hold the ledger.
    if who ~= name or not (ns.isOfficer and ns.isOfficer()) then return end
    -- A short random wait so the officer who answers first is the only one.
    local delay = math.random(1, 30) / 10
    if C_Timer and C_Timer.After then C_Timer.After(delay, function() answer(who, sender) end) else answer(who, sender) end
  elseif kind == "DONE" and channel == "GUILD" then
    if ns.isOfficerName and ns.isOfficerName(name) then answered[ns.normalizeName(string.match(text, "^DONE|(.+)$")) or ""] = now() end
  elseif kind == "ROW" and channel == "WHISPER" then
    if not (pending and ns.isOfficerName and ns.isOfficerName(name)) then return end
    local index, total, line = string.match(text, "^ROW|(%d+)|(%d+)|(.*)$")
    index, total = tonumber(index), tonumber(total)
    if not (index and total) or total > 20 then return end
    pending.from = pending.from or name
    if pending.from ~= name then return end
    pending.lines[index] = line
    local count = 0; for _ in pairs(pending.lines) do count = count + 1 end
    if count >= total then
      pending.done = true
      show(pending.name, pending.lines, string.format(L("from %s's ledger"), name))
      pending = nil
    end
  end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["history"] = function(args) history.request(args[1]) end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded history [player] - your EP/GP and loot history (officers: anyone's), without Discord")

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(_, event, prefix, text, channel, sender)
  if event == "PLAYER_LOGIN" then ns.comm.register(PREFIX) return end
  if prefix ~= PREFIX or (ns.isSecret and (ns.isSecret(text) or ns.isSecret(sender))) then return end
  local ok, err = pcall(onAddon, text, channel, sender)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "history: " .. tostring(err)) end
end)
