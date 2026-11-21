-- World PvP stats (9.0): kills, deaths, defends and calls answered, kept per player and per week.
--
--   /guilded worldpvp     my numbers this week and in total (also /guilded wpvp)
--
-- Only what the game and Guilded already tell us, with no combat log (restricted on Forever):
--   kills     the game's own honorable-kill line (CHAT_MSG_COMBAT_HONOR_GAIN), outside instances and
--             battlegrounds, read from the client's global string so every language works
--   deaths    I died within a minute of an attack by an enemy player that Call for help confirmed (never in an instance,
--             battleground, arena or duel; the zone and time are kept, never the enemy's name or class)
--   places    each kill and death also keeps the map id and my position on it (0..1, 4 decimals), read with plain map calls;
--             where the game refuses it (combat, instances) the last position seen before is used and marked approximate
--   defends   an honorable kill within 5 minutes of pressing On my way on a guildmate's call, in the zone the call named
--   calls     calls for help I made, how many a guildmate answered, and how many I answered
-- Stored in the saved variables as worldPvp (totals, the current week, the week before, the last 30 kills and the newest
-- events with their places) so the companion can carry it to the Discord PvP ladder and the public pages of guilds that
-- publish. Nothing is sent from here. With the module off nothing is recorded and the stored events are dropped.
local _, ns = ...
local wp = {}
ns.worldPvp = wp

local DEFEND_SECONDS = 300
local DEATH_WINDOW_SECONDS = 60
local DEDUPE_SECONDS = 5
local RECENT = 30
local MAX_ZONES = 25
local EVENTS_KEEP = 500
local EVENTS_MAX_AGE = 30 * 86400
local SAMPLE_SECONDS = 5
local STALE_SECONDS = 60
local WEEK = 7 * 86400
local WEEK_OFFSET = 5 * 86400 + 15 * 3600 -- Tuesday 15:00 UTC, counted from the epoch (a Thursday)

local function L(text) return ns.L and ns.L(text) or text end
local function active() return not ns.moduleActive or ns.moduleActive("worldpvp") end
local function epoch() local ok, v = pcall(GetServerTime); return ok and tonumber(v) or time() end
local function clock()
  local ok, v = pcall(GetTime)
  return ok and type(v) == "number" and v or time()
end
local function inInstance()
  if not IsInInstance then return false end
  local ok, inside = pcall(IsInInstance)
  return ok and inside == true
end
local function clean(text, limit)
  text = tostring(text or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("[|;~%c]", ""):gsub("^%s+", ""):gsub("%s+$", "")
  return string.sub(text, 1, limit or 40)
end

local FIELDS = { "kills", "deaths", "defends", "calls", "answered", "responded" }
local function blank()
  local t = {}
  for _, field in ipairs(FIELDS) do t[field] = 0 end
  return t
end

-- The saved table, with the week rolled over when a new one has begun.
local function store()
  local db = ns.getDb and ns.getDb()
  if type(db) ~= "table" then return nil end
  local s = type(db.worldPvp) == "table" and db.worldPvp or {}
  db.worldPvp = s
  s.total = type(s.total) == "table" and s.total or blank()
  s.recent = type(s.recent) == "table" and s.recent or {}
  local key = math.floor((epoch() - WEEK_OFFSET) / WEEK)
  if type(s.week) ~= "table" or s.weekKey ~= key then
    -- The week just ended is kept (db.worldPvp.prev) so a session that crossed the Tuesday reset still uploads it.
    if type(s.week) == "table" and tonumber(s.weekKey) == key - 1 then s.prev = { weekKey = s.weekKey, week = s.week } end
    s.week, s.weekKey = blank(), key
  end
  if type(s.prev) == "table" and tonumber(s.prev.weekKey) ~= key - 1 then s.prev = nil end
  s.since = s.since or epoch()
  return s
end

function wp.weekKey(t) return math.floor(((t or epoch()) - WEEK_OFFSET) / WEEK) end

local function bump(field, amount)
  local s = store()
  if not s then return false end
  amount = amount or 1
  s.total[field] = (tonumber(s.total[field]) or 0) + amount
  s.week[field] = (tonumber(s.week[field]) or 0) + amount
  return true
end

-- ---------------------------------------------------------------------
-- Reading the honorable-kill line
-- ---------------------------------------------------------------------

local function esc(text) return (text:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0")) end
-- "%s dies, honorable kill Rank: %s (%d Honor Points)" -> a pattern whose first capture is the victim.
local function compile(format)
  if type(format) ~= "string" or format == "" then return nil end
  local parts, pos, count = { "^" }, 1, 0
  while true do
    local s, e = format:find("%%%d*%$?[%d%.]*[sdf]", pos)
    if not s then parts[#parts + 1] = esc(format:sub(pos)); break end
    parts[#parts + 1] = esc(format:sub(pos, s - 1))
    count = count + 1
    parts[#parts + 1] = count == 1 and "(.-)" or ".-"
    pos = e + 1
  end
  parts[#parts + 1] = "$"
  return count >= 1 and table.concat(parts) or nil
end

-- Built only from the client's own global strings (never a hard-coded English fallback): text that cannot be read or matched
-- gives no name, and the kill still counts through the statistic.
local patterns = {}
local function honorPatterns()
  local list = {}
  for _, key in ipairs({ "COMBATLOG_HONORGAIN", "COMBATLOG_HONORGAIN_NO_RANK" }) do
    local format = _G[key]
    if type(format) == "string" and not (ns.isSecret and ns.isSecret(format)) then
      if patterns[format] == nil then patterns[format] = compile(format) or false end
      if patterns[format] then list[#list + 1] = patterns[format] end
    end
  end
  return list
end
function wp.victim(text)
  if type(text) ~= "string" or (ns.isSecret and ns.isSecret(text)) then return nil end
  for _, pattern in ipairs(honorPatterns()) do
    local ok, name = pcall(string.match, text, pattern)
    name = ok and name and clean(name, 40)
    if name and name ~= "" then return name end
  end
  return nil
end

-- ---------------------------------------------------------------------
-- Recording
-- ---------------------------------------------------------------------

local lastKill, lastDeathAt
local defendingUntil, defendingZone, defendingMap

local function inCombat()
  if ns.compat and ns.compat.inCombat then return ns.compat.inCombat() == true end
  if not InCombatLockdown then return false end
  local ok, value = pcall(InCombatLockdown)
  return ok and value == true
end
local function round4(value) return math.floor(value * 10000 + 0.5) / 10000 end

-- My map id and position on it with plain map calls (never a protected function); the position is nil where the game does not give
-- one (instances, a refusal, secret values), the map id alone may still be known.
-- The map is whatever GetBestMapForUnit returns: in a capital city that is the city map with city-local coordinates (the website
-- has the cities' rectangles), and in a cave or micro-dungeon the game may return another map type; the id is kept as it comes and
-- the website places it with the rectangles from /guilded probe maps.
local function readPosition()
  if inInstance() then return nil end
  if not (C_Map and C_Map.GetBestMapForUnit and C_Map.GetPlayerMapPosition) then return nil end
  local ok, mapId = pcall(C_Map.GetBestMapForUnit, "player")
  if not ok or type(mapId) ~= "number" or mapId <= 0 or (ns.isSecret and ns.isSecret(mapId)) then return nil end
  local okPos, position = pcall(C_Map.GetPlayerMapPosition, mapId, "player")
  if not okPos or not position then return mapId end
  local okXY, x, y = pcall(function() return position:GetXY() end)
  if not okXY or type(x) ~= "number" or type(y) ~= "number" or (ns.isSecret and (ns.isSecret(x) or ns.isSecret(y))) then return mapId end
  if x < 0 or x > 1 or y < 0 or y > 1 or (x == 0 and y == 0) then return mapId end
  return mapId, round4(x), round4(y)
end

-- The last position seen out of combat (sampled on a zone change and every few seconds), for the moments the game refuses it.
local lastPlace
function wp.sample()
  if not active() or inCombat() then return false end
  local mapId, x, y = readPosition()
  if mapId and x then lastPlace = { m = mapId, x = x, y = y, at = clock() } end
  return mapId ~= nil
end

-- Where a kill or death happened: { m, x, y, a } with a = true when the position is the last one seen before (approximate).
function wp.where()
  local mapId, x, y = readPosition()
  if mapId and x then return { m = mapId, x = x, y = y } end
  if lastPlace and clock() - lastPlace.at <= STALE_SECONDS and (not mapId or mapId == lastPlace.m) then
    return { m = lastPlace.m, x = lastPlace.x, y = lastPlace.y, a = true }
  end
  return mapId and { m = mapId } or {}
end

-- One kill or death in the newest-events list: kind, time, zone text and place. Bounded by count and by age.
local function addEvent(s, kind, zone, at, place)
  s.events = type(s.events) == "table" and s.events or {}
  local list = s.events
  -- s: an id kept with the event, so every upload of the same event carries the same number (a counter, kept below 2^30).
  s.seq = ((tonumber(s.seq) or 0) % 1073741823) + 1
  list[#list + 1] = { k = kind, t = at, z = zone, m = place.m, x = place.x, y = place.y, a = place.a and 1 or nil, s = s.seq }
  local kept = {}
  for _, e in ipairs(list) do
    if type(e) == "table" and tonumber(e.t) and at - e.t <= EVENTS_MAX_AGE then kept[#kept + 1] = e end
  end
  while #kept > EVENTS_KEEP do table.remove(kept, 1) end
  s.events = kept
end

local function currentZone()
  local zone = GetRealZoneText and GetRealZoneText() or ""
  if type(zone) ~= "string" or (ns.isSecret and ns.isSecret(zone)) then return "" end
  return zone
end

local function currentMap()
  if not (ns.guildMap and ns.guildMap.myPosition) then return nil end
  local ok, mapId = pcall(ns.guildMap.myPosition)
  return ok and tonumber(mapId) or nil
end

-- Inside the 5 minutes after On my way, and where the call was. The map id decides when both sides know it (the zone name
-- is the caller's language: a French helper and an English caller never share one); otherwise the name, cut like the call
-- cuts it (28 characters). A call without a place counts anywhere.
function wp.defending()
  if defendingUntil == nil or clock() > defendingUntil then return false end
  if defendingMap then
    local mine = currentMap()
    if mine then return mine == defendingMap end
  end
  if defendingZone == nil then return defendingMap == nil end
  return clean(currentZone(), 28) == defendingZone
end

-- ---------------------------------------------------------------------
-- Who was killed: enrichment only. The honorable-kills statistic stays the one count; what follows only attaches a name, class,
-- level and guild to a kill that was already counted. Three sources, in order: the honor line, PARTY_KILL, and the last enemy
-- player seen dying at the target, mouseover or a nameplate. All reads are guarded and tolerate secret values.
-- ---------------------------------------------------------------------
local ATTRIBUTION_SECONDS = 3   -- the honor line or PARTY_KILL and the statistic announce the same kill within this
local DEATH_SECONDS = 5         -- an enemy player seen dying this recently is the likely victim
local SEEN_KEEP_SECONDS = 30
local SEEN_MAX = 20
local FEIGN_SECONDS = 4         -- a unit that is alive again this soon feigned death
local DUEL_SECONDS = 60         -- a duel request nobody accepts stops counting as a duel after this long

local seen = {}                 -- key -> { name, class, level, guild, zone, m, at, diedAt, used }
local lineVictim, partyVictim   -- { name, at }
local lastRow                   -- the newest counted kill: { row, at, src }
local duelUntil

local function readable(value) return value ~= nil and not (ns.isSecret and ns.isSecret(value)) end
local function isTrue(fn, ...)
  if not fn then return false end
  local ok, value = pcall(fn, ...)
  return ok and readable(value) and value == true
end
local function dueling() return duelUntil ~= nil and clock() < duelUntil end

-- The full name of a unit ("First Last" on Forever) through the repo's own helpers; nil when unreadable.
local function unitName(unit)
  local ok, first, second = pcall(UnitName, unit)
  if not ok or type(first) ~= "string" or not readable(first) or first == "" then return nil end
  local full = first
  if type(second) == "string" and readable(second) and second ~= "" and ns.util and ns.util.isForever and ns.util.isForever() then
    full = first .. " " .. second
  end
  if ns.util and ns.util.characterKey then
    local okKey, key = pcall(ns.util.characterKey, full)
    if okKey and type(key) == "string" and key ~= "" then full = key end
  end
  return clean(full, 40)
end

local function prune(t)
  local count = 0
  for key, e in pairs(seen) do
    if t - e.at > SEEN_KEEP_SECONDS then seen[key] = nil else count = count + 1 end
  end
  while count > SEEN_MAX do
    local oldestKey, oldestAt
    for key, e in pairs(seen) do
      if not oldestAt or e.at < oldestAt then oldestKey, oldestAt = key, e.at end
    end
    if not oldestKey then break end
    seen[oldestKey] = nil
    count = count - 1
  end
end

local function isUnitToken(unit)
  return unit == "target" or unit == "mouseover" or (type(unit) == "string" and unit:sub(1, 9) == "nameplate")
end

-- Looks at one unit (target, mouseover, nameplate): an enemy player of the other faction, never a mind-controlled one. Remembers
-- who it is and when it was seen, and when it was seen dead (alive again within FEIGN_SECONDS = Feign Death, not a death).
function wp.observe(unit)
  if not active() or inInstance() or dueling() or not isUnitToken(unit) then return false end
  return pcall(function()
    if not isTrue(UnitExists, unit) or not isTrue(UnitIsPlayer, unit) then return end
    if not (isTrue(UnitIsEnemy, "player", unit) or isTrue(UnitCanAttack, "player", unit)) then return end
    if isTrue(UnitIsMindControlled, unit) or isTrue(UnitIsCharmed, unit) then return end
    local theirs = UnitFactionGroup and UnitFactionGroup(unit)
    local mine = UnitFactionGroup and UnitFactionGroup("player")
    if readable(theirs) and readable(mine) and theirs ~= nil and theirs == mine then return end
    local name = unitName(unit)
    if not name then return end
    local guid = UnitGUID and UnitGUID(unit)
    local key = (type(guid) == "string" and readable(guid) and guid ~= "") and guid or name:lower()
    local t = clock()
    local e = seen[key]
    if not e then e = { name = name }; seen[key] = e end
    e.name, e.at = name, t
    local class = UnitClass and select(2, UnitClass(unit))
    if type(class) == "string" and readable(class) then e.class = clean(class, 20) end
    local level = UnitLevel and UnitLevel(unit)
    if type(level) == "number" and readable(level) and level > 0 then e.level = level end
    local guild = GetGuildInfo and GetGuildInfo(unit)
    if type(guild) == "string" and readable(guild) and guild ~= "" then e.guild = clean(guild, 40) end
    e.zone = clean(currentZone(), 40)
    local okMap, mapId = pcall(function() return C_Map and C_Map.GetBestMapForUnit and C_Map.GetBestMapForUnit("player") end)
    if okMap and type(mapId) == "number" and readable(mapId) and mapId > 0 then e.m = mapId end
    if isTrue(UnitIsDeadOrGhost, unit) then
      if not e.diedAt then e.diedAt, e.used = t, nil end
    elseif e.diedAt then
      -- Alive again: within FEIGN_SECONDS it feigned death (not a death); later it simply lives on. Either way no death stands.
      e.diedAt = nil
    end
    prune(t)
  end)
end

local function findSeen(name, guid)
  if guid and seen[guid] then return seen[guid] end
  if type(name) ~= "string" or name == "" then return nil end
  local lower = name:lower()
  local firstWord = lower:match("^(%S+)")
  local best
  for _, e in pairs(seen) do
    local theirs = e.name:lower()
    if theirs == lower then return e end
    if firstWord and theirs:match("^(%S+)") == firstWord and (not best or e.at > best.at) then best = e end
  end
  return best
end

local function recentDeath(t)
  local best
  for _, e in pairs(seen) do
    if e.diedAt and not e.used and t - e.diedAt <= DEATH_SECONDS and t - e.at <= SEEN_KEEP_SECONDS and (not best or e.diedAt > best.diedAt) then best = e end
  end
  return best
end

-- Who was killed, for a statistic delta at time t: honor line, else PARTY_KILL, else the newest enemy seen dying.
local function resolveVictim(t)
  if lineVictim and t - lineVictim.at <= ATTRIBUTION_SECONDS then return lineVictim.name, findSeen(lineVictim.name), "line" end
  if partyVictim and t - partyVictim.at <= ATTRIBUTION_SECONDS then return partyVictim.name, findSeen(partyVictim.name, partyVictim.guid), "party" end
  local e = recentDeath(t)
  if e then e.used = true; return e.name, e, "death" end
  return nil, nil, nil
end

local function enrich(row, e)
  if not e then return end
  row.c, row.l, row.g = e.class, e.level, e.guild
end

-- A source that arrives after the statistic counted the kill: names the "?n" row (or one a seen-dying guess named).
function wp.attachLate(name, src, t)
  if not lastRow or t - lastRow.at > ATTRIBUTION_SECONDS then return false end
  local row = lastRow.row
  if not (row.n:sub(1, 1) == "?" or (lastRow.src == "death" and src ~= "death")) then return false end
  row.n, row.c, row.l, row.g, lastRow.src = name, nil, nil, nil, src
  enrich(row, findSeen(name))
  return true
end

-- PARTY_KILL (killer GUID, victim GUID): only my own or my pet's killing blow on a player.
function wp.notePartyKill(killer, victim)
  if not active() or inInstance() or dueling() then return false end
  if type(victim) ~= "string" or not readable(victim) or victim:sub(1, 7) ~= "Player-" then return false end
  if type(killer) ~= "string" or not readable(killer) then return false end
  local okMe, me = pcall(UnitGUID, "player")
  local okPet, pet = pcall(UnitGUID, "pet")
  local mine = (okMe and readable(me) and me == killer) or (okPet and readable(pet) and pet ~= nil and pet == killer)
  if not mine then return false end
  local name = seen[victim] and seen[victim].name
  if not name and GetPlayerInfoByGUID then
    local ok, _, _, _, _, _, first = pcall(GetPlayerInfoByGUID, victim)
    if ok and type(first) == "string" and readable(first) and first ~= "" then name = clean(first, 40) end
  end
  if not name then return false end
  local t = clock()
  partyVictim = { name = name, guid = victim, at = t }
  if seen[victim] then seen[victim].used = true end
  wp.attachLate(name, "party", t)
  return true
end

-- Records one kill (victim "" when the game did not name one). Returns true when it was counted.
local function recordKill(victim, info, src)
  if not bump("kills") then return false end
  local s = store()
  local zone = GetRealZoneText and GetRealZoneText() or ""
  if type(zone) ~= "string" or (ns.isSecret and ns.isSecret(zone)) then zone = "" end
  local place, at = wp.where(), epoch()
  local defended = wp.defending()
  -- A kill the game did not name is stored as "?<n>": the bot's repeat-victim limit must never fold unnamed kills together.
  local who = victim ~= "" and victim or ("?" .. tostring((tonumber(s.seq) or 0) + 1))
  local row = { n = who, z = clean(zone, 40), at = at, d = defended and 1 or nil, m = place.m, x = place.x, y = place.y, a = place.a and 1 or nil }
  if victim ~= "" then enrich(row, info or findSeen(victim)) end
  s.recent[#s.recent + 1] = row
  lastRow = { row = row, at = clock(), src = victim ~= "" and src or nil }
  while #s.recent > RECENT do table.remove(s.recent, 1) end
  addEvent(s, "kill", clean(zone, 40), at, place)
  if defended then bump("defends") end
  return true
end

-- Two signals can announce the same kill, in either order: the honor line and the game's honorable-kill statistic going up
-- (PLAYER_PVP_KILLS_CHANGED). Whichever comes first counts it; the other, within PAIR_SECONDS, is the same kill.
local PAIR_SECONDS = 3
local lineAt, statAt, lastHK

-- An honorable kill line from the game. Returns true when it was counted.
-- WoW Forever runs on a modern client: the line may be missing, worded differently, or its text secret, so a line that is
-- not readable still counts as a kill when it is the honor-gain event and the statistic confirms it (see noteStatKill).
function wp.noteKill(text)
  if not active() or inInstance() or dueling() then return false end
  local victim = wp.victim(text)
  if not victim then return false end
  local t = clock()
  if lastKill and lastKill.name == victim and t - lastKill.at < DEDUPE_SECONDS then return false end
  lastKill = { name = victim, at = t }
  lineVictim = { name = victim, at = t }
  if statAt and t - statAt <= PAIR_SECONDS then
    statAt = nil; lineAt = t
    wp.attachLate(victim, "line", t) -- the statistic already counted it: only the name is new
    return false
  end
  lineAt = t
  return recordKill(victim, nil, "line")
end

-- The honorable-kills statistic rose (PLAYER_PVP_KILLS_CHANGED): a kill even when no honor line could be read. Battleground and
-- instance kills raise the statistic too but are not world PvP; the baseline still moves so they are never counted later.
function wp.noteStatKill()
  local ok, hk = pcall(function() return GetPVPLifetimeStats and GetPVPLifetimeStats() end)
  if not ok or type(hk) ~= "number" or hk ~= hk or (ns.isSecret and ns.isSecret(hk)) then return false end
  local before = lastHK
  lastHK = hk
  if before == nil or hk <= before or not active() or inInstance() or dueling() then return false end
  local t = clock()
  local counted = false
  for i = 1, math.min(hk - before, 5) do
    if i == 1 and lineAt and t - lineAt <= PAIR_SECONDS then lineAt = nil -- the honor line already counted it
    else
      statAt = t
      local victim, info, src = "", nil, nil
      if i == 1 then
        local okV, name, entry, source = pcall(resolveVictim, t)
        if okV and name then victim, info, src = name, entry, source end
      end
      counted = recordKill(victim, info, src) or counted
    end
  end
  return counted
end

function wp.baselineHK()
  local ok, hk = pcall(function() return GetPVPLifetimeStats and GetPVPLifetimeStats() end)
  if ok and type(hk) == "number" and hk == hk then lastHK = hk end
end

-- I died. Counts when Call for help confirmed an attack by an enemy player in the last minute.
function wp.noteDeath()
  if not active() or inInstance() then return false end
  local help = ns.callForHelp
  if not (help and help.attacked and help.attacked()) then return false end
  local t = clock()
  if lastDeathAt and t - lastDeathAt < DEATH_WINDOW_SECONDS then return false end
  lastDeathAt = t
  if not bump("deaths") then return false end
  -- Where and when, like a kill, but never who: no killer name or class is kept (an enemy player's name is theirs).
  local st = store()
  local zone = clean(currentZone(), 40)
  st.deathsRecent = type(st.deathsRecent) == "table" and st.deathsRecent or {}
  local place, at = wp.where(), epoch()
  st.deathsRecent[#st.deathsRecent + 1] = { z = zone, at = at, m = place.m, x = place.x, y = place.y, a = place.a and 1 or nil }
  while #st.deathsRecent > RECENT do table.remove(st.deathsRecent, 1) end
  addEvent(st, "death", zone, at, place)
  if zone ~= "" then
    st.zones = type(st.zones) == "table" and st.zones or {}
    if not st.zones[zone] then
      local n, lowest, lowestCount = 0, nil, nil
      for name, count in pairs(st.zones) do
        n = n + 1
        if not lowestCount or count < lowestCount then lowest, lowestCount = name, count end
      end
      if n >= MAX_ZONES and lowest then st.zones[lowest] = nil end
    end
    st.zones[zone] = (tonumber(st.zones[zone]) or 0) + 1
  end
  return true
end

-- From Call for help: "call" (I called), "answered" (a guildmate said On my way to my call),
-- "responded" (I pressed On my way; `zone` and `mapId` are where the call named).
function wp.note(kind, zone, mapId)
  if not active() then return false end
  if kind == "call" then return bump("calls") end
  if kind == "answered" then return bump("answered") end
  if kind == "responded" then
    defendingUntil = clock() + DEFEND_SECONDS
    defendingZone = type(zone) == "string" and zone ~= "" and clean(zone, 28) or nil
    defendingMap = tonumber(mapId) and tonumber(mapId) > 0 and tonumber(mapId) or nil
    return bump("responded")
  end
  return false
end

-- ---------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------

function wp.stats()
  local s = store()
  if not s then return blank(), blank() end
  return s.week, s.total
end

-- Kills per death (a death-free week shows the kills), one decimal.
function wp.kd(t)
  local kills, deaths = tonumber(t and t.kills) or 0, tonumber(t and t.deaths) or 0
  return string.format("%.1f", deaths > 0 and kills / deaths or kills)
end

-- The zones I died in most (open world only), most first: { { zone = "Hillsbrad Foothills", deaths = 4 }, ... }.
function wp.deadliestZones(limit)
  local s = store()
  local list = {}
  for zone, count in pairs(s and s.zones or {}) do list[#list + 1] = { zone = zone, deaths = tonumber(count) or 0 } end
  table.sort(list, function(a, b) return a.deaths > b.deaths or (a.deaths == b.deaths and a.zone < b.zone) end)
  while #list > (limit or 3) do table.remove(list) end
  return list
end

-- The K/D and deadliest-zones lines under the counters; none until a death was counted.
function wp.details()
  local week, total = wp.stats()
  if (tonumber(total.deaths) or 0) == 0 then return {} end
  local lines = { string.format(L("K/D: %s this week, %s in total."), wp.kd(week), wp.kd(total)) }
  local zones = {}
  for _, z in ipairs(wp.deadliestZones(3)) do zones[#zones + 1] = string.format("%s (%d)", z.zone, z.deaths) end
  if #zones > 0 then lines[#lines + 1] = string.format(L("Deadliest zones: %s."), table.concat(zones, ", ")) end
  return lines
end

local function line(prefix, t)
  return string.format(L("%s: %d kills, %d deaths, %d defends. Calls for help: %d made (%d answered), %d answered by me."),
    prefix, t.kills or 0, t.deaths or 0, t.defends or 0, t.calls or 0, t.answered or 0, t.responded or 0)
end

function wp.summary()
  local week, total = wp.stats()
  return line(L("World PvP this week"), week), line(L("World PvP in total"), total)
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["worldpvp"] = function()
  local a, b = wp.summary()
  ns.message(a)
  ns.message(b)
  for _, extra in ipairs(wp.details()) do ns.message(extra) end
  ns.message(L("Kills and deaths are shown by zone and position on the public pages of guilds that publish."))
end
ns.commandHandlers["wpvp"] = ns.commandHandlers["worldpvp"]
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded worldpvp - my open-world kills, deaths, defends and calls for help, this week and in total; kills and deaths are shown by zone and position on the public pages of guilds that publish")

local frame = CreateFrame("Frame")
local function register(event)
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event, true)
  else pcall(frame.RegisterEvent, frame, event) end
end
register("CHAT_MSG_COMBAT_HONOR_GAIN")
register("PLAYER_PVP_KILLS_CHANGED")
register("PLAYER_DEAD")
register("PLAYER_ENTERING_WORLD")
register("ZONE_CHANGED_NEW_AREA")
-- Victim enrichment (all guarded: an event the client does not have is skipped).
register("PARTY_KILL")
register("PLAYER_TARGET_CHANGED")
register("UPDATE_MOUSEOVER_UNIT")
register("NAME_PLATE_UNIT_ADDED")
register("NAME_PLATE_UNIT_REMOVED")
register("UNIT_HEALTH")
register("DUEL_REQUESTED")
register("DUEL_FINISHED")
local sampleTimer = 0
function wp.tick(elapsed)
  sampleTimer = sampleTimer + (tonumber(elapsed) or 0)
  if sampleTimer < SAMPLE_SECONDS then return end
  sampleTimer = 0
  pcall(function()
    if active() then wp.sample()
    else
      -- Module off: nothing is recorded, and what was kept of kills' and deaths' places is dropped.
      local db = ns.getDb and ns.getDb()
      local s = type(db) == "table" and db.worldPvp
      if type(s) == "table" then
        s.events = nil
        for _, list in ipairs({ s.recent or {}, s.deathsRecent or {} }) do
          for _, row in ipairs(list) do
            if type(row) == "table" then row.m, row.x, row.y, row.a = nil, nil, nil, nil end
          end
        end
      end
      lastPlace = nil
    end
  end)
end
frame:SetScript("OnUpdate", function(_, elapsed) wp.tick(elapsed) end)
frame:SetScript("OnEvent", function(_, event, text, second)
  local ok, err = pcall(function()
    if event == "UPDATE_MOUSEOVER_UNIT" then wp.observe("mouseover")
    elseif event == "UNIT_HEALTH" or event == "NAME_PLATE_UNIT_ADDED" or event == "NAME_PLATE_UNIT_REMOVED" then
      -- Cheap filter first: UNIT_HEALTH fires for every unit in sight.
      if isUnitToken(text) then wp.observe(text) end
    elseif event == "PLAYER_TARGET_CHANGED" then wp.observe("target")
    elseif event == "PARTY_KILL" then wp.notePartyKill(text, second)
    elseif event == "DUEL_REQUESTED" then duelUntil = clock() + DUEL_SECONDS
    elseif event == "DUEL_FINISHED" then duelUntil = nil
    elseif event == "CHAT_MSG_COMBAT_HONOR_GAIN" then wp.noteKill(text)
    elseif event == "PLAYER_PVP_KILLS_CHANGED" then wp.noteStatKill()
    elseif event == "PLAYER_DEAD" then wp.noteDeath()
    else
      if event == "PLAYER_ENTERING_WORLD" and lastHK == nil then wp.baselineHK() end
      wp.sample()
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "world pvp: " .. tostring(err)) end
end)
