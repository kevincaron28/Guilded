-- Opt-in availability. Peers are memory-only. Consent and anonymous aggregates
-- use character SavedVariables, outside the companion's account upload file.
local addonName, ns = ...
ns = ns or {}
local presence = { peers = {} }
ns.presence = presence
local PREFIX, EXPIRE, RETENTION = "GuildedFree", 90, 28 * 86400
local scope, lastSent, elapsed = nil, -1000, 0
local lastState, wasSharing
local function L(text) return ns.L and ns.L(text) or text end
local function secret(v) return ns.isSecret and ns.isSecret(v) end
local function active() return not ns.moduleActive or ns.moduleActive("presence") end
local function call(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, value = pcall(fn, ...)
  if ok and not secret(value) then return value end
end
local function stamp() return call(GetServerTime) or time() end
local function clock() return call(GetTime) or stamp() end
local function combatState()
  if type(InCombatLockdown) ~= "function" then return nil end
  local ok, value = pcall(InCombatLockdown)
  if not ok or secret(value) then return nil end
  return value ~= false and value ~= nil
end
local function context()
  local guild, realm = call(GetGuildInfo, "player"), call(GetRealmName)
  local edition = ns.util and ns.util.gameEdition()
  if type(guild) ~= "string" or guild == "" or type(realm) ~= "string" or not edition or edition == "unknown" then return nil end
  return edition .. ":" .. realm .. ":" .. guild, edition
end
local function state()
  local key, edition = context()
  if key ~= scope then
    presence.peers = {}; scope = key; lastSent = -1000; wasSharing = false; lastState = nil
  end
  if not key then return nil end
  GuildedPresenceDB = type(GuildedPresenceDB) == "table" and GuildedPresenceDB or {}
  local root = GuildedPresenceDB
  root.scopes = type(root.scopes) == "table" and root.scopes or {}
  for k, v in pairs(root.scopes) do
    if type(v) ~= "table" or type(v.seen) ~= "number" or stamp() - v.seen > RETENTION then root.scopes[k] = nil end
  end
  if not root.scopes[key] then
    local keys = {}; for k in pairs(root.scopes) do keys[#keys + 1] = k end
    table.sort(keys, function(a, b) return root.scopes[a].seen < root.scopes[b].seen end)
    for i = 1, #keys - 9 do root.scopes[keys[i]] = nil end
    root.scopes[key] = { share = false, observe = false, keys = false, mode = "F", role = "ANY", hours = {} }
  end
  local s = root.scopes[key]; s.seen = stamp(); s.hours = s.hours or {}
  for hour in pairs(s.hours) do
    if type(hour) ~= "number" or hour < stamp() - RETENTION or hour > stamp() then s.hours[hour] = nil end
  end
  return s, edition
end
local function expire()
  local now = clock()
  for name, row in pairs(presence.peers) do
    if now - row.at >= EXPIRE or now < row.at then presence.peers[name] = nil end
  end
end
function presence.myStatus()
  local s = state(); if not s then return "U" end
  if s.mode == "B" or s.mode == "A" then return s.mode end
  local combat = combatState()
  if combat == nil then return "U" end
  if combat then return "B" end
  local inside = call(IsInInstance)
  if inside == nil then return "U" end
  if inside then return "B" end
  return "F"
end
local function integer(value, maximum)
  return type(value) == "number" and value >= 1 and value <= maximum and value == math.floor(value)
end
-- Retail's owned key, not the active dungeon's key or an alt's inventory.
-- API absence, secret values and nil all remain unknown. Never called on Classic/Forever.
function presence.myKey()
  local s, edition = state()
  if edition ~= "retail" or not s or not s.keys or not s.share or combatState() ~= false or not C_MythicPlus then return nil end
  local map = call(C_MythicPlus.GetOwnedKeystoneChallengeMapID)
  local level = call(C_MythicPlus.GetOwnedKeystoneLevel)
  if integer(map, 1000000) and integer(level, 1000) then return map, level end
  return nil
end
local function send(edition, status, role)
  local text = "1|" .. edition .. "|" .. status .. "|" .. role
  local map, level
  if status ~= "G" then map, level = presence.myKey(); if map then text = text .. "|" .. map .. "|" .. level end end
  local queuedScope, queuedAt = context(), clock()
  -- Throttled packets must not outlive consent, guild context or current status.
  local function stillCurrent()
    local age = clock() - queuedAt
    if age < 0 or age >= 5 or context() ~= queuedScope or not active() or combatState() ~= false then return false end
    local s = state()
    if not s then return false end
    if status == "G" then return not s.share end
    if not s.share or s.role ~= role or presence.myStatus() ~= status then return false end
    if map then
      local currentMap, currentLevel = presence.myKey()
      if currentMap ~= map or currentLevel ~= level then return false end
    end
    return true
  end
  return ns.comm and ns.comm.send(PREFIX, text, "GUILD", nil, stillCurrent)
end
function presence.receive(text, sender, channel)
  if not active() or secret(channel) or channel ~= "GUILD" or secret(text) or secret(sender) then return false end
  local s, edition = state()
  if not s or not (s.share or s.observe) or type(text) ~= "string" or #text > 100 then return false end
  if type(sender) ~= "string" or #sender > 80 or sender:find("[|%c]") or sender == "" then return false end
  local version, remoteEdition, status, role = text:match("^(%d+)|([%l%-]+)|([FBAUG])|([%u]+)$")
  local map, level
  if not version then
    version, remoteEdition, status, role, map, level = text:match("^(%d+)|([%l%-]+)|([FBAU])|([%u]+)|(%d+)|(%d+)$")
    map, level = tonumber(map), tonumber(level)
    if edition ~= "retail" or not integer(map, 1000000) or not integer(level, 1000) then return false end
  end
  if version ~= "1" or remoteEdition ~= edition or not ({ ANY = true, TANK = true, HEALER = true, DPS = true })[role] then return false end
  local key = ns.normalizeName(sender)
  if not key or key == ns.playerName() then return false end
  if status == "G" then presence.peers[key] = nil; return true end
  expire()
  local count = 0; for _ in pairs(presence.peers) do count = count + 1 end
  if count >= 1000 and not presence.peers[key] then return false end
  -- Identity comes only from the actual sender supplied by the game.
  presence.peers[key] = { name = sender, status = status, role = role, at = clock(), keyMap = map, keyLevel = level }
  return true
end
function presence.rows(filter)
  local s = state(); expire()
  if not active() or not s or not (s.share or s.observe) then return {} end
  filter = filter or {}
  local query = type(filter.name) == "string" and filter.name:lower() or ""
  local rows = {}
  for _, row in pairs(presence.peers) do
    if (query == "" or row.name:lower():find(query, 1, true))
      and (not filter.role or filter.role == "ANY" or row.role == filter.role)
      and (not filter.free or row.status == "F")
      and (not filter.minKey or (row.keyLevel and row.keyLevel >= filter.minKey)) then rows[#rows + 1] = row end
  end
  table.sort(rows, function(a, b)
    if a.status == b.status then return a.name < b.name end
    return a.status == "F" or (b.status ~= "F" and a.status < b.status)
  end)
  return rows
end
function presence.tick()
  local s, edition = state(); if not s then return end
  expire()
  if not active() then presence.peers = {}; return end
  local now, combat = clock(), combatState()
  if s.share and combat == false then
    local current = presence.myStatus() .. "|" .. s.role .. "|" .. tostring(s.keys)
    if now - lastSent >= 30 or (current ~= lastState and now - lastSent >= 5) then
      if send(edition, presence.myStatus(), s.role) then lastSent = now; lastState = current; wasSharing = true end
    end
  elseif wasSharing and combat == false and now - lastSent >= 5 then
    if send(edition, "G", "ANY") then lastSent = now; wasSharing = false end
  end
  if not s.observe then return end
  -- One observation every five minutes while this client is running. No backfill.
  local nowEpoch = stamp()
  if type(s.lastSample) == "number" and nowEpoch >= s.lastSample and nowEpoch - s.lastSample < 300 then return end
  s.lastSample = nowEpoch
  local total, free = 0, 0
  for _, row in ipairs(presence.rows()) do total = total + 1; if row.status == "F" then free = free + 1 end end
  if s.share then total = total + 1; if presence.myStatus() == "F" then free = free + 1 end end
  local hour = math.floor(nowEpoch / 3600) * 3600
  local bucket = s.hours[hour] or { samples = 0, total = 0, free = 0 }
  if bucket.samples < 12 then
    bucket.samples = bucket.samples + 1; bucket.total = bucket.total + total; bucket.free = bucket.free + free; s.hours[hour] = bucket
  end
end
function presence.configure(action, value)
  local s = state(); if not s then return false end
  if (action == "share" or action == "observe" or action == "keys") and (value == "on" or value == "off") then
    if action == "keys" and ns.util.gameEdition() ~= "retail" then return false end
    s[action] = value == "on"
    if not s.share and not s.observe then presence.peers = {} end
  elseif action == "status" and ({ free = "F", busy = "B", away = "A" })[value] then s.mode = ({ free = "F", busy = "B", away = "A" })[value]
  elseif action == "role" and ({ any = true, tank = true, healer = true, dps = true })[value] then s.role = value:upper()
  elseif action == "clear" then s.hours = {}; s.lastSample = stamp()
  else return false end
  presence.tick(); return true
end
local STATUS = { F = "Free", B = "Busy", A = "Away", U = "Unknown" }
function presence.describe(filter)
  local s = state(); if not s then return L("Join a guild to use availability.") end
  local lines = { L("Availability sharing") .. ": " .. L(s.share and "On" or "Off") .. " | " .. L("Local observations") .. ": " .. L(s.observe and "On" or "Off"),
    L("My status") .. ": " .. L(STATUS[presence.myStatus()]) .. " / " .. s.role,
    L("Self-reported characters, not unique players. Entries expire after 90 seconds.") }
  if ns.util.gameEdition() == "retail" then lines[#lines + 1] = L("Owned-key sharing") .. ": " .. L(s.keys and "On" or "Off") end
  local rows = presence.rows(filter)
  for i = 1, math.min(#rows, 25) do
    local row = rows[i]
    local keyText = ""
    if row.keyMap then
      local name = C_ChallengeMode and call(C_ChallengeMode.GetMapUIInfo, row.keyMap)
      keyText = " / " .. (type(name) == "string" and name or ("#" .. row.keyMap)) .. " +" .. row.keyLevel
    end
    lines[#lines + 1] = row.name .. " - " .. L(STATUS[row.status]) .. " / " .. L(row.role) .. keyText
  end
  if #rows == 0 then lines[#lines + 1] = L("No fresh opt-in reports. This does not mean nobody is online.") end
  if #rows > 25 then lines[#lines + 1] = L("Showing the first 25 reports.") end
  return table.concat(lines, "\n")
end
-- Only characters already recorded by this installation in the active guild.
-- This is not evidence of current availability or ownership of another sender.
function presence.charactersText()
  local guild, realm = call(GetGuildInfo, "player"), call(GetRealmName)
  local db = ns.getDb and ns.getDb()
  local lines = { L("Characters recorded on this PC in this guild. Last seen, not live availability.") }
  if type(guild) ~= "string" or type(realm) ~= "string" or not db or db.guildKey ~= guild .. "-" .. realm then return lines[1] end
  local rows = {}
  for _, info in pairs(db.myCharacters or {}) do
    if type(info) == "table" and info.gameEdition == ns.util.gameEdition() and type(info.name) == "string" then
      rows[#rows + 1] = (info.displayName or info.name) .. " / " .. (info.realm or "") .. " / " .. (info.class or "") .. " / " .. (info.capturedAt or L("Unknown"))
    end
  end
  table.sort(rows)
  for i = 1, math.min(#rows, 50) do lines[#lines + 1] = rows[i] end
  return table.concat(lines, "\n")
end
function presence.heatmap()
  local s = state(); if not s then return {} end
  local cells = {}
  for hour, bucket in pairs(s.hours) do
    local utc = date("!*t", hour)
    local key = ((utc.wday + 5) % 7) * 24 + utc.hour
    local cell = cells[key] or { samples = 0, total = 0, free = 0 }
    cell.samples = cell.samples + bucket.samples; cell.total = cell.total + bucket.total; cell.free = cell.free + bucket.free; cells[key] = cell
  end
  return cells
end
function presence.activityText()
  local cells, lines = presence.heatmap(), { L("28-day observations (UTC). Average reporting characters per sampled hour; '-' means unknown.") }
  local days = { "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" }
  for day = 0, 6 do
    local hours = {}; for hour = 0, 23 do local c = cells[day * 24 + hour]; hours[#hours + 1] = c and string.format("%.1f", c.total / c.samples) or "-" end
    lines[#lines + 1] = L(days[day + 1]) .. " 00-11: " .. table.concat(hours, " / ", 1, 12)
    lines[#lines + 1] = "      12-23: " .. table.concat(hours, " / ", 13, 24)
  end
  lines[#lines + 1] = L("Only observations made by this client. No names saved or uploaded. Sharing and observation are off by default.")
  return table.concat(lines, "\n")
end
ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers.free = function(args)
  if args[1] == "activity" then ns.showCopyText(presence.activityText(), L("Local activity observations")); return end
  if args[1] == "characters" then ns.showCopyText(presence.charactersText(), L("My recorded characters")); return end
  if args[1] and not presence.configure(args[1], args[2]) then ns.message("/guilded free [share on|off | observe on|off | keys on|off (Retail) | status free|busy|away | role any|tank|healer|dps | activity | clear]"); return end
  ns.message(presence.describe())
end
local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "CHAT_MSG_ADDON", "PLAYER_GUILD_UPDATE" }) do
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event) else pcall(frame.RegisterEvent, frame, event) end
end
frame:SetScript("OnEvent", function(_, event, prefix, text, channel, sender)
  if event == "PLAYER_LOGIN" then if ns.comm then ns.comm.register(PREFIX) end; state()
  elseif event == "CHAT_MSG_ADDON" and not secret(prefix) and prefix == PREFIX then presence.receive(text, sender, channel)
  elseif event == "PLAYER_GUILD_UPDATE" then state() end
end)
frame:SetScript("OnUpdate", function(_, delta)
  elapsed = elapsed + delta
  if elapsed < 5 then return end
  elapsed = 0; presence.tick()
end)
