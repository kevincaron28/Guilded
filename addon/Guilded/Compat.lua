-- Compatibility layer: the ONLY place the dungeon system touches WoW APIs.
--
-- WoW Forever runs the modern client with Midnight-era restrictions, and
-- patches can move or remove functions. Every call here checks that the
-- function exists, runs in pcall, ignores "secret" values, and returns nil
-- (or a safe default) instead of erroring. A failure is logged once per
-- feature to /guilded diag, and ns.compat.features() says what works, so one
-- missing API disables one statistic, never the whole system.
--
-- If a patch breaks something, fix it here; nothing else should change.
local addonName, ns = ...
ns = ns or {}

local compat = {}
ns.compat = compat

-- WoW's Lua 5.1 has a global unpack; newer Lua moved it to table.unpack.
local unpack = unpack or table.unpack

local reported = {}

-- Logs a compatibility problem once per feature (not every call).
local function problem(feature, detail)
  if reported[feature] then return end
  reported[feature] = true
  if ns.logDiagnostic then ns.logDiagnostic("COMPAT", feature .. ": " .. tostring(detail)) end
end

local function secret(value)
  return ns.isSecret and ns.isSecret(value)
end

-- Calls fn(...) safely; returns its results, or nothing on failure.
local function try(feature, fn, ...)
  if type(fn) ~= "function" then
    problem(feature, "function missing")
    return nil
  end
  local results = { pcall(fn, ...) }
  if not results[1] then
    problem(feature, results[2])
    return nil
  end
  return unpack(results, 2)
end

local function exists(fn) return type(fn) == "function" end

-- ---------------------------------------------------------------------
-- Time
-- ---------------------------------------------------------------------

-- Server epoch seconds when available: the same clock for every player in
-- the group, so start/end times from different clients agree.
function compat.serverTime()
  local now = exists(GetServerTime) and try("serverTime", GetServerTime) or nil
  if type(now) == "number" and not secret(now) then return now end
  return time()
end

-- ---------------------------------------------------------------------
-- Instance
-- ---------------------------------------------------------------------

-- Current instance, or nil when not in one. `id` is the stable instance
-- (map) id; names are for display only.
function compat.instance()
  if not exists(GetInstanceInfo) then problem("instance", "GetInstanceInfo missing"); return nil end
  local name, instanceType, difficultyId, difficultyName, maxPlayers, _, _, instanceId = try("instance", GetInstanceInfo)
  if not name or secret(name) or secret(instanceId) then return nil end
  if instanceType == "none" or instanceType == nil then return nil end
  return {
    id = tonumber(instanceId),
    name = name,
    type = instanceType,          -- "party" = 5-man dungeon, "raid", "pvp", "arena", "scenario"
    difficultyId = tonumber(difficultyId) or 0,
    difficultyName = difficultyName or "",
    maxPlayers = tonumber(maxPlayers) or 0
  }
end

-- ---------------------------------------------------------------------
-- Group
-- ---------------------------------------------------------------------

local ROLE = { TANK = "TANK", HEALER = "HEALER", DAMAGER = "DPS" }

local function unitInfo(unit)
  if not exists(UnitExists) or not UnitExists(unit) then return nil end
  local name = try("unitName", UnitName, unit)
  if not name or secret(name) then return nil end
  local _, classFile = try("unitClass", UnitClass, unit)
  local guid = exists(UnitGUID) and try("unitGuid", UnitGUID, unit) or nil
  local role = exists(UnitGroupRolesAssigned) and try("groupRoles", UnitGroupRolesAssigned, unit) or nil
  local inGuild = exists(UnitIsInMyGuild) and try("inGuild", UnitIsInMyGuild, unit) or nil
  local online = not exists(UnitIsConnected) or try("online", UnitIsConnected, unit)
  return {
    unit = unit,
    name = ns.normalizeName(name),
    guid = (not secret(guid)) and guid or nil,
    class = (not secret(classFile)) and classFile or nil,
    role = ROLE[role or ""] or nil,
    inGuild = inGuild and true or false,
    online = online and true or false
  }
end

-- You plus your party (or raid) members that exist right now.
function compat.groupMembers()
  local members = {}
  local me = unitInfo("player")
  if me then table.insert(members, me) end
  if exists(IsInRaid) and IsInRaid() then
    local count = exists(GetNumGroupMembers) and try("groupSize", GetNumGroupMembers) or 0
    for i = 1, count or 0 do
      local info = unitInfo("raid" .. i)
      if info and (not me or info.name ~= me.name) then table.insert(members, info) end
    end
  else
    for i = 1, 4 do
      local info = unitInfo("party" .. i)
      if info then table.insert(members, info) end
    end
  end
  return members
end

function compat.isLeader()
  return exists(UnitIsGroupLeader) and try("leader", UnitIsGroupLeader, "player") and true or false
