-- Optional officer bridge: companion files -> online guildmates, never executable Lua.
local _, ns = ...
local PREFIX, CHUNK, MAX_BYTES, MAX_PARTS = "GuildedBridge", 180, 46080, 256
local pending, lastShare, started, lastGuild = nil, nil, false, nil
local function db() return ns.getDb and ns.getDb() end
local function guildKey()
  if not (IsInGuild and IsInGuild()) then return nil end
  local name = GetGuildInfo and GetGuildInfo("player")
  if type(name) ~= "string" or name == "" or (ns.isSecret and ns.isSecret(name)) then return nil end
  return name .. "-" .. ((GetRealmName and GetRealmName()) or "")
end
local function clock() return ns.util.serverTime() end
local function after(seconds, fn) if C_Timer and C_Timer.After then C_Timer.After(seconds, fn) end end

-- Length-prefixed values; no load/loadstring, and explicit resource bounds in both directions.
local function encode(value, depth, budget)
  depth = depth or 0; budget = budget or { nodes = 0 }
  budget.nodes = budget.nodes + 1
  if depth > 9 or budget.nodes > 6000 then error("bridge data is too large") end
  local kind = type(value)
  if kind == "string" then
    if #value > 4096 then error("bridge string is too long") end
    return "s" .. #value .. ":" .. value
  elseif kind == "number" then
    if value ~= value or math.abs(value) > 1000000000000 then error("invalid bridge number") end
    return "n" .. tostring(value) .. ";"
  elseif kind == "boolean" then return value and "b1" or "b0"
  elseif kind == "table" then
    local keys = {}
    for key in pairs(value) do
      if type(key) ~= "string" and (type(key) ~= "number" or key < 1 or key ~= math.floor(key)) then error("invalid bridge key") end
      table.insert(keys, key)
    end
    table.sort(keys, function(a, b) return type(a) == type(b) and a < b or type(a) < type(b) end)
    local parts = { "t" .. #keys .. ":" }
    for _, key in ipairs(keys) do
      table.insert(parts, encode(key, depth + 1, budget)); table.insert(parts, encode(value[key], depth + 1, budget))
    end
    return table.concat(parts)
  end
  error("unsupported bridge value")
end
local function decode(text)
  if #text > MAX_BYTES then error("bridge data is too large") end
  local at, nodes = 1, 0
  local read
  local function size(delimiter)
    local stop = string.find(text, delimiter, at, true)
    if not stop or stop - at > 20 then error("invalid bridge length") end
    local raw = string.sub(text, at, stop - 1)
    at = stop + 1
    local n = tonumber(raw)
    if not n or n < 0 or n ~= math.floor(n) then error("invalid bridge length") end
    return n
  end
  read = function(depth)
    nodes = nodes + 1
    if depth > 9 or nodes > 6000 then error("bridge data is too large") end
    local tag = string.sub(text, at, at); at = at + 1
    if tag == "s" then
      local n = size(":")
      if n > 4096 or at + n - 1 > #text then error("invalid bridge string") end
      local value = string.sub(text, at, at + n - 1); at = at + n; return value
    elseif tag == "n" then
      local stop = string.find(text, ";", at, true)
      if not stop or stop - at > 24 then error("invalid bridge number") end
      local n = tonumber(string.sub(text, at, stop - 1)); at = stop + 1
      if not n or n ~= n or math.abs(n) > 1000000000000 then error("invalid bridge number") end
      return n
    elseif tag == "b" then
      local flag = string.sub(text, at, at); at = at + 1
      if flag ~= "0" and flag ~= "1" then error("invalid bridge boolean") end
      return flag == "1"
    elseif tag == "t" then
      local n, value = size(":"), {}
      if n > 3000 then error("bridge table is too large") end
      for _ = 1, n do
        local key = read(depth + 1)
        if type(key) ~= "string" and (type(key) ~= "number" or key < 1 or key ~= math.floor(key)) then error("invalid bridge key") end
        if value[key] ~= nil then error("duplicate bridge key") end
        value[key] = read(depth + 1)
      end
      return value
    end
    error("invalid bridge value")
  end
  local value = read(0)
  if at ~= #text + 1 then error("trailing bridge data") end
  return value
end

local function validRaid(raid)
  if raid == false then return true end
  if type(raid) ~= "table" or type(raid.id) ~= "string" or type(raid.title) ~= "string" or type(raid.at) ~= "string" then return false end
  if raid.players ~= nil then
    if type(raid.players) ~= "table" then return false end
    for _, player in pairs(raid.players) do
      if type(player) ~= "table" or type(player.name) ~= "string" or type(player.role) ~= "string" then return false end
    end
  end
  return true
end
local function apply(snapshot, stamp, sender)
  local d, key = db(), guildKey()
  if not d or not key or snapshot.guild ~= key or (d.guildKey and d.guildKey ~= key) then return false end
  if type(snapshot.raids) ~= "table" or not validRaid(snapshot.nextRaid) then return false end
  for _, raid in pairs(snapshot.raids) do if not validRaid(raid) or raid == false then return false end end
  local rules
  if snapshot.loot ~= false then
    if type(snapshot.loot) ~= "table" or not ns.adoptOfficerLootRules then return false end
    local okay
    okay, rules = pcall(ns.adoptOfficerLootRules, snapshot.loot, stamp)
    if not okay then return false end
  end
  d.officerBridge = { updatedAt = stamp, from = sender, snapshot = snapshot }
  -- Never replace a newer companion file's core data with an older broadcast.
  if not d.lootRules or not d.lootRules.updatedAt or d.lootRules.updatedAt < stamp then d.lootRules = rules end
  if not GuildedStandings or not GuildedStandings.updatedAt or GuildedStandings.updatedAt < stamp then
    GuildedNextRaid = snapshot.nextRaid ~= false and snapshot.nextRaid or nil
    GuildedRaids = snapshot.raids
  end
  if ns.onLootChange then pcall(ns.onLootChange) end
  if ns.onCalendarChange then pcall(ns.onCalendarChange) end
  return true
end
local function publicLoot(value, depth)
  if type(value) ~= "table" then return value end
  if (depth or 0) > 9 then error("bridge data is too deep") end
  local copy = {}
  for key, child in pairs(value) do
    -- Discord ownership IDs need not travel in game with core prices and points.
    if key ~= "account" then copy[key] = publicLoot(child, (depth or 0) + 1) end
  end
  return copy
end
local function capture()
  local d, key = db(), guildKey()
  local settings = d and d.settings and d.settings.officerBridge
  if not key or not settings or settings.guild ~= key or not settings.enabled or not ns.isOfficer() then return end
  local file = GuildedStandings
  if type(file) ~= "table" or type(file.updatedAt) ~= "string" then return end
  if d.officerBridge and d.officerBridge.updatedAt >= file.updatedAt then return end
  if type(GuildedLoot) == "table" and (not d.lootRules or not d.lootRules.updatedAt or d.lootRules.updatedAt < file.updatedAt) then
    d.lootRules = ns.adoptOfficerLootRules(GuildedLoot, file.updatedAt)
  end
  local raids = {}
  for _, raid in ipairs(type(GuildedRaids) == "table" and GuildedRaids or {}) do
    -- Native Discord events are filtered for the officer's permissions, not
    -- every guildmate's. Never relay those potentially private events.
    if type(raid.id) == "string" and not string.match(raid.id, "^discord:") then table.insert(raids, raid) end
  end
  -- The officer explicitly binds their companion to this WoW guild with bridge on.
  apply({ guild = key, loot = type(GuildedLoot) == "table" and publicLoot(GuildedLoot) or false,
    nextRaid = type(GuildedNextRaid) == "table" and type(GuildedNextRaid.id) == "string" and not string.match(GuildedNextRaid.id, "^discord:") and GuildedNextRaid or false,
    raids = raids }, file.updatedAt, ns.playerName())
end
local function share()
  capture()
  local d, key = db(), guildKey()
  local settings = d and d.settings and d.settings.officerBridge
  local data = d and d.officerBridge
  if not key or not settings or not settings.enabled or settings.guild ~= key or not ns.isOfficer() or not data or data.snapshot.guild ~= key then return end
  if lastShare and clock() - lastShare < 90 then return end
  local okay, payload = pcall(encode, data.snapshot)
  if not okay or #payload * 2 > MAX_BYTES then ns.message("Officer bridge data is too large to share. Use personal browser sync for now."); return end
  -- ASCII wire data preserves accents/newlines without splitting UTF-8 or sending NUL bytes.
  payload = string.gsub(payload, ".", function(byte) return string.format("%02x", string.byte(byte)) end)
  lastShare = clock()
  local total = math.ceil(#payload / CHUNK)
  for index = 1, total do
    ns.comm.send(PREFIX, "DATA|1|" .. data.updatedAt .. "|" .. index .. "|" .. total .. "|" .. string.sub(payload, (index - 1) * CHUNK + 1, index * CHUNK), "GUILD")
  end
end
local function request()
  local d, key = db(), guildKey()
  if not d or not key then return end
  ns.comm.send(PREFIX, "REQ|1|" .. (d.officerBridge and d.officerBridge.snapshot.guild == key and d.officerBridge.updatedAt or "0"), "GUILD")
end
local function receive(text, sender)
  if not ns.isOfficerName(sender) then return end
  local stamp, index, total, payload = string.match(text, "^DATA|1|([^|]+)|(%d+)|(%d+)|(.*)$")
  index, total = tonumber(index), tonumber(total)
  if not stamp or #stamp > 32 or not string.match(stamp, "^%d%d%d%d%-%d%d%-%d%dT") or ns.util.tooFarAhead(stamp) then return end
  if not index or not total or total < 1 or total > MAX_PARTS or index < 1 or index > total or #payload > CHUNK or #payload % 2 ~= 0 or not string.match(payload, "^%x+$") then return end
  local d, key = db(), guildKey()
  if not d or not key or (d.officerBridge and d.officerBridge.snapshot.guild == key and d.officerBridge.updatedAt >= stamp) then return end
  if pending and clock() - pending.at > 600 then pending = nil end
  -- Keep one bounded assembly. Never combine chunks from competing officers.
  if pending and (pending.sender ~= sender or pending.stamp ~= stamp) then return end
  if not pending then pending = { sender = sender, stamp = stamp, total = total, parts = {}, at = clock() } end
  if pending.total ~= total or (pending.parts[index] and pending.parts[index] ~= payload) then pending = nil; return end
  pending.parts[index] = payload
  for part = 1, total do if not pending.parts[part] then return end end
  local assembled = table.concat(pending.parts); pending = nil
  assembled = string.gsub(assembled, "%x%x", function(pair) return string.char(tonumber(pair, 16)) end)
  local okay, snapshot = pcall(decode, assembled)
  if okay and type(snapshot) == "table" then apply(snapshot, stamp, sender) end
end
ns.commandHandlers["bridge"] = function(args)
  local mode, d, key = string.lower(args[1] or "status"), db(), guildKey()
  if mode == "on" or mode == "off" then
    if not ns.isOfficer() then ns.message("Only an officer can enable the guild's Discord bridge."); return end
    if not d or not key then ns.message("Join your in-game guild before enabling the officer bridge."); return end
    d.settings = d.settings or {}; d.settings.officerBridge = { enabled = mode == "on", guild = key }
    if mode == "on" then capture(); share() end
  elseif mode == "refresh" then request()
  elseif mode ~= "status" then ns.message("/guilded bridge on | off | refresh | status"); return end
  local data = d and d.officerBridge
  ns.message(data and data.snapshot.guild == key and ("Guild data from " .. tostring(data.from) .. " (" .. data.updatedAt .. ").") or "Waiting for an online officer to share Discord guild data. Personal browser sync is optional.")
end
table.insert(ns.commandHelp, "/guilded bridge status | refresh - request core and raid data from an online officer")
table.insert(ns.commandHelp, { officer = true, text = "/guilded bridge on | off - bridge your companion's data to this WoW guild" })
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD"); frame:RegisterEvent("PLAYER_GUILD_UPDATE"); frame:RegisterEvent("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(_, event, ...)
  local eventArgs = { ... }
  local okay, err = pcall(function()
    if event == "PLAYER_ENTERING_WORLD" then
      if started then return end; started = true; ns.comm.register(PREFIX)
      lastGuild = guildKey()
      local d = db()
      if d and d.officerBridge and d.officerBridge.snapshot.guild == guildKey() then
        apply(d.officerBridge.snapshot, d.officerBridge.updatedAt, d.officerBridge.from)
      end
      capture()
      after(10, function() request(); share() end)
      after(130, request); after(310, request) -- Late guild roster / lost chunks / officer login.
    elseif event == "PLAYER_GUILD_UPDATE" then
      local key, d = guildKey(), db()
      if lastGuild ~= key then pending, lastShare = nil, nil end
      if lastGuild and lastGuild ~= key then GuildedNextRaid, GuildedRaids = nil, nil end
      lastGuild = key
      if d and d.officerBridge and d.officerBridge.snapshot.guild == key then
        apply(d.officerBridge.snapshot, d.officerBridge.updatedAt, d.officerBridge.from)
      end
      capture()
      after(10, request)
    elseif event == "CHAT_MSG_ADDON" then
      local prefix, text, channel, sender = unpack(eventArgs)
      if prefix ~= PREFIX or channel ~= "GUILD" or not guildKey() then return end
      if ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender) then return end
      sender = ns.normalizeName(sender)
      if not sender or sender == ns.playerName() or #text > 255 then return end
      if string.match(text, "^REQ|1|") then
        local d = db(); capture()
        local their = string.match(text, "^REQ|1|([^|]+)$")
        if their and d and d.officerBridge and d.officerBridge.updatedAt > their then share() end
      elseif string.match(text, "^DATA|") then receive(text, sender) end
    end
  end)
  if not okay and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Officer bridge: " .. tostring(err)) end
end)
