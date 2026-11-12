-- Guild snapshot (8.5): what the game shows every member about the whole guild, saved for the
-- companion so members who never install Guilded still reach Discord (docs/GUILD_DATA_INVENTORY.md).
--
--   db.guildSnapshot = { at, complete, count, members = { [key] = { level, class, rankName,
--     rankIndex, online, lastOnline } }, motd, info, textAt }
--
-- * Read from the game's own guild roster (GetGuildRosterInfo, GetGuildRosterLastOnline), so it
--   covers every member, with or without the addon. At most once a minute.
-- * `complete` is false when the roster hides offline members: the bot then only adds, never
--   concludes that someone left.
-- * Public and officer notes are NOT kept (personal text; other addons store data there).
-- * MOTD and guild information text, as the game shows them.
-- Nothing is sent to other players; the companion uploads it with the rest of the saved data.
local addonName, ns = ...
ns = ns or {}

local MIN_INTERVAL = 60
local MAX_MEMBERS = 1000

local snapshot = {}
ns.guildSnapshot = snapshot

local function clock() return (GetServerTime and GetServerTime()) or (time and time()) or 0 end
local function secret(value) return ns.isSecret and ns.isSecret(value) end
local function inCombat()
  if ns.compat and ns.compat.inCombat then return ns.compat.inCombat() and true or false end
  if type(InCombatLockdown) == "function" then
    local ok, value = pcall(InCombatLockdown)
    return ok and value == true
  end
  return false
end
local function text(value, limit)
  if type(value) ~= "string" or secret(value) then return nil end
  value = value:gsub("[%c|]", " "):gsub("^%s+", ""):gsub("%s+$", "")
  return value ~= "" and value:sub(1, limit) or nil
end

-- "Online now" or the game's "last online" (years, months, days, hours ago) as a time.
local function lastOnline(index, online, now)
  if online then return now end
  if type(GetGuildRosterLastOnline) ~= "function" then return nil end
  local ok, years, months, days, hours = pcall(GetGuildRosterLastOnline, index)
  if not ok or (years == nil and months == nil and days == nil and hours == nil) then return nil end
  local age = (((tonumber(years) or 0) * 365 + (tonumber(months) or 0) * 30 + (tonumber(days) or 0)) * 24 + (tonumber(hours) or 0)) * 3600
  return now - age
end

-- (9.1.7) The game often names a refused call "UNKNOWN()". The two guild text reads below are marked while they
-- run, so Core's ADDON_ACTION_BLOCKED handler can say which one was running when the refusal was raised. That is
-- only a hint for the message. The reads are switched off for this client build (the MOTD still arrives with the
-- GUILD_MOTD event) only when the game itself names the function.
local function buildKey()
  if type(GetBuildInfo) ~= "function" then return "?" end
  local ok, _, build = pcall(GetBuildInfo)
  return ok and not secret(build) and tostring(build or "?") or "?"
end
local function textBlocked(db) return type(db.guildTextBlocked) == "string" and db.guildTextBlocked == buildKey() end
-- Called by Core only when the game's own event names exactly this function (never from a guess).
function snapshot.onBlocked(name)
  local db = ns.getDb and ns.getDb()
  if db and (name == "GetGuildRosterMOTD" or name == "GetGuildInfoText") then db.guildTextBlocked = buildKey(); return true end
  return false
end
local function guarded(name, fn)
  -- The marker exists only while the call runs: a refusal event raised inside it is named, one that
  -- arrives later is never blamed on this read.
  ns.guardedCall = { name = name }
  local ok, value = pcall(fn)
  ns.guardedCall = nil
  return ok, value
end

-- Reads the whole roster; returns the snapshot, or nil when the roster is not loaded.
function snapshot.read(force)
  local db = ns.getDb and ns.getDb()
  if not db or type(GetNumGuildMembers) ~= "function" or type(GetGuildRosterInfo) ~= "function" then return nil end
  local now = clock()
  local saved = db.guildSnapshot
  if not force and type(saved) == "table" and tonumber(saved.at) and now - saved.at < MIN_INTERVAL then return saved end
  local count = tonumber((GetNumGuildMembers())) or 0
  if count < 1 then return nil end
  local members, kept = {}, 0
  for index = 1, math.min(count, MAX_MEMBERS) do
    local ok, rawName, rankName, rankIndex, level, _, _, _, _, online, _, classFile = pcall(GetGuildRosterInfo, index)
    local key = ok and ns.normalizeName and ns.normalizeName(rawName) or nil
    if key and not secret(rawName) then
      if ns.util and ns.util.rememberDisplayName then ns.util.rememberDisplayName(rawName) end
      local lv, rank = tonumber(level), tonumber(rankIndex)
      members[key] = {
        level = (lv and lv >= 1 and lv <= 100) and math.floor(lv) or nil,
        class = type(classFile) == "string" and classFile:match("^%u+$") and #classFile <= 20 and classFile or nil,
        rankName = text(rankName, 60),
        rankIndex = (rank and rank >= 0 and rank < 20) and math.floor(rank) or nil,
        online = online and true or false,
        lastOnline = lastOnline(index, online, now)
      }
      kept = kept + 1
    end
  end
  if kept == 0 then return nil end
  local showsOffline = true
  if type(GetGuildRosterShowOffline) == "function" then
    local okShow, value = pcall(GetGuildRosterShowOffline)
    if okShow and value == false then showsOffline = false end
  end
  -- WoW Forever refuses the MOTD and guild information reads to addons in combat ("Guilded tried to
  -- call UNKNOWN()" twice per roster update, taint log of 10 November 2026). In combat the texts of
  -- the last snapshot are kept; the next read out of combat refreshes them.
  local motdText, infoText, textAt
  if inCombat() or textBlocked(db) then
    if type(saved) == "table" then motdText, infoText, textAt = saved.motd, saved.info, saved.textAt end
    if snapshot.eventMotd then motdText, textAt = snapshot.eventMotd, now end
  else
    local motdFn = GetGuildRosterMOTD or (C_GuildInfo and C_GuildInfo.GetMOTD)
    local okMotd, motd = guarded("GetGuildRosterMOTD", function() return motdFn and motdFn() end)
    local okInfo, info = guarded("GetGuildInfoText", function() return GetGuildInfoText and GetGuildInfoText() end)
    motdText, infoText, textAt = okMotd and text(motd, 255) or nil, okInfo and text(info, 1000) or nil, now
  end
  local result = { at = now, count = count, complete = showsOffline and count <= MAX_MEMBERS, members = members,
    motd = motdText, info = infoText, textAt = textAt }
  db.guildSnapshot = result
  return result
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("GUILD_ROSTER_UPDATE")
frame:RegisterEvent("GUILD_MOTD")
frame:SetScript("OnEvent", function(_, event, arg1)
  local ok, err = pcall(function()
    -- GUILD_MOTD carries the new text itself: no read needed.
    if event == "GUILD_MOTD" and type(arg1) == "string" and not secret(arg1) then snapshot.eventMotd = text(arg1, 255) end
    if ns.moduleActive and not ns.moduleActive("guildsnapshot") then return end
    snapshot.read(event == "GUILD_MOTD")
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "guild snapshot: " .. tostring(err)) end
end)
