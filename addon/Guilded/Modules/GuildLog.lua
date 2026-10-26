-- Guild event log: keeps the game's own guild log (invites, joins, promotions, demotions,
-- removals, leaves) beyond the few days and 100 lines the game shows, in this guild's saved
-- data on this PC. Nothing is sent anywhere.
--
--   /guilded guildlog [name]     the latest events, or one player's
--   /guilded guildlog copy       everything kept, to copy
--   /guilded guildlog refresh    ask the game for the log now
--
-- The game gives each event's age in hours, not a timestamp, so times are approximate (to the
-- hour). The same event read again later is recognised and kept once. Clients without the
-- guild log API simply record nothing.
local addonName, ns = ...
ns = ns or {}

local MAX_EVENTS = 2000
local SAME_EVENT_SECONDS = 3 * 3600
local QUERY_EVERY = 30 * 60

local guildLog = {}
ns.guildLog = guildLog

local function L(text) return ns.L and ns.L(text) or text end
local function clock() return ns.util and ns.util.serverTime and ns.util.serverTime() or (time and time()) or 0 end

local function state()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  db.guildLog = db.guildLog or { events = {} }
  return db.guildLog
end

local function available() return type(GetNumGuildEvents) == "function" and type(GetGuildEventInfo) == "function" end

local TYPES = { invite = true, join = true, promote = true, demote = true, remove = true, quit = true }
local ENGLISH = {
  invite = "%s has invited %s to the guild.", join = "%s has joined the guild.",
  promote = "%s has promoted %s to %s.", demote = "%s has demoted %s to %s.",
  remove = "%s has removed %s from the guild.", quit = "%s has quit the guild."
}
local GLOBALS = { invite = "GUILDEVENT_TYPE_INVITE", join = "GUILDEVENT_TYPE_JOIN", promote = "GUILDEVENT_TYPE_PROMOTE",
  demote = "GUILDEVENT_TYPE_DEMOTE", remove = "GUILDEVENT_TYPE_REMOVE", quit = "GUILDEVENT_TYPE_QUIT" }

-- One event as the game's own sentence (its language), else English.
function guildLog.describe(event)
  local template = _G and _G[GLOBALS[event.type] or ""]
  if type(template) ~= "string" then template = ENGLISH[event.type] or "%s %s %s" end
  local ok, text = pcall(string.format, template, event.p1 or "?", event.p2 or "?", event.rank or "?")
  return ok and text or (tostring(event.type) .. " " .. tostring(event.p1))
end

local function same(a, b)
  return a.type == b.type and a.p1 == b.p1 and a.p2 == b.p2 and a.rank == b.rank and math.abs(a.at - b.at) <= SAME_EVENT_SECONDS
end

-- Reads the game's log into saved data; returns how many new events were kept.
function guildLog.read()
  local s = state()
  if not (s and available()) then return 0 end
  local now = clock()
  local count = tonumber(GetNumGuildEvents()) or 0
  local added = 0
  -- The game lists newest last in Classic and newest first elsewhere; ages sort it out.
  for i = 1, math.min(count, 500) do
    local kind, p1, p2, rank, years, months, days, hours = GetGuildEventInfo(i)
    if TYPES[kind] and not (ns.isSecret and (ns.isSecret(p1) or ns.isSecret(p2))) then
      local age = ((tonumber(years) or 0) * 365 + (tonumber(months) or 0) * 30 + (tonumber(days) or 0)) * 86400 + (tonumber(hours) or 0) * 3600
      local event = { type = kind, p1 = p1 and tostring(p1) or nil, p2 = p2 and tostring(p2) or nil, rank = rank ~= nil and tostring(rank) or nil, at = now - age }
      local known = false
      for j = #s.events, math.max(1, #s.events - 300), -1 do
        if same(s.events[j], event) then known = true; break end
      end
      if not known then table.insert(s.events, event); added = added + 1 end
    end
  end
  if added > 0 then
    table.sort(s.events, function(a, b) return a.at < b.at end)
    while #s.events > MAX_EVENTS do table.remove(s.events, 1) end
  end
  s.readAt = now
  return added
end

function guildLog.query()
  if type(QueryGuildEventLog) == "function" then pcall(QueryGuildEventLog) end
end

-- Events about one player (as actor or target), newest first.
function guildLog.find(name, limit)
  local s = state()
  local out, needle = {}, name and string.lower(name) or nil
  for i = #(s and s.events or {}), 1, -1 do
    local e = s.events[i]
    if not needle or string.lower(e.p1 or "") == needle or string.lower(e.p2 or "") == needle
      or string.find(string.lower(e.p1 or ""), needle, 1, true) or string.find(string.lower(e.p2 or ""), needle, 1, true) then
      table.insert(out, e)
      if limit and #out >= limit then break end
    end
  end
  return out
end

local function stamp(at) return date and date("%Y-%m-%d %H:00", at) or tostring(at) end
function guildLog.line(event) return "~" .. stamp(event.at) .. "  " .. guildLog.describe(event) end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["guildlog"] = function(args)
  if ns.moduleActive and not ns.moduleActive("guildlog") then return end
  if not available() then ns.message(L("This game client has no guild event log for addons.")) return end
  local action = string.lower(args[1] or "")
  if action == "refresh" then
    guildLog.query()
    ns.message(L("Asked the game for the guild log; it is saved when it arrives."))
  elseif action == "copy" then
    local lines = {}
    for _, e in ipairs(guildLog.find(nil)) do table.insert(lines, 1, guildLog.line(e)) end
    if ns.showCopyText then ns.showCopyText(table.concat(lines, "\n"), L("Guilded - guild event log")) end
  else
    local events = guildLog.find(args[1] and table.concat(args, " ") or nil, 20)
    if #events == 0 then ns.message(L("No guild events recorded yet. They are read when you log in and every 30 minutes.")) return end
    for i = #events, 1, -1 do ns.message(guildLog.line(events[i])) end
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded guildlog [name] | copy | refresh - the guild's invites, joins, promotions and leaves, kept longer than the game does")

local function tick()
  local active = not ns.moduleActive or ns.moduleActive("guildlog")
  if active and IsInGuild and IsInGuild() then guildLog.query() end
  if C_Timer and C_Timer.After then C_Timer.After(QUERY_EVERY, tick) end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, "GUILD_EVENT_LOG_UPDATE", true)
else pcall(frame.RegisterEvent, frame, "GUILD_EVENT_LOG_UPDATE") end
frame:SetScript("OnEvent", function(_, event)
  local ok, err = pcall(function()
    if ns.moduleActive and not ns.moduleActive("guildlog") then return end
    if event == "PLAYER_LOGIN" then
      if C_Timer and C_Timer.After then C_Timer.After(20, tick) end
    elseif event == "GUILD_EVENT_LOG_UPDATE" then
      guildLog.read()
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "guildlog: " .. tostring(err)) end
end)
