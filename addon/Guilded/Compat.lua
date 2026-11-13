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

-- A conservative observation. Unsupported, secret, disconnected or distant
-- members are unknown, never credited merely for being online. No coordinates.
function compat.dungeonPresence(unit)
  local instance = compat.instance()
  if not instance or instance.type ~= "party" then return false end
  if unit == "player" then return true end
  if not exists(UnitIsConnected) or not exists(UnitInRange) or not exists(UnitIsVisible) then return nil end
  local online = try("dungeonPresenceOnline", UnitIsConnected, unit)
  if secret(online) or online ~= true then return nil end
  local visible = try("dungeonPresenceVisible", UnitIsVisible, unit)
  local inRange, checked = try("dungeonPresenceRange", UnitInRange, unit)
  if secret(visible) or secret(inRange) or secret(checked) then return nil end
  if visible == true and checked == true and inRange == true then return true end
  return nil
end

local function unitInfo(unit)
  if not exists(UnitExists) or not UnitExists(unit) then return nil end
  ns.util.unitDisplayName(unit)
  local name = ns.util.unitKey(unit)
  if not name or secret(name) then return nil end
  local _, classFile = try("unitClass", UnitClass, unit)
  local guid = exists(UnitGUID) and try("unitGuid", UnitGUID, unit) or nil
  local role = exists(UnitGroupRolesAssigned) and try("groupRoles", UnitGroupRolesAssigned, unit) or nil
  local inGuild = exists(UnitIsInMyGuild) and try("inGuild", UnitIsInMyGuild, unit) or nil
  local level = exists(UnitLevel) and try("unitLevel", UnitLevel, unit) or nil
  if secret(level) or type(level) ~= "number" or level < 1 or level > 100 then level = nil end
  local online = not exists(UnitIsConnected) or try("online", UnitIsConnected, unit)
  -- (9.3) The guild this player belongs to, as the game reports it for the unit (nil when none or not
  -- known yet, for example out of range). A plain read, the same kind as the lines above.
  local guild = exists(GetGuildInfo) and try("unitGuild", GetGuildInfo, unit) or nil
  if secret(guild) or type(guild) ~= "string" or guild == "" or #guild > 80 then guild = nil end
  return {
    unit = unit, level = level, guild = guild,
    name = ns.normalizeName(name),
    guid = (not secret(guid)) and guid or nil,
    class = (not secret(classFile)) and classFile or nil,
    role = ns.util.dungeonRole(role),
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

-- Forever dungeons may not be exposed through the Encounter Journal.
-- IDs confirmed in the owner's saved runs: Hall of Thanes (13 Oct 2026)
-- and Deadmines / Edwin VanCleef (14 Oct 2026).
-- Numeric identities work independently of the client's locale.
local finalBossFallbacks = {
  [36] = 2747,
  [389] = 2735,  -- Bazzalan, seen in the owner's Ragefire Chasm run of 5 Nov 2026
  [3065] = 3496
}

-- Forever reports its own encounter ids (Ragefire Chasm 2732-2735, not the Classic Era
-- 6xx/29xx ids in the sourced catalog), and the ids of most dungeons are not confirmed yet.
-- A successful final-boss kill is therefore also recognised by NAME inside the matching
-- instance (English and French, case-insensitive); the instance id comes from the client.
-- The first run that goes unrecognised is kept in full (see Dungeon.lua recovery) and can
-- be completed afterwards once its id or name is added here.
local foreverFinalBossNames = {
  [389] = { "Bazzalan" },
  [43]  = { "Mutanus the Devourer", "Mutanus le D\195\169voreur" },
  [36]  = { "Edwin VanCleef" },
  [33]  = { "Archmage Arugal", "Archimage Arugal" },
  [34]  = { "Bazil Thredd" },
  [48]  = { "Aku'mai" },
  [129] = { "Amnennar the Coldbringer", "Amnennar le Porte-Froid" },
  [90]  = { "Mekgineer Thermaplugg", "M\195\169kgin\195\169er Thermaplugg" },
  [47]  = { "Charlga Razorflank" },
  [70]  = { "Archaedas" },
  [3065] = { "Durgen Dirgehammer" },
  -- Forever-only dungeons, from the community guides of 7 Nov 2026 (no saved run yet; English
  -- names only until a French client reports them). Ruins of Lordaeron's secret boss Viktor
  -- the Vile and Dalaran's Lyn the Ignored are optional, so they do not end the run.
  [2999] = { "Rath'mael" },
  [2998] = { "Relic Guardian" },
  [2959] = { "Shade of the Archmage" }
}

local function lowerName(value)
  if type(value) ~= "string" or secret(value) then return nil end
  return (string.lower(value):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function foreverFinalName(instanceId, name)
  local wanted, aliases = lowerName(name), foreverFinalBossNames[instanceId]
  if not wanted or not aliases then return false end
  for _, alias in ipairs(aliases) do
    if lowerName(alias) == wanted then return true end
  end
  return false
end

-- Diagnostic for /guilded dungeon check and run recovery.
function compat.isForeverFinalBossName(instanceId, name) return foreverFinalName(instanceId, name) end

-- (9.1.7) True when this client already knows which boss ends the instance (by name or id), so a run
-- that stops earlier is simply unfinished, not an unknown dungeon.
function compat.dungeonFinalKnown(instanceId)
  if type(instanceId) ~= "number" then return false end
  return (foreverFinalBossNames[instanceId] ~= nil) or (finalBossFallbacks[instanceId] ~= nil)
end

function compat.isDungeonFinalBoss(instanceId, encounterId, name, difficultyId)
  if ns.dungeonRoutes and not secret(encounterId) and not secret(difficultyId)
    and ns.dungeonRoutes.sourceFinal(instanceId, difficultyId, tonumber(encounterId)) then return true end
  if ns.dungeonRoutes and not secret(encounterId) and not secret(name) and not secret(difficultyId)
    and ns.dungeonRoutes.matchesFinal(ns.dungeonRoutes.verified, instanceId, difficultyId, tonumber(encounterId), name) then return true end
  -- Scarlet wings share map 189. English/French event names identify their endpoints
  -- (the same names the bot uses to tell the wings apart); unknown names still use the
  -- native journal when available.
  if ns.util.isForever() and instanceId == 189 and not secret(name) and type(name) == "string" then
    local bosses = { ["Bloodmage Thalnos"]=true, ["Mage de sang Thalnos"]=true,
      ["Arcanist Doan"]=true, ["Arcaniste Doan"]=true, ["Herod"]=true, ["H\195\169rode"]=true,
      ["High Inquisitor Whitemane"]=true, ["Grande Inquisitrice Blanchet\195\170te"]=true }
    if bosses[name] then return true end
  end
  if ns.util.isForever() and foreverFinalName(instanceId, name) then return true end
  local boss = ns.util.isForever() and finalBossFallbacks[instanceId] or nil
  if not boss then return false end
  return not secret(encounterId) and tonumber(encounterId) == boss
end

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
  local realm = ns.util.isForever() and (text(realmName) or text(normalized) or "")
    or (text(normalized) or text(realmName) or text(unitRealm) or "")
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
