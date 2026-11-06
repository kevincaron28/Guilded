-- Login digest: "since your last login" in one chat line, and /guilded digest.
--
-- Reads only what this client already saved (new guild members seen, EPGP
-- ledger entries, finished raids, loot rows), so it needs no new sync. It
-- prints nothing when nothing changed, and nothing at all the first time.
local addonName, ns = ...
ns = ns or {}

local SHOW_DELAY_SECONDS = 6

local function count(map, when)
  local n = 0
  for _, entry in pairs(map or {}) do
    if type(entry) == "table" and when(entry) then n = n + 1 end
  end
  return n
end

-- ISO timestamps ("2026-09-24T00:00:00Z") sort as text, so > is enough.
local function after(value, since)
  return type(value) == "string" and value > since
end

-- Builds the digest lines for everything newer than `since` (ISO string).
local function L(text) return ns.L and ns.L(text) or text end
-- The player's own time (or "today 11:56") instead of raw UTC; the raw text when that is not possible.
local function whenText(iso)
  local text = ns.util and ns.util.whenText and ns.util.whenText(iso)
  return text or iso
end

local function build(db, since)
  local lines = {}
  -- Joined the guild since (raid pugs are in the roster too, with inGuild = false).
  local newMembers = count(db.roster, function(e) return e.inGuild ~= false and after(e.joinedAt or e.firstSeen, since) end)
  if newMembers > 0 then table.insert(lines, string.format(L("%d new guild member(s) seen"), newMembers)) end

  local ledger = 0
  for _, account in pairs(db.epgp or {}) do
    for _, entry in pairs(type(account) == "table" and account.ledger or {}) do
      if type(entry) == "table" and after(entry.at, since) then ledger = ledger + 1 end
    end
  end
  if ledger > 0 then table.insert(lines, string.format(L("%d EPGP change(s)"), ledger)) end

  local raids = count(db.raids, function(e) return after(e.endedAt, since) end)
  if raids > 0 then table.insert(lines, string.format(L("%d raid(s) finished"), raids)) end

  local loot = count(db.loot, function(e) return after(e.at, since) end)
  if loot > 0 then table.insert(lines, string.format(L("%d item(s) looted"), loot)) end
  return lines
end

local module = { build = build }
ns.digest = module

local function state()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  db.digest = db.digest or {}
  if db.digest.enabled == nil then db.digest.enabled = true end
  return db.digest, db
end

-- "Synced via Lebowski, 2 h ago." when a guildmate's companion carries this member's data
-- (Modules/GuildRelay.lua); nothing when this PC runs the companion or none was heard.
local function showVia()
  local ok, text = pcall(function() return ns.relay and ns.relay.viaText and ns.relay.viaText() end)
  if ok and type(text) == "string" then ns.message(text) end
end

local function show(force)
  local digest, db = state()
  if not digest then return end
  if not digest.lastSeen then
    if not force then return end
    ns.message(L("No earlier login recorded yet; the digest starts from now."))
    showVia()
    return
  end
  local lines = build(db, digest.lastSeen)
  if #lines == 0 then
    if force then ns.message(string.format(L("Nothing new since %s."), whenText(digest.lastSeen))); showVia() end
    return
  end
  ns.message(string.format(L("Since your last login (%s): %s."), whenText(digest.lastSeen), table.concat(lines, ", ")))
  showVia()
end
module.show = show

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_LOGOUT")
frame:SetScript("OnEvent", function(_, event)
  local ok, err = pcall(function()
    if ns.moduleActive and not ns.moduleActive("digest") then return end
    local digest = state()
    if not digest then return end
    if event == "PLAYER_LOGIN" then
      if digest.enabled and C_Timer and C_Timer.After then
        C_Timer.After(SHOW_DELAY_SECONDS, function() pcall(show, false) end)
      end
      -- First run: start the clock without printing anything.
      if not digest.lastSeen then digest.lastSeen = ns.now() end
    elseif event == "PLAYER_LOGOUT" then
      digest.lastSeen = ns.now()
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "digest: " .. tostring(err)) end
end)

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["digest"] = function(args)
  if ns.moduleActive and not ns.moduleActive("digest") then return end
  local action = string.lower(args[1] or "")
  local digest = state()
  if action == "on" or action == "off" then
    if digest then digest.enabled = (action == "on") end
    ns.message("Login digest " .. action .. ".")
  else
    show(true)
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded digest [on|off] - what changed since your last login (shown once at login)")