end

function compat.inGroup()
  return exists(IsInGroup) and try("inGroup", IsInGroup) and true or false
end

function compat.inCombat()
  if exists(InCombatLockdown) and try("combat", InCombatLockdown) then return true end
  return exists(UnitAffectingCombat) and try("combat", UnitAffectingCombat, "player") and true or false
end

-- ---------------------------------------------------------------------
-- Encounter Journal: which bosses a dungeon has, so the last one can end
-- the run automatically. Optional: without it, runs end by button.
-- ---------------------------------------------------------------------

local bossCache = {}

-- List of { id = dungeonEncounterId, name } for the current instance, in
-- journal order, or nil if the journal isn't available. Not called in
-- combat (the journal is shared with Blizzard's UI).
function compat.dungeonBosses(instanceId)
  if instanceId and bossCache[instanceId] then return bossCache[instanceId] end
  if compat.inCombat() then return nil end
  if not (exists(EJ_GetInstanceForMap) and exists(EJ_GetEncounterInfoByIndex) and C_Map and exists(C_Map.GetBestMapForUnit)) then
    problem("encounterJournal", "journal API missing")
    return nil
  end
  local mapId = try("encounterJournal", C_Map.GetBestMapForUnit, "player")
  local journalInstance = mapId and try("encounterJournal", EJ_GetInstanceForMap, mapId)
  if not journalInstance or journalInstance == 0 then return nil end
  local bosses = {}
  for index = 1, 40 do
    local name, _, _, _, _, _, dungeonEncounterId = try("encounterJournal", EJ_GetEncounterInfoByIndex, index, journalInstance)
    if not name then break end
    if not secret(name) and tonumber(dungeonEncounterId) then
      table.insert(bosses, { id = tonumber(dungeonEncounterId), name = name })
    end
  end
  if #bosses == 0 then return nil end
  if instanceId then bossCache[instanceId] = bosses end
  return bosses
end

-- ---------------------------------------------------------------------
-- Misc
-- ---------------------------------------------------------------------

function compat.addonVersion()
  if C_AddOns and exists(C_AddOns.GetAddOnMetadata) then return try("version", C_AddOns.GetAddOnMetadata, addonName, "Version") or "0" end
  if exists(GetAddOnMetadata) then return try("version", GetAddOnMetadata, addonName, "Version") or "0" end
  return "0"
end

function compat.interfaceVersion()
  if not exists(GetBuildInfo) then return nil end
  local _, _, _, interface = try("buildInfo", GetBuildInfo)
  return interface
end

-- Registers an event if the client knows it; returns true on success.
function compat.registerEvent(frame, event, optional)
  local ok = pcall(frame.RegisterEvent, frame, event)
  if not ok and not optional then problem("event:" .. event, "event not available") end
  return ok
end

-- Who this character is, tolerant of how the client names things. Other
-- Forever addons report that Forever has no real realms and that names can
-- carry a hyphen, so nothing here assumes a realm exists. Returns the raw
-- values too, so /guilded diag can show exactly what this client says.
function compat.identity()
  local name = exists(UnitName) and try("identity.name", UnitName, "player") or nil
  local realmName = exists(GetRealmName) and try("identity.realm", GetRealmName) or nil
  local normalized = exists(GetNormalizedRealmName) and try("identity.normalized", GetNormalizedRealmName) or nil
  local unitRealm
  if exists(UnitName) then
    local ok, _, r = pcall(UnitName, "player")
    if ok then unitRealm = r end
  end
  local full = exists(GetUnitName) and try("identity.full", GetUnitName, "player", true) or nil
  local function text(value)
    if type(value) == "string" and not secret(value) and value ~= "" then return value end
    return nil
  end
  local realm = text(realmName) or text(normalized) or text(unitRealm) or ""
  return {
    name = text(name) or "Unknown",
    realm = realm,
    hasRealm = realm ~= "",
    raw = { realmName = text(realmName), normalizedRealm = text(normalized), unitNameRealm = text(unitRealm), fullName = text(full) }
  }
end

-- What the dungeon system can and can't do on this client.
function compat.features()
  return {
    instanceInfo = exists(GetInstanceInfo),
    serverTime = exists(GetServerTime),
    groupRoles = exists(UnitGroupRolesAssigned),
    guids = exists(UnitGUID),
    guildCheck = exists(UnitIsInMyGuild),
    encounterJournal = exists(EJ_GetInstanceForMap) and exists(EJ_GetEncounterInfoByIndex) and C_Map ~= nil and exists(C_Map.GetBestMapForUnit),
    addonMessages = (C_ChatInfo ~= nil and exists(C_ChatInfo.SendAddonMessage)) or exists(SendAddonMessage)
  }
end
